/**
 * Contract Policy Zod Schemas
 *
 * Epic 18: Agent Wallets & Contract Policies
 * Validation schemas for the contractPolicy field within wallets.spending_policy JSONB.
 */

import { z } from 'zod';

// ============================================
// Contract Policy Schema (nested inside spending_policy)
// ============================================

export const contractPolicySchema = z.object({
  /** Agent IDs or wallet addresses that are blocked */
  counterpartyBlocklist: z.array(z.string()).optional(),

  /** Agent IDs or wallet addresses that are explicitly allowed (if set, only these are permitted) */
  counterpartyAllowlist: z.array(z.string()).optional(),

  /** Minimum KYA tier required for counterparty agents (0-3) */
  minCounterpartyKyaTier: z.number().int().min(0).max(3).optional(),

  /** Minimum reputation score required for counterparty (0.0-1.0, from Epic 63) */
  minCounterpartyReputation: z.number().min(0).max(1).optional(),

  /** Contract types that are allowed (if set, only these are permitted) */
  allowedContractTypes: z.array(z.string()).optional(),

  /** Contract types that are blocked (takes precedence over allowedContractTypes) */
  blockedContractTypes: z.array(z.string()).optional(),

  /** Maximum rolling 24-hour exposure per counterparty */
  maxExposure24h: z.number().positive().optional(),

  /** Maximum rolling 7-day exposure per counterparty */
  maxExposure7d: z.number().positive().optional(),

  /** Maximum rolling 30-day exposure per counterparty */
  maxExposure30d: z.number().positive().optional(),

  /** Maximum active contracts per counterparty */
  maxActiveContracts: z.number().int().nonnegative().optional(),

  /** Maximum active escrows per counterparty */
  maxActiveEscrows: z.number().int().nonnegative().optional(),

  /** Amount above which the engine escalates instead of auto-approving */
  escalateAbove: z.number().positive().optional(),
});

export type ContractPolicy = z.infer<typeof contractPolicySchema>;

// ============================================
// Extended Spending Policy Schema (existing + contract policy)
// ============================================

export const extendedSpendingPolicySchema = z.object({
  // --- Existing spending policy fields ---
  dailySpendLimit: z.number().positive().optional(),
  dailySpent: z.number().nonnegative().optional(),
  dailyResetAt: z.string().optional(),
  monthlySpendLimit: z.number().positive().optional(),
  monthlySpent: z.number().nonnegative().optional(),
  monthlyResetAt: z.string().optional(),
  approvalThreshold: z.number().positive().optional(),
  requiresApprovalAbove: z.number().positive().optional(),
  approvedEndpoints: z.array(z.string()).optional(),
  approvedVendors: z.array(z.string()).optional(),
  approvedCategories: z.array(z.string()).optional(),
  autoFundEnabled: z.boolean().optional(),
  autoFundThreshold: z.number().positive().optional(),
  autoFundAmount: z.number().positive().optional(),
  autoFundSourceAccountId: z.string().uuid().optional(),

  // --- New: Contract Policy (Epic 18) ---
  contractPolicy: contractPolicySchema.optional(),
});

export type ExtendedSpendingPolicy = z.infer<typeof extendedSpendingPolicySchema>;

// ============================================
// Policy Evaluation Types
// ============================================

export type PolicyDecision = 'approve' | 'escalate' | 'deny';

export type ActionType =
  | 'payment'
  | 'escrow_create'
  | 'escrow_release'
  | 'contract_sign'
  | 'negotiation_check'
  | 'counterparty_check';

export interface PolicyCheckDetail {
  check: string;
  result: 'pass' | 'fail' | 'skip';
  detail: string;
}

export interface ContractPolicyResult {
  decision: PolicyDecision;
  reasons: string[];
  checks: PolicyCheckDetail[];
  suggestedCounterOffer?: {
    maxAmount: number;
    reason: string;
  };
  evaluationMs: number;
}

export interface ContractPolicyContext {
  walletId: string;
  agentId: string;
  tenantId: string;
  amount: number;
  currency?: string;
  actionType: ActionType;
  contractType?: string;
  protocol?: string;
  counterpartyAgentId?: string;
  counterpartyAddress?: string;
  correlationId?: string;
  /** If true, do not record the evaluation (dry-run for negotiation) */
  dryRun?: boolean;
}

// ============================================
// Negotiation Guardrails Request/Response
// ============================================

export const negotiationEvaluateRequestSchema = z.object({
  amount: z.number().positive(),
  currency: z.string().default('USDC'),
  action_type: z.enum([
    'payment', 'escrow_create', 'escrow_release',
    'contract_sign', 'negotiation_check', 'counterparty_check',
  ]).default('negotiation_check'),
  contract_type: z.string().optional(),
  counterparty_agent_id: z.string().uuid().optional(),
  counterparty_address: z.string().optional(),
  protocol: z.string().optional(),
});

export type NegotiationEvaluateRequest = z.infer<typeof negotiationEvaluateRequestSchema>;
