/**
 * Contract Policy Engine
 *
 * Epic 18, Story 18.7: The core policy engine for agent contract governance.
 *
 * Composes:
 *   1. Existing SpendingPolicyService (daily/monthly limits, vendor allowlists)
 *   2. Counterparty checks (blocklist, allowlist, KYA tier, reputation)
 *   3. Exposure window checks (24h/7d/30d caps)
 *   4. Contract-type restrictions
 *   5. Concurrent contract limits
 *
 * Returns a three-way decision: approve / escalate / deny
 * with optional counter-offer generation on deny.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import type { SpendingPolicy } from './spending-policy.js';
import { SpendingPolicyService } from './spending-policy.js';
import { CounterpartyExposureService } from './counterparty-exposure.service.js';
import type {
  ContractPolicy,
  ContractPolicyContext,
  ContractPolicyResult,
  PolicyCheckDetail,
  PolicyDecision,
} from '../schemas/contract-policy.schema.js';
import { trackOp } from './ops/track-op.js';
import { OpType } from './ops/operation-types.js';

// ============================================
// Engine
// ============================================

export class ContractPolicyEngine {
  private spendingPolicyService: SpendingPolicyService;
  private exposureService: CounterpartyExposureService;

  constructor(private supabase: SupabaseClient) {
    this.spendingPolicyService = new SpendingPolicyService(supabase);
    this.exposureService = new CounterpartyExposureService(supabase);
  }

  /**
   * Evaluate a contract/payment action against the wallet's policy.
   *
   * Runs all checks and returns a composite decision:
   *   - approve: all checks pass
   *   - escalate: soft limit exceeded, needs human approval
   *   - deny: hard limit exceeded or blocklist hit
   */
  async evaluate(ctx: ContractPolicyContext): Promise<ContractPolicyResult> {
    const start = Date.now();
    const checks: PolicyCheckDetail[] = [];
    const reasons: string[] = [];
    let decision: PolicyDecision = 'approve';
    let suggestedCounterOffer: ContractPolicyResult['suggestedCounterOffer'];

    // 1. Fetch wallet + spending policy
    const wallet = await this.spendingPolicyService.getWalletWithPolicy(ctx.walletId);
    if (!wallet) {
      return this.buildResult('deny', ['Wallet not found'], [
        { check: 'wallet_exists', result: 'fail', detail: 'Wallet not found' },
      ], Date.now() - start);
    }

    const spendingPolicy = wallet.spending_policy;
    const contractPolicy = (spendingPolicy as any)?.contractPolicy as ContractPolicy | undefined;

    // 2. Run existing spending policy checks (reuse, don't rewrite)
    const spendingResult = await this.spendingPolicyService.checkPolicy(
      ctx.walletId,
      ctx.amount,
      {
        protocol: (ctx.protocol as any) || 'x402',
        vendor: ctx.counterpartyAddress,
      },
      ctx.correlationId,
    );

    if (!spendingResult.allowed) {
      if (spendingResult.requiresApproval) {
        decision = this.escalateDecision(decision);
        reasons.push(spendingResult.reason || 'Exceeds approval threshold');
        checks.push({
          check: 'spending_policy',
          result: 'fail',
          detail: spendingResult.reason || 'Requires approval',
        });
      } else {
        decision = 'deny';
        reasons.push(spendingResult.reason || 'Spending policy violation');
        checks.push({
          check: 'spending_policy',
          result: 'fail',
          detail: spendingResult.reason || 'Hard limit exceeded',
        });
        // Generate counter-offer based on remaining limit
        if (spendingResult.limits?.daily && spendingResult.currentSpending) {
          const remaining = (spendingResult.limits.daily) - spendingResult.currentSpending.daily;
          if (remaining > 0) {
            suggestedCounterOffer = {
              maxAmount: remaining,
              reason: `Daily limit allows up to ${remaining.toFixed(2)}`,
            };
          }
        }
      }
    } else {
      checks.push({ check: 'spending_policy', result: 'pass', detail: 'Within spending limits' });
    }

    // If no contract policy, skip remaining checks
    if (!contractPolicy) {
      checks.push({ check: 'contract_policy', result: 'skip', detail: 'No contract policy configured' });
      return this.finalize(ctx, decision, reasons, checks, suggestedCounterOffer, start);
    }

    // 3. Counterparty blocklist
    if (contractPolicy.counterpartyBlocklist?.length) {
      const counterpartyId = ctx.counterpartyAgentId || ctx.counterpartyAddress || '';
      if (contractPolicy.counterpartyBlocklist.includes(counterpartyId)) {
        decision = 'deny';
        reasons.push(`Counterparty "${counterpartyId}" is blocklisted`);
        checks.push({ check: 'counterparty_blocklist', result: 'fail', detail: `Blocked: ${counterpartyId}` });
        return this.finalize(ctx, decision, reasons, checks, undefined, start);
      }
      checks.push({ check: 'counterparty_blocklist', result: 'pass', detail: 'Not blocklisted' });
    }

    // 4. Counterparty allowlist
    if (contractPolicy.counterpartyAllowlist?.length) {
      const counterpartyId = ctx.counterpartyAgentId || ctx.counterpartyAddress || '';
      if (!contractPolicy.counterpartyAllowlist.includes(counterpartyId)) {
        decision = 'deny';
        reasons.push(`Counterparty "${counterpartyId}" not in allowlist`);
        checks.push({ check: 'counterparty_allowlist', result: 'fail', detail: `Not allowed: ${counterpartyId}` });
        return this.finalize(ctx, decision, reasons, checks, undefined, start);
      }
      checks.push({ check: 'counterparty_allowlist', result: 'pass', detail: 'In allowlist' });
    }

    // 5. Counterparty KYA tier check
    if (contractPolicy.minCounterpartyKyaTier !== undefined && ctx.counterpartyAgentId) {
      const cptyTier = await this.getCounterpartyKyaTier(ctx.counterpartyAgentId);
      if (cptyTier < contractPolicy.minCounterpartyKyaTier) {
        decision = 'deny';
        reasons.push(`Counterparty KYA tier ${cptyTier} below minimum ${contractPolicy.minCounterpartyKyaTier}`);
        checks.push({
          check: 'counterparty_kya_tier',
          result: 'fail',
          detail: `Tier ${cptyTier} < required ${contractPolicy.minCounterpartyKyaTier}`,
        });
      } else {
        checks.push({
          check: 'counterparty_kya_tier',
          result: 'pass',
          detail: `Tier ${cptyTier} >= required ${contractPolicy.minCounterpartyKyaTier}`,
        });
      }
    }

    // 6. Counterparty reputation check (Epic 63 integration)
    if (contractPolicy.minCounterpartyReputation !== undefined && ctx.counterpartyAgentId) {
      const reputation = await this.getCounterpartyReputation(ctx.counterpartyAgentId);
      if (reputation !== null && reputation < contractPolicy.minCounterpartyReputation) {
        decision = 'deny';
        reasons.push(`Counterparty reputation ${reputation.toFixed(2)} below minimum ${contractPolicy.minCounterpartyReputation}`);
        checks.push({
          check: 'counterparty_reputation',
          result: 'fail',
          detail: `Score ${reputation.toFixed(2)} < required ${contractPolicy.minCounterpartyReputation}`,
        });
      } else {
        checks.push({
          check: 'counterparty_reputation',
          result: reputation !== null ? 'pass' : 'skip',
          detail: reputation !== null
            ? `Score ${reputation.toFixed(2)} >= required ${contractPolicy.minCounterpartyReputation}`
            : 'No reputation data available',
        });
      }
    }

    // 7. Contract type restrictions
    if (ctx.contractType) {
      if (contractPolicy.blockedContractTypes?.includes(ctx.contractType)) {
        decision = 'deny';
        reasons.push(`Contract type "${ctx.contractType}" is blocked`);
        checks.push({
          check: 'contract_type_blocked',
          result: 'fail',
          detail: `Type "${ctx.contractType}" in blocked list`,
        });
      } else if (
        contractPolicy.allowedContractTypes?.length &&
        !contractPolicy.allowedContractTypes.includes(ctx.contractType)
      ) {
        decision = 'deny';
        reasons.push(`Contract type "${ctx.contractType}" not in allowed types`);
        checks.push({
          check: 'contract_type_allowed',
          result: 'fail',
          detail: `Type "${ctx.contractType}" not in allowed list: [${contractPolicy.allowedContractTypes.join(', ')}]`,
        });
      } else {
        checks.push({ check: 'contract_type', result: 'pass', detail: 'Contract type permitted' });
      }
    }

    // 8. Exposure window checks
    if (ctx.counterpartyAgentId || ctx.counterpartyAddress) {
      const counterparty = {
        counterpartyAgentId: ctx.counterpartyAgentId,
        counterpartyAddress: ctx.counterpartyAddress,
      };
      const exposure = await this.exposureService.getExposure(ctx.walletId, counterparty, ctx.tenantId);

      if (exposure) {
        // 24h exposure
        if (contractPolicy.maxExposure24h !== undefined) {
          const projected = exposure.exposure24h + ctx.amount;
          if (projected > contractPolicy.maxExposure24h) {
            decision = 'deny';
            const remaining = Math.max(0, contractPolicy.maxExposure24h - exposure.exposure24h);
            reasons.push(`Would exceed 24h exposure cap (${projected.toFixed(2)} > ${contractPolicy.maxExposure24h})`);
            checks.push({
              check: 'exposure_24h',
              result: 'fail',
              detail: `Projected ${projected.toFixed(2)} > cap ${contractPolicy.maxExposure24h}`,
            });
            if (remaining > 0 && (!suggestedCounterOffer || remaining < suggestedCounterOffer.maxAmount)) {
              suggestedCounterOffer = {
                maxAmount: remaining,
                reason: `24h exposure cap allows up to ${remaining.toFixed(2)}`,
              };
            }
          } else {
            checks.push({ check: 'exposure_24h', result: 'pass', detail: `${projected.toFixed(2)} <= ${contractPolicy.maxExposure24h}` });
          }
        }

        // 7d exposure
        if (contractPolicy.maxExposure7d !== undefined) {
          const projected = exposure.exposure7d + ctx.amount;
          if (projected > contractPolicy.maxExposure7d) {
            decision = 'deny';
            reasons.push(`Would exceed 7d exposure cap (${projected.toFixed(2)} > ${contractPolicy.maxExposure7d})`);
            checks.push({
              check: 'exposure_7d',
              result: 'fail',
              detail: `Projected ${projected.toFixed(2)} > cap ${contractPolicy.maxExposure7d}`,
            });
          } else {
            checks.push({ check: 'exposure_7d', result: 'pass', detail: `${projected.toFixed(2)} <= ${contractPolicy.maxExposure7d}` });
          }
        }

        // 30d exposure
        if (contractPolicy.maxExposure30d !== undefined) {
          const projected = exposure.exposure30d + ctx.amount;
          if (projected > contractPolicy.maxExposure30d) {
            decision = 'deny';
            reasons.push(`Would exceed 30d exposure cap (${projected.toFixed(2)} > ${contractPolicy.maxExposure30d})`);
            checks.push({
              check: 'exposure_30d',
              result: 'fail',
              detail: `Projected ${projected.toFixed(2)} > cap ${contractPolicy.maxExposure30d}`,
            });
          } else {
            checks.push({ check: 'exposure_30d', result: 'pass', detail: `${projected.toFixed(2)} <= ${contractPolicy.maxExposure30d}` });
          }
        }

        // Active contracts limit
        if (contractPolicy.maxActiveContracts !== undefined) {
          if (exposure.activeContracts >= contractPolicy.maxActiveContracts) {
            decision = 'deny';
            reasons.push(`Active contracts (${exposure.activeContracts}) at limit (${contractPolicy.maxActiveContracts})`);
            checks.push({
              check: 'active_contracts',
              result: 'fail',
              detail: `${exposure.activeContracts} >= limit ${contractPolicy.maxActiveContracts}`,
            });
          } else {
            checks.push({ check: 'active_contracts', result: 'pass', detail: `${exposure.activeContracts} < ${contractPolicy.maxActiveContracts}` });
          }
        }

        // Active escrows limit
        if (contractPolicy.maxActiveEscrows !== undefined) {
          if (exposure.activeEscrows >= contractPolicy.maxActiveEscrows) {
            decision = 'deny';
            reasons.push(`Active escrows (${exposure.activeEscrows}) at limit (${contractPolicy.maxActiveEscrows})`);
            checks.push({
              check: 'active_escrows',
              result: 'fail',
              detail: `${exposure.activeEscrows} >= limit ${contractPolicy.maxActiveEscrows}`,
            });
          } else {
            checks.push({ check: 'active_escrows', result: 'pass', detail: `${exposure.activeEscrows} < ${contractPolicy.maxActiveEscrows}` });
          }
        }
      } else {
        checks.push({ check: 'exposure_windows', result: 'pass', detail: 'No prior exposure with counterparty' });
      }
    }

    // 9. Escalation threshold (contract-policy-level, separate from spending policy approval threshold)
    if (decision === 'approve' && contractPolicy.escalateAbove !== undefined && ctx.amount > contractPolicy.escalateAbove) {
      decision = 'escalate';
      reasons.push(`Amount ${ctx.amount.toFixed(2)} exceeds contract policy escalation threshold ${contractPolicy.escalateAbove}`);
      checks.push({
        check: 'escalation_threshold',
        result: 'fail',
        detail: `${ctx.amount.toFixed(2)} > escalateAbove ${contractPolicy.escalateAbove}`,
      });
    }

    return this.finalize(ctx, decision, reasons, checks, suggestedCounterOffer, start);
  }

  // ============================================
  // Private helpers
  // ============================================

  private escalateDecision(current: PolicyDecision): PolicyDecision {
    // deny > escalate > approve (deny takes precedence)
    if (current === 'deny') return 'deny';
    return 'escalate';
  }

  private buildResult(
    decision: PolicyDecision,
    reasons: string[],
    checks: PolicyCheckDetail[],
    evaluationMs: number,
    suggestedCounterOffer?: ContractPolicyResult['suggestedCounterOffer'],
  ): ContractPolicyResult {
    return { decision, reasons, checks, suggestedCounterOffer, evaluationMs };
  }

  private async finalize(
    ctx: ContractPolicyContext,
    decision: PolicyDecision,
    reasons: string[],
    checks: PolicyCheckDetail[],
    suggestedCounterOffer: ContractPolicyResult['suggestedCounterOffer'],
    startMs: number,
  ): Promise<ContractPolicyResult> {
    const evaluationMs = Date.now() - startMs;

    // Record evaluation in audit log (unless dry-run)
    if (!ctx.dryRun) {
      await this.recordEvaluation(ctx, decision, reasons, checks, suggestedCounterOffer, evaluationMs);
    }

    // Track operation
    trackOp({
      tenantId: ctx.tenantId,
      operation: OpType.GOVERNANCE_POLICY_EVAL,
      subject: `wallet/${ctx.walletId}/contract-policy`,
      correlationId: ctx.correlationId,
      success: decision === 'approve',
      data: {
        decision,
        actionType: ctx.actionType,
        amount: ctx.amount,
        counterpartyAgentId: ctx.counterpartyAgentId,
        counterpartyAddress: ctx.counterpartyAddress,
        contractType: ctx.contractType,
        checksCount: checks.length,
        evaluationMs,
        dryRun: ctx.dryRun || false,
      },
    });

    return { decision, reasons, checks, suggestedCounterOffer, evaluationMs };
  }

  private async recordEvaluation(
    ctx: ContractPolicyContext,
    decision: PolicyDecision,
    reasons: string[],
    checks: PolicyCheckDetail[],
    suggestedCounterOffer: ContractPolicyResult['suggestedCounterOffer'],
    evaluationMs: number,
  ): Promise<void> {
    try {
      await this.supabase
        .from('policy_evaluations')
        .insert({
          tenant_id: ctx.tenantId,
          wallet_id: ctx.walletId,
          agent_id: ctx.agentId || null,
          action_type: ctx.actionType,
          counterparty_agent_id: ctx.counterpartyAgentId || null,
          counterparty_address: ctx.counterpartyAddress || null,
          amount: ctx.amount,
          currency: ctx.currency || 'USDC',
          contract_type: ctx.contractType || null,
          protocol: ctx.protocol || null,
          decision,
          decision_reasons: reasons,
          suggested_counter_offer: suggestedCounterOffer
            ? { max_amount: suggestedCounterOffer.maxAmount, reason: suggestedCounterOffer.reason }
            : null,
          checks_performed: checks,
          evaluation_ms: evaluationMs,
          correlation_id: ctx.correlationId || null,
        });
    } catch (err) {
      // Non-fatal: audit logging failure shouldn't block payment
      console.warn('[ContractPolicyEngine] Failed to record evaluation:', err);
    }
  }

  /**
   * Look up the KYA tier of a counterparty agent.
   */
  private async getCounterpartyKyaTier(agentId: string): Promise<number> {
    const { data } = await this.supabase
      .from('agents')
      .select('kya_tier')
      .eq('id', agentId)
      .maybeSingle();

    return data?.kya_tier ?? 0;
  }

  /**
   * Look up the reputation score of a counterparty agent.
   * Queries the reputation_scores table (Epic 63).
   * Returns null if no reputation data exists.
   */
  private async getCounterpartyReputation(agentId: string): Promise<number | null> {
    try {
      const { data } = await this.supabase
        .from('reputation_scores')
        .select('unified_score')
        .eq('agent_id', agentId)
        .maybeSingle();

      // unified_score is 0-1000; normalize to 0-1 for policy comparison
      if (data?.unified_score != null) {
        return data.unified_score / 1000;
      }
      return null;
    } catch {
      // reputation_scores table may not exist yet (Epic 63 not deployed)
      return null;
    }
  }
}

export function createContractPolicyEngine(supabase: SupabaseClient): ContractPolicyEngine {
  return new ContractPolicyEngine(supabase);
}
