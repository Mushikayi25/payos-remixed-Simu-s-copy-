/**
 * Review Timeout Worker (Epic 69, Story 69.3)
 *
 * Sweeps for input-required tasks with reason_code='result_review' that have
 * exceeded their review_timeout_minutes. Auto-fails them and cancels mandates.
 */

import { createClient } from '../db/client.js';
import { A2ATaskService } from '../services/a2a/task-service.js';
import { A2ATaskProcessor } from '../services/a2a/task-processor.js';
import { taskEventBus } from '../services/a2a/task-event-bus.js';

export class ReviewTimeoutWorker {
  private isRunning = false;
  private intervalId: NodeJS.Timeout | null = null;

  start(intervalMs: number = 60000): void {
    if (this.isRunning) {
      console.warn('[ReviewTimeout] Worker already running');
      return;
    }
    this.isRunning = true;
    console.log(`[ReviewTimeout] Started (interval: ${intervalMs}ms)`);
    this.intervalId = setInterval(() => this.sweep().catch(console.error), intervalMs);
  }

  stop(): void {
    if (!this.isRunning) return;
    this.isRunning = false;
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
    console.log('[ReviewTimeout] Stopped');
  }

  async sweep(): Promise<number> {
    const supabase = createClient();
    let timedOut = 0;

    // Find all input-required tasks (filter in-memory for review metadata)
    const { data: tasks, error } = await supabase
      .from('a2a_tasks')
      .select('id, tenant_id, agent_id, metadata')
      .eq('state', 'input-required')
      .limit(100);

    if (error || !tasks?.length) return 0;

    const now = Date.now();

    for (const task of tasks) {
      const meta = task.metadata as Record<string, unknown> | null;
      if (!meta) continue;

      // Only process result_review tasks
      const context = meta.input_required_context as Record<string, unknown> | undefined;
      if (context?.reason_code !== 'result_review') continue;
      if (meta.review_status !== 'pending') continue;

      const requestedAt = meta.review_requested_at as string | undefined;
      const timeoutMinutes = (meta.review_timeout_minutes as number) || 60;

      if (!requestedAt) continue;

      const elapsed = now - new Date(requestedAt).getTime();
      const timeoutMs = timeoutMinutes * 60 * 1000;

      if (elapsed < timeoutMs) continue;

      // Timed out — resolve as failed
      console.log(`[ReviewTimeout] Task ${task.id.slice(0, 8)} timed out after ${timeoutMinutes}m`);

      const mandateId = meta.settlementMandateId as string ||
        (context.details as Record<string, unknown>)?.mandate_id as string;

      const taskService = new A2ATaskService(supabase, task.tenant_id);

      if (mandateId) {
        const processor = new A2ATaskProcessor(supabase, task.tenant_id);
        await processor.resolveSettlementMandate(task.id, mandateId, 'failed');
      }

      await taskService.updateTaskState(task.id, 'failed', `Review timed out after ${timeoutMinutes} minutes`);

      // Emit audit event
      taskEventBus.emitTask(task.id, {
        type: 'timeout',
        taskId: task.id,
        data: { reason: 'review_timeout', timeout_minutes: timeoutMinutes },
        timestamp: new Date().toISOString(),
      }, {
        tenantId: task.tenant_id,
        agentId: task.agent_id,
        actorType: 'system',
      });

      timedOut++;
    }

    if (timedOut > 0) {
      console.log(`[ReviewTimeout] Timed out ${timedOut} task(s)`);
    }

    return timedOut;
  }
}

let instance: ReviewTimeoutWorker | null = null;

export function getReviewTimeoutWorker(): ReviewTimeoutWorker {
  if (!instance) instance = new ReviewTimeoutWorker();
  return instance;
}
