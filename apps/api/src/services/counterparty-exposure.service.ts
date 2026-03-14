/**
 * Counterparty Exposure Service
 *
 * Epic 18, Story 18.8: Per-counterparty rolling exposure tracking.
 *
 * Tracks 24h/7d/30d exposure windows per wallet+counterparty pair.
 * Supports dual identification: counterparty_agent_id (Sly agents)
 * OR counterparty_address (external wallets).
 */

import type { SupabaseClient } from '@supabase/supabase-js';

// ============================================
// Types
// ============================================

export interface CounterpartyExposure {
  id: string;
  walletId: string;
  agentId: string | null;
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

export interface CounterpartyIdentifier {
  counterpartyAgentId?: string;
  counterpartyAddress?: string;
}

// ============================================
// Service
// ============================================

export class CounterpartyExposureService {
  constructor(private supabase: SupabaseClient) {}

  /**
   * Get exposure for a specific wallet+counterparty pair.
   * Normalizes rolling windows before returning.
   */
  async getExposure(
    walletId: string,
    counterparty: CounterpartyIdentifier,
    tenantId: string,
  ): Promise<CounterpartyExposure | null> {
    let query = this.supabase
      .from('counterparty_exposures')
      .select('*')
      .eq('wallet_id', walletId)
      .eq('tenant_id', tenantId);

    if (counterparty.counterpartyAgentId) {
      query = query.eq('counterparty_agent_id', counterparty.counterpartyAgentId);
    } else if (counterparty.counterpartyAddress) {
      query = query.eq('counterparty_address', counterparty.counterpartyAddress)
        .is('counterparty_agent_id', null);
    } else {
      return null;
    }

    const { data, error } = await query.maybeSingle();
    if (error || !data) return null;

    // Normalize windows (decay expired amounts)
    const normalized = this.normalizeWindows(data);
    return this.mapRow(normalized);
  }

  /**
   * Record exposure after a payment or escrow creation.
   * Upserts the counterparty record and increments rolling windows.
   */
  async recordExposure(params: {
    tenantId: string;
    walletId: string;
    agentId?: string;
    counterparty: CounterpartyIdentifier;
    amount: number;
    currency?: string;
    type: 'payment' | 'escrow_create' | 'contract_sign';
  }): Promise<void> {
    const { tenantId, walletId, agentId, counterparty, amount, currency = 'USDC', type } = params;
    const now = new Date().toISOString();

    // Try to find existing record
    const existing = await this.getExposureRaw(walletId, counterparty, tenantId);

    if (existing) {
      // Normalize windows before incrementing
      const normalized = this.normalizeWindows(existing);

      const updates: Record<string, unknown> = {
        exposure_24h: parseFloat(normalized.exposure_24h) + amount,
        exposure_7d: parseFloat(normalized.exposure_7d) + amount,
        exposure_30d: parseFloat(normalized.exposure_30d) + amount,
        total_volume: parseFloat(normalized.total_volume) + amount,
        transaction_count: normalized.transaction_count + 1,
        updated_at: now,
      };

      if (type === 'escrow_create') {
        updates.active_escrows = normalized.active_escrows + 1;
      }
      if (type === 'contract_sign') {
        updates.active_contracts = normalized.active_contracts + 1;
      }

      await this.supabase
        .from('counterparty_exposures')
        .update(updates)
        .eq('id', existing.id);
    } else {
      // Create new exposure record
      const insert: Record<string, unknown> = {
        tenant_id: tenantId,
        wallet_id: walletId,
        agent_id: agentId || null,
        counterparty_agent_id: counterparty.counterpartyAgentId || null,
        counterparty_address: counterparty.counterpartyAddress || null,
        exposure_24h: amount,
        exposure_7d: amount,
        exposure_30d: amount,
        total_volume: amount,
        transaction_count: 1,
        currency,
        active_contracts: type === 'contract_sign' ? 1 : 0,
        active_escrows: type === 'escrow_create' ? 1 : 0,
        last_24h_reset_at: now,
        last_7d_reset_at: now,
        last_30d_reset_at: now,
      };

      await this.supabase
        .from('counterparty_exposures')
        .insert(insert);
    }
  }

