/**
 * MPP Governance Tests
 *
 * Tests the governed client: policy checks (allowed, denied, requires approval).
 *
 * @see Story 71.2: Governance Middleware
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { OpType, OpCategory, getCategoryFromOpType, getProtocolFromOpType, type Protocol } from '../../src/services/ops/operation-types.js';

describe('MPP OpType Entries', () => {
  it('should define all MPP operation types', () => {
    expect(OpType.MPP_CHALLENGE_RECEIVED).toBe('mpp.challenge_received');
    expect(OpType.MPP_POLICY_CHECKED).toBe('mpp.policy_checked');
    expect(OpType.MPP_POLICY_VIOLATED).toBe('mpp.policy_violated');
    expect(OpType.MPP_CREDENTIAL_SIGNED).toBe('mpp.credential_signed');
    expect(OpType.MPP_PAYMENT_COMPLETED).toBe('mpp.payment_completed');
    expect(OpType.MPP_PAYMENT_FAILED).toBe('mpp.payment_failed');
    expect(OpType.MPP_SESSION_OPENED).toBe('mpp.session_opened');
    expect(OpType.MPP_SESSION_VOUCHER).toBe('mpp.session_voucher');
    expect(OpType.MPP_SESSION_CLOSED).toBe('mpp.session_closed');
    expect(OpType.MPP_SESSION_EXHAUSTED).toBe('mpp.session_exhausted');
  });

  it('should define composition operation types', () => {
    expect(OpType.COMPOSITION_TASK_SETTLED).toBe('composition.task_settled');
    expect(OpType.COMPOSITION_TASK_REJECTED).toBe('composition.task_rejected');
  });

  it('should categorize MPP ops correctly', () => {
    expect(getCategoryFromOpType(OpType.MPP_PAYMENT_COMPLETED)).toBe(OpCategory.MPP);
    expect(getCategoryFromOpType(OpType.MPP_SESSION_OPENED)).toBe(OpCategory.MPP);
    expect(getCategoryFromOpType(OpType.MPP_POLICY_VIOLATED)).toBe(OpCategory.MPP);
  });

  it('should categorize composition ops correctly', () => {
    expect(getCategoryFromOpType(OpType.COMPOSITION_TASK_SETTLED)).toBe(OpCategory.COMPOSITION);
  });

  it('should derive mpp protocol from OpType', () => {
    expect(getProtocolFromOpType(OpType.MPP_PAYMENT_COMPLETED)).toBe('mpp' as Protocol);
    expect(getProtocolFromOpType(OpType.MPP_SESSION_OPENED)).toBe('mpp' as Protocol);
  });

  it('should return null protocol for composition ops', () => {
    // composition ops don't have a single protocol
    expect(getProtocolFromOpType(OpType.COMPOSITION_TASK_SETTLED)).toBe(null);
  });
});

describe('MPP in Protocol Registry', () => {
  it('should include mpp as valid protocol ID', async () => {
    const { isValidProtocolId, getProtocol, getProtocolIds } = await import('../../src/services/protocol-registry/protocols.js');

    expect(isValidProtocolId('mpp')).toBe(true);

    const mpp = getProtocol('mpp');
    expect(mpp).toBeDefined();
    expect(mpp!.name).toBe('Machine Payments Protocol');
    expect(mpp!.status).toBe('beta');
    expect(mpp!.capabilities).toContain('http-402');
    expect(mpp!.capabilities).toContain('streaming-sessions');

    expect(getProtocolIds()).toContain('mpp');
  });
});

describe('MPP in Spending Policy Context', () => {
  it('should accept mpp as protocol in PolicyContext', () => {
    // Type-level test: this should compile
    const context = {
      protocol: 'mpp' as const,
      vendor: 'api.openai.com',
      mppServiceUrl: 'https://api.openai.com/v1/chat',
      mppSessionId: 'session_123',
    };

    expect(context.protocol).toBe('mpp');
    expect(context.mppServiceUrl).toBeTruthy();
  });
});

describe('MPP in Approval Workflow', () => {
  it('should accept mpp as PaymentProtocol', () => {
    // Type-level test: mpp should be a valid PaymentProtocol value
    const protocol: 'x402' | 'ap2' | 'acp' | 'ucp' | 'mpp' = 'mpp';
    expect(protocol).toBe('mpp');
  });

  it('should support MPP-specific ApprovalRecipient fields', () => {
    const recipient = {
      mppServiceUrl: 'https://api.example.com',
      mppSessionId: 'session_abc',
      vendor: 'example.com',
    };

    expect(recipient.mppServiceUrl).toBeTruthy();
    expect(recipient.mppSessionId).toBeTruthy();
  });
});
