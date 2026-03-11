/**
 * Settlement Configuration API Routes
 * 
 * Allows tenants to view and configure their settlement fee structure.
 * Includes multi-protocol settlement routing (Epic 27, Story 27.1).
 */

import { Hono } from 'hono';
import { z } from 'zod';
import { createClient } from '../db/client.js';
import { authMiddleware } from '../middleware/auth.js';
import { createSettlementService } from '../services/settlement.js';
import { createSettlementRouter, Protocol, SettlementRail } from '../services/settlement-router.js';
import { getCirclePayoutsClient, validatePixKey, validateClabe, PixKeyType } from '../services/circle/payouts.js';
import { getEnvironment, isServiceEnabled } from '../config/environment.js';

const app = new Hono();

// Apply auth middleware to all routes
app.use('*', authMiddleware);

// ============================================
// Validation Schemas
// ============================================

const updateConfigSchema = z.object({
  x402FeeType: z.enum(['percentage', 'fixed', 'hybrid']).optional(),
  x402FeePercentage: z.number().min(0).max(1).optional(), // 0 to 1 (e.g., 0.029 = 2.9%)
  x402FeeFixed: z.number().min(0).optional(),
  x402FeeCurrency: z.enum(['USDC', 'EURC']).optional(),
  autoSettlementEnabled: z.boolean().optional(),
  settlementSchedule: z.enum(['immediate', 'daily', 'weekly']).optional(),
});

// ============================================
// Routes
// ============================================

/**
 * GET /v1/settlement/config
 * Get current settlement configuration for tenant
 */
app.get('/config', async (c) => {
  try {
    const ctx = c.get('ctx');
    const supabase = createClient();
    const settlementService = createSettlementService(supabase);

    const config = await settlementService.getConfig(ctx.tenantId);

    if (!config) {
      // Return defaults if no config exists
      return c.json({
        data: {
          tenantId: ctx.tenantId,
          x402FeeType: 'percentage',
          x402FeePercentage: 0.029, // 2.9%
          x402FeeFixed: 0,
          x402FeeCurrency: 'USDC',
          autoSettlementEnabled: true,
          settlementSchedule: 'immediate',
          isDefault: true,
        },
      });
    }

    return c.json({
      data: {
        ...config,
        isDefault: false,
      },
    });
  } catch (error: any) {
    console.error('Error in GET /v1/settlement/config:', error);
    return c.json({
      error: 'Internal server error',
      message: error.message,
    }, 500);
  }
});

/**
 * PATCH /v1/settlement/config
 * Update settlement configuration for tenant
 */
app.patch('/config', async (c) => {
  try {
    const ctx = c.get('ctx');
    const body = await c.req.json();

    // Validate request
    const updates = updateConfigSchema.parse(body);

    const supabase = createClient();
    const settlementService = createSettlementService(supabase);

    // Update configuration
    const config = await settlementService.updateConfig(ctx.tenantId, updates);

    return c.json({
      success: true,
      message: 'Settlement configuration updated',
      data: config,
    });
  } catch (error: any) {
    if (error instanceof z.ZodError) {
      return c.json({
        error: 'Validation failed',
        details: error.errors,
      }, 400);
    }

    console.error('Error in PATCH /v1/settlement/config:', error);
    return c.json({
      error: 'Internal server error',
      message: error.message,
    }, 500);
  }
});

/**
 * POST /v1/settlement/preview
 * Preview fee calculation for a given amount
 */
app.post('/preview', async (c) => {
  try {
    const ctx = c.get('ctx');
    const body = await c.req.json();

    const { amount, currency } = z.object({
      amount: z.number().positive(),
      currency: z.enum(['USDC', 'EURC']).default('USDC'),
    }).parse(body);

    const supabase = createClient();
    const settlementService = createSettlementService(supabase);

    // Calculate fee
    const feeCalc = await settlementService.calculateX402Fee(
      ctx.tenantId,
      amount,
      currency
    );

    return c.json({
      data: {
        grossAmount: feeCalc.grossAmount,
        feeAmount: feeCalc.feeAmount,
        netAmount: feeCalc.netAmount,
        currency: feeCalc.currency,
        feeType: feeCalc.feeType,
        breakdown: feeCalc.breakdown,
        effectiveFeePercentage: feeCalc.grossAmount > 0
          ? (feeCalc.feeAmount / feeCalc.grossAmount) * 100
          : 0,
      },
    });
  } catch (error: any) {
    if (error instanceof z.ZodError) {
      return c.json({
        error: 'Validation failed',
        details: error.errors,
      }, 400);
    }

    console.error('Error in POST /v1/settlement/preview:', error);
    return c.json({
      error: 'Internal server error',
      message: error.message,
    }, 500);
  }
});

