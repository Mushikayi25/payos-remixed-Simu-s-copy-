/**
 * MPP Metadata Tests
 *
 * Validates Zod schemas, type guards, and factory functions
 * for MPP protocol metadata.
 *
 * @see Story 71.3: MPP Data Model
 */

import { describe, it, expect } from 'vitest';
import {
  mppMetadataSchema,
  createMppMetadata,
  validateProtocolMetadata,
  safeValidateProtocolMetadata,
  protocolMetadataSchema,
} from '@sly/types';
import {
  isMppMetadata,
  isX402Metadata,
  isProtocolTransfer,
} from '@sly/types';

describe('MPP Metadata Schema', () => {
  const validMppMetadata = {
    protocol: 'mpp' as const,
    service_url: 'https://api.openai.com/v1/chat',
    payment_method: 'tempo' as const,
    intent: 'AI inference request',
    session_id: 'session_abc123',
    voucher_index: 0,
    receipt_id: 'receipt_xyz',
    receipt_data: { tx: '0xabc' },
    settlement_network: 'tempo-testnet',
    settlement_tx_hash: '0xdef',
    verified_at: '2026-03-18T00:00:00.000Z',
  };

  it('should validate a complete MPP metadata object', () => {
    const result = mppMetadataSchema.safeParse(validMppMetadata);
    expect(result.success).toBe(true);
  });

  it('should validate with minimal required fields', () => {
    const minimal = {
      protocol: 'mpp',
      service_url: 'https://example.com/api',
      payment_method: 'tempo',
    };
    const result = mppMetadataSchema.safeParse(minimal);
    expect(result.success).toBe(true);
  });

  it('should reject missing service_url', () => {
    const invalid = {
      protocol: 'mpp',
      payment_method: 'tempo',
    };
    const result = mppMetadataSchema.safeParse(invalid);
    expect(result.success).toBe(false);
  });

  it('should reject invalid payment_method', () => {
    const invalid = {
      protocol: 'mpp',
      service_url: 'https://example.com',
      payment_method: 'bitcoin', // not a valid method
    };
    const result = mppMetadataSchema.safeParse(invalid);
    expect(result.success).toBe(false);
  });

  it('should accept all valid payment methods', () => {
    for (const method of ['tempo', 'stripe', 'lightning', 'custom']) {
      const data = {
        protocol: 'mpp',
        service_url: 'https://example.com',
        payment_method: method,
      };
      expect(mppMetadataSchema.safeParse(data).success).toBe(true);
    }
  });

  it('should reject negative voucher_index', () => {
    const invalid = {
      ...validMppMetadata,
      voucher_index: -1,
    };
    const result = mppMetadataSchema.safeParse(invalid);
    expect(result.success).toBe(false);
  });
});

describe('MPP Metadata Factory', () => {
  it('should create validated MPP metadata', () => {
    const metadata = createMppMetadata({
      protocol: 'mpp',
      service_url: 'https://api.anthropic.com/v1',
      payment_method: 'tempo',
      receipt_id: 'r_123',
    });

    expect(metadata.protocol).toBe('mpp');
    expect(metadata.service_url).toBe('https://api.anthropic.com/v1');
    expect(metadata.payment_method).toBe('tempo');
  });

  it('should throw on invalid input', () => {
    expect(() => createMppMetadata({
      protocol: 'mpp',
      service_url: '', // empty string fails min(1)
      payment_method: 'tempo',
    })).toThrow();
  });
});

describe('Protocol Metadata Validation Helpers', () => {
  it('should validate mpp protocol via validateProtocolMetadata', () => {
    const data = {
      protocol: 'mpp',
      service_url: 'https://example.com',
      payment_method: 'stripe',
    };
    const result = validateProtocolMetadata('mpp', data);
    expect(result.protocol).toBe('mpp');
  });

  it('should safely validate mpp via safeValidateProtocolMetadata', () => {
    const result = safeValidateProtocolMetadata('mpp', {
      protocol: 'mpp',
      service_url: 'https://example.com',
      payment_method: 'lightning',
    });
    expect(result.success).toBe(true);
  });

  it('should include mpp in discriminated union schema', () => {
    const data = {
      protocol: 'mpp',
      service_url: 'https://example.com',
      payment_method: 'tempo',
    };
    const result = protocolMetadataSchema.safeParse(data);
    expect(result.success).toBe(true);
  });

  it('should accept null in the union schema', () => {
    const result = protocolMetadataSchema.safeParse(null);
    expect(result.success).toBe(true);
  });
});

describe('MPP Type Guards', () => {
  it('should identify MPP metadata', () => {
    expect(isMppMetadata({ protocol: 'mpp' })).toBe(true);
    expect(isMppMetadata({ protocol: 'x402' })).toBe(false);
    expect(isMppMetadata(null)).toBe(false);
    expect(isMppMetadata(undefined)).toBe(false);
  });

  it('should not confuse with x402', () => {
    expect(isX402Metadata({ protocol: 'mpp' })).toBe(false);
  });

  it('should identify as protocol transfer', () => {
    expect(isProtocolTransfer({ protocol: 'mpp', service_url: 'https://x.com' })).toBe(true);
  });
});
