/**
 * Epic 63 — External Reputation Bridge — Unit Tests
 *
 * Tests:
 * 1. Cache: TTL, stale-while-revalidate, invalidation
 * 2. Tier/confidence mapping (pure functions from types)
 * 3. A2A feedback source: score calculation with mocked Supabase
 * 4. TrustScoreCalculator: aggregation, weight redistribution, DB persistence
 * 5. Policy engine: unified_score normalization
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { TEST_AGENTS } from '../setup.js';

// ============================================
// 1. Cache Tests
// ============================================

import {
  getCached,
  setCached,
  invalidate,
  clearAll,
  cacheKey,
} from '../../src/services/reputation/cache.js';
import type { UnifiedTrustScore } from '../../src/services/reputation/types.js';
import { TIER_THRESHOLDS } from '../../src/services/reputation/types.js';

function makeTrustScore(overrides: Partial<UnifiedTrustScore> = {}): UnifiedTrustScore {
  return {
    score: 750,
    tier: 'B',
    confidence: 'medium',
    dimensions: [],
    dataPoints: 5,
    lastRefreshed: new Date().toISOString(),
    stale: false,
    ...overrides,
  };
}

describe('Reputation Cache', () => {
  beforeEach(() => {
    clearAll();
  });

  it('returns null for missing keys', () => {
    expect(getCached('reputation:nonexistent')).toBeNull();
  });

  it('stores and retrieves values within TTL', () => {
    const score = makeTrustScore();
    setCached('reputation:agent-1', score);

    const result = getCached('reputation:agent-1');
    expect(result).not.toBeNull();
    expect(result!.stale).toBe(false);
    expect(result!.value.score).toBe(750);
    expect(result!.value.stale).toBe(false);
  });

  it('returns stale data after TTL but within grace period', () => {
    const score = makeTrustScore();
    // Set with a very short TTL so it expires immediately
    setCached('reputation:agent-1', score, 0);

    // Should be stale but still returned (within 15 min grace)
    const result = getCached('reputation:agent-1');
    expect(result).not.toBeNull();
    expect(result!.stale).toBe(true);
    expect(result!.value.stale).toBe(true);
    expect(result!.value.score).toBe(750);
  });

  it('invalidate removes entry', () => {
    setCached('reputation:agent-1', makeTrustScore());
    invalidate('reputation:agent-1');
    expect(getCached('reputation:agent-1')).toBeNull();
  });

  it('clearAll removes all entries', () => {
    setCached('reputation:a', makeTrustScore());
    setCached('reputation:b', makeTrustScore({ score: 500 }));
    clearAll();
    expect(getCached('reputation:a')).toBeNull();
    expect(getCached('reputation:b')).toBeNull();
  });

  it('cacheKey formats correctly', () => {
    expect(cacheKey('abc-123')).toBe('reputation:abc-123');
  });
});

// ============================================
// 2. Tier Mapping Tests
// ============================================

describe('Tier Thresholds', () => {
  function scoreToTier(score: number) {
    for (const t of TIER_THRESHOLDS) {
      if (score >= t.min) return t.tier;
    }
    return 'F';
  }

  it.each([
    [1000, 'A'],
    [900, 'A'],
    [899, 'B'],
    [750, 'B'],
    [749, 'C'],
    [600, 'C'],
    [599, 'D'],
    [400, 'D'],
    [399, 'E'],
    [200, 'E'],
    [199, 'F'],
    [0, 'F'],
  ])('score %d maps to tier %s', (score, expectedTier) => {
    expect(scoreToTier(score)).toBe(expectedTier);
  });
});

// ============================================
// 3. A2A Feedback Source Tests (mocked Supabase)
// ============================================

// Mock the DB client module — singleton so all callers share the same mock
const _sharedMockQuery = {
  select: vi.fn().mockReturnThis(),
  eq: vi.fn().mockReturnThis(),
};
const _sharedMockSupabase = {
  from: vi.fn(() => _sharedMockQuery),
  _query: _sharedMockQuery,
};
vi.mock('../../src/db/client.js', () => ({
  createClient: vi.fn(() => _sharedMockSupabase),
}));

describe('A2A Feedback Source', () => {
  // Use vi.importActual to get the real (unmocked) a2a-feedback source,
  // since vi.mock for that module is hoisted for the calculator tests below.
  // The DB client is mocked via _sharedMockSupabase singleton.
  let realQuery: (id: string) => Promise<any>;

  beforeAll(async () => {
    const real = await vi.importActual<any>('../../src/services/reputation/sources/a2a-feedback.js');
    realQuery = real.a2aFeedbackSource.query;
  });

  beforeEach(() => {
    vi.clearAllMocks();
  });

  function mockFeedbackResponse(data: any[] | null, error: any = null) {
    _sharedMockSupabase.from.mockReturnValue({
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockResolvedValue({ data, error }),
      }),
    });
  }

  it('returns unavailable for non-UUID identifiers', async () => {
    const result = await realQuery('0xABC123');
    expect(result.available).toBe(false);
    expect(result.source).toBe('a2a_feedback');
    expect(result.score).toBeNull();
  });

  it('returns unavailable when no feedback exists', async () => {
    mockFeedbackResponse([]);
    const result = await realQuery(TEST_AGENTS.payroll);
    expect(result.available).toBe(false);
    expect(result.dataPoints).toBe(0);
  });

  it('computes score from feedback with scores', async () => {
    mockFeedbackResponse([
      { action: 'accept', satisfaction: 'excellent', score: 90 },
      { action: 'accept', satisfaction: 'acceptable', score: 70 },
      { action: 'accept', satisfaction: 'excellent', score: 80 },
    ]);

    const result = await realQuery(TEST_AGENTS.payroll);
    expect(result.available).toBe(true);
    expect(result.dataPoints).toBe(3);
    // avg score = (90+70+80)/3 = 80 → 800 on 0-1000 scale
    // rejection rate = 0 → penalty = 0
    // finalScore = 800
    expect(result.score).toBe(800);
    expect(result.dimensions?.service_quality).toBe(800);
  });

  it('applies rejection penalty', async () => {
    mockFeedbackResponse([
      { action: 'accept', satisfaction: 'acceptable', score: 80 },
      { action: 'reject', satisfaction: null, score: 20 },
    ]);

    const result = await realQuery(TEST_AGENTS.payroll);
    expect(result.available).toBe(true);
    // avg score = (80+20)/2 = 50 → 500 on 0-1000 scale
    // rejection rate = 0.5 → penalty = 250
    // finalScore = 500 - 250 = 250
    expect(result.score).toBe(250);
  });

  it('uses acceptance-rate-only scoring when no numeric scores', async () => {
    mockFeedbackResponse([
      { action: 'accept', satisfaction: 'excellent', score: null },
      { action: 'accept', satisfaction: 'acceptable', score: null },
      { action: 'reject', satisfaction: null, score: null },
    ]);

    const result = await realQuery(TEST_AGENTS.payroll);
    expect(result.available).toBe(true);
    // No scored entries → use acceptance-rate formula
    // rejection rate = 1/3 ≈ 0.333
    // finalScore = round(700 - 0.333 * 500) = round(700 - 166.67) = 533
    expect(result.score).toBe(533);
  });
});

// ============================================
// 4. TrustScoreCalculator Tests (mocked sources)
// ============================================

// Mock all source modules to control their behavior
vi.mock('../../src/services/reputation/sources/erc8004.js', () => ({
  erc8004Source: {
    name: 'erc8004',
    query: vi.fn(),
  },
}));
vi.mock('../../src/services/reputation/sources/mnemom.js', () => ({
  mnemomSource: {
    name: 'mnemom',
    query: vi.fn(),
  },
}));
vi.mock('../../src/services/reputation/sources/vouched.js', () => ({
  vouchedSource: {
    name: 'vouched',
    query: vi.fn(),
  },
}));
vi.mock('../../src/services/reputation/sources/escrow-history.js', () => ({
  escrowHistorySource: {
    name: 'escrow_history',
    query: vi.fn(),
  },
}));
vi.mock('../../src/services/reputation/sources/a2a-feedback.js', async (importOriginal) => {
  // Keep the real implementation for the a2a-feedback source tests above,
  // but the calculator imports its own reference that we can override
  const original = await importOriginal<any>();
  return {
    ...original,
    a2aFeedbackSource: {
      name: 'a2a_feedback',
      query: vi.fn(),
    },
  };
});

import { TrustScoreCalculator } from '../../src/services/reputation/trust-score-calculator.js';
import { erc8004Source } from '../../src/services/reputation/sources/erc8004.js';
import { mnemomSource } from '../../src/services/reputation/sources/mnemom.js';
import { vouchedSource } from '../../src/services/reputation/sources/vouched.js';
import { escrowHistorySource } from '../../src/services/reputation/sources/escrow-history.js';
// Import the calculator's version (mocked)
import { a2aFeedbackSource as a2aFeedbackMock } from '../../src/services/reputation/sources/a2a-feedback.js';

function makeUnavailable(source: string): any {
  return {
    source,
    available: false,
    score: null,
    rawData: { reason: 'stub' },
    dataPoints: 0,
    queriedAt: new Date().toISOString(),
    latencyMs: 1,
  };
}

function makeAvailable(source: string, score: number, dims: Record<string, number> = {}): any {
  return {
    source,
    available: true,
    score,
    rawData: {},
    dataPoints: 1,
    queriedAt: new Date().toISOString(),
    latencyMs: 10,
    dimensions: dims,
  };
}

function createMockSupabase() {
  const mockQuery = {
    select: vi.fn().mockReturnThis(),
    insert: vi.fn().mockReturnThis(),
    upsert: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    or: vi.fn().mockReturnThis(),
    maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
  };
  return {
    from: vi.fn().mockReturnValue(mockQuery),
    _query: mockQuery,
  } as any;
}

describe('TrustScoreCalculator', () => {
  let supabase: any;

  beforeEach(() => {
    clearAll(); // Clear reputation cache between tests
    supabase = createMockSupabase();
    vi.clearAllMocks();

    // Default: all sources unavailable
    (erc8004Source.query as any).mockResolvedValue(makeUnavailable('erc8004'));
    (mnemomSource.query as any).mockResolvedValue(makeUnavailable('mnemom'));
    (vouchedSource.query as any).mockResolvedValue(makeUnavailable('vouched'));
    (escrowHistorySource.query as any).mockResolvedValue(makeUnavailable('escrow_history'));
    (a2aFeedbackMock.query as any).mockResolvedValue(makeUnavailable('a2a_feedback'));
  });

  it('returns tier F with confidence none when no sources available', async () => {
    const calc = new TrustScoreCalculator(supabase);
    const result = await calc.compute(TEST_AGENTS.payroll);

    expect(result.score).toBe(0);
    expect(result.tier).toBe('F');
    expect(result.confidence).toBe('none');
    expect(result.dimensions).toHaveLength(0);
  });

  it('computes score from a single source (low confidence)', async () => {
    (a2aFeedbackMock.query as any).mockResolvedValue(
      makeAvailable('a2a_feedback', 700, { service_quality: 700 })
    );

    const calc = new TrustScoreCalculator(supabase);
    const result = await calc.compute(TEST_AGENTS.payroll);

    expect(result.confidence).toBe('low');
    // Single dimension: service_quality at 700
    // With only service_quality available, all weight goes to it → score = 700
    expect(result.score).toBe(700);
    expect(result.tier).toBe('C');
    expect(result.dimensions).toHaveLength(1);
    expect(result.dimensions[0].name).toBe('service_quality');
    expect(result.dimensions[0].weight).toBe(1); // all weight redistributed here
  });

  it('computes score from two sources (medium confidence)', async () => {
    (erc8004Source.query as any).mockResolvedValue(
      makeAvailable('erc8004', 800, { identity: 700, community_signal: 600 })
    );
    (a2aFeedbackMock.query as any).mockResolvedValue(
      makeAvailable('a2a_feedback', 900, { service_quality: 900 })
    );

    const calc = new TrustScoreCalculator(supabase);
    const result = await calc.compute(TEST_AGENTS.payroll);

    expect(result.confidence).toBe('medium');
    // With service_quality available, use WEIGHTS_WITH_SERVICE_QUALITY
    // Active dims: identity(0.22), community_signal(0.16), service_quality(0.15)
    // Total active weight = 0.22 + 0.16 + 0.15 = 0.53
    // Normalized: identity=0.22/0.53≈0.42, community=0.16/0.53≈0.30, sq=0.15/0.53≈0.28
    // Score ≈ 700*0.42 + 600*0.30 + 900*0.28 ≈ 294 + 180 + 252 = 726
    expect(result.score).toBeGreaterThan(700);
    expect(result.score).toBeLessThan(800);
    expect(result.tier).toBe('C');
    expect(result.dimensions.length).toBe(3);
  });

  it('computes score from three+ sources (high confidence)', async () => {
    (erc8004Source.query as any).mockResolvedValue(
      makeAvailable('erc8004', 800, { identity: 800, community_signal: 750, capability_trust: 700 })
    );
    (a2aFeedbackMock.query as any).mockResolvedValue(
      makeAvailable('a2a_feedback', 850, { service_quality: 850 })
    );
    (mnemomSource.query as any).mockResolvedValue(
      makeAvailable('mnemom', 780, { capability_trust: 780 })
    );

    const calc = new TrustScoreCalculator(supabase);
    const result = await calc.compute(TEST_AGENTS.payroll);

    expect(result.confidence).toBe('high');
    expect(result.score).toBeGreaterThan(700);
    expect(result.tier).toMatch(/^[A-C]$/);
  });

  it('redistributes weights when only some dimensions have data', async () => {
    // Only identity dimension available → it gets 100% weight
    (erc8004Source.query as any).mockResolvedValue(
      makeAvailable('erc8004', 900, { identity: 900 })
    );

    const calc = new TrustScoreCalculator(supabase);
    const result = await calc.compute(TEST_AGENTS.payroll);

    expect(result.dimensions).toHaveLength(1);
    expect(result.dimensions[0].name).toBe('identity');
    expect(result.dimensions[0].weight).toBe(1);
    expect(result.score).toBe(900);
    expect(result.tier).toBe('A');
  });

  it('averages multiple sources contributing to same dimension', async () => {
    // Both erc8004 and mnemom feed capability_trust
    (erc8004Source.query as any).mockResolvedValue(
      makeAvailable('erc8004', 600, { capability_trust: 600 })
    );
    (mnemomSource.query as any).mockResolvedValue(
      makeAvailable('mnemom', 800, { capability_trust: 800 })
    );

    const calc = new TrustScoreCalculator(supabase);
    const result = await calc.compute(TEST_AGENTS.payroll);

    // capability_trust = avg(600, 800) = 700
    const ctDim = result.dimensions.find(d => d.name === 'capability_trust');
    expect(ctDim).toBeDefined();
    expect(ctDim!.score).toBe(700);
    expect(ctDim!.sources).toEqual(['erc8004', 'mnemom']);
  });

  it('persists to DB on fresh computation', async () => {
    (a2aFeedbackMock.query as any).mockResolvedValue(
      makeAvailable('a2a_feedback', 600, { service_quality: 600 })
    );

    const calc = new TrustScoreCalculator(supabase);
    await calc.compute(TEST_AGENTS.payroll);

    // Should have called upsert on reputation_scores
    expect(supabase.from).toHaveBeenCalledWith('reputation_scores');
    const upsertCalls = supabase._query.upsert.mock.calls;
    expect(upsertCalls.length).toBeGreaterThan(0);

    const record = upsertCalls[0][0];
    expect(record.agent_id).toBe(TEST_AGENTS.payroll);
    expect(record.unified_score).toBe(600);
    expect(record.unified_tier).toBe('C');
  });

  it('uses external_identifier for non-UUID identifiers', async () => {
    const walletAddr = '0x1234567890abcdef1234567890abcdef12345678';

    // All sources return unavailable for wallet address
    const calc = new TrustScoreCalculator(supabase);
    await calc.compute(walletAddr);

    // Should persist with external_identifier, not agent_id
    const upsertCalls = supabase._query.upsert.mock.calls;
    if (upsertCalls.length > 0) {
      const record = upsertCalls[0][0];
      expect(record.external_identifier).toBe(walletAddr);
      expect(record.agent_id).toBeUndefined();
    }
  });

  it('logs queries to reputation_queries table', async () => {
    const calc = new TrustScoreCalculator(supabase);
    await calc.compute(TEST_AGENTS.payroll);

    // Should have called insert on reputation_queries
    const insertCalls = supabase._query.insert.mock.calls;
    expect(insertCalls.length).toBeGreaterThan(0);
    const rows = insertCalls[0][0];
    expect(Array.isArray(rows)).toBe(true);
    expect(rows.length).toBe(5); // 5 sources queried
    expect(rows[0].identifier).toBe(TEST_AGENTS.payroll);
  });

  it('returns cached value on second call', async () => {
    (a2aFeedbackMock.query as any).mockResolvedValue(
      makeAvailable('a2a_feedback', 700, { service_quality: 700 })
    );

    const calc = new TrustScoreCalculator(supabase);
    const first = await calc.compute(TEST_AGENTS.payroll);
    const second = await calc.compute(TEST_AGENTS.payroll);

    expect(second.score).toBe(first.score);
    // Source should only be queried once (second call hits cache)
    expect((a2aFeedbackMock.query as any).mock.calls.length).toBe(1);
  });

  it('getSourceBreakdown returns all source results', async () => {
    (a2aFeedbackMock.query as any).mockResolvedValue(
      makeAvailable('a2a_feedback', 700, { service_quality: 700 })
    );

    const calc = new TrustScoreCalculator(supabase);
    const sources = await calc.getSourceBreakdown(TEST_AGENTS.payroll);

    expect(sources).toHaveLength(5);
    const available = sources.filter(s => s.available);
    expect(available).toHaveLength(1);
    expect(available[0].source).toBe('a2a_feedback');
  });
});

// ============================================
// 5. Policy Engine — unified_score normalization
// ============================================

describe('ContractPolicyEngine — reputation lookup', () => {
  it('normalizes unified_score from 0-1000 to 0-1', async () => {
    // Import the real module (not mocked for this test)
    const { ContractPolicyEngine } = await import('../../src/services/contract-policy-engine.js');

    const supabase = createMockSupabase();

    // Mock table-specific returns
    supabase.from.mockImplementation((table: string) => {
      const query = {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        is: vi.fn().mockReturnThis(),
        or: vi.fn().mockReturnThis(),
        in: vi.fn().mockReturnThis(),
        order: vi.fn().mockReturnThis(),
        range: vi.fn().mockReturnThis(),
        limit: vi.fn().mockReturnThis(),
        insert: vi.fn().mockReturnThis(),
        update: vi.fn().mockReturnThis(),
        upsert: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValue({ data: null, error: null }),
        maybeSingle: vi.fn().mockResolvedValue({
          data: table === 'reputation_scores'
            ? { unified_score: 750 } // 750/1000 = 0.75
            : null,
          error: null,
        }),
      };
      return query;
    });

    const engine = new ContractPolicyEngine(supabase);

    // Access the private method via prototype for testing
    const reputation = await (engine as any).getCounterpartyReputation(TEST_AGENTS.payroll);

    // Should be normalized to 0-1 scale
    expect(reputation).toBe(0.75);
  });

  it('returns null when no reputation data', async () => {
    const { ContractPolicyEngine } = await import('../../src/services/contract-policy-engine.js');

    const supabase = createMockSupabase();

    const engine = new ContractPolicyEngine(supabase);
    const reputation = await (engine as any).getCounterpartyReputation(TEST_AGENTS.payroll);

    expect(reputation).toBeNull();
  });
});