/**
 * GET /v1/settlement/analytics
 * Get settlement analytics for tenant
 */
app.get('/analytics', async (c) => {
  try {
    const ctx = c.get('ctx');
    const query = c.req.query();

    const supabase = createClient();
    const settlementService = createSettlementService(supabase);

    const analytics = await settlementService.getSettlementAnalytics(ctx.tenantId, {
      startDate: query.startDate,
      endDate: query.endDate,
      type: query.type,
    });

    return c.json({ data: analytics });
  } catch (error: any) {
    console.error('Error in GET /v1/settlement/analytics:', error);
    return c.json({
      error: 'Internal server error',
      message: error.message,
    }, 500);
  }
});

/**
 * GET /v1/settlement/status/:transferId
 * Get settlement status for a specific transfer
 */
app.get('/status/:transferId', async (c) => {
  try {
    const ctx = c.get('ctx');
    const transferId = c.req.param('transferId');

    const supabase = createClient();
    const settlementService = createSettlementService(supabase);

    const status = await settlementService.getSettlementStatus(transferId);

    if (!status) {
      throw new Error('Transfer not found');
    }

    return c.json({ data: status });
  } catch (error: any) {
    console.error('Error in GET /v1/settlement/status/:transferId:', error);
    return c.json({
      error: 'Internal server error',
      message: error.message,
    }, 500);
  }
});

// ============================================
// Settlement Router Endpoints (Epic 27, Story 27.1)
// ============================================

const routeSchema = z.object({
  transferId: z.string().uuid(),
  protocol: z.enum(['x402', 'ap2', 'acp', 'internal', 'cross_border']).optional(),
  amount: z.number().positive(),
  currency: z.string().default('USDC'),
  destinationCurrency: z.string().optional(),
  destinationCountry: z.string().length(2).optional(),
});

const settleSchema = routeSchema.extend({
  maxRetries: z.number().min(0).max(5).default(3),
});

/**
 * POST /v1/settlement/route
 * Get routing decision for a transfer without executing settlement
 */
app.post('/route', async (c) => {
  try {
    const ctx = c.get('ctx');
    const body = await c.req.json();

    const request = routeSchema.parse(body);
    
    const supabase = createClient();
    const router = createSettlementRouter(supabase);

    const decision = await router.routeTransfer({
      transferId: request.transferId,
      tenantId: ctx.tenantId,
      protocol: (request.protocol || 'internal') as Protocol,
      amount: request.amount,
      currency: request.currency,
      destinationCurrency: request.destinationCurrency,
      destinationCountry: request.destinationCountry,
    });

    return c.json({
      data: {
        transferId: decision.transferId,
        protocol: decision.protocol,
        selectedRail: decision.selectedRail,
        route: {
          rail: decision.route.rail,
          estimatedTime: decision.route.estimatedTime,
          feePercentage: decision.route.feePercentage,
          feeFixed: decision.route.feeFixed,
        },
        alternativeRails: decision.alternativeRails,
        decisionTimeMs: decision.decisionTime,
        metadata: decision.metadata,
      },
    });
  } catch (error: any) {
    if (error instanceof z.ZodError) {
      return c.json({
        error: 'Validation failed',
        details: error.errors,
      }, 400);
    }

    console.error('Error in POST /v1/settlement/route:', error);
    return c.json({
      error: 'Internal server error',
      message: error.message,
    }, 500);
  }
});

/**
 * POST /v1/settlement/execute
 * Execute settlement for a transfer
 */
