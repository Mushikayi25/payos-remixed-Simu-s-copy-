/**
 * Epic 65: Operations Observability — Type Definitions
 *
 * CloudEvents 1.0 envelope types, OpType enum (48+ entries),
 * CostKey enum, and metadata contracts.
 */

// =============================================================================
// OpType Enum — Every tracked platform operation
// =============================================================================

export enum OpType {
  // --- Settlement & Financial ---
  SETTLEMENT_DOMESTIC = 'settlement.domestic',
  SETTLEMENT_CROSS_BORDER = 'settlement.cross_border',
  SETTLEMENT_ASYNC = 'settlement.async',
  SETTLEMENT_BATCH_NET = 'settlement.batch_net',
  SETTLEMENT_CCTP_BRIDGE = 'settlement.cctp_bridge',
  SETTLEMENT_INTENT_CREATED = 'settlement.intent_created',
  SETTLEMENT_INTENT_AUTHORIZED = 'settlement.intent_authorized',
  FX_QUOTE = 'settlement.fx_quote',
  WALLET_CREATED = 'wallet.created',
  WALLET_DEPOSIT = 'wallet.deposit',
  WALLET_WITHDRAWAL = 'wallet.withdrawal',
  CHAIN_METRIC_RECORDED = 'settlement.chain_metric_recorded',

  // --- UCP Protocol ---
  UCP_MERCHANT_DISCOVERED = 'ucp.merchant_discovered',
  UCP_CHECKOUT_CREATED = 'ucp.checkout_created',
  UCP_CHECKOUT_UPDATED = 'ucp.checkout_updated',
  UCP_CHECKOUT_COMPLETED = 'ucp.checkout_completed',
  UCP_CHECKOUT_CANCELLED = 'ucp.checkout_cancelled',
  UCP_INSTRUMENT_ADDED = 'ucp.instrument_added',
  UCP_ORDER_CREATED = 'ucp.order_created',
  UCP_ORDER_UPDATED = 'ucp.order_updated',
  UCP_ORDER_CANCELLED = 'ucp.order_cancelled',
  UCP_FULFILLMENT_EVENT = 'ucp.fulfillment_event',
  UCP_TOKEN_ACQUIRED = 'ucp.token_acquired',
  UCP_SETTLEMENT_EXECUTED = 'ucp.settlement_executed',

  // --- ACP Protocol ---
  ACP_CHECKOUT_CREATED = 'acp.checkout_created',
  ACP_CHECKOUT_COMPLETED = 'acp.checkout_completed',
  ACP_CHECKOUT_CANCELLED = 'acp.checkout_cancelled',
  ACP_BATCH_INITIATED = 'acp.batch_initiated',

  // --- AP2 Mandates ---
  AP2_MANDATE_CREATED = 'ap2.mandate_created',
  AP2_MANDATE_UPDATED = 'ap2.mandate_updated',
  AP2_MANDATE_EXECUTED = 'ap2.mandate_executed',
  AP2_MANDATE_CANCELLED = 'ap2.mandate_cancelled',
  AP2_MANDATE_EXPIRED = 'ap2.mandate_expired',

  // --- x402 Protocol ---
  X402_ENDPOINT_CREATED = 'x402.endpoint_created',
  X402_ENDPOINT_UPDATED = 'x402.endpoint_updated',
  X402_PAYMENT_SENT = 'x402.payment_sent',
  X402_PAYMENT_VERIFIED = 'x402.payment_verified',

  // --- MPP Protocol (Machine Payments Protocol) ---
  MPP_CHALLENGE_RECEIVED = 'mpp.challenge_received',
  MPP_POLICY_CHECKED = 'mpp.policy_checked',
  MPP_POLICY_VIOLATED = 'mpp.policy_violated',
  MPP_CREDENTIAL_SIGNED = 'mpp.credential_signed',
  MPP_PAYMENT_COMPLETED = 'mpp.payment_completed',
  MPP_PAYMENT_FAILED = 'mpp.payment_failed',
  MPP_SESSION_OPENED = 'mpp.session_opened',
  MPP_SESSION_VOUCHER = 'mpp.session_voucher',
  MPP_SESSION_CLOSED = 'mpp.session_closed',
  MPP_SESSION_EXHAUSTED = 'mpp.session_exhausted',

