/**
 * Protocol Metadata Types
 * 
 * Type definitions for protocol-specific metadata stored in transfers.protocol_metadata.
 * Supports x402, AP2, and ACP protocols.
 * 
 * @module types/protocol-metadata
 */

// ============================================
// x402 Protocol (Coinbase/Cloudflare)
// ============================================

/**
 * Metadata for x402 (HTTP 402) micropayments
 * Used for API monetization and pay-per-request services
 */
export interface X402Metadata {
  /** Protocol identifier */
  protocol: 'x402';
  
  /** PayOS endpoint ID that received the payment */
  endpoint_id: string;
  
  /** API path that was accessed */
  endpoint_path: string;
  
  /** HTTP method (GET, POST, etc.) */
  endpoint_method?: string;
  
  /** Unique request ID from x402 payment proof */
  request_id: string;
  
  /** Payment proof JWT from x402 provider */
  payment_proof?: string;
  
  /** Vendor domain (e.g., 'api.openai.com') */
  vendor_domain?: string;
  
  /** Timestamp when payment was verified */
  verified_at?: string;
}

// ============================================
// AP2 Protocol (Google)
// ============================================

/**
 * Metadata for AP2 (Agent Payment Protocol)
 * Used for agent-authorized payments with mandates
 */
export interface AP2Metadata {
  /** Protocol identifier */
  protocol: 'ap2';
  
  /** Mandate ID that authorized this payment */
  mandate_id: string;
  
  /** Type of mandate */
  mandate_type: 'intent' | 'cart' | 'payment';
  
  /** Agent ID that executed the mandate */
  agent_id: string;
  
  /** Execution index (for multi-step mandates) */
  execution_index?: number;
  
  /** Original mandate JSON */
  mandate_data?: Record<string, any>;
  
  /** Timestamp when mandate was verified */
  verified_at?: string;
}

// ============================================
// ACP Protocol (Stripe/OpenAI)
// ============================================

/**
 * Metadata for ACP (Agentic Commerce Protocol)
 * Used for checkout sessions and shared payment tokens
 */
export interface ACPMetadata {
  /** Protocol identifier */
  protocol: 'acp';
  
  /** Checkout session ID */
  checkout_id: string;
  
  /** Shared payment token (delegated authorization) */
  shared_payment_token?: string;
  
  /** Cart items purchased */
  cart_items?: Array<{
    name: string;
    quantity: number;
    price: number;
    currency?: string;
  }>;
  
  /** Merchant name */
  merchant_name?: string;
  
  /** Merchant ID */
  merchant_id?: string;
  
  /** Timestamp when checkout was completed */
  completed_at?: string;
}

// ============================================
// MPP Protocol (Stripe/Tempo Labs)
// ============================================

/**
 * Metadata for MPP (Machine Payments Protocol)
 * Used for machine-to-machine HTTP 402 payments with sessions
 */
export interface MppMetadata {
  /** Protocol identifier */
  protocol: 'mpp';

  /** Service URL that received the payment */
  service_url: string;

  /** Payment method used */
  payment_method: 'tempo' | 'stripe' | 'lightning' | 'card' | 'custom';

  /** Protocol-level intent from mppx challenge/receipt (e.g. 'charge', 'session') */
  protocol_intent?: 'charge' | 'session';

  /** Human-readable payment description */
  intent?: string;

  /** Session ID (for streaming payments) */
  session_id?: string;

  /** Voucher index within session */
  voucher_index?: number;

  /** Receipt ID from MPP */
  receipt_id?: string;

  /** Raw receipt data */
  receipt_data?: Record<string, any>;

  /** Settlement network (e.g., 'tempo-testnet', 'stripe') */
  settlement_network?: string;

  /** Settlement transaction hash */
  settlement_tx_hash?: string;

  /** Timestamp when payment was verified */
  verified_at?: string;
}

// ============================================
// Union Type
// ============================================

/**
 * Union type for all protocol metadata
 * Stored in transfers.protocol_metadata (JSONB column)
 */
export type ProtocolMetadata = X402Metadata | AP2Metadata | ACPMetadata | MppMetadata | null;

// ============================================
// Type Guards
// ============================================

/**
 * Type guard for x402 metadata
 */
export function isX402Metadata(metadata: any): metadata is X402Metadata {
  return metadata?.protocol === 'x402';
}

/**
 * Type guard for AP2 metadata
 */
export function isAP2Metadata(metadata: any): metadata is AP2Metadata {
  return metadata?.protocol === 'ap2';
}

/**
 * Type guard for ACP metadata
 */
export function isACPMetadata(metadata: any): metadata is ACPMetadata {
  return metadata?.protocol === 'acp';
}

/**
 * Type guard for MPP metadata
 */
export function isMppMetadata(metadata: any): metadata is MppMetadata {
  return metadata?.protocol === 'mpp';
}

/**
 * Type guard to check if transfer has protocol metadata
 */
export function isProtocolTransfer(metadata: any): metadata is ProtocolMetadata {
  return metadata && 'protocol' in metadata;
}