app.post('/execute', async (c) => {
  try {
    const ctx = c.get('ctx');
    const body = await c.req.json();

    const request = settleSchema.parse(body);
    
    const supabase = createClient();
    const router = createSettlementRouter(supabase);

    const result = await router.settleTransfer({
      transferId: request.transferId,
      tenantId: ctx.tenantId,
      protocol: (request.protocol || 'internal') as Protocol,
      amount: request.amount,
      currency: request.currency,
      destinationCurrency: request.destinationCurrency,
      destinationCountry: request.destinationCountry,
      maxRetries: request.maxRetries,
    });

    if (!result.success) {
      return c.json({
        error: 'Settlement failed',
        data: result,
      }, result.error?.retryable ? 503 : 400);
    }

    return c.json({ data: result });
  } catch (error: any) {
    if (error instanceof z.ZodError) {
      return c.json({
        error: 'Validation failed',
        details: error.errors,
      }, 400);
    }

    console.error('Error in POST /v1/settlement/execute:', error);
    return c.json({
      error: 'Internal server error',
      message: error.message,
    }, 500);
  }
});

/**
 * POST /v1/settlement/batch
 * Execute settlement for multiple transfers
 */
app.post('/batch', async (c) => {
  try {
    const ctx = c.get('ctx');
    const body = await c.req.json();

    const batchSchema = z.object({
      transfers: z.array(settleSchema).min(1).max(100),
    });

    const { transfers } = batchSchema.parse(body);
    
    const supabase = createClient();
    const router = createSettlementRouter(supabase);

    const results = await router.settleBatch(
      transfers.map(t => ({
        transferId: t.transferId,
        tenantId: ctx.tenantId,
        protocol: (t.protocol || 'internal') as Protocol,
        amount: t.amount,
        currency: t.currency,
        destinationCurrency: t.destinationCurrency,
        destinationCountry: t.destinationCountry,
        maxRetries: t.maxRetries,
      }))
    );

    const succeeded = results.filter(r => r.success);
    const failed = results.filter(r => !r.success);

    return c.json({
      data: {
        total: results.length,
        succeeded: succeeded.length,
        failed: failed.length,
        results,
      },
    });
  } catch (error: any) {
    if (error instanceof z.ZodError) {
      return c.json({
        error: 'Validation failed',
        details: error.errors,
      }, 400);
    }

    console.error('Error in POST /v1/settlement/batch:', error);
    return c.json({
      error: 'Internal server error',
      message: error.message,
    }, 500);
  }
});

/**
 * GET /v1/settlement/rails
 * Get available settlement rails and their configuration
 */
app.get('/rails', async (c) => {
  const rails = [
    {
      id: 'internal',
      name: 'Internal Ledger',
      description: 'Instant transfers within PayOS',
      estimatedTimeSeconds: 0,
      feePercentage: 0.05,
      feeFixed: 0,
      minAmount: 0.01,
      maxAmount: 1000000,
      currencies: ['USDC', 'USD'],
      countries: ['*'],
      status: 'active',
    },
    {
      id: 'circle_usdc',
      name: 'Circle USDC',
      description: 'Settlement via Circle Programmable Wallets',
      estimatedTimeSeconds: 30,
      feePercentage: 1.0,
      feeFixed: 0.10,
      minAmount: 1,
      maxAmount: 100000,
      currencies: ['USDC'],
      countries: ['US', 'EU', '*'],
      status: 'active',
    },
    {
      id: 'base_chain',
      name: 'Base L2',
      description: 'On-chain settlement via Base Layer 2',
      estimatedTimeSeconds: 60,
      feePercentage: 0.5,
      feeFixed: 0.05,
      minAmount: 0.10,
      maxAmount: 500000,
      currencies: ['USDC', 'ETH'],
      countries: ['*'],
      status: 'active',
    },
    {
      id: 'pix',
      name: 'Pix',
      description: 'Brazilian instant payment system',
      estimatedTimeSeconds: 10,
      feePercentage: 0.7,
      feeFixed: 0,
      minAmount: 1,
      maxAmount: 100000,
      currencies: ['BRL'],
      countries: ['BR'],
      status: 'active',
    },
    {
      id: 'spei',
      name: 'SPEI',
      description: 'Mexican interbank transfer system',
      estimatedTimeSeconds: 300,
      feePercentage: 0.8,
      feeFixed: 1.50,
      minAmount: 10,
      maxAmount: 500000,
      currencies: ['MXN'],
      countries: ['MX'],
      status: 'active',
    },
    {
      id: 'wire',
      name: 'Wire Transfer',
      description: 'International bank wire (fallback)',
      estimatedTimeSeconds: 86400,
      feePercentage: 1.5,
      feeFixed: 25,
      minAmount: 100,
      maxAmount: 10000000,
      currencies: ['USD', 'EUR', 'BRL', 'MXN'],
      countries: ['*'],
      status: 'active',
    },
  ];

  return c.json({ data: rails });
});

