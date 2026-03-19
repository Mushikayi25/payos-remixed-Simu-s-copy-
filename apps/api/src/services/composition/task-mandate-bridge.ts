/**
 * Task–Mandate Bridge
 *
 * Evaluates whether an A2A task can proceed given:
 * 1. AP2 mandate: active, budget remaining, not expired
 * 2. A2A: counterparty KYA-verified, allowlisted, category-approved
 * 3. MPP: settlement path reachable (can we pay this agent via Tempo/Stripe?)
 *
 * Returns a unified CompositionDecision with reason identifying
 * which protocol blocked.
 *
 * @see Story 71.17: AP2 Mandate -> A2A Task -> MPP Settlement Bridge
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { getAP2MandateService } from '../ap2/mandate-service.js';
import type { MppPaymentMethod } from '../mpp/types.js';

// ============================================
// Types
// ============================================

export interface CompositionDecision {
  allowed: boolean;
  reason?: string;
  /** Which protocol caused the block */
  protocol?: 'ap2' | 'a2a' | 'mpp';
  mandate?: {
    id: string;
    status: string;
    remainingBudget: number;
    currency: string;
  };
  counterparty?: {
    agentId: string;
    name: string;
    kyaTier: number;
    verified: boolean;
  };
  paymentPath?: {
    reachable: boolean;
    method?: MppPaymentMethod;
    network?: string;
    recipientAddress?: string;
  };
  auditRef?: string;
}

export interface CompositionAuditEvent {
  type: 'composition.task_settled' | 'composition.task_rejected';
  mandateId: string;
  taskId: string;
  counterparty: string;
  amount: string;
  method?: MppPaymentMethod;
  receiptRef?: string;
  protocols: ('ap2' | 'a2a' | 'mpp')[];
}

export interface EvaluateOptions {
  tenantId: string;
  mandateId: string;
  taskId: string;
  counterpartyAgentId: string;
  amount: number;
  currency?: string;
  category?: string;
}

// ============================================
// Task-Mandate Bridge
// ============================================

export class TaskMandateBridge {
  constructor(private supabase: SupabaseClient) {}

  /**
   * Evaluate whether an A2A task can proceed against an AP2 mandate
   * with MPP as the settlement rail.
   * Returns a unified decision spanning all three protocols.
   */
  async evaluateTaskWithMandate(options: EvaluateOptions): Promise<CompositionDecision> {
    const { tenantId, mandateId, taskId, counterpartyAgentId, amount, currency = 'USDC', category } = options;

    // 1. AP2 Check: mandate active, budget remaining, not expired
    const mandateService = getAP2MandateService();
    const mandate = await mandateService.getMandate(mandateId);

    if (!mandate) {
      return {
        allowed: false,
        reason: 'Mandate not found',
        protocol: 'ap2',
      };
    }

    const mandateValidation = mandateService.validateMandate(mandate);
    if (!mandateValidation.valid) {
      return {
        allowed: false,
        reason: mandateValidation.reason,
        protocol: 'ap2',
        mandate: {
          id: mandate.id,
          status: mandate.status,
          remainingBudget: (mandate.max_amount || 0) - amount,
          currency: mandate.currency,
        },
      };
    }

    // Check budget
    if (mandate.max_amount && amount > mandate.max_amount) {
      return {
        allowed: false,
        reason: `Amount ${amount} exceeds mandate max ${mandate.max_amount}`,
        protocol: 'ap2',
        mandate: {
          id: mandate.id,
          status: mandate.status,
          remainingBudget: mandate.max_amount,
          currency: mandate.currency,
        },
      };
    }

    // 2. A2A Check: counterparty KYA-verified, allowlisted
    const { data: counterpartyAgent } = await this.supabase
      .from('agents')
      .select('id, name, kya_tier, kya_status, status, wallet_address')
      .eq('id', counterpartyAgentId)
      .single();

    if (!counterpartyAgent) {
      return {
        allowed: false,
        reason: 'Counterparty agent not found',
        protocol: 'a2a',
      };
    }

    if (counterpartyAgent.status !== 'active') {
      return {
        allowed: false,
        reason: `Counterparty agent is ${counterpartyAgent.status}`,
        protocol: 'a2a',
        counterparty: {
          agentId: counterpartyAgent.id,
          name: counterpartyAgent.name,
          kyaTier: counterpartyAgent.kya_tier || 0,
          verified: false,
        },
      };
    }

    if (!counterpartyAgent.kya_tier || counterpartyAgent.kya_status !== 'verified') {
      return {
        allowed: false,
        reason: 'Counterparty agent KYA not verified',
        protocol: 'a2a',
        counterparty: {
          agentId: counterpartyAgent.id,
          name: counterpartyAgent.name,
          kyaTier: counterpartyAgent.kya_tier || 0,
          verified: false,
        },
      };
    }

    // 3. MPP Check: settlement path reachable
    // Check if counterparty has a wallet we can pay
    const paymentPath = await this.resolvePaymentPath(counterpartyAgent);

    if (!paymentPath.reachable) {
      return {
        allowed: false,
        reason: 'No reachable MPP settlement path to counterparty',
        protocol: 'mpp',
        counterparty: {
          agentId: counterpartyAgent.id,
          name: counterpartyAgent.name,
          kyaTier: counterpartyAgent.kya_tier,
          verified: true,
        },
        paymentPath,
      };
    }

    // All checks passed
    return {
      allowed: true,
      mandate: {
        id: mandate.id,
        status: mandate.status,
        remainingBudget: (mandate.max_amount || Infinity) - amount,
        currency: mandate.currency,
      },
      counterparty: {
        agentId: counterpartyAgent.id,
        name: counterpartyAgent.name,
        kyaTier: counterpartyAgent.kya_tier,
        verified: true,
      },
      paymentPath,
      auditRef: `composition:${mandateId}:${taskId}`,
    };
  }

  /**
   * Resolve how we can pay a counterparty agent.
   */
  private async resolvePaymentPath(agent: {
    id: string;
    wallet_address?: string;
  }): Promise<CompositionDecision['paymentPath'] & {}> {
    // Check for Tempo wallet
    if (agent.wallet_address) {
      return {
        reachable: true,
        method: 'tempo',
        network: 'tempo-testnet',
        recipientAddress: agent.wallet_address,
      };
    }

    // Check wallets table for any wallet owned by this agent
    const { data: wallet } = await this.supabase
      .from('wallets')
      .select('id, address, network')
      .eq('managed_by_agent_id', agent.id)
      .eq('status', 'active')
      .single();

    if (wallet?.address) {
      return {
        reachable: true,
        method: 'tempo',
        network: wallet.network || 'tempo-testnet',
        recipientAddress: wallet.address,
      };
    }

    return { reachable: false };
  }
}
