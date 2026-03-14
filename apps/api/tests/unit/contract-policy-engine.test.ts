/**
 * Contract Policy Engine — Unit Tests
 *
 * Epic 18: Agent Wallets & Contract Policies
 * Tests the policy engine, exposure tracking, and negotiation guardrails.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ContractPolicyEngine } from '../../src/services/contract-policy-engine.js';
import { CounterpartyExposureService } from '../../src/services/counterparty-exposure.service.js';

// ============================================
// Mock Supabase
// ============================================

function createMockSupabase(overrides: Record<string, any> = {}) {
  const mockQuery = {
    select: vi.fn().mockReturnThis(),
    insert: vi.fn().mockReturnThis(),
    update: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    is: vi.fn().mockReturnThis(),
    in: vi.fn().mockReturnThis(),
    order: vi.fn().mockReturnThis(),
    range: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    single: vi.fn().mockResolvedValue({ data: null, error: null }),
    maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
    ...overrides,
  };

  return {
    from: vi.fn().mockReturnValue(mockQuery),
    _query: mockQuery,
  } as any;
}

// ============================================
// Wallet factory
// ============================================

function makeWallet(policyOverrides: Record<string, any> = {}) {
  return {
    id: 'wallet-1',
    tenant_id: 'tenant-1',
    owner_account_id: 'account-1',
    managed_by_agent_id: 'agent-1',
    balance: '1000.0000',
    currency: 'USDC',
    spending_policy: {
      dailySpendLimit: 500,
      dailySpent: 0,
      monthlySpendLimit: 5000,
      monthlySpent: 0,
      ...policyOverrides,
    },
    status: 'active',
  };
}

// ============================================
// ContractPolicyEngine Tests
// ============================================

describe('ContractPolicyEngine', () => {
  describe('evaluate — basic spending policy checks (reused from SpendingPolicyService)', () => {
    it('approves payment within spending limits', async () => {
      const wallet = makeWallet();
      const supabase = createMockSupabase();
      // Return wallet on first query, null on exposure lookup
      supabase.from.mockImplementation((table: string) => {
        const query = {
          select: vi.fn().mockReturnThis(),
          insert: vi.fn().mockReturnThis(),
          update: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          is: vi.fn().mockReturnThis(),
          order: vi.fn().mockReturnThis(),
          range: vi.fn().mockReturnThis(),
          single: vi.fn().mockResolvedValue({ data: table === 'wallets' ? wallet : null, error: null }),
          maybeSingle: vi.fn().mockResolvedValue({ data: table === 'wallets' ? wallet : null, error: null }),
        };
        return query;
      });

      const engine = new ContractPolicyEngine(supabase);
      const result = await engine.evaluate({
        walletId: 'wallet-1',
        agentId: 'agent-1',
        tenantId: 'tenant-1',
        amount: 10,
        actionType: 'payment',
        dryRun: true,
      });

      expect(result.decision).toBe('approve');
      expect(result.checks.some((c) => c.check === 'spending_policy' && c.result === 'pass')).toBe(true);
    });

    it('denies payment exceeding daily limit', async () => {
      const wallet = makeWallet({ dailySpendLimit: 50, dailySpent: 45 });
      const supabase = createMockSupabase();
      supabase.from.mockImplementation((table: string) => {
        const query = {
          select: vi.fn().mockReturnThis(),
          insert: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          is: vi.fn().mockReturnThis(),
          single: vi.fn().mockResolvedValue({ data: table === 'wallets' ? wallet : null, error: null }),
          maybeSingle: vi.fn().mockResolvedValue({ data: table === 'wallets' ? wallet : null, error: null }),
        };
        return query;
      });

      const engine = new ContractPolicyEngine(supabase);
      const result = await engine.evaluate({
        walletId: 'wallet-1',
        agentId: 'agent-1',
        tenantId: 'tenant-1',
        amount: 10,
        actionType: 'payment',
        dryRun: true,
      });

      expect(result.decision).toBe('deny');
      expect(result.reasons.some((r) => r.includes('daily spend limit'))).toBe(true);
      // Should suggest counter-offer with remaining daily limit
      expect(result.suggestedCounterOffer).toBeDefined();
      expect(result.suggestedCounterOffer!.maxAmount).toBe(5);
    });
  });

  describe('evaluate — counterparty blocklist', () => {
    it('denies payment to blocklisted counterparty', async () => {
      const wallet = makeWallet({
        contractPolicy: {
          counterpartyBlocklist: ['bad-agent-id'],
        },
      });
      const supabase = createMockSupabase();
      supabase.from.mockImplementation((table: string) => {
        const query = {
          select: vi.fn().mockReturnThis(),
          insert: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          is: vi.fn().mockReturnThis(),
          single: vi.fn().mockResolvedValue({ data: table === 'wallets' ? wallet : null, error: null }),
          maybeSingle: vi.fn().mockResolvedValue({ data: table === 'wallets' ? wallet : null, error: null }),
        };
        return query;
      });

      const engine = new ContractPolicyEngine(supabase);
      const result = await engine.evaluate({
        walletId: 'wallet-1',
        agentId: 'agent-1',
        tenantId: 'tenant-1',
        amount: 10,
        actionType: 'payment',
        counterpartyAgentId: 'bad-agent-id',
        dryRun: true,
      });

      expect(result.decision).toBe('deny');
      expect(result.checks.some((c) => c.check === 'counterparty_blocklist' && c.result === 'fail')).toBe(true);
    });

    it('approves payment to non-blocklisted counterparty', async () => {
      const wallet = makeWallet({
        contractPolicy: {
          counterpartyBlocklist: ['bad-agent-id'],
        },
      });
      const supabase = createMockSupabase();
      supabase.from.mockImplementation((table: string) => {
        const query = {
          select: vi.fn().mockReturnThis(),
          insert: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          is: vi.fn().mockReturnThis(),
          single: vi.fn().mockResolvedValue({ data: table === 'wallets' ? wallet : null, error: null }),
          maybeSingle: vi.fn().mockResolvedValue({ data: table === 'wallets' ? wallet : null, error: null }),
        };
        return query;
      });

      const engine = new ContractPolicyEngine(supabase);
      const result = await engine.evaluate({
        walletId: 'wallet-1',
        agentId: 'agent-1',
        tenantId: 'tenant-1',
        amount: 10,
        actionType: 'payment',
        counterpartyAgentId: 'good-agent-id',
        dryRun: true,
      });

      expect(result.decision).toBe('approve');
    });
  });

  describe('evaluate — counterparty allowlist', () => {
    it('denies payment to counterparty not in allowlist', async () => {
      const wallet = makeWallet({
        contractPolicy: {
          counterpartyAllowlist: ['allowed-agent-1', 'allowed-agent-2'],
        },
      });
      const supabase = createMockSupabase();
      supabase.from.mockImplementation((table: string) => {
        const query = {
          select: vi.fn().mockReturnThis(),
          insert: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          is: vi.fn().mockReturnThis(),
          single: vi.fn().mockResolvedValue({ data: table === 'wallets' ? wallet : null, error: null }),
          maybeSingle: vi.fn().mockResolvedValue({ data: table === 'wallets' ? wallet : null, error: null }),
        };
        return query;
      });

      const engine = new ContractPolicyEngine(supabase);
      const result = await engine.evaluate({
        walletId: 'wallet-1',
        agentId: 'agent-1',
        tenantId: 'tenant-1',
        amount: 10,
        actionType: 'payment',
        counterpartyAgentId: 'unknown-agent',
        dryRun: true,
      });

      expect(result.decision).toBe('deny');
      expect(result.checks.some((c) => c.check === 'counterparty_allowlist' && c.result === 'fail')).toBe(true);
    });
  });

  describe('evaluate — contract type restrictions', () => {
    it('denies blocked contract type', async () => {
      const wallet = makeWallet({
        contractPolicy: {
          blockedContractTypes: ['loan', 'margin'],
        },
      });
      const supabase = createMockSupabase();
      supabase.from.mockImplementation((table: string) => {
        const query = {
          select: vi.fn().mockReturnThis(),
          insert: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          is: vi.fn().mockReturnThis(),
          single: vi.fn().mockResolvedValue({ data: table === 'wallets' ? wallet : null, error: null }),
          maybeSingle: vi.fn().mockResolvedValue({ data: table === 'wallets' ? wallet : null, error: null }),
        };
        return query;
      });

      const engine = new ContractPolicyEngine(supabase);
      const result = await engine.evaluate({
        walletId: 'wallet-1',
        agentId: 'agent-1',
        tenantId: 'tenant-1',
        amount: 10,
        actionType: 'contract_sign',
        contractType: 'loan',
        dryRun: true,
      });

      expect(result.decision).toBe('deny');
      expect(result.checks.some((c) => c.check === 'contract_type_blocked' && c.result === 'fail')).toBe(true);
    });

    it('allows permitted contract type', async () => {
      const wallet = makeWallet({
        contractPolicy: {
          allowedContractTypes: ['payment', 'escrow'],
        },
      });
      const supabase = createMockSupabase();
      supabase.from.mockImplementation((table: string) => {
        const query = {
          select: vi.fn().mockReturnThis(),
          insert: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          is: vi.fn().mockReturnThis(),
          single: vi.fn().mockResolvedValue({ data: table === 'wallets' ? wallet : null, error: null }),
          maybeSingle: vi.fn().mockResolvedValue({ data: table === 'wallets' ? wallet : null, error: null }),
        };
        return query;
      });

      const engine = new ContractPolicyEngine(supabase);
      const result = await engine.evaluate({
        walletId: 'wallet-1',
        agentId: 'agent-1',
        tenantId: 'tenant-1',
        amount: 10,
        actionType: 'contract_sign',
        contractType: 'payment',
        dryRun: true,
      });

      expect(result.decision).toBe('approve');
    });
  });

  describe('evaluate — escalation threshold', () => {
    it('escalates when amount exceeds contract policy escalation threshold', async () => {
      const wallet = makeWallet({
        contractPolicy: {
          escalateAbove: 50,
        },
      });
      const supabase = createMockSupabase();
      supabase.from.mockImplementation((table: string) => {
        const query = {
          select: vi.fn().mockReturnThis(),
          insert: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          is: vi.fn().mockReturnThis(),
          single: vi.fn().mockResolvedValue({ data: table === 'wallets' ? wallet : null, error: null }),
          maybeSingle: vi.fn().mockResolvedValue({ data: table === 'wallets' ? wallet : null, error: null }),
        };
        return query;
      });

      const engine = new ContractPolicyEngine(supabase);
      const result = await engine.evaluate({
        walletId: 'wallet-1',
        agentId: 'agent-1',
        tenantId: 'tenant-1',
        amount: 100,
        actionType: 'payment',
        dryRun: true,
      });

      expect(result.decision).toBe('escalate');
      expect(result.checks.some((c) => c.check === 'escalation_threshold' && c.result === 'fail')).toBe(true);
    });
  });

  describe('evaluate — KYA tier check', () => {
    it('denies when counterparty KYA tier is below minimum', async () => {
      const wallet = makeWallet({
        contractPolicy: {
          minCounterpartyKyaTier: 2,
        },
      });
      const supabase = createMockSupabase();
      supabase.from.mockImplementation((table: string) => {
        const query = {
          select: vi.fn().mockReturnThis(),
          insert: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          is: vi.fn().mockReturnThis(),
          single: vi.fn().mockResolvedValue({
            data: table === 'wallets' ? wallet : table === 'agents' ? { kya_tier: 1 } : null,
            error: null,
          }),
          maybeSingle: vi.fn().mockResolvedValue({
            data: table === 'wallets' ? wallet : table === 'agents' ? { kya_tier: 1 } : null,
            error: null,
          }),
        };
        return query;
      });

      const engine = new ContractPolicyEngine(supabase);
      const result = await engine.evaluate({
        walletId: 'wallet-1',
        agentId: 'agent-1',
        tenantId: 'tenant-1',
        amount: 10,
        actionType: 'payment',
        counterpartyAgentId: 'low-tier-agent',
        dryRun: true,
      });

      expect(result.decision).toBe('deny');
      expect(result.checks.some((c) => c.check === 'counterparty_kya_tier' && c.result === 'fail')).toBe(true);
    });
  });

  describe('evaluate — no policy configured', () => {
    it('approves when no spending_policy at all', async () => {
      const wallet = { ...makeWallet(), spending_policy: null };
      const supabase = createMockSupabase();
      supabase.from.mockImplementation((table: string) => {
        const query = {
          select: vi.fn().mockReturnThis(),
          insert: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          is: vi.fn().mockReturnThis(),
          single: vi.fn().mockResolvedValue({ data: table === 'wallets' ? wallet : null, error: null }),
          maybeSingle: vi.fn().mockResolvedValue({ data: table === 'wallets' ? wallet : null, error: null }),
        };
        return query;
      });

      const engine = new ContractPolicyEngine(supabase);
      const result = await engine.evaluate({
        walletId: 'wallet-1',
        agentId: 'agent-1',
        tenantId: 'tenant-1',
        amount: 10,
        actionType: 'payment',
        dryRun: true,
      });

      expect(result.decision).toBe('approve');
    });
  });

  describe('evaluate — evaluationMs is tracked', () => {
    it('returns evaluation time in milliseconds', async () => {
      const wallet = makeWallet();
      const supabase = createMockSupabase();
      supabase.from.mockImplementation((table: string) => {
        const query = {
          select: vi.fn().mockReturnThis(),
          insert: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          is: vi.fn().mockReturnThis(),
          single: vi.fn().mockResolvedValue({ data: table === 'wallets' ? wallet : null, error: null }),
          maybeSingle: vi.fn().mockResolvedValue({ data: table === 'wallets' ? wallet : null, error: null }),
        };
        return query;
      });

      const engine = new ContractPolicyEngine(supabase);
      const result = await engine.evaluate({
        walletId: 'wallet-1',
        agentId: 'agent-1',
        tenantId: 'tenant-1',
        amount: 10,
        actionType: 'payment',
        dryRun: true,
      });

      expect(result.evaluationMs).toBeGreaterThanOrEqual(0);
      expect(typeof result.evaluationMs).toBe('number');
    });
  });
});

// ============================================
// CounterpartyExposureService Tests
// ============================================

describe('CounterpartyExposureService', () => {
  describe('normalizeWindows', () => {
    it('resets 24h window when elapsed', async () => {
      const expired24h = new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString();
      const row = {
        id: 'exp-1',
        wallet_id: 'w-1',
        tenant_id: 't-1',
        agent_id: null,
        counterparty_agent_id: 'cpty-1',
        counterparty_address: null,
        exposure_24h: '100.0000',
        exposure_7d: '200.0000',
        exposure_30d: '500.0000',
        active_contracts: 1,
        active_escrows: 0,
        total_volume: '500.0000',
        transaction_count: 5,
        currency: 'USDC',
        last_24h_reset_at: expired24h,
        last_7d_reset_at: new Date().toISOString(),
        last_30d_reset_at: new Date().toISOString(),
      };

      const supabase = createMockSupabase();
      supabase.from.mockImplementation(() => ({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        is: vi.fn().mockReturnThis(),
        maybeSingle: vi.fn().mockResolvedValue({ data: row, error: null }),
      }));

      const service = new CounterpartyExposureService(supabase);
      const result = await service.getExposure('w-1', { counterpartyAgentId: 'cpty-1' }, 't-1');

      expect(result).not.toBeNull();
      // 24h window should be reset to 0 because it expired
      expect(result!.exposure24h).toBe(0);
      // 7d and 30d should retain values
      expect(result!.exposure7d).toBe(200);
      expect(result!.exposure30d).toBe(500);
    });
  });

  describe('recordExposure', () => {
    it('creates new exposure record when none exists', async () => {
      const supabase = createMockSupabase();
      const insertFn = vi.fn().mockResolvedValue({ data: null, error: null });

      supabase.from.mockImplementation(() => ({
        select: vi.fn().mockReturnThis(),
        insert: insertFn,
        eq: vi.fn().mockReturnThis(),
        is: vi.fn().mockReturnThis(),
        maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
      }));

      const service = new CounterpartyExposureService(supabase);
      await service.recordExposure({
        tenantId: 't-1',
        walletId: 'w-1',
        agentId: 'a-1',
        counterparty: { counterpartyAgentId: 'cpty-1' },
        amount: 25,
        type: 'payment',
      });

      expect(insertFn).toHaveBeenCalledTimes(1);
      const inserted = insertFn.mock.calls[0][0];
      expect(inserted.exposure_24h).toBe(25);
      expect(inserted.exposure_7d).toBe(25);
      expect(inserted.exposure_30d).toBe(25);
      expect(inserted.total_volume).toBe(25);
      expect(inserted.transaction_count).toBe(1);
      expect(inserted.active_escrows).toBe(0);
      expect(inserted.active_contracts).toBe(0);
    });

    it('increments escrow count for escrow_create type', async () => {
      const supabase = createMockSupabase();
      const insertFn = vi.fn().mockResolvedValue({ data: null, error: null });

      supabase.from.mockImplementation(() => ({
        select: vi.fn().mockReturnThis(),
        insert: insertFn,
        eq: vi.fn().mockReturnThis(),
        is: vi.fn().mockReturnThis(),
        maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
      }));

      const service = new CounterpartyExposureService(supabase);
      await service.recordExposure({
        tenantId: 't-1',
        walletId: 'w-1',
        counterparty: { counterpartyAgentId: 'cpty-1' },
        amount: 100,
        type: 'escrow_create',
      });

      const inserted = insertFn.mock.calls[0][0];
      expect(inserted.active_escrows).toBe(1);
    });
  });
});