// ============================================
// Pix Payout Endpoints (Story 40.3)
// ============================================

const pixPayoutSchema = z.object({
  amount: z.string().regex(/^\d+(\.\d{1,2})?$/, 'Amount must be a valid decimal'),
  pixKey: z.string().min(1),
  pixKeyType: z.enum(['cpf', 'cnpj', 'email', 'phone', 'evp']),
  recipientName: z.string().min(1).max(100),
  taxId: z.string().optional(),
  reference: z.string().max(100).optional(),
  transferId: z.string().uuid().optional(),
});

/**
 * POST /v1/settlement/pix
 * Create a Pix payout to Brazil
 * 
 * Story 40.3: Circle Pix Payout Integration
 */
app.post('/pix', async (c) => {
  try {
    const ctx = c.get('ctx');
    const body = await c.req.json();

    const request = pixPayoutSchema.parse(body);

    // Validate Pix key format
    if (!validatePixKey(request.pixKey, request.pixKeyType as PixKeyType)) {
      return c.json({
        error: 'Invalid Pix key format',
        message: `The provided ${request.pixKeyType} key is not valid`,
      }, 400);
    }

    // Check if Circle is enabled
    const env = getEnvironment();
    if (env === 'mock' || !isServiceEnabled('circle')) {
      // Return mock response
      const mockPayoutId = `mock-pix-${Date.now()}`;
      return c.json({
        data: {
          id: mockPayoutId,
          status: 'pending',
          amount: {
            amount: request.amount,
            currency: 'BRL',
          },
          destination: {
            type: 'pix',
            pixKey: request.pixKey,
            pixKeyType: request.pixKeyType,
            name: request.recipientName,
          },
          createDate: new Date().toISOString(),
          mock: true,
          message: 'Mock mode - no actual payout created',
        },
      }, 201);
    }

    // Create real Circle payout
    const client = getCirclePayoutsClient();
    const payout = await client.createPixPayout({
      amount: request.amount,
      pixKey: request.pixKey,
      pixKeyType: request.pixKeyType as PixKeyType,
      recipientName: request.recipientName,
      taxId: request.taxId,
      metadata: {
        tenantId: ctx.tenantId,
        ...(request.transferId && { transferId: request.transferId }),
        ...(request.reference && { reference: request.reference }),
      },
    });

    // Record in database
    const supabase = createClient();
    await supabase.from('settlements').insert({
      tenant_id: ctx.tenantId,
      transfer_id: request.transferId || null,
      rail: 'pix',
      external_id: payout.id,
      status: payout.status,
      amount: parseFloat(request.amount),
      currency: 'BRL',
      destination_details: {
        type: 'pix',
        pixKey: request.pixKey,
        pixKeyType: request.pixKeyType,
        name: request.recipientName,
      },
      provider_response: payout,
    });

    return c.json({
      data: {
        id: payout.id,
        status: payout.status,
        amount: payout.amount,
        destination: payout.destination,
        trackingRef: payout.trackingRef,
        createDate: payout.createDate,
      },
    }, 201);
  } catch (error: any) {
    if (error instanceof z.ZodError) {
      return c.json({
        error: 'Validation failed',
        details: error.errors,
      }, 400);
    }

    console.error('Error in POST /v1/settlement/pix:', error);
    return c.json({
      error: 'Failed to create Pix payout',
      message: error.message,
    }, 500);
  }
});

// ============================================
// SPEI Payout Endpoints (Story 40.4)
// ============================================

const speiPayoutSchema = z.object({
  amount: z.string().regex(/^\d+(\.\d{1,2})?$/, 'Amount must be a valid decimal'),
  clabe: z.string().length(18).regex(/^\d+$/, 'CLABE must be 18 digits'),
  recipientName: z.string().min(1).max(100),
  taxId: z.string().optional(),
  bankName: z.string().optional(),
  reference: z.string().max(100).optional(),
  transferId: z.string().uuid().optional(),
});

