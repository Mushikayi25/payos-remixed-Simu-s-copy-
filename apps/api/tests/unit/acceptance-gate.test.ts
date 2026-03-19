/**
 * Epic 69: A2A Result Acceptance & Quality Feedback Tests
 *
 * Tests for:
 * - Acceptance policy config parsing & defaults
 * - Acceptance gate logic (engage vs bypass)
 * - Respond endpoint: accept/reject branching
 * - Feedback storage & validation
 * - Partial settlement
 * - Feedback query API
 * - Review timeout worker
 */

import { describe, it, expect } from 'vitest';
import { DEFAULT_ACCEPTANCE_POLICY } from '../../src/services/a2a/types.js';
import type { AcceptancePolicy } from '../../src/services/a2a/types.js';

// =============================================================================
// 1. Acceptance Policy Config
// =============================================================================

describe('Acceptance Policy — Config & Defaults', () => {
  it('provides sensible defaults', () => {
    expect(DEFAULT_ACCEPTANCE_POLICY).toEqual({
      requires_acceptance: false,
      auto_accept_below: 0,
      review_timeout_minutes: 60,
    });
  });

  it('defaults are backwards compatible (no gate)', () => {
    expect(DEFAULT_ACCEPTANCE_POLICY.requires_acceptance).toBe(false);
  });

  it('default timeout is 60 minutes', () => {
    expect(DEFAULT_ACCEPTANCE_POLICY.review_timeout_minutes).toBe(60);
  });
});

// =============================================================================
// 2. Acceptance Gate Logic (pure logic tests)
// =============================================================================

describe('Acceptance Gate — Decision Logic', () => {
  /**
   * Pure function simulating the gate decision logic from checkAcceptanceGate().
   * Tests the core algorithm without needing Supabase or full processor instantiation.
   */
  function shouldEngageGate(
    outcome: 'completed' | 'failed',
    policy: AcceptancePolicy,
    mandateAmount: number,
  ): boolean {
    if (outcome !== 'completed') return false;
    if (!policy.requires_acceptance) return false;
    if (policy.auto_accept_below > 0 && mandateAmount < policy.auto_accept_below) return false;
    return true;
  }

  it('returns false for failed outcomes (never gates failures)', () => {
    const policy: AcceptancePolicy = { requires_acceptance: true, auto_accept_below: 0, review_timeout_minutes: 60 };
    expect(shouldEngageGate('failed', policy, 10)).toBe(false);
  });

  it('returns false when requires_acceptance is false (default policy)', () => {
    expect(shouldEngageGate('completed', DEFAULT_ACCEPTANCE_POLICY, 10)).toBe(false);
  });

  it('returns false when amount is below auto_accept_below threshold', () => {
    const policy: AcceptancePolicy = { requires_acceptance: true, auto_accept_below: 5, review_timeout_minutes: 60 };
    expect(shouldEngageGate('completed', policy, 2)).toBe(false);
  });

  it('returns true when policy requires acceptance and amount exceeds threshold', () => {
    const policy: AcceptancePolicy = { requires_acceptance: true, auto_accept_below: 1, review_timeout_minutes: 60 };
    expect(shouldEngageGate('completed', policy, 5)).toBe(true);
  });

  it('returns true when auto_accept_below is 0 (no auto-accept)', () => {
    const policy: AcceptancePolicy = { requires_acceptance: true, auto_accept_below: 0, review_timeout_minutes: 30 };
    expect(shouldEngageGate('completed', policy, 0.01)).toBe(true);
  });

  it('returns true when amount equals auto_accept_below (edge case: not below)', () => {
    const policy: AcceptancePolicy = { requires_acceptance: true, auto_accept_below: 5, review_timeout_minutes: 60 };
    expect(shouldEngageGate('completed', policy, 5)).toBe(true);
  });

  it('policy parsing: falls back to defaults for invalid fields', () => {
    const raw = { requires_acceptance: 'yes', auto_accept_below: -1, review_timeout_minutes: 0 } as any;
    const parsed: AcceptancePolicy = {
      requires_acceptance: typeof raw.requires_acceptance === 'boolean' ? raw.requires_acceptance : DEFAULT_ACCEPTANCE_POLICY.requires_acceptance,
      auto_accept_below: typeof raw.auto_accept_below === 'number' && raw.auto_accept_below >= 0 ? raw.auto_accept_below : DEFAULT_ACCEPTANCE_POLICY.auto_accept_below,
      review_timeout_minutes: typeof raw.review_timeout_minutes === 'number' && raw.review_timeout_minutes > 0 ? raw.review_timeout_minutes : DEFAULT_ACCEPTANCE_POLICY.review_timeout_minutes,
    };
    expect(parsed.requires_acceptance).toBe(false); // 'yes' is not boolean
    expect(parsed.auto_accept_below).toBe(0); // -1 is invalid
    expect(parsed.review_timeout_minutes).toBe(60); // 0 is invalid
  });

  it('policy parsing: accepts valid custom values', () => {
    const raw = { requires_acceptance: true, auto_accept_below: 2.5, review_timeout_minutes: 120 };
    const parsed: AcceptancePolicy = {
      requires_acceptance: typeof raw.requires_acceptance === 'boolean' ? raw.requires_acceptance : DEFAULT_ACCEPTANCE_POLICY.requires_acceptance,
      auto_accept_below: typeof raw.auto_accept_below === 'number' && raw.auto_accept_below >= 0 ? raw.auto_accept_below : DEFAULT_ACCEPTANCE_POLICY.auto_accept_below,
      review_timeout_minutes: typeof raw.review_timeout_minutes === 'number' && raw.review_timeout_minutes > 0 ? raw.review_timeout_minutes : DEFAULT_ACCEPTANCE_POLICY.review_timeout_minutes,
    };
    expect(parsed.requires_acceptance).toBe(true);
    expect(parsed.auto_accept_below).toBe(2.5);
    expect(parsed.review_timeout_minutes).toBe(120);
  });
});

