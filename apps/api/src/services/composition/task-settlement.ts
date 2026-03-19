/**
 * Task Settlement Service
 *
 * Settles completed A2A tasks:
 * 1. Execute MPP payment via governed client to counterparty
 * 2. Decrement AP2 mandate balance
 * 3. Attach MPP receipt to A2A task artifact
 * 4. Emit single composition.task_settled CloudEvent
 *
 * @see Story 71.17: AP2 Mandate -> A2A Task -> MPP Settlement Bridge
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { GovernedMppClient } from '../mpp/governed-client.js';
import { getAP2MandateService } from '../ap2/mandate-service.js';
import { trackOp } from '../ops/track-op.js';
import { OpType } from '../ops/operation-types.js';
import type { CompositionAuditEvent } from './task-mandate-bridge.js';

// ============================================
// Types
// ============================================

export interface SettleTaskOptions {
  tenantId: string;
  taskId: string;
  mandateId: string;
  agentId: string;
  counterpartyAgentId: string;
  amount: number;
  currency?: string;
  walletId: string;
  /** Counterparty wallet address */
  recipientAddress: string;
  /** Service URL for MPP payment (counterparty's A2A endpoint) */
  serviceUrl: string;
  correlationId?: string;
}

export interface SettleTaskResult {
  success: boolean;
  transferId?: string;
  receiptId?: string;
  mandateDrawdown?: {
    mandateId: string;
    amountCharged: number;
    remainingBudget: number;
  };
  auditEvent?: CompositionAuditEvent;
  error?: string;
  errorProtocol?: 'ap2' | 'a2a' | 'mpp';
}

// ============================================
// Task Settlement Service
// ============================================

export class TaskSettlement {
  private governedClient: GovernedMppClient;

  constructor(private supabase: SupabaseClient) {
    this.governedClient = new GovernedMppClient(supabase);
  }

  /**
   * Settle a completed A2A task via MPP against an AP2 mandate.
   */
  async settleCompletedTask(options: SettleTaskOptions): Promise<SettleTaskResult> {
    const {
      tenantId, taskId, mandateId, agentId, counterpartyAgentId,
      amount, currency = 'USDC', walletId, recipientAddress, serviceUrl,
      correlationId,
    } = options;

    // 1. Execute MPP payment via governed client
    const chargeResult = await this.governedClient.charge({
      serviceUrl,
      amount,
      currency,
      intent: `A2A task settlement: ${taskId}`,
      agentId,
      tenantId,
      walletId,
      correlationId,
      actorType: 'agent',
      actorId: agentId,
    });

    if (!chargeResult.executed) {
      trackOp({
        tenantId,
        operation: OpType.COMPOSITION_TASK_REJECTED,
        subject: `task/${taskId}`,
        correlationId,
        success: false,
        amountUsd: amount,
        data: {
          mandateId,
          counterparty: counterpartyAgentId,
          reason: chargeResult.deniedReason,
          protocols: ['ap2', 'a2a', 'mpp'],
        },
      });

      return {
        success: false,
        error: chargeResult.deniedReason,
        errorProtocol: 'mpp',
      };
    }

    // 2. Decrement AP2 mandate balance
    // The in-memory mandate service doesn't persist balance changes,
    // but we record the drawdown for audit
    const mandateService = getAP2MandateService();
    const mandate = await mandateService.getMandate(mandateId);
    const remainingBudget = mandate
      ? (mandate.max_amount || 0) - amount
      : 0;

    // 3. Attach MPP receipt to A2A task as artifact
    if (chargeResult.payment?.receiptId) {
      await this.attachReceiptToTask(
        tenantId, taskId,
        chargeResult.payment.receiptId,
        chargeResult.transferId,
        amount, currency
      );
    }

    // 4. Emit composition.task_settled CloudEvent
    const auditEvent: CompositionAuditEvent = {
      type: 'composition.task_settled',
      mandateId,
      taskId,
      counterparty: counterpartyAgentId,
      amount: String(amount),
      method: chargeResult.payment?.paymentMethod,
      receiptRef: chargeResult.payment?.receiptId,
      protocols: ['ap2', 'a2a', 'mpp'],
    };

    trackOp({
      tenantId,
      operation: OpType.COMPOSITION_TASK_SETTLED,
      subject: `task/${taskId}`,
      correlationId,
      success: true,
      amountUsd: amount,
      currency,
      data: {
        mandateId,
        transferId: chargeResult.transferId,
        counterparty: counterpartyAgentId,
        receiptId: chargeResult.payment?.receiptId,
        paymentMethod: chargeResult.payment?.paymentMethod,
        remainingBudget,
        protocols: ['ap2', 'a2a', 'mpp'],
      },
    });

    return {
      success: true,
      transferId: chargeResult.transferId,
      receiptId: chargeResult.payment?.receiptId,
      mandateDrawdown: {
        mandateId,
        amountCharged: amount,
        remainingBudget,
      },
      auditEvent,
    };
  }

  /**
   * Attach an MPP receipt as an A2A task artifact.
   */
  private async attachReceiptToTask(
    tenantId: string,
    taskId: string,
    receiptId: string,
    transferId: string | undefined,
    amount: number,
    currency: string
  ): Promise<void> {
    try {
      await this.supabase
        .from('a2a_artifacts')
        .insert({
          tenant_id: tenantId,
          task_id: taskId,
          name: `mpp-receipt-${receiptId}`,
          parts: [{
            type: 'data',
            mimeType: 'application/json',
            data: JSON.stringify({
              protocol: 'mpp',
              receipt_id: receiptId,
              transfer_id: transferId,
              amount,
              currency,
              settled_at: new Date().toISOString(),
            }),
          }],
          metadata: {
            type: 'payment_receipt',
            protocol: 'mpp',
            receipt_id: receiptId,
          },
        });
    } catch (error) {
      console.error('[Composition] Failed to attach receipt to task:', error);
      // Non-fatal — payment was already completed
    }
  }
}
