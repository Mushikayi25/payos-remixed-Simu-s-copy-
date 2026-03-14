/**
 * Agent Wallets Client
 *
 * Epic 18: Agent Wallets & Contract Policies
 * Story 18.6: SDK Methods
 *
 * Provides:
 *   - evaluatePolicy()  — dry-run contract policy evaluation
 *   - getExposures()     — list counterparty exposures
 *   - getEvaluations()   — audit log of policy decisions
 *   - getWallet()        — get agent's wallet
 *   - freezeWallet()     — freeze agent's wallet
 *   - unfreezeWallet()   — reactivate agent's wallet
 *   - setContractPolicy() — set contract policy on agent's wallet
 */

import type { PayOSClient } from '../../client';

// ============================================
// Types
// ============================================

export interface ContractPolicy {
  counterpartyBlocklist?: string[];
  counterpartyAllowlist?: string[];
  minCounterpartyKyaTier?: number;
  minCounterpartyReputation?: number;
  allowedContractTypes?: string[];
  blockedContractTypes?: string[];
  maxExposure24h?: number;
  maxExposure7d?: number;
  maxExposure30d?: number;
  maxActiveContracts?: number;
  maxActiveEscrows?: number;
  escalateAbove?: number;
}

export interface SpendingPolicy {
  dailySpendLimit?: number;
  monthlySpendLimit?: number;
  requiresApprovalAbove?: number;
  approvedVendors?: string[];
  approvedCategories?: string[];
  approvedEndpoints?: string[];
  contractPolicy?: ContractPolicy;
}

export interface PolicyEvaluateRequest {
  amount: number;
  currency?: string;
  actionType:
    | 'payment'
    | 'escrow_create'
    | 'escrow_release'
    | 'contract_sign'
    | 'negotiation_check'
    | 'counterparty_check';
  contractType?: string;
  counterpartyAgentId?: string;
  counterpartyAddress?: string;
  protocol?: string;
}

export interface PolicyCheckDetail {
  check: string;
  result: 'pass' | 'fail' | 'skip';
  detail: string;
}

export interface PolicyEvaluateResponse {
  decision: 'approve' | 'escalate' | 'deny';
  reasons: string[];
  checks: PolicyCheckDetail[];
  suggestedCounterOffer: {
    maxAmount: number;
    reason: string;
  } | null;
  evaluationMs: number;
}

export interface CounterpartyExposure {
  id: string;
  walletId: string;
  counterpartyAgentId: string | null;
  counterpartyAddress: string | null;
  exposure24h: number;
  exposure7d: number;
  exposure30d: number;
  activeContracts: number;
  activeEscrows: number;
  totalVolume: number;
  transactionCount: number;
  currency: string;
}

export interface PolicyEvaluation {
  id: string;
  actionType: string;
  amount: number;
  currency: string;
  contractType: string | null;
  counterpartyAgentId: string | null;
  counterpartyAddress: string | null;
  decision: string;
  decisionReasons: string[];
  suggestedCounterOffer: any;
  checksPerformed: PolicyCheckDetail[];
  evaluationMs: number;
  createdAt: string;
}

// ============================================
// Client
// ============================================

export class AgentWalletsClient {
  private client: PayOSClient;

  constructor(client: PayOSClient) {
    this.client = client;
  }

  /**
   * Evaluate a contract policy in dry-run mode (negotiation guardrails).
   *
   * @example
   * ```typescript
   * const result = await sly.agentWallets.evaluatePolicy('agent-uuid', {
   *   amount: 150,
   *   actionType: 'payment',
   *   counterpartyAgentId: 'other-agent-uuid',
   * });
   * console.log(result.decision); // 'approve' | 'escalate' | 'deny'
   * ```
   */
  async evaluatePolicy(
    agentId: string,
    request: PolicyEvaluateRequest,
  ): Promise<PolicyEvaluateResponse> {
    const response = await this.client.request<{ data: any }>(
      `/v1/agents/${agentId}/wallet/policy/evaluate`,
      {
        method: 'POST',
        body: JSON.stringify({
          amount: request.amount,
          currency: request.currency || 'USDC',
          action_type: request.actionType,
          contract_type: request.contractType,
          counterparty_agent_id: request.counterpartyAgentId,
          counterparty_address: request.counterpartyAddress,
          protocol: request.protocol,
        }),
      },
    );
    const d = response.data || response;
    return {
      decision: d.decision,
      reasons: d.reasons,
      checks: d.checks,
      suggestedCounterOffer: d.suggested_counter_offer
        ? {
            maxAmount: d.suggested_counter_offer.max_amount,
            reason: d.suggested_counter_offer.reason,
          }
        : null,
      evaluationMs: d.evaluation_ms,
    };
  }

