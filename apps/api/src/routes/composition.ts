/**
 * Composition Routes
 *
 * Cross-protocol endpoints: AP2 x A2A x MPP.
 * Settle completed A2A tasks via MPP against AP2 mandates.
 *
 * @see Story 71.17: AP2 Mandate -> A2A Task -> MPP Settlement Bridge
 */

import { Hono } from 'hono';
import { z } from 'zod';
import { createClient } from '../db/client.js';
import { TaskMandateBridge } from '../services/composition/task-mandate-bridge.js';
import { TaskSettlement } from '../services/composition/task-settlement.js';

const compositionRouter = new Hono();

// ============================================
// POST /v1/composition/agents/:id/tasks/:taskId/settle
// Settle a completed A2A task via MPP against a mandate
// ============================================

compositionRouter.post('/agents/:id/tasks/:taskId/settle', async (c) => {
  const ctx = c.get('ctx');
  const agentId = c.req.param('id');
  const taskId = c.req.param('taskId');

  const schema = z.object({
    mandate_id: z.string().min(1),
    counterparty_agent_id: z.string().uuid(),
    amount: z.number().positive(),
    currency: z.string().default('USDC'),
    wallet_id: z.string().uuid(),
    recipient_address: z.string().min(1),
    service_url: z.string().url(),
  });

  const body = await c.req.json();
  const parsed = schema.safeParse(body);

  if (!parsed.success) {
    return c.json({ error: 'Validation failed', details: parsed.error.flatten() }, 400);
  }

  const supabase = createClient();

  // First evaluate if the task can be settled
  const bridge = new TaskMandateBridge(supabase);
  const decision = await bridge.evaluateTaskWithMandate({
    tenantId: ctx.tenantId,
    mandateId: parsed.data.mandate_id,
    taskId,
    counterpartyAgentId: parsed.data.counterparty_agent_id,
    amount: parsed.data.amount,
    currency: parsed.data.currency,
  });

  if (!decision.allowed) {
    return c.json({
      error: 'Settlement blocked',
      reason: decision.reason,
      blocked_by: decision.protocol,
      mandate: decision.mandate,
      counterparty: decision.counterparty,
      payment_path: decision.paymentPath,
    }, 403);
  }

  // Execute settlement
  const settlement = new TaskSettlement(supabase);
  const result = await settlement.settleCompletedTask({
    tenantId: ctx.tenantId,
    taskId,
    mandateId: parsed.data.mandate_id,
    agentId,
    counterpartyAgentId: parsed.data.counterparty_agent_id,
    amount: parsed.data.amount,
    currency: parsed.data.currency,
    walletId: parsed.data.wallet_id,
    recipientAddress: parsed.data.recipient_address,
    serviceUrl: parsed.data.service_url,
    correlationId: c.get('requestId'),
  });

  if (!result.success) {
    return c.json({
      error: 'Settlement failed',
      reason: result.error,
      failed_protocol: result.errorProtocol,
    }, 500);
  }

  return c.json({
    status: 'settled',
    transfer_id: result.transferId,
    receipt_id: result.receiptId,
    mandate_drawdown: result.mandateDrawdown,
    audit_event: result.auditEvent,
  });
});

// ============================================
// GET /v1/composition/agents/:id/mandates/:mid/tasks
// List tasks settled against a mandate
// ============================================

compositionRouter.get('/agents/:id/mandates/:mid/tasks', async (c) => {
  const ctx = c.get('ctx');
  const agentId = c.req.param('id');
  const mandateId = c.req.param('mid');
  const limit = parseInt(c.req.query('limit') || '50');
  const offset = parseInt(c.req.query('offset') || '0');

  const supabase = createClient();

  // Find transfers linked to this mandate via composition
  const { data: transfers, count } = await supabase
    .from('transfers')
    .select('*', { count: 'exact' })
    .eq('tenant_id', ctx.tenantId)
    .eq('type', 'mpp')
    .filter('description', 'ilike', `%${mandateId}%`)
    .order('created_at', { ascending: false })
    .range(offset, offset + limit - 1);

  return c.json({
    data: transfers || [],
    pagination: { limit, offset, total: count || 0 },
    mandate_id: mandateId,
    agent_id: agentId,
  });
});

// ============================================
// GET /v1/composition/audit — Cross-protocol audit trail
// ============================================

compositionRouter.get('/audit', async (c) => {
  const ctx = c.get('ctx');
  const limit = parseInt(c.req.query('limit') || '50');
  const offset = parseInt(c.req.query('offset') || '0');
  const protocol = c.req.query('protocol');

  const supabase = createClient();

  // Query operations log for composition events
  let query = supabase
    .from('operations')
    .select('*', { count: 'exact' })
    .eq('tenant_id', ctx.tenantId)
    .or('operation.eq.composition.task_settled,operation.eq.composition.task_rejected')
    .order('created_at', { ascending: false })
    .range(offset, offset + limit - 1);

  const { data, count, error } = await query;

  if (error) {
    // Operations table may not exist yet; return empty
    return c.json({
      data: [],
      pagination: { limit, offset, total: 0 },
    });
  }

  return c.json({
    data: data || [],
    pagination: { limit, offset, total: count || 0 },
  });
});

export default compositionRouter;
