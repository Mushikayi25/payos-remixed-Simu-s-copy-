/**
 * Spending Policy Service
 * 
 * Unified service for checking and enforcing wallet spending policies
 * across all protocols (x402, AP2, ACP, UCP).
 * 
 * Story 18.R1: Extracted from x402-payments.ts for multi-protocol use.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { trackOp } from './ops/track-op.js';
import { OpType } from './ops/operation-types.js';

// ============================================
// Types
// ============================================

export interface SpendingPolicy {
  // Spending limits
  dailySpendLimit?: number;
  dailySpent?: number;
  dailyResetAt?: string;
  monthlySpendLimit?: number;
  monthlySpent?: number;
  monthlyResetAt?: string;
  
  // Approval controls
  approvalThreshold?: number;       // Legacy name
  requiresApprovalAbove?: number;   // Preferred name
  
  // Allowlists
  approvedEndpoints?: string[];     // x402-specific endpoint IDs
  approvedVendors?: string[];       // Domain patterns
  approvedCategories?: string[];    // Payment categories
  
  // Auto-fund settings
  autoFundEnabled?: boolean;
  autoFundThreshold?: number;
  autoFundAmount?: number;
  autoFundSourceAccountId?: string;
}

export interface PolicyContext {
  protocol: 'x402' | 'ap2' | 'acp' | 'ucp' | 'mpp';
  vendor?: string;          // Domain or merchant identifier
  category?: string;        // Payment category
  endpointId?: string;      // x402 endpoint ID
  endpointPath?: string;    // x402 endpoint path
  merchantId?: string;      // ACP/UCP merchant
  mandateId?: string;       // AP2 mandate
  mppServiceUrl?: string;   // MPP target service URL
  mppSessionId?: string;    // MPP session ID (for streaming)
  metadata?: Record<string, unknown>;
}

export interface PolicyCheckResult {
  allowed: boolean;
  requiresApproval: boolean;
  reason?: string;
  violationType?: 'daily_limit' | 'monthly_limit' | 'approval_threshold' | 'vendor_not_approved' | 'endpoint_not_approved' | 'category_not_approved';
  currentSpending?: {
    daily: number;
    monthly: number;
  };
  limits?: {
    daily?: number;
    monthly?: number;
    approvalThreshold?: number;
  };
}

export interface WalletWithPolicy {
  id: string;
  tenant_id: string;
  owner_account_id: string;
  managed_by_agent_id?: string;
  balance: number;
  currency: string;
  spending_policy: SpendingPolicy | null;
  status: string;
}

// ============================================
// Cache Implementation
// ============================================

interface CacheEntry<T> {
  data: T;
  expiresAt: number;
}

const policyCache = new Map<string, CacheEntry<SpendingPolicy | null>>();
const CACHE_TTL_MS = 30000; // 30 seconds

function getCachedPolicy(walletId: string): SpendingPolicy | null | undefined {
  const cached = policyCache.get(walletId);
  if (cached && Date.now() < cached.expiresAt) {
    return cached.data;
  }
  if (cached) {
    policyCache.delete(walletId);
  }
  return undefined; // undefined means not in cache, null means no policy
}

function cachePolicy(walletId: string, policy: SpendingPolicy | null): void {
  policyCache.set(walletId, {
    data: policy,
    expiresAt: Date.now() + CACHE_TTL_MS
  });
}

export function invalidatePolicyCache(walletId: string): void {
  policyCache.delete(walletId);
}

// Clean up expired entries periodically
setInterval(() => {
  const now = Date.now();
  const keysToDelete: string[] = [];
  policyCache.forEach((value, key) => {
    if (now >= value.expiresAt) {
      keysToDelete.push(key);
    }
  });
  keysToDelete.forEach(key => policyCache.delete(key));
}, 60000);

// ============================================
// Spending Policy Service
// ============================================

export class SpendingPolicyService {
  constructor(private supabase: SupabaseClient) {}

  /**
   * Check if a payment is allowed by the wallet's spending policy.
   * 
   * Returns:
   * - { allowed: true } if payment is within policy
   * - { allowed: false, requiresApproval: true } if amount exceeds approval threshold
   * - { allowed: false, requiresApproval: false } if hard limit exceeded
   */
  async checkPolicy(
    walletId: string,
    amount: number,
    context: PolicyContext,
    correlationId?: string
  ): Promise<PolicyCheckResult> {
    // Fetch wallet with policy
    const wallet = await this.getWalletWithPolicy(walletId);
    if (!wallet) {
      trackOp({
        tenantId: 'unknown',
        operation: OpType.GOVERNANCE_POLICY_EVAL,
        subject: `wallet/${walletId}`,
        correlationId,
        success: false,
        data: { amount, reason: 'Wallet not found', protocol: context.protocol },
      });
      return {
        allowed: false,
        requiresApproval: false,
        reason: 'Wallet not found'
      };
    }

    const policy = wallet.spending_policy;

    // No policy = no restrictions
    if (!policy) {
      trackOp({
        tenantId: wallet.tenant_id,
        operation: OpType.GOVERNANCE_POLICY_EVAL,
        subject: `wallet/${walletId}`,
        correlationId,
        success: true,
        data: { amount, protocol: context.protocol, policyPresent: false },
      });
      return { allowed: true, requiresApproval: false };
    }

    // Reset counters if needed (handles daily/monthly rollovers)
    const normalizedPolicy = this.normalizeCounters(policy);

    // 1. Check hard limits first (these cannot be bypassed with approval)
    
    // Check daily spend limit
    if (normalizedPolicy.dailySpendLimit) {
      const dailySpent = normalizedPolicy.dailySpent || 0;
      if (dailySpent + amount > normalizedPolicy.dailySpendLimit) {
        trackOp({
          tenantId: wallet.tenant_id,
          operation: OpType.GOVERNANCE_POLICY_EVAL,
          subject: `wallet/${walletId}`,
          success: false,
          correlationId,
          data: { amount, protocol: context.protocol, violationType: 'daily_limit', dailySpent, dailyLimit: normalizedPolicy.dailySpendLimit },
        });
        return {
          allowed: false,
          requiresApproval: false,
          reason: `Would exceed daily spend limit (${(dailySpent + amount).toFixed(2)} > ${normalizedPolicy.dailySpendLimit})`,
          violationType: 'daily_limit',
          currentSpending: { daily: dailySpent, monthly: normalizedPolicy.monthlySpent || 0 },
          limits: { daily: normalizedPolicy.dailySpendLimit, monthly: normalizedPolicy.monthlySpendLimit }
        };
      }
    }

    // Check monthly spend limit
    if (normalizedPolicy.monthlySpendLimit) {
      const monthlySpent = normalizedPolicy.monthlySpent || 0;
      if (monthlySpent + amount > normalizedPolicy.monthlySpendLimit) {
        trackOp({
          tenantId: wallet.tenant_id,
          operation: OpType.GOVERNANCE_POLICY_EVAL,
          subject: `wallet/${walletId}`,
          success: false,
          correlationId,
          data: { amount, protocol: context.protocol, violationType: 'monthly_limit', monthlySpent, monthlyLimit: normalizedPolicy.monthlySpendLimit },
        });
        return {
          allowed: false,
          requiresApproval: false,
          reason: `Would exceed monthly spend limit (${(monthlySpent + amount).toFixed(2)} > ${normalizedPolicy.monthlySpendLimit})`,
          violationType: 'monthly_limit',
          currentSpending: { daily: normalizedPolicy.dailySpent || 0, monthly: monthlySpent },
          limits: { daily: normalizedPolicy.dailySpendLimit, monthly: normalizedPolicy.monthlySpendLimit }
        };
      }
    }

    // 2. Check allowlists (these are hard restrictions)

    // Check approved endpoints (x402-specific)
    if (context.endpointId && normalizedPolicy.approvedEndpoints?.length) {
      if (!normalizedPolicy.approvedEndpoints.includes(context.endpointId)) {
        trackOp({
          tenantId: wallet.tenant_id,
          operation: OpType.GOVERNANCE_POLICY_EVAL,
          subject: `wallet/${walletId}`,
          success: false,
          correlationId,
          data: { amount, protocol: context.protocol, violationType: 'endpoint_not_approved', endpointId: context.endpointId },
        });
        return {
          allowed: false,
          requiresApproval: false,
          reason: 'Endpoint not in approved endpoints list',
          violationType: 'endpoint_not_approved'
        };
      }
    }

    // Check approved vendors
    if (context.vendor && normalizedPolicy.approvedVendors?.length) {
      const isApproved = normalizedPolicy.approvedVendors.some(
        (vendor: string) => context.vendor!.toLowerCase().includes(vendor.toLowerCase())
      );
      if (!isApproved) {
        trackOp({
          tenantId: wallet.tenant_id,
          operation: OpType.GOVERNANCE_POLICY_EVAL,
          subject: `wallet/${walletId}`,
          success: false,
          correlationId,
          data: { amount, protocol: context.protocol, violationType: 'vendor_not_approved', vendor: context.vendor },
        });
        return {
          allowed: false,
          requiresApproval: false,
          reason: `Vendor "${context.vendor}" not in approved vendors list`,
          violationType: 'vendor_not_approved'
        };
      }
    }

    // Check approved categories
    if (context.category && normalizedPolicy.approvedCategories?.length) {
      if (!normalizedPolicy.approvedCategories.includes(context.category)) {
        trackOp({
          tenantId: wallet.tenant_id,
          operation: OpType.GOVERNANCE_POLICY_EVAL,
          subject: `wallet/${walletId}`,
          success: false,
          correlationId,
          data: { amount, protocol: context.protocol, violationType: 'category_not_approved', category: context.category },
        });
        return {
          allowed: false,
          requiresApproval: false,
          reason: `Category "${context.category}" not in approved categories list`,
          violationType: 'category_not_approved'
        };
      }
    }

    // 3. Check approval threshold (can be bypassed with human approval)
    const approvalThreshold = normalizedPolicy.approvalThreshold || normalizedPolicy.requiresApprovalAbove;
    if (approvalThreshold && amount > approvalThreshold) {
      trackOp({
        tenantId: wallet.tenant_id,
        operation: OpType.GOVERNANCE_POLICY_EVAL,
        subject: `wallet/${walletId}`,
        success: false,
        correlationId,
        data: { amount, protocol: context.protocol, violationType: 'approval_threshold', approvalThreshold, requiresApproval: true },
      });
      return {
        allowed: false,
        requiresApproval: true,  // KEY DIFFERENCE: This can be approved by human
        reason: `Amount ${amount.toFixed(2)} exceeds approval threshold ${approvalThreshold}`,
        violationType: 'approval_threshold',
        currentSpending: {
          daily: normalizedPolicy.dailySpent || 0,
          monthly: normalizedPolicy.monthlySpent || 0
        },
        limits: {
          daily: normalizedPolicy.dailySpendLimit,
          monthly: normalizedPolicy.monthlySpendLimit,
          approvalThreshold
        }
      };
    }

    // All checks passed
    trackOp({
      tenantId: wallet.tenant_id,
      operation: OpType.GOVERNANCE_POLICY_EVAL,
      subject: `wallet/${walletId}`,
      correlationId,
      success: true,
      data: { amount, protocol: context.protocol },
    });
    return {
      allowed: true,
      requiresApproval: false,
      currentSpending: {
        daily: normalizedPolicy.dailySpent || 0,
        monthly: normalizedPolicy.monthlySpent || 0
      },
      limits: {
        daily: normalizedPolicy.dailySpendLimit,
        monthly: normalizedPolicy.monthlySpendLimit,
        approvalThreshold
      }
    };
  }

  /**
   * Record spending after a successful payment.
   * Updates daily and monthly counters.
   */
  async recordSpending(walletId: string, amount: number): Promise<void> {
    const wallet = await this.getWalletWithPolicy(walletId);
    if (!wallet?.spending_policy) {
      return; // No policy to update
    }

    const updatedPolicy = this.updateCounters(wallet.spending_policy, amount);
    
    await this.supabase
      .from('wallets')
      .update({
        spending_policy: updatedPolicy,
        updated_at: new Date().toISOString()
      })
      .eq('id', walletId);

    // Invalidate cache
    invalidatePolicyCache(walletId);
  }

  /**
   * Get wallet with spending policy, using cache when available.
   */
  async getWalletWithPolicy(walletId: string): Promise<WalletWithPolicy | null> {
    const { data: wallet, error } = await this.supabase
      .from('wallets')
      .select('id, tenant_id, owner_account_id, managed_by_agent_id, balance, currency, spending_policy, status')
      .eq('id', walletId)
      .single();

    if (error || !wallet) {
      return null;
    }

    return {
      ...wallet,
      balance: parseFloat(wallet.balance)
    };
  }

  /**
   * Find wallet managed by an agent.
   */
  async getAgentWallet(agentId: string, tenantId: string): Promise<WalletWithPolicy | null> {
    const { data: wallet, error } = await this.supabase
      .from('wallets')
      .select('id, tenant_id, owner_account_id, managed_by_agent_id, balance, currency, spending_policy, status')
      .eq('managed_by_agent_id', agentId)
      .eq('tenant_id', tenantId)
      .eq('status', 'active')
      .single();

    if (error || !wallet) {
      return null;
    }

    return {
      ...wallet,
      balance: parseFloat(wallet.balance)
    };
  }

  /**
   * Normalize counters by resetting if past reset time.
   */
  private normalizeCounters(policy: SpendingPolicy): SpendingPolicy {
    const now = new Date();
    const normalized = { ...policy };

    // Check daily reset
    if (policy.dailyResetAt) {
      const resetTime = new Date(policy.dailyResetAt);
      if (now > resetTime) {
        // Past reset time - counter should be 0
        normalized.dailySpent = 0;
        // Set new reset time to tomorrow midnight
        const tomorrow = new Date(now);
        tomorrow.setDate(tomorrow.getDate() + 1);
        tomorrow.setHours(0, 0, 0, 0);
        normalized.dailyResetAt = tomorrow.toISOString();
      }
    }

    // Check monthly reset
    if (policy.monthlyResetAt) {
      const resetTime = new Date(policy.monthlyResetAt);
      if (now > resetTime) {
        // Past reset time - counter should be 0
        normalized.monthlySpent = 0;
        // Set new reset time to first of next month
        const nextMonth = new Date(now);
        nextMonth.setMonth(nextMonth.getMonth() + 1);
        nextMonth.setDate(1);
        nextMonth.setHours(0, 0, 0, 0);
        normalized.monthlyResetAt = nextMonth.toISOString();
      }
    }

    return normalized;
  }

  /**
   * Update spending counters after a payment.
   */
  private updateCounters(policy: SpendingPolicy, amount: number): SpendingPolicy {
    const now = new Date();
    const updated = { ...policy };

    // Update daily spent
    if (policy.dailySpendLimit !== undefined) {
      const resetTime = policy.dailyResetAt ? new Date(policy.dailyResetAt) : null;

      if (!resetTime || now > resetTime) {
        // Reset daily counter and set new reset time
        const tomorrow = new Date(now);
        tomorrow.setDate(tomorrow.getDate() + 1);
        tomorrow.setHours(0, 0, 0, 0);

        updated.dailySpent = amount;
        updated.dailyResetAt = tomorrow.toISOString();
      } else {
        updated.dailySpent = (policy.dailySpent || 0) + amount;
      }
    }

    // Update monthly spent
    if (policy.monthlySpendLimit !== undefined) {
      const resetTime = policy.monthlyResetAt ? new Date(policy.monthlyResetAt) : null;

      if (!resetTime || now > resetTime) {
        // Reset monthly counter and set new reset time
        const nextMonth = new Date(now);
        nextMonth.setMonth(nextMonth.getMonth() + 1);
        nextMonth.setDate(1);
        nextMonth.setHours(0, 0, 0, 0);

        updated.monthlySpent = amount;
        updated.monthlyResetAt = nextMonth.toISOString();
      } else {
        updated.monthlySpent = (policy.monthlySpent || 0) + amount;
      }
    }

    return updated;
  }
}

// ============================================
// Factory Function
// ============================================

export function createSpendingPolicyService(supabase: SupabaseClient): SpendingPolicyService {
  return new SpendingPolicyService(supabase);
}
