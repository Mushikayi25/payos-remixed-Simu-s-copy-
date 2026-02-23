/**
 * Integration Tests: Refund Simulation
 * Story 28.5: Refund Simulation with Eligibility Checking
 */

import 'dotenv/config';
import { describe, it, expect, beforeAll } from 'vitest';
import { createClient } from '@supabase/supabase-js';
import crypto from 'crypto';

const API_URL = process.env.API_URL || 'http://localhost:4000';
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const skipIntegration = !SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY;

const supabase = skipIntegration
  ? (null as any)
  : createClient(SUPABASE_URL!, SUPABASE_SERVICE_ROLE_KEY!);

// Test accounts from setup.ts
const TEST_TENANT_ID = 'aaaaaaaa-0000-0000-0000-000000000001'; // Demo Fintech
const TEST_API_KEY = 'pk_test_demo_fintech_key_12345';
const ACCOUNT_MARIA = 'cccccccc-0000-0000-0000-000000000001'; // $27,997 USDC
const ACCOUNT_ANA = 'cccccccc-0000-0000-0000-000000000003'; // $30,462 USDC

function hashApiKey(key: string): string {
  return crypto.createHash('sha256').update(key).digest('hex');
}

beforeAll(async () => {
  // Ensure test API key exists
  const keyPrefix = TEST_API_KEY.substring(0, TEST_API_KEY.indexOf('_', 3) + 1);
  const keyHash = hashApiKey(TEST_API_KEY);

  await supabase
    .from('api_keys')
    .upsert({
      tenant_id: TEST_TENANT_ID,
      name: 'Test Key for Refund Simulations',
      environment: 'test',
      key_prefix: keyPrefix,
      key_hash: keyHash,
      status: 'active',
    }, {
      onConflict: 'tenant_id,key_prefix',
    });
});