  // --- Governance & Compliance ---
  GOVERNANCE_KYA = 'governance.kya',
  GOVERNANCE_LIMIT_CHECK = 'governance.limit_check',
  GOVERNANCE_POLICY_EVAL = 'governance.policy_eval',
  GOVERNANCE_APPROVAL = 'governance.approval',
  GOVERNANCE_PERMISSION = 'governance.permission',
  COMPLIANCE_SANCTIONS = 'compliance.sanctions',
  COMPLIANCE_KYC = 'compliance.kyc',
  COMPLIANCE_KYB = 'compliance.kyb',
  COMPLIANCE_TM = 'compliance.tm',

  // --- Entity Lifecycle ---
  ENTITY_ACCOUNT_CREATED = 'entity.account_created',
  ENTITY_ACCOUNT_UPDATED = 'entity.account_updated',
  ENTITY_AGENT_CREATED = 'entity.agent_created',
  ENTITY_AGENT_DELETED = 'entity.agent_deleted',

  // --- A2A & Discovery ---
  A2A_AGENT_DISCOVERED = 'a2a.agent_discovered',
  A2A_TASK_SENT = 'a2a.task_sent',
  A2A_TASK_STATE_CHANGED = 'a2a.task_state_changed',
  DISCOVERY_MERCHANT_SCAN = 'discovery.merchant_scan',
  DISCOVERY_SHOPPING_TEST = 'discovery.shopping_test',

  // --- Composition (Multi-Protocol) ---
  COMPOSITION_TASK_SETTLED = 'composition.task_settled',
  COMPOSITION_TASK_REJECTED = 'composition.task_rejected',
}

// =============================================================================
// Category — groups OpTypes for filtering & dashboards
// =============================================================================

export enum OpCategory {
  SETTLEMENT = 'settlement',
  WALLET = 'wallet',
  UCP = 'ucp',
  ACP = 'acp',
  AP2 = 'ap2',
  X402 = 'x402',
  MPP = 'mpp',
  GOVERNANCE = 'governance',
  COMPLIANCE = 'compliance',
  ENTITY = 'entity',
  A2A = 'a2a',
  DISCOVERY = 'discovery',
  COMPOSITION = 'composition',
}

/** Derive category from an OpType */
export function getCategoryFromOpType(opType: OpType): OpCategory {
  const prefix = opType.split('.')[0];
  const categoryMap: Record<string, OpCategory> = {
    settlement: OpCategory.SETTLEMENT,
    wallet: OpCategory.WALLET,
    ucp: OpCategory.UCP,
    acp: OpCategory.ACP,
    ap2: OpCategory.AP2,
    x402: OpCategory.X402,
    mpp: OpCategory.MPP,
    governance: OpCategory.GOVERNANCE,
    compliance: OpCategory.COMPLIANCE,
    entity: OpCategory.ENTITY,
    a2a: OpCategory.A2A,
    discovery: OpCategory.DISCOVERY,
    composition: OpCategory.COMPOSITION,
  };
  return categoryMap[prefix] || OpCategory.SETTLEMENT;
}

// =============================================================================
// Protocol — which protocol this operation belongs to
// =============================================================================

export type Protocol = 'ucp' | 'acp' | 'ap2' | 'x402' | 'mpp' | 'a2a' | 'cctp' | 'internal' | null;

export function getProtocolFromOpType(opType: OpType): Protocol {
  if (opType.startsWith('ucp.')) return 'ucp';
  if (opType.startsWith('acp.')) return 'acp';
  if (opType.startsWith('ap2.')) return 'ap2';
  if (opType.startsWith('x402.')) return 'x402';
  if (opType.startsWith('mpp.')) return 'mpp';
  if (opType.startsWith('a2a.')) return 'a2a';
  if (opType === OpType.SETTLEMENT_CCTP_BRIDGE) return 'cctp';
  return null;
}

