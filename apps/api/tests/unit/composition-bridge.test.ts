/**
 * Composition Bridge Tests
 *
 * Tests three-protocol composition: mandate valid + counterparty approved + MPP reachable = allowed.
 * Any single failure returns structured error with protocol identification.
 *
 * @see Story 71.17: AP2 Mandate -> A2A Task -> MPP Settlement Bridge
 */

import { describe, it, expect } from 'vitest';
import type { CompositionDecision, CompositionAuditEvent } from '../../src/services/composition/task-mandate-bridge.js';

describe('CompositionDecision Type', () => {
  it('should represent an allowed decision', () => {
    const decision: CompositionDecision = {
      allowed: true,
      mandate: {
        id: 'mandate_123',
        status: 'active',
        remainingBudget: 150,
        currency: 'USD',
      },
      counterparty: {
        agentId: 'agent_456',
        name: 'Research Agent',
        kyaTier: 2,
        verified: true,
      },
      paymentPath: {
        reachable: true,
        method: 'tempo',
        network: 'tempo-testnet',
        recipientAddress: '0xabc',
      },
      auditRef: 'composition:mandate_123:task_789',
    };

    expect(decision.allowed).toBe(true);
    expect(decision.protocol).toBeUndefined();
    expect(decision.reason).toBeUndefined();
  });

  it('should identify AP2 block', () => {
    const decision: CompositionDecision = {
      allowed: false,
      reason: 'Mandate has expired',
      protocol: 'ap2',
      mandate: {
        id: 'mandate_expired',
        status: 'expired',
        remainingBudget: 0,
        currency: 'USD',
      },
    };

    expect(decision.allowed).toBe(false);
    expect(decision.protocol).toBe('ap2');
  });

  it('should identify A2A block', () => {
    const decision: CompositionDecision = {
      allowed: false,
      reason: 'Counterparty agent KYA not verified',
      protocol: 'a2a',
      counterparty: {
        agentId: 'agent_unverified',
        name: 'Untrusted Agent',
        kyaTier: 0,
        verified: false,
      },
    };

    expect(decision.allowed).toBe(false);
    expect(decision.protocol).toBe('a2a');
    expect(decision.counterparty?.verified).toBe(false);
  });

  it('should identify MPP block', () => {
    const decision: CompositionDecision = {
      allowed: false,
      reason: 'No reachable MPP settlement path to counterparty',
      protocol: 'mpp',
      paymentPath: {
        reachable: false,
      },
    };

    expect(decision.allowed).toBe(false);
    expect(decision.protocol).toBe('mpp');
    expect(decision.paymentPath?.reachable).toBe(false);
  });
});

describe('CompositionAuditEvent Type', () => {
  it('should create a task_settled event', () => {
    const event: CompositionAuditEvent = {
      type: 'composition.task_settled',
      mandateId: 'mandate_123',
      taskId: 'task_456',
      counterparty: 'agent_789',
      amount: '50.00',
      method: 'tempo',
      receiptRef: 'receipt_abc',
      protocols: ['ap2', 'a2a', 'mpp'],
    };

    expect(event.type).toBe('composition.task_settled');
    expect(event.protocols).toHaveLength(3);
    expect(event.protocols).toContain('ap2');
    expect(event.protocols).toContain('a2a');
    expect(event.protocols).toContain('mpp');
  });

  it('should create a task_rejected event', () => {
    const event: CompositionAuditEvent = {
      type: 'composition.task_rejected',
      mandateId: 'mandate_123',
      taskId: 'task_456',
      counterparty: 'agent_789',
      amount: '50.00',
      protocols: ['ap2', 'a2a', 'mpp'],
    };

    expect(event.type).toBe('composition.task_rejected');
    expect(event.method).toBeUndefined();
    expect(event.receiptRef).toBeUndefined();
  });
});

describe('Composition Validation Logic', () => {
  // Simulates the three-step validation without DB calls

  function evaluateComposition(opts: {
    mandateActive: boolean;
    mandateBudgetRemaining: number;
    counterpartyVerified: boolean;
    counterpartyKyaTier: number;
    paymentPathReachable: boolean;
    amount: number;
  }): CompositionDecision {
    // AP2 check
    if (!opts.mandateActive) {
      return { allowed: false, reason: 'Mandate not active', protocol: 'ap2' };
    }
    if (opts.amount > opts.mandateBudgetRemaining) {
      return { allowed: false, reason: 'Amount exceeds mandate budget', protocol: 'ap2' };
    }

    // A2A check
    if (!opts.counterpartyVerified) {
      return { allowed: false, reason: 'Counterparty not verified', protocol: 'a2a' };
    }
    if (opts.counterpartyKyaTier < 1) {
      return { allowed: false, reason: 'Counterparty KYA tier too low', protocol: 'a2a' };
    }

    // MPP check
    if (!opts.paymentPathReachable) {
      return { allowed: false, reason: 'No payment path', protocol: 'mpp' };
    }

    return { allowed: true };
  }

  it('should allow when all checks pass', () => {
    const result = evaluateComposition({
      mandateActive: true,
      mandateBudgetRemaining: 200,
      counterpartyVerified: true,
      counterpartyKyaTier: 2,
      paymentPathReachable: true,
      amount: 50,
    });
    expect(result.allowed).toBe(true);
  });

  it('should block on inactive mandate (AP2)', () => {
    const result = evaluateComposition({
      mandateActive: false,
      mandateBudgetRemaining: 200,
      counterpartyVerified: true,
      counterpartyKyaTier: 2,
      paymentPathReachable: true,
      amount: 50,
    });
    expect(result.allowed).toBe(false);
    expect(result.protocol).toBe('ap2');
  });

  it('should block on budget exceeded (AP2)', () => {
    const result = evaluateComposition({
      mandateActive: true,
      mandateBudgetRemaining: 30,
      counterpartyVerified: true,
      counterpartyKyaTier: 2,
      paymentPathReachable: true,
      amount: 50,
    });
    expect(result.allowed).toBe(false);
    expect(result.protocol).toBe('ap2');
  });

  it('should block on unverified counterparty (A2A)', () => {
    const result = evaluateComposition({
      mandateActive: true,
      mandateBudgetRemaining: 200,
      counterpartyVerified: false,
      counterpartyKyaTier: 2,
      paymentPathReachable: true,
      amount: 50,
    });
    expect(result.allowed).toBe(false);
    expect(result.protocol).toBe('a2a');
  });

  it('should block on low KYA tier (A2A)', () => {
    const result = evaluateComposition({
      mandateActive: true,
      mandateBudgetRemaining: 200,
      counterpartyVerified: true,
      counterpartyKyaTier: 0,
      paymentPathReachable: true,
      amount: 50,
    });
    expect(result.allowed).toBe(false);
    expect(result.protocol).toBe('a2a');
  });

  it('should block on unreachable payment path (MPP)', () => {
    const result = evaluateComposition({
      mandateActive: true,
      mandateBudgetRemaining: 200,
      counterpartyVerified: true,
      counterpartyKyaTier: 2,
      paymentPathReachable: false,
      amount: 50,
    });
    expect(result.allowed).toBe(false);
    expect(result.protocol).toBe('mpp');
  });

  it('should block at first failing protocol (AP2 before A2A)', () => {
    const result = evaluateComposition({
      mandateActive: false,
      mandateBudgetRemaining: 0,
      counterpartyVerified: false,
      counterpartyKyaTier: 0,
      paymentPathReachable: false,
      amount: 50,
    });
    // AP2 fails first
    expect(result.protocol).toBe('ap2');
  });
});