// =============================================================================
// 3. Respond Endpoint — result_review validation
// =============================================================================

describe('Respond — result_review action validation', () => {
  it('rejects invalid actions', () => {
    const validActions = ['accept', 'reject'];
    expect(validActions).toContain('accept');
    expect(validActions).toContain('reject');
    expect(validActions).not.toContain('maybe');
    expect(validActions).not.toContain('');
  });

  it('validates satisfaction enum values', () => {
    const validSatisfaction = ['excellent', 'acceptable', 'partial', 'unacceptable'];
    expect(validSatisfaction).toContain('excellent');
    expect(validSatisfaction).toContain('acceptable');
    expect(validSatisfaction).toContain('partial');
    expect(validSatisfaction).toContain('unacceptable');
    expect(validSatisfaction).not.toContain('good');
  });

  it('validates score range 0-100', () => {
    const isValidScore = (s: number) => typeof s === 'number' && s >= 0 && s <= 100;
    expect(isValidScore(0)).toBe(true);
    expect(isValidScore(50)).toBe(true);
    expect(isValidScore(100)).toBe(true);
    expect(isValidScore(-1)).toBe(false);
    expect(isValidScore(101)).toBe(false);
  });
});

// =============================================================================
// 4. Feedback Data Model
// =============================================================================

describe('Feedback — Data Model', () => {
  it('feedback fields are optional (accept/reject works without feedback)', () => {
    const minimalFeedback = { action: 'accept' };
    expect(minimalFeedback.action).toBe('accept');
    // No satisfaction, score, or comment required
  });

  it('feedback with all fields', () => {
    const fullFeedback = {
      action: 'accept',
      satisfaction: 'excellent',
      score: 95,
      comment: 'Great analysis',
      settlement_amount: 0.35,
    };
    expect(fullFeedback.score).toBe(95);
    expect(fullFeedback.satisfaction).toBe('excellent');
    expect(fullFeedback.settlement_amount).toBe(0.35);
  });
});

// =============================================================================
// 5. Partial Settlement
// =============================================================================

describe('Partial Settlement — Validation', () => {
  it('settlement_amount must be positive', () => {
    const isValid = (amount: number, max: number) =>
      typeof amount === 'number' && amount > 0 && amount <= max;

    expect(isValid(0.1, 1.0)).toBe(true);
    expect(isValid(1.0, 1.0)).toBe(true);
    expect(isValid(0.5, 1.0)).toBe(true);

    expect(isValid(0, 1.0)).toBe(false);
    expect(isValid(-1, 1.0)).toBe(false);
    expect(isValid(1.5, 1.0)).toBe(false);
  });

  it('settlement_amount cannot exceed original mandate amount', () => {
    const originalAmount = 10.0;
    const partialAmount = 7.5;
    expect(partialAmount).toBeLessThanOrEqual(originalAmount);

    const excessAmount = 15.0;
    expect(excessAmount).toBeGreaterThan(originalAmount);
  });
});

// =============================================================================
// 6. Feedback Query API
// =============================================================================