/**
 * POST /v1/settlement/spei
 * Create a SPEI payout to Mexico
 * 
 * Story 40.4: Circle SPEI Payout Integration
 */
app.post('/spei', async (c) => {
  try {
    const ctx = c.get('ctx');
    const body = await c.req.json();

    const request = speiPayoutSchema.parse(body);

    // Validate CLABE
    if (!validateClabe(request.clabe)) {
      return c.json({
        error: 'Invalid CLABE number',
        message: 'The provided CLABE has an invalid checksum',
      }, 400);
    }

    // Check if Circle is enabled
    const env = getEnvironment();
    if (env === 'mock' || !isServiceEnabled('circle')) {
      // Return mock response
      const mockPayoutId = `mock-spei-${Date.now()}`;
      return c.json({
        data: {
          id: mockPayoutId,
          status: 'pending',
          amount: {
            amount: request.amount,
            currency: 'MXN',
          },
          destination: {
            type: 'spei',
            clabe: request.clabe,
            name: request.recipientName,
          },
          createDate: new Date().toISOString(),
          mock: true,
          message: 'Mock mode - no actual payout created',
        },
      }, 201);
    }

    // Create real Circle payout
    const client = getCirclePayoutsClient();
    const payout = await client.createSpeiPayout({
      amount: request.amount,
      clabe: request.clabe,
      recipientName: request.recipientName,
      taxId: request.taxId,
      bankName: request.bankName,
      metadata: {
        tenantId: ctx.tenantId,
        ...(request.transferId && { transferId: request.transferId }),
        ...(request.reference && { reference: request.reference }),
      },
    });

    // Record in database
    const supabase = createClient();
    await supabase.from('settlements').insert({
      tenant_id: ctx.tenantId,
      transfer_id: request.transferId || null,
      rail: 'spei',
      external_id: payout.id,
      status: payout.status,
      amount: parseFloat(request.amount),
      currency: 'MXN',
      destination_details: {
        type: 'spei',
        clabe: request.clabe,
        name: request.recipientName,
      },
      provider_response: payout,
    });

    return c.json({
      data: {
        id: payout.id,
        status: payout.status,
        amount: payout.amount,
        destination: payout.destination,
        trackingRef: payout.trackingRef,
        createDate: payout.createDate,
      },
    }, 201);
  } catch (error: any) {
    if (error instanceof z.ZodError) {
      return c.json({
        error: 'Validation failed',
        details: error.errors,
      }, 400);
    }

    console.error('Error in POST /v1/settlement/spei:', error);
    return c.json({
      error: 'Failed to create SPEI payout',
      message: error.message,
    }, 500);
  }
});

/**
 * GET /v1/settlement/payout/:id
 * Get status of a Pix or SPEI payout
 */
app.get('/payout/:id', async (c) => {
  try {
    const ctx = c.get('ctx');
    const payoutId = c.req.param('id');

    // Check if it's a mock payout
    if (payoutId.startsWith('mock-')) {
      return c.json({
        data: {
          id: payoutId,
          status: 'complete',
          mock: true,
        },
      });
    }

    // Check if Circle is enabled
    const env = getEnvironment();
    if (env === 'mock' || !isServiceEnabled('circle')) {
      return c.json({
        error: 'Circle is not enabled',
        message: 'Set PAYOS_CIRCLE_ENV=sandbox to enable Circle payouts',
      }, 503);
    }

    const client = getCirclePayoutsClient();
    const payout = await client.getPayout(payoutId);

    // Update database record
    const supabase = createClient();
    await supabase
      .from('settlements')
      .update({
        status: payout.status,
        provider_response: payout,
        updated_at: new Date().toISOString(),
      })
      .eq('external_id', payoutId)
      .eq('tenant_id', ctx.tenantId);

    return c.json({
      data: {
        id: payout.id,
        status: payout.status,
        amount: payout.amount,
        destination: payout.destination,
        trackingRef: payout.trackingRef,
        fees: payout.fees,
        createDate: payout.createDate,
        updateDate: payout.updateDate,
        ...(payout.return && { return: payout.return }),
        ...(payout.errorCode && { errorCode: payout.errorCode }),
      },
    });
  } catch (error: any) {
    console.error('Error in GET /v1/settlement/payout/:id:', error);
    return c.json({
      error: 'Failed to get payout status',
      message: error.message,
    }, 500);
  }
});