  /**
   * List counterparty exposures for an agent's wallet.
   *
   * @example
   * ```typescript
   * const exposures = await sly.agentWallets.getExposures('agent-uuid');
   * for (const exp of exposures) {
   *   console.log(`${exp.counterpartyAgentId}: ${exp.exposure24h} (24h)`);
   * }
   * ```
   */
  async getExposures(agentId: string): Promise<CounterpartyExposure[]> {
    const response = await this.client.request<{ data: any[] }>(
      `/v1/agents/${agentId}/wallet/exposures`,
    );
    const items = response.data || [];
    return items.map((e: any) => ({
      id: e.id,
      walletId: e.wallet_id,
      counterpartyAgentId: e.counterparty_agent_id,
      counterpartyAddress: e.counterparty_address,
      exposure24h: e.exposure_24h,
      exposure7d: e.exposure_7d,
      exposure30d: e.exposure_30d,
      activeContracts: e.active_contracts,
      activeEscrows: e.active_escrows,
      totalVolume: e.total_volume,
      transactionCount: e.transaction_count,
      currency: e.currency,
    }));
  }

  /**
   * Get policy evaluation audit log for an agent's wallet.
   */
  async getEvaluations(
    agentId: string,
    options?: { page?: number; limit?: number },
  ): Promise<{ data: PolicyEvaluation[]; pagination: any }> {
    const params = new URLSearchParams();
    if (options?.page) params.set('page', options.page.toString());
    if (options?.limit) params.set('limit', options.limit.toString());
    const qs = params.toString();

    const response = await this.client.request<{ data: any[]; pagination: any }>(
      `/v1/agents/${agentId}/wallet/policy/evaluations${qs ? `?${qs}` : ''}`,
    );
    return {
      data: (response.data || []).map((e: any) => ({
        id: e.id,
        actionType: e.action_type,
        amount: e.amount,
        currency: e.currency,
        contractType: e.contract_type,
        counterpartyAgentId: e.counterparty_agent_id,
        counterpartyAddress: e.counterparty_address,
        decision: e.decision,
        decisionReasons: e.decision_reasons,
        suggestedCounterOffer: e.suggested_counter_offer,
        checksPerformed: e.checks_performed,
        evaluationMs: e.evaluation_ms,
        createdAt: e.created_at,
      })),
      pagination: response.pagination,
    };
  }

  /**
   * Get an agent's wallet details.
   */
  async getWallet(agentId: string): Promise<any> {
    const response = await this.client.request<{ data: any }>(
      `/v1/agents/${agentId}/wallet`,
    );
    return response.data || response;
  }

  /**
   * Freeze an agent's wallet (disables all payments).
   */
  async freezeWallet(agentId: string): Promise<any> {
    const response = await this.client.request<{ data: any }>(
      `/v1/agents/${agentId}/wallet/freeze`,
      { method: 'POST' },
    );
    return response.data || response;
  }

  /**
   * Unfreeze an agent's wallet (re-enables payments).
   */
  async unfreezeWallet(agentId: string): Promise<any> {
    const response = await this.client.request<{ data: any }>(
      `/v1/agents/${agentId}/wallet/unfreeze`,
      { method: 'POST' },
    );
    return response.data || response;
  }

  /**
   * Set or update the contract policy on an agent's wallet.
   *
   * @example
   * ```typescript
   * await sly.agentWallets.setContractPolicy('agent-uuid', {
   *   dailySpendLimit: 500,
   *   contractPolicy: {
   *     counterpartyBlocklist: ['bad-agent-id'],
   *     maxExposure24h: 200,
   *     escalateAbove: 100,
   *   },
   * });
   * ```
   */
  async setContractPolicy(
    agentId: string,
    policy: SpendingPolicy,
  ): Promise<any> {
    const response = await this.client.request<{ data: any }>(
      `/v1/agents/${agentId}/wallet/policy`,
      {
        method: 'PUT',
        body: JSON.stringify(policy),
      },
    );
    return response.data || response;
  }
}