  /**
   * Decrement exposure when a payment completes or escrow resolves.
   */
  async decrementExposure(params: {
    tenantId: string;
    walletId: string;
    counterparty: CounterpartyIdentifier;
    type: 'escrow_complete' | 'contract_complete';
  }): Promise<void> {
    const { tenantId, walletId, counterparty, type } = params;

    const existing = await this.getExposureRaw(walletId, counterparty, tenantId);
    if (!existing) return;

    const updates: Record<string, unknown> = {
      updated_at: new Date().toISOString(),
    };

    if (type === 'escrow_complete' && existing.active_escrows > 0) {
      updates.active_escrows = existing.active_escrows - 1;
    }
    if (type === 'contract_complete' && existing.active_contracts > 0) {
      updates.active_contracts = existing.active_contracts - 1;
    }

    await this.supabase
      .from('counterparty_exposures')
      .update(updates)
      .eq('id', existing.id);
  }

  /**
   * List all counterparty exposures for a wallet.
   */
  async listExposures(
    walletId: string,
    tenantId: string,
  ): Promise<CounterpartyExposure[]> {
    const { data, error } = await this.supabase
      .from('counterparty_exposures')
      .select('*')
      .eq('wallet_id', walletId)
      .eq('tenant_id', tenantId)
      .order('updated_at', { ascending: false });

    if (error || !data) return [];

    return data.map((row: any) => this.mapRow(this.normalizeWindows(row)));
  }

  // ============================================
  // Private helpers
  // ============================================

  private async getExposureRaw(
    walletId: string,
    counterparty: CounterpartyIdentifier,
    tenantId: string,
  ): Promise<any | null> {
    let query = this.supabase
      .from('counterparty_exposures')
      .select('*')
      .eq('wallet_id', walletId)
      .eq('tenant_id', tenantId);

    if (counterparty.counterpartyAgentId) {
      query = query.eq('counterparty_agent_id', counterparty.counterpartyAgentId);
    } else if (counterparty.counterpartyAddress) {
      query = query.eq('counterparty_address', counterparty.counterpartyAddress)
        .is('counterparty_agent_id', null);
    } else {
      return null;
    }

    const { data, error } = await query.maybeSingle();
    if (error || !data) return null;
    return data;
  }

  /**
   * Normalize rolling windows by decaying amounts that have expired.
   * This doesn't do per-transaction decay (that would require event sourcing);
   * instead it resets the window if the full period has elapsed since last reset.
   */
  private normalizeWindows(row: any): any {
    const now = Date.now();
    const normalized = { ...row };

    // 24-hour window
    const last24h = new Date(row.last_24h_reset_at).getTime();
    if (now - last24h > 24 * 60 * 60 * 1000) {
      normalized.exposure_24h = 0;
      normalized.last_24h_reset_at = new Date().toISOString();
    }

    // 7-day window
    const last7d = new Date(row.last_7d_reset_at).getTime();
    if (now - last7d > 7 * 24 * 60 * 60 * 1000) {
      normalized.exposure_7d = 0;
      normalized.last_7d_reset_at = new Date().toISOString();
    }

    // 30-day window
    const last30d = new Date(row.last_30d_reset_at).getTime();
    if (now - last30d > 30 * 24 * 60 * 60 * 1000) {
      normalized.exposure_30d = 0;
      normalized.last_30d_reset_at = new Date().toISOString();
    }

    return normalized;
  }

  private mapRow(row: any): CounterpartyExposure {
    return {
      id: row.id,
      walletId: row.wallet_id,
      agentId: row.agent_id,
      counterpartyAgentId: row.counterparty_agent_id,
      counterpartyAddress: row.counterparty_address,
      exposure24h: parseFloat(row.exposure_24h),
      exposure7d: parseFloat(row.exposure_7d),
      exposure30d: parseFloat(row.exposure_30d),
      activeContracts: row.active_contracts,
      activeEscrows: row.active_escrows,
      totalVolume: parseFloat(row.total_volume),
      transactionCount: row.transaction_count,
      currency: row.currency,
    };
  }
}

export function createCounterpartyExposureService(supabase: SupabaseClient): CounterpartyExposureService {
  return new CounterpartyExposureService(supabase);
}