// ============================================
// Chain Performance Metrics (Epic 38, Story 38.17)
// ============================================

/**
 * GET /v1/settlement/chain-metrics
 * Returns aggregated chain performance metrics for the tenant.
 * Query params: blockchain, path, days (default 7)
 */
app.get('/chain-metrics', async (c) => {
  try {
    const ctx = c.get('ctx');
    const supabase = createClient();

    const blockchain = c.req.query('blockchain');
    const path = c.req.query('path');
    const daysRaw = parseInt(c.req.query('days') || '7');
    const days = Number.isFinite(daysRaw) && daysRaw > 0 ? Math.min(daysRaw, 365) : 7;
    const since = new Date(Date.now() - days * 86400_000).toISOString();

    const VALID_BLOCKCHAINS = ['base', 'solana', 'ethereum', 'polygon', 'arbitrum', 'avalanche'];
    const VALID_PATHS = ['circle', 'viem', 'solana', 'cctp', 'skipped'];

    // Aggregated stats — tenant-scoped
    let query = supabase
      .from('chain_performance_metrics')
      .select('blockchain, settlement_path, total_duration_ms, amount_usd, success, created_at')
      .eq('tenant_id', ctx.tenantId)
      .gte('created_at', since)
      .order('created_at', { ascending: false })
      .limit(1000);

    if (blockchain && VALID_BLOCKCHAINS.includes(blockchain)) query = query.eq('blockchain', blockchain);
    if (path && VALID_PATHS.includes(path)) query = query.eq('settlement_path', path);

    const { data: metrics, error } = await query;

    if (error) {
      return c.json({ error: error.message }, 500);
    }

    // Compute aggregates per blockchain+path
    const aggregates = new Map<string, {
      blockchain: string;
      path: string;
      count: number;
      successCount: number;
      totalDurationMs: number;
      totalAmountUsd: number;
      minDurationMs: number;
      maxDurationMs: number;
    }>();

    for (const m of (metrics || [])) {
      const key = `${m.blockchain}:${m.settlement_path}`;
      let agg = aggregates.get(key);
      if (!agg) {
        agg = {
          blockchain: m.blockchain,
          path: m.settlement_path,
          count: 0,
          successCount: 0,
          totalDurationMs: 0,
          totalAmountUsd: 0,
          minDurationMs: Infinity,
          maxDurationMs: 0,
        };
        aggregates.set(key, agg);
      }
      agg.count++;
      if (m.success) agg.successCount++;
      agg.totalDurationMs += m.total_duration_ms;
      agg.totalAmountUsd += parseFloat(m.amount_usd || '0');
      agg.minDurationMs = Math.min(agg.minDurationMs, m.total_duration_ms);
      agg.maxDurationMs = Math.max(agg.maxDurationMs, m.total_duration_ms);
    }

    const summary = Array.from(aggregates.values()).map(agg => ({
      blockchain: agg.blockchain,
      settlementPath: agg.path,
      count: agg.count,
      successRate: agg.count > 0 ? (agg.successCount / agg.count * 100).toFixed(1) + '%' : '0%',
      avgDurationMs: agg.count > 0 ? Math.round(agg.totalDurationMs / agg.count) : 0,
      minDurationMs: agg.minDurationMs === Infinity ? 0 : agg.minDurationMs,
      maxDurationMs: agg.maxDurationMs,
      totalVolumeUsd: parseFloat(agg.totalAmountUsd.toFixed(2)),
    }));

    return c.json({
      data: {
        period: { days, since },
        metrics: summary,
        totalSettlements: (metrics || []).length,
      },
    });
  } catch (error: any) {
    console.error('Error in GET /v1/settlement/chain-metrics:', error);
    return c.json({ error: 'Failed to retrieve chain metrics' }, 500);
  }
});

/**
 * GET /v1/settlement/cctp/routes
 * Returns available CCTP cross-chain routes.
 */
app.get('/cctp/routes', async (c) => {
  try {
    const { getCCTPBridge } = await import('../services/cctp/bridge.js');
    const bridge = getCCTPBridge();
    const routes = bridge.getSupportedRoutes();

    return c.json({ data: routes });
  } catch (error: any) {
    return c.json({ error: error.message }, 500);
  }
});

export default app;

