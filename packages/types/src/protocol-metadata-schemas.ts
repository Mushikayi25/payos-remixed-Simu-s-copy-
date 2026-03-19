/**
 * Protocol Metadata Validation Schemas
 * 
 * Zod schemas for runtime validation of protocol metadata.
 * Use these to validate data before inserting into database.
 * 
 * @module types/protocol-metadata-schemas
 */

import { z } from 'zod';

// ============================================
// x402 Schema
// ============================================

export const x402MetadataSchema = z.object({
  protocol: z.literal('x402'),
  endpoint_id: z.string().uuid(),
  endpoint_path: z.string().min(1),
  endpoint_method: z.string().optional(),
  request_id: z.string().min(1),
  payment_proof: z.string().optional(),
  vendor_domain: z.string().optional(),
  verified_at: z.string().datetime().optional(),
});

export type X402MetadataInput = z.input<typeof x402MetadataSchema>;
export type X402MetadataOutput = z.output<typeof x402MetadataSchema>;

// ============================================
// AP2 Schema
// ============================================

export const ap2MetadataSchema = z.object({
  protocol: z.literal('ap2'),
  mandate_id: z.string().min(1),
  mandate_type: z.enum(['intent', 'cart', 'payment']),
  agent_id: z.string().uuid(),
  execution_index: z.number().int().nonnegative().optional(),
  mandate_data: z.record(z.any()).optional(),
  verified_at: z.string().datetime().optional(),
});

export type AP2MetadataInput = z.input<typeof ap2MetadataSchema>;
export type AP2MetadataOutput = z.output<typeof ap2MetadataSchema>;

// ============================================
// ACP Schema
// ============================================

export const acpMetadataSchema = z.object({
  protocol: z.literal('acp'),
  checkout_id: z.string().min(1),
  shared_payment_token: z.string().optional(),
  cart_items: z.array(z.object({
    name: z.string().min(1),
    quantity: z.number().int().positive(),
    price: z.number().nonnegative(),
    currency: z.string().length(3).optional(),
  })).optional(),
  merchant_name: z.string().optional(),
  merchant_id: z.string().optional(),
  completed_at: z.string().datetime().optional(),
});

export type ACPMetadataInput = z.input<typeof acpMetadataSchema>;
export type ACPMetadataOutput = z.output<typeof acpMetadataSchema>;

// ============================================
// MPP Schema
// ============================================

export const mppMetadataSchema = z.object({
  protocol: z.literal('mpp'),
  service_url: z.string().min(1),
  payment_method: z.enum(['tempo', 'stripe', 'lightning', 'card', 'custom']),
  protocol_intent: z.enum(['charge', 'session']).optional(),
  intent: z.string().optional(),
  session_id: z.string().optional(),
  voucher_index: z.number().int().nonnegative().optional(),
  receipt_id: z.string().optional(),
  receipt_data: z.record(z.any()).optional(),
  settlement_network: z.string().optional(),
  settlement_tx_hash: z.string().optional(),
  verified_at: z.string().datetime().optional(),
});

export type MppMetadataInput = z.input<typeof mppMetadataSchema>;
export type MppMetadataOutput = z.output<typeof mppMetadataSchema>;

// ============================================
// Union Schema
// ============================================

/**
 * Discriminated union schema for all protocol metadata
 * Use this to validate protocol_metadata before database insert
 */
export const protocolMetadataSchema = z.discriminatedUnion('protocol', [
  x402MetadataSchema,
  ap2MetadataSchema,
  acpMetadataSchema,
  mppMetadataSchema,
]).nullable();

export type ProtocolMetadataInput = z.input<typeof protocolMetadataSchema>;
export type ProtocolMetadataOutput = z.output<typeof protocolMetadataSchema>;

// ============================================
// Validation Helpers
// ============================================

/**
 * Validate protocol metadata (throws on error)
 * 
 * @example
 * const metadata = validateProtocolMetadata('x402', {
 *   protocol: 'x402',
 *   endpoint_id: '...',
 *   endpoint_path: '/v1/chat',
 *   request_id: '...',
 * });
 */
export function validateProtocolMetadata(
  protocol: 'x402' | 'ap2' | 'acp' | 'mpp',
  data: unknown
): X402MetadataOutput | AP2MetadataOutput | ACPMetadataOutput | MppMetadataOutput {
  switch (protocol) {
    case 'x402':
      return x402MetadataSchema.parse(data);
    case 'ap2':
      return ap2MetadataSchema.parse(data);
    case 'acp':
      return acpMetadataSchema.parse(data);
    case 'mpp':
      return mppMetadataSchema.parse(data);
  }
}

/**
 * Safely validate protocol metadata (returns error instead of throwing)
 * 
 * @example
 * const result = safeValidateProtocolMetadata('x402', metadata);
 * if (result.success) {
 *   console.log('Valid:', result.data);
 * } else {
 *   console.error('Invalid:', result.error);
 * }
 */
export function safeValidateProtocolMetadata(
  protocol: 'x402' | 'ap2' | 'acp' | 'mpp',
  data: unknown
): z.SafeParseReturnType<unknown, X402MetadataOutput | AP2MetadataOutput | ACPMetadataOutput | MppMetadataOutput> {
  switch (protocol) {
    case 'x402':
      return x402MetadataSchema.safeParse(data);
    case 'ap2':
      return ap2MetadataSchema.safeParse(data);
    case 'acp':
      return acpMetadataSchema.safeParse(data);
    case 'mpp':
      return mppMetadataSchema.safeParse(data);
  }
}

// ============================================
// Factory Functions
// ============================================

/**
 * Create validated x402 metadata
 */
export function createX402Metadata(data: X402MetadataInput): X402MetadataOutput {
  return x402MetadataSchema.parse(data);
}

/**
 * Create validated AP2 metadata
 */
export function createAP2Metadata(data: AP2MetadataInput): AP2MetadataOutput {
  return ap2MetadataSchema.parse(data);
}

/**
 * Create validated ACP metadata
 */
export function createACPMetadata(data: ACPMetadataInput): ACPMetadataOutput {
  return acpMetadataSchema.parse(data);
}

/**
 * Create validated MPP metadata
 */
export function createMppMetadata(data: MppMetadataInput): MppMetadataOutput {
  return mppMetadataSchema.parse(data);
}