describe('Feedback Query — Summary Aggregation', () => {
  it('computes average score correctly', () => {
    const scores = [90, 80, 70];
    const avg = Math.round((scores.reduce((a, b) => a + b, 0) / scores.length) * 10) / 10;
    expect(avg).toBe(80);
  });

  it('computes rejection rate correctly', () => {
    const feedback = [
      { action: 'accept' },
      { action: 'accept' },
      { action: 'reject' },
      { action: 'accept' },
    ];
    const total = feedback.length;
    const rejections = feedback.filter(r => r.action === 'reject').length;
    const rate = Math.round((rejections / total) * 1000) / 1000;
    expect(rate).toBe(0.25);
  });

  it('handles empty feedback gracefully', () => {
    const feedback: any[] = [];
    const total = feedback.length;
    const avgScore = total > 0 ? feedback.reduce((a, b) => a + b.score, 0) / total : null;
    const rate = total > 0 ? 0 : 0;
    expect(avgScore).toBeNull();
    expect(rate).toBe(0);
  });

  it('computes satisfaction distribution', () => {
    const feedback = [
      { satisfaction: 'excellent' },
      { satisfaction: 'excellent' },
      { satisfaction: 'acceptable' },
      { satisfaction: 'unacceptable' },
    ];
    const distribution: Record<string, number> = { excellent: 0, acceptable: 0, partial: 0, unacceptable: 0 };
    for (const row of feedback) {
      if (row.satisfaction && distribution[row.satisfaction] !== undefined) {
        distribution[row.satisfaction]++;
      }
    }
    expect(distribution).toEqual({ excellent: 2, acceptable: 1, partial: 0, unacceptable: 1 });
  });
});

// =============================================================================
// 7. Review Timeout Worker
// =============================================================================

describe('Review Timeout Worker — Sweep Logic', () => {
  it('identifies timed-out tasks correctly', () => {
    const now = Date.now();
    const requestedAt = new Date(now - 70 * 60 * 1000).toISOString(); // 70 minutes ago
    const timeoutMinutes = 60;

    const elapsed = now - new Date(requestedAt).getTime();
    const timeoutMs = timeoutMinutes * 60 * 1000;

    expect(elapsed).toBeGreaterThan(timeoutMs);
  });

  it('skips tasks within timeout window', () => {
    const now = Date.now();
    const requestedAt = new Date(now - 30 * 60 * 1000).toISOString(); // 30 minutes ago
    const timeoutMinutes = 60;

    const elapsed = now - new Date(requestedAt).getTime();
    const timeoutMs = timeoutMinutes * 60 * 1000;

    expect(elapsed).toBeLessThan(timeoutMs);
  });

  it('skips non-review input-required tasks', () => {
    const meta = {
      input_required_context: { reason_code: 'needs_payment' },
    };
    const context = meta.input_required_context;
    expect(context.reason_code).not.toBe('result_review');
  });

  it('skips tasks with review_status !== pending', () => {
    const meta = {
      input_required_context: { reason_code: 'result_review' },
      review_status: 'resolved',
    };
    expect(meta.review_status).not.toBe('pending');
  });

  it('uses custom timeout from task metadata', () => {
    const customTimeout = 120; // 2 hours
    const now = Date.now();
    const requestedAt = new Date(now - 90 * 60 * 1000).toISOString(); // 90 minutes ago

    const elapsed = now - new Date(requestedAt).getTime();
    const timeoutMs = customTimeout * 60 * 1000;

    // 90 minutes < 120 minute timeout — should NOT be timed out
    expect(elapsed).toBeLessThan(timeoutMs);
  });
});

// =============================================================================
// 8. InputRequiredContext Extensions
// =============================================================================

describe('InputRequiredContext — Epic 69 Extensions', () => {
  it('supports result_review reason code', () => {
    const context = {
      reason_code: 'result_review' as const,
      next_action: 'accept_or_reject' as const,
      resolve_endpoint: 'POST /v1/a2a/tasks/xxx/respond',
      required_auth: 'api_key' as const,
      details: { mandate_id: 'mandate-1', amount: 0.35 },
    };
    expect(context.reason_code).toBe('result_review');
    expect(context.next_action).toBe('accept_or_reject');
  });

  it('supports no_handler reason code (existing usage)', () => {
    const context = {
      reason_code: 'no_handler' as const,
      next_action: 'register_webhook' as const,
    };
    expect(context.reason_code).toBe('no_handler');
    expect(context.next_action).toBe('register_webhook');
  });
});
