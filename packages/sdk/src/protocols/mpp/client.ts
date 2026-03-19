/**
 * MPP Client - Machine Payments Protocol
 *
 * Wraps PayOS MPP API endpoints for governed machine payments and sessions.
 */

import type { PayOSClient } from '../../client';
import type {
  MppPayRequest,
  MppPayResponse,
  MppOpenSessionRequest,
  MppSession,
  MppSessionDetail,
  MppListSessionsOptions,
  MppListSessionsResponse,
  MppListTransfersOptions,
  MppListTransfersResponse,
  MppReceiptVerification,
  MppProvisionWalletRequest,
} from './types';

export class MPPClient {
  private client: PayOSClient;

  constructor(client: PayOSClient) {
    this.client = client;
  }

  /**
   * Make a one-shot MPP payment to a service
   *
   * @example
   * ```typescript
   * const result = await sly.mpp.pay({
   *   service_url: 'https://api.example.com',
   *   amount: 0.50,
   *   agent_id: 'agent-uuid',
   * });
   * ```
   */
  public async pay(request: MppPayRequest): Promise<MppPayResponse> {
    return this.client.request<MppPayResponse>('/v1/mpp/pay', {
      method: 'POST',
      body: JSON.stringify(request),
    });
  }

  /**
   * Open a streaming payment session
   *
   * @example
   * ```typescript
   * const session = await sly.mpp.openSession({
   *   service_url: 'https://api.example.com',
   *   deposit_amount: 10.00,
   *   agent_id: 'agent-uuid',
   *   wallet_id: 'wallet-uuid',
   * });
   * ```
   */
  public async openSession(request: MppOpenSessionRequest): Promise<MppSession> {
    return this.client.request<MppSession>('/v1/mpp/sessions', {
      method: 'POST',
      body: JSON.stringify(request),
    });
  }

  /**
   * Get session details with voucher history
   */
  public async getSession(sessionId: string): Promise<MppSessionDetail> {
    return this.client.request<MppSessionDetail>(`/v1/mpp/sessions/${sessionId}`);
  }

  /**
   * List MPP sessions with optional filtering
   */
  public async listSessions(options: MppListSessionsOptions = {}): Promise<MppListSessionsResponse> {
    const params = new URLSearchParams();
    if (options.agent_id) params.append('agent_id', options.agent_id);
    if (options.status) params.append('status', options.status);
    if (options.limit) params.append('limit', options.limit.toString());
    if (options.offset) params.append('offset', options.offset.toString());

    const queryString = params.toString();
    const path = queryString ? `/v1/mpp/sessions?${queryString}` : '/v1/mpp/sessions';

    return this.client.request<MppListSessionsResponse>(path);
  }

  /**
   * Close an active session
   */
  public async closeSession(sessionId: string): Promise<MppSession> {
    return this.client.request<MppSession>(`/v1/mpp/sessions/${sessionId}/close`, {
      method: 'POST',
    });
  }

  /**
   * List MPP payment transfers
   */
  public async listTransfers(options: MppListTransfersOptions = {}): Promise<MppListTransfersResponse> {
    const params = new URLSearchParams();
    if (options.service_url) params.append('service_url', options.service_url);
    if (options.session_id) params.append('session_id', options.session_id);
    if (options.limit) params.append('limit', options.limit.toString());
    if (options.offset) params.append('offset', options.offset.toString());

    const queryString = params.toString();
    const path = queryString ? `/v1/mpp/transfers?${queryString}` : '/v1/mpp/transfers';

    return this.client.request<MppListTransfersResponse>(path);
  }

  /**
   * Verify an MPP payment receipt
   */
  public async verifyReceipt(receiptId: string): Promise<MppReceiptVerification> {
    return this.client.request<MppReceiptVerification>('/v1/mpp/receipts/verify', {
      method: 'POST',
      body: JSON.stringify({ receipt_id: receiptId }),
    });
  }

  /**
   * Provision a wallet for MPP payments
   */
  public async provisionWallet(request: MppProvisionWalletRequest): Promise<any> {
    return this.client.request<any>('/v1/mpp/wallets/provision', {
      method: 'POST',
      body: JSON.stringify(request),
    });
  }

  /**
   * Browse the MPP service directory
   */
  public async browseServices(options?: { category?: string; limit?: number }): Promise<any> {
    const params = new URLSearchParams();
    if (options?.category) params.append('category', options.category);
    if (options?.limit) params.append('limit', options.limit.toString());

    const queryString = params.toString();
    const path = queryString ? `/v1/mpp/services?${queryString}` : '/v1/mpp/services';

    return this.client.request<any>(path);
  }

  /**
   * Get pricing info for a service
   */
  public async getServicePricing(domain: string): Promise<any> {
    return this.client.request<any>(`/v1/mpp/services/${domain}/pricing`);
  }
}
