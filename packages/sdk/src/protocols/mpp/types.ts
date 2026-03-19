/**
 * Types for MPP (Machine Payments Protocol)
 */

export interface MppPayRequest {
  service_url: string;
  amount: number;
  currency?: string;
  intent?: string;
  agent_id: string;
  wallet_id?: string;
}

export interface MppPayResponse {
  status: 'completed' | 'approval_required';
  transfer_id?: string;
  approval_id?: string;
  message?: string;
  payment?: {
    receipt_id?: string;
    payment_method?: string;
    settlement_network?: string;
    settlement_tx_hash?: string;
    amount_paid?: number;
    currency?: string;
  };
}

export interface MppOpenSessionRequest {
  service_url: string;
  deposit_amount: number;
  max_budget?: number;
  agent_id: string;
  wallet_id: string;
  currency?: string;
}

export interface MppSession {
  id: string;
  tenant_id: string;
  agent_id: string;
  wallet_id: string;
  service_url: string;
  status: MppSessionStatus;
  deposit_amount: number;
  spent_amount: number;
  remaining_amount: number;
  max_budget?: number;
  currency: string;
  voucher_count: number;
  created_at: string;
  updated_at: string;
  closed_at?: string;
}

export type MppSessionStatus = 'active' | 'closed' | 'expired' | 'exhausted';

export interface MppSessionDetail extends MppSession {
  vouchers: any[];
}

export interface MppListSessionsOptions {
  agent_id?: string;
  status?: MppSessionStatus;
  limit?: number;
  offset?: number;
}

export interface MppListSessionsResponse {
  data: MppSession[];
  pagination: {
    limit: number;
    offset: number;
    total: number;
  };
}

export interface MppListTransfersOptions {
  service_url?: string;
  session_id?: string;
  limit?: number;
  offset?: number;
}

export interface MppListTransfersResponse {
  data: any[];
  pagination?: {
    limit: number;
    offset: number;
    total: number;
  };
  total?: number;
}

export interface MppReceiptVerification {
  verified: boolean;
  receipt_id: string;
  transfer_id?: string;
  amount?: number;
  currency?: string;
  service_url?: string;
  verified_at?: string;
}

export interface MppProvisionWalletRequest {
  agent_id: string;
  owner_account_id: string;
  testnet?: boolean;
  initial_balance?: number;
}