// =============================================================================
// CostKey — external cost categories for cost-to-serve analysis
// =============================================================================

export enum CostKey {
  CIRCLE_TRANSFER = 'circle.transfer',
  CIRCLE_PAYOUT = 'circle.payout',
  CIRCLE_WALLET_CREATE = 'circle.wallet_create',
  CIRCLE_FX = 'circle.fx',
  CIRCLE_CCTP = 'circle.cctp',
  COMPLIANCE_SANCTIONS_CHECK = 'compliance.sanctions_check',
  COMPLIANCE_KYC_CHECK = 'compliance.kyc_check',
  COMPLIANCE_KYB_CHECK = 'compliance.kyb_check',
  COMPLIANCE_TM_CHECK = 'compliance.tm_check',
  FUNDING_ONRAMP = 'funding.onramp',
  FUNDING_OFFRAMP = 'funding.offramp',
  SOLANA_PRIORITY_FEE = 'solana.priority_fee',
  SOLANA_RENT = 'solana.rent',
}

// =============================================================================
// CloudEvents 1.0 Envelope
// =============================================================================

export interface OperationEvent {
  /** Unique event ID (UUID v4) */
  id: string;
  /** CloudEvents spec version */
  specversion: '1.0';
  /** Event type: sly.{category}.{operation} */
  type: string;
  /** Event source identifier */
  source: string;
  /** Subject of the event (resource ID or path) */
  subject: string;
  /** ISO 8601 timestamp */
  time: string;
  /** Tenant that owns this event */
  tenantId: string;
  /** Correlation ID for grouping events from the same request */
  correlationId?: string;
  /** Actor classification */
  actorType: 'api_key' | 'user' | 'agent' | 'portal' | 'system';
  /** Actor identifier */
  actorId: string;
  /** Operation category */
  category: OpCategory;
  /** Specific operation */
  operation: OpType;
  /** USD amount involved (if applicable) */
  amountUsd?: number;
  /** Currency code (if applicable) */
  currency?: string;
  /** Protocol identifier */
  protocol?: Protocol;
  /** Whether the operation succeeded */
  success: boolean;
  /** Duration in milliseconds */
  durationMs?: number;
  /** External cost in USD (from cost wrappers) */
  externalCostUsd?: number;
  /** Arbitrary metadata */
  data?: Record<string, unknown>;
}

// =============================================================================
// trackOp() Input — what callers provide
// =============================================================================

export interface TrackOpInput {
  tenantId: string;
  operation: OpType;
  subject: string;
  actorType?: 'api_key' | 'user' | 'agent' | 'portal' | 'system';
  actorId?: string;
  correlationId?: string;
  success?: boolean;
  durationMs?: number;
  amountUsd?: number;
  currency?: string;
  externalCostUsd?: number;
  data?: Record<string, unknown>;
}

// =============================================================================
// Cost Tracking Input
// =============================================================================

export interface CostTrackingInput {
  tenantId: string;
  provider: CostKey;
  subject: string;
  actorType?: 'api_key' | 'user' | 'agent' | 'portal' | 'system';
  actorId?: string;
  data?: Record<string, unknown>;
}

// =============================================================================
// Request Count Row — what gets upserted to api_request_counts
// =============================================================================

export interface RequestCountRow {
  tenantId: string;
  minuteBucket: string; // ISO 8601 truncated to minute
  method: string;
  pathTemplate: string;
  statusCode: number;
  actorType: string;
  count: number;
  totalDurationMs: number;
}

// =============================================================================
// Usage API Response Types
// =============================================================================

export interface UsageSummary {
  period: { start: string; end: string };
  totalRequests: number;
  totalOperations: number;
  totalCostUsd: number;
  byCategory: Record<string, number>;
  byProtocol: Record<string, number>;
}

export interface UsageOperationsQuery {
  tenantId: string;
  start?: string;
  end?: string;
  category?: OpCategory;
  operation?: OpType;
  protocol?: Protocol;
  page?: number;
  limit?: number;
}