// Helper to create and execute a transfer
async function createTransfer(amount: string): Promise<string> {
  // Create simulation
  const simResponse = await fetch(`${API_URL}/v1/simulate`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${TEST_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      action: 'transfer',
      payload: {
        from_account_id: ACCOUNT_MARIA,
        to_account_id: ACCOUNT_ANA,
        amount,
        currency: 'USDC',
        description: 'Test transfer for refund',
      },
    }),
  });

  const simData = await simResponse.json();
  const simulationId = simData.data.simulation_id;

  // Execute simulation
  const execResponse = await fetch(`${API_URL}/v1/simulate/${simulationId}/execute`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${TEST_API_KEY}`,
      'Content-Type': 'application/json',
    },
  });

  const execData = await execResponse.json();
  return execData.data.execution_result.id;
}

describe.skipIf(skipIntegration)('POST /v1/simulate - Refund Simulation', () => {
  it('should simulate a valid partial refund', async () => {
    // Create a transfer first
    const transferId = await createTransfer('100.00');

    // Simulate refund
    const response = await fetch(`${API_URL}/v1/simulate`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${TEST_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        action: 'refund',
        payload: {
          transfer_id: transferId,
          amount: '50.00',
          reason: 'customer_request',
        },
      }),
    });

    expect(response.status).toBe(201);
    const data = await response.json();

    expect(data.success).toBe(true);
    expect(data.data.can_execute).toBe(true);
    expect(data.data.preview).toBeDefined();
    expect(data.data.preview.refund.refund_type).toBe('partial');
    expect(data.data.preview.refund.refund_amount).toBe('50.00');
    expect(data.data.preview.refund.original_transfer_id).toBe(transferId);
    expect(data.data.preview.eligibility.can_refund).toBe(true);
    expect(data.data.preview.original_transfer.remaining_refundable).toBe('100.00');
  });

  it('should simulate a full refund', async () => {
    const transferId = await createTransfer('75.00');

    const response = await fetch(`${API_URL}/v1/simulate`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${TEST_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        action: 'refund',
        payload: {
          transfer_id: transferId,
          amount: '75.00',
          reason: 'error',
        },
      }),
    });

    const data = await response.json();

    expect(data.data.can_execute).toBe(true);
    expect(data.data.preview.refund.refund_type).toBe('full');
    expect(data.data.preview.refund.refund_amount).toBe('75.00');
  });

  it('should default to full refund when amount not specified', async () => {
    const transferId = await createTransfer('60.00');

    const response = await fetch(`${API_URL}/v1/simulate`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${TEST_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        action: 'refund',
        payload: {
          transfer_id: transferId,
          reason: 'customer_request',
        },
      }),
    });

    const data = await response.json();

    expect(data.data.can_execute).toBe(true);
    expect(data.data.preview.refund.refund_type).toBe('full');
    expect(data.data.preview.refund.refund_amount).toBe('60.00');
  });

  it('should reject refund for non-existent transfer', async () => {
    const response = await fetch(`${API_URL}/v1/simulate`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${TEST_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        action: 'refund',
        payload: {
          transfer_id: '00000000-0000-0000-0000-000000000000',
          amount: '50.00',
          reason: 'customer_request',
        },
      }),
    });

    const data = await response.json();

    expect(data.data.can_execute).toBe(false);
    expect(data.data.errors.length).toBeGreaterThan(0);
    expect(data.data.errors[0].code).toBe('TRANSFER_NOT_FOUND');
  });

  it('should reject refund amount exceeding original', async () => {
    const transferId = await createTransfer('100.00');

    const response = await fetch(`${API_URL}/v1/simulate`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${TEST_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        action: 'refund',
        payload: {
          transfer_id: transferId,
          amount: '150.00', // More than original
          reason: 'customer_request',
        },
      }),
    });

    const data = await response.json();

    expect(data.data.can_execute).toBe(false);
    expect(data.data.errors).toBeDefined();
    const exceededError = data.data.errors.find((e: any) => e.code === 'REFUND_AMOUNT_EXCEEDS_AVAILABLE');
    expect(exceededError).toBeDefined();
    expect(exceededError.details.requested).toBe('150.00');
    expect(exceededError.details.available).toBe('100.00');
  });

  it('should show balance impact for both accounts', async () => {
    const transferId = await createTransfer('80.00');

    const response = await fetch(`${API_URL}/v1/simulate`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${TEST_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        action: 'refund',
        payload: {
          transfer_id: transferId,
          amount: '40.00',
          reason: 'customer_request',
        },
      }),
    });

    const data = await response.json();

    expect(data.data.preview.impact).toBeDefined();
    expect(data.data.preview.impact.source_account).toBeDefined();
    expect(data.data.preview.impact.destination_account).toBeDefined();

    // Source should gain balance
    const sourceBefore = parseFloat(data.data.preview.impact.source_account.balance_before);
    const sourceAfter = parseFloat(data.data.preview.impact.source_account.balance_after);
    expect(sourceAfter).toBeGreaterThan(sourceBefore);
    expect(sourceAfter - sourceBefore).toBe(40.00);

    // Destination should lose balance
    const destBefore = parseFloat(data.data.preview.impact.destination_account.balance_before);
    const destAfter = parseFloat(data.data.preview.impact.destination_account.balance_after);
    expect(destAfter).toBeLessThan(destBefore);
    expect(destBefore - destAfter).toBe(40.00);
  });

  it('should show refund window expiry', async () => {
    const transferId = await createTransfer('50.00');

    const response = await fetch(`${API_URL}/v1/simulate`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${TEST_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        action: 'refund',
        payload: {
          transfer_id: transferId,
          amount: '25.00',
          reason: 'customer_request',
        },
      }),
    });

    const data = await response.json();

    expect(data.data.preview.eligibility.window_expires).toBeDefined();
    
    const expiryDate = new Date(data.data.preview.eligibility.window_expires);
    const now = new Date();
    const daysDiff = (expiryDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24);
    
    // Should be approximately 30 days from now
    expect(daysDiff).toBeGreaterThan(29);
    expect(daysDiff).toBeLessThan(31);
  });

  it('should warn about large partial refund', async () => {
    const transferId = await createTransfer('100.00');

    const response = await fetch(`${API_URL}/v1/simulate`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${TEST_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        action: 'refund',
        payload: {
          transfer_id: transferId,
          amount: '75.00', // 75% of original
          reason: 'customer_request',
        },
      }),
    });

    const data = await response.json();

    expect(data.data.warnings).toBeDefined();
    const largeRefundWarning = data.data.warnings.find((w: any) => w.code === 'LARGE_PARTIAL_REFUND');
    expect(largeRefundWarning).toBeDefined();
    expect(largeRefundWarning.details.percentage).toBe('75.0%');
  });

  it('should include timing estimate', async () => {
    const transferId = await createTransfer('90.00');

    const response = await fetch(`${API_URL}/v1/simulate`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${TEST_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        action: 'refund',
        payload: {
          transfer_id: transferId,
          amount: '45.00',
          reason: 'error',
        },
      }),
    });

    const data = await response.json();

    expect(data.data.preview.timing).toBeDefined();
    expect(data.data.preview.timing.estimated_duration_seconds).toBe(5);
    expect(data.data.preview.timing.estimated_completion).toBeDefined();
  });

  it('should track original transfer details', async () => {
    const transferId = await createTransfer('120.00');

    const response = await fetch(`${API_URL}/v1/simulate`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${TEST_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        action: 'refund',
        payload: {
          transfer_id: transferId,
          amount: '30.00',
          reason: 'customer_request',
        },
      }),
    });

    const data = await response.json();

    expect(data.data.preview.original_transfer).toBeDefined();
    expect(data.data.preview.original_transfer.amount).toBe('120.00');
    expect(data.data.preview.original_transfer.currency).toBe('USDC');
    expect(data.data.preview.original_transfer.already_refunded).toBe('0.00');
    expect(data.data.preview.original_transfer.remaining_refundable).toBe('120.00');
    expect(data.data.preview.original_transfer.transfer_date).toBeDefined();
  });
});



