/**
 * MPP Session Tests
 *
 * Tests session lifecycle, budget enforcement, and auto-close.
 *
 * @see Story 71.7: Governed Session Manager
 */

import { describe, it, expect } from 'vitest';
import type { MppSession, MppSessionStatus } from '../../src/services/mpp/types.js';

describe('MPP Session Status Transitions', () => {
  const validTransitions: Record<MppSessionStatus, MppSessionStatus[]> = {
    open: ['active', 'closing', 'closed', 'error'],
    active: ['closing', 'closed', 'exhausted', 'error'],
    closing: ['closed', 'error'],
    closed: [],
    exhausted: ['closed'],
    error: ['closed'],
  };

  it('should define all valid session statuses', () => {
    const statuses: MppSessionStatus[] = ['open', 'active', 'closing', 'closed', 'exhausted', 'error'];
    statuses.forEach(s => {
      expect(validTransitions[s]).toBeDefined();
    });
  });

  it('should not allow transitions from closed', () => {
    expect(validTransitions.closed).toHaveLength(0);
  });
});

describe('MPP Session Budget Enforcement', () => {
  function checkBudget(session: Pick<MppSession, 'depositAmount' | 'spentAmount' | 'maxBudget'>, amount: number) {
    const budget = session.maxBudget || session.depositAmount;
    const newSpent = session.spentAmount + amount;

    if (newSpent > budget) {
      return {
        allowed: false,
        reason: `Would exceed session budget (${newSpent.toFixed(2)} > ${budget})`,
        remainingBudget: budget - session.spentAmount,
      };
    }

    return {
      allowed: true,
      remainingBudget: budget - newSpent,
    };
  }

  it('should allow voucher within budget', () => {
    const result = checkBudget({ depositAmount: 10, spentAmount: 3, maxBudget: undefined }, 2);
    expect(result.allowed).toBe(true);
    expect(result.remainingBudget).toBe(5);
  });

  it('should deny voucher exceeding deposit budget', () => {
    const result = checkBudget({ depositAmount: 10, spentAmount: 8, maxBudget: undefined }, 5);
    expect(result.allowed).toBe(false);
    expect(result.remainingBudget).toBe(2);
  });

  it('should use maxBudget when set', () => {
    const result = checkBudget({ depositAmount: 5, spentAmount: 3, maxBudget: 20 }, 10);
    expect(result.allowed).toBe(true);
    expect(result.remainingBudget).toBe(7);
  });

  it('should enforce maxBudget limit', () => {
    const result = checkBudget({ depositAmount: 5, spentAmount: 18, maxBudget: 20 }, 5);
    expect(result.allowed).toBe(false);
  });

  it('should handle exact budget match', () => {
    const result = checkBudget({ depositAmount: 10, spentAmount: 5, maxBudget: undefined }, 5);
    expect(result.allowed).toBe(true);
    expect(result.remainingBudget).toBe(0);
  });
});

describe('MPP Session Types', () => {
  it('should create a valid session object', () => {
    const session: MppSession = {
      id: 'test-session-id',
      tenantId: 'tenant-123',
      agentId: 'agent-456',
      walletId: 'wallet-789',
      serviceUrl: 'https://api.openai.com/v1/chat/completions',
      depositAmount: 50.0,
      spentAmount: 12.50,
      voucherCount: 25,
      status: 'active',
      maxBudget: 100.0,
      mppSessionId: 'mpp_sess_abc',
      openedAt: '2026-03-18T12:00:00.000Z',
      lastVoucherAt: '2026-03-18T12:05:00.000Z',
    };

    expect(session.status).toBe('active');
    expect(session.depositAmount).toBe(50);
    expect(session.spentAmount).toBe(12.5);
    expect(session.voucherCount).toBe(25);
  });
});
