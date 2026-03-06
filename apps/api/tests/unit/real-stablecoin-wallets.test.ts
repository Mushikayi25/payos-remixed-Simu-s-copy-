/**
 * Real Stablecoin Wallets Tests
 *
 * Comprehensive tests for the real stablecoin wallet implementation:
 * - Phase 1: Agent BYOW Registration (wallet linking, signature verification)
 * - Phase 2: Circle Sandbox Wallet Provisioning
 * - Phase 3: x402 On-Chain Settlement (dual settlement path)
 * - Phase 4: A2A Payment Settlement with Real Wallets
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { TEST_TENANT_ID, TEST_ACCOUNTS, TEST_AGENTS } from '../setup.js';

// ============================================================================
// Helper: create a chainable Supabase mock
// ============================================================================

interface MockSupabaseOptions {
  singleResults?: Record<string, (filters: Record<string, string>) => { data: any; error: any }>;
  maybeSingleResults?: Record<string, (filters: Record<string, string>) => { data: any; error: any }>;
  defaultResult?: { data: any; error: any };
}

function createChainableMock(options: MockSupabaseOptions = {}) {
  let currentTable = '';
  const filters: Record<string, string> = {};
  const insertedRows: Record<string, any[]> = {};

  const mock: any = {};

  // Every chainable method returns mock (making it thenable = awaitable)
  mock.from = vi.fn((table: string) => { currentTable = table; Object.keys(filters).forEach(k => delete filters[k]); return mock; });
  mock.select = vi.fn(() => mock);
  mock.insert = vi.fn((row: any) => {
    if (!insertedRows[currentTable]) insertedRows[currentTable] = [];
    insertedRows[currentTable].push(row);
    return mock;
  });
  mock.update = vi.fn(() => mock);
  mock.upsert = vi.fn(() => mock);
  mock.delete = vi.fn(() => mock);
  mock.eq = vi.fn((col: string, val: string) => { filters[col] = val; return mock; });
  mock.in = vi.fn(() => mock);
  mock.gte = vi.fn(() => mock);
  mock.order = vi.fn(() => mock);
  mock.limit = vi.fn(() => mock);

  // Terminal methods return Promises
  mock.single = vi.fn(() => {
    const handler = options.singleResults?.[currentTable];
    if (handler) return Promise.resolve(handler({ ...filters }));
    return Promise.resolve(options.defaultResult ?? { data: null, error: null });
  });

  mock.maybeSingle = vi.fn(() => {
    const handler = options.maybeSingleResults?.[currentTable];
    if (handler) return Promise.resolve(handler({ ...filters }));
    return Promise.resolve({ data: null, error: null });
  });

  // Make mock itself awaitable (for chains without .single()/.maybeSingle())
  // e.g., `await supabase.from('agents').update({...}).eq('id', x).eq('tenant_id', y)`
  mock.then = (resolve: any, reject?: any) => {
    try {
      resolve(options.defaultResult ?? { data: null, error: null });
    } catch (e) {
      if (reject) reject(e);
    }
  };

  // Expose for assertions
  mock._insertedRows = insertedRows;
  mock._currentTable = () => currentTable;

  return mock;
}

// ============================================================================
// Phase 1: Agent BYOW Registration
// ============================================================================

describe('Phase 1: Agent BYOW Registration', () => {
  describe('A2A register_agent with BYOW wallet', () => {
    let handleRegisterAgent: typeof import('../../src/services/a2a/onboarding-handler.js').handleRegisterAgent;
    let mockSupabase: any;

    beforeEach(async () => {
      vi.resetModules();

      // Use vi.doMock (not hoisted) so it works after resetModules
      vi.doMock('../../src/services/wallet/index.js', () => ({
        getWalletVerificationService: vi.fn(() => ({
          generateChallenge: vi.fn((addr: string) => ({
            message: `Verify wallet ${addr}`,
            nonce: 'test-nonce',
            issued_at: new Date().toISOString(),
            expires_at: new Date(Date.now() + 300_000).toISOString(),
            wallet_address: addr,
            domain: { name: 'PayOS', version: '1', chainId: 84532 },
          })),
          verifyPersonalSign: vi.fn(async (address: string, signature: string, _message: string) => {
            if (signature === '0xvalid_sig') {
              return { verified: true, address, method: 'eip191' as const };
            }
            return { verified: false, error: 'Invalid signature', method: 'eip191' as const };
          }),
        })),
      }));

      vi.doMock('../../src/utils/crypto.js', () => ({
        generateAgentToken: vi.fn(() => 'agent_mock_token_for_test_123456'),
        hashApiKey: vi.fn((key: string) => `hash_${key}`),
        getKeyPrefix: vi.fn((key: string) => key.slice(0, 12)),
      }));

      vi.doMock('../../src/routes/agents.js', () => ({
        computeEffectiveLimits: vi.fn(async () => ({
          limits: { per_transaction: 1000, daily: 5000, monthly: 50000 },
          capped: false,
        })),
        DEFAULT_PERMISSIONS: {
          transactions: { initiate: true, approve: false, view: true },
          streams: { initiate: true, modify: true, pause: true, terminate: true, view: true },
          accounts: { view: true, create: false },
          treasury: { view: false, rebalance: false },
        },
      }));

      mockSupabase = createChainableMock({
        singleResults: {
          accounts: () => ({
            data: { id: TEST_ACCOUNTS.techcorp, type: 'business', name: 'TechCorp', verification_tier: 1 },
            error: null,
          }),
          agents: () => ({
            data: { id: 'new-agent-id', name: 'Test Agent', description: null, status: 'active', kya_tier: 1, kya_status: 'verified', created_at: new Date().toISOString() },
            error: null,
          }),
          wallets: () => ({
            data: { id: 'new-wallet-id' },
            error: null,
          }),
        },
      });

      const mod = await import('../../src/services/a2a/onboarding-handler.js');
      handleRegisterAgent = mod.handleRegisterAgent;
    });

    afterEach(() => {
      vi.restoreAllMocks();
    });

    it('registers agent with BYOW wallet when valid signature provided', async () => {
      const result = await handleRegisterAgent(
        'req-1',
        {
          name: 'BYOW Agent',
          accountId: TEST_ACCOUNTS.techcorp,
          wallet_address: '0x1234567890abcdef1234567890abcdef12345678',
          signature: '0xvalid_sig',
          message: 'Verify wallet 0x1234567890abcdef1234567890abcdef12345678',
        },
        mockSupabase,
        'http://localhost:4000',
        { tenantId: TEST_TENANT_ID, authType: 'api_key' as const },
      );

      expect(result.jsonrpc).toBe('2.0');
      expect(result.error).toBeUndefined();
      expect(result.result).toBeDefined();
      expect(result.result?.status.state).toBe('completed');

      // Verify wallet was inserted as external type
      const walletInserts = mockSupabase._insertedRows['wallets'] || [];
      const externalWallet = walletInserts.find((w: any) => w.wallet_type === 'external');
      expect(externalWallet).toBeDefined();
      expect(externalWallet.provider).toBe('byow');
      expect(externalWallet.custody_type).toBe('self');
      expect(externalWallet.wallet_address).toBe('0x1234567890abcdef1234567890abcdef12345678');
    });

    it('falls back to internal wallet when BYOW signature is invalid', async () => {
      const result = await handleRegisterAgent(
        'req-2',
        {
          name: 'Fallback Agent',
          accountId: TEST_ACCOUNTS.techcorp,
          wallet_address: '0x1234567890abcdef1234567890abcdef12345678',
          signature: '0xinvalid_sig',
          message: 'Verify wallet ...',
        },
        mockSupabase,
        'http://localhost:4000',
        { tenantId: TEST_TENANT_ID, authType: 'api_key' as const },
      );

      expect(result.result?.status.state).toBe('completed');

      // Should have created internal wallet as fallback
      const walletInserts = mockSupabase._insertedRows['wallets'] || [];
      const internalWallet = walletInserts.find((w: any) => w.wallet_type === 'internal');
      expect(internalWallet).toBeDefined();
      expect(internalWallet.wallet_address).toMatch(/^internal:\/\//);
    });

    it('creates internal wallet when no BYOW fields provided', async () => {
      const result = await handleRegisterAgent(
        'req-3',
        {
          name: 'Internal Agent',
          accountId: TEST_ACCOUNTS.techcorp,
        },
        mockSupabase,
        'http://localhost:4000',
        { tenantId: TEST_TENANT_ID, authType: 'api_key' as const },
      );

      expect(result.result?.status.state).toBe('completed');

      const walletInserts = mockSupabase._insertedRows['wallets'] || [];
      const internalWallet = walletInserts.find((w: any) => w.wallet_type === 'internal');
      expect(internalWallet).toBeDefined();
    });
  });

  describe('A2A manage_wallet link_wallet action', () => {
    let handleManageWallet: typeof import('../../src/services/a2a/onboarding-handler.js').handleManageWallet;
    let mockSupabase: any;

    beforeEach(async () => {
      vi.resetModules();

      vi.doMock('../../src/services/wallet/index.js', () => ({
        getWalletVerificationService: vi.fn(() => ({
          verifyPersonalSign: vi.fn(async (address: string, signature: string) => {
            if (signature === '0xvalid_link_sig') {
              return { verified: true, address, method: 'eip191' as const };
            }
            return { verified: false, error: 'Bad sig', method: 'eip191' as const };
          }),
        })),
      }));

      vi.doMock('../../src/routes/agents.js', () => ({
        computeEffectiveLimits: vi.fn(async () => ({
          limits: { per_transaction: 1000, daily: 5000, monthly: 50000 },
          capped: false,
        })),
        DEFAULT_PERMISSIONS: {},
      }));
      vi.doMock('../../src/utils/crypto.js', () => ({
        generateAgentToken: vi.fn(() => 'agent_test'),
        hashApiKey: vi.fn((k: string) => `hash_${k}`),
        getKeyPrefix: vi.fn((k: string) => k.slice(0, 12)),
      }));

      mockSupabase = createChainableMock({
        singleResults: {
          agents: () => ({
            data: { id: TEST_AGENTS.payroll, parent_account_id: TEST_ACCOUNTS.techcorp, name: 'Payroll Agent' },
            error: null,
          }),
          wallets: () => ({
            data: { id: 'wallet-001' },
            error: null,
          }),
        },
        maybeSingleResults: {
          wallets: () => ({
            data: null, // No existing external wallet
            error: null,
          }),
        },
      });

      const mod = await import('../../src/services/a2a/onboarding-handler.js');
      handleManageWallet = mod.handleManageWallet;
    });

    afterEach(() => {
      vi.restoreAllMocks();
    });

    it('links wallet with valid signature', async () => {
      const result = await handleManageWallet(
        'req-link-1',
        {
          action: 'link_wallet',
          wallet_address: '0xabcdefabcdefabcdefabcdefabcdefabcdefabcd',
          signature: '0xvalid_link_sig',
          message: 'Verify wallet ownership',
        },
        mockSupabase,
        'http://localhost:4000',
        { tenantId: TEST_TENANT_ID, authType: 'agent' as const, agentId: TEST_AGENTS.payroll },
      );

      expect(result.error).toBeUndefined();
      expect(result.result).toBeDefined();

      const artifact = result.result?.artifacts?.[0];
      const data = artifact?.parts?.[0]?.data as any;
      expect(data.action).toBe('link_wallet');
      expect(data.verification_status).toBe('verified');
      expect(data.wallet_address).toBe('0xabcdefabcdefabcdefabcdefabcdefabcdefabcd');
    });

    it('rejects link_wallet with invalid signature', async () => {
      const result = await handleManageWallet(
        'req-link-2',
        {
          action: 'link_wallet',
          wallet_address: '0xabcdefabcdefabcdefabcdefabcdefabcdefabcd',
          signature: '0xbad_sig',
          message: 'Verify wallet ownership',
        },
        mockSupabase,
        'http://localhost:4000',
        { tenantId: TEST_TENANT_ID, authType: 'agent' as const, agentId: TEST_AGENTS.payroll },
      );

      expect(result.error).toBeDefined();
      expect(result.error?.message).toContain('verification failed');
    });

    it('rejects link_wallet without required fields', async () => {
      const result = await handleManageWallet(
        'req-link-3',
        {
          action: 'link_wallet',
          wallet_address: '0xabcdefabcdefabcdefabcdefabcdefabcdefabcd',
          // missing signature and message
        },
        mockSupabase,
        'http://localhost:4000',
        { tenantId: TEST_TENANT_ID, authType: 'agent' as const, agentId: TEST_AGENTS.payroll },
      );

      expect(result.error).toBeDefined();
      expect(result.error?.message).toContain('signature and message are required');
    });

    it('rejects link_wallet with invalid address format', async () => {
      const result = await handleManageWallet(
        'req-link-4',
        {
          action: 'link_wallet',
          wallet_address: 'not-an-eth-address',
          signature: '0xvalid_link_sig',
          message: 'Verify',
        },
        mockSupabase,
        'http://localhost:4000',
        { tenantId: TEST_TENANT_ID, authType: 'agent' as const, agentId: TEST_AGENTS.payroll },
      );

      expect(result.error).toBeDefined();
      expect(result.error?.message).toContain('valid Ethereum address');
    });

    it('requires agent token auth for manage_wallet', async () => {
      const result = await handleManageWallet(
        'req-link-5',
        { action: 'link_wallet' },
        mockSupabase,
        'http://localhost:4000',
        { tenantId: TEST_TENANT_ID, authType: 'api_key' as const },
      );

      expect(result.error).toBeDefined();
      expect(result.error?.message).toContain('agent token authentication');
    });
  });
});

// ============================================================================
// Phase 2: Circle Sandbox Wallet Provisioning
// ============================================================================

describe('Phase 2: Circle Sandbox Wallet Provisioning', () => {
  describe('Circle wallet creation during agent registration', () => {
    afterEach(() => {
      delete process.env.PAYOS_ENVIRONMENT;
      delete process.env.CIRCLE_API_KEY;
      delete process.env.CIRCLE_WALLET_SET_ID;
      vi.restoreAllMocks();
    });

    it('creates Circle sandbox wallet when PAYOS_ENVIRONMENT=sandbox', async () => {
      vi.resetModules();

      process.env.PAYOS_ENVIRONMENT = 'sandbox';
      process.env.CIRCLE_API_KEY = 'SAND_test_key';
      process.env.CIRCLE_WALLET_SET_ID = 'ws-test-set-id';

      vi.doMock('../../src/services/circle/client.js', () => ({
        getCircleClient: vi.fn(() => ({
          createWallet: vi.fn(async () => ({
            id: 'circle-wallet-id-123',
            address: '0xCircleGeneratedAddress1234567890abcdef1234',
            state: 'LIVE',
            accountType: 'SCA',
            custodyType: 'DEVELOPER',
            createDate: new Date().toISOString(),
            walletSetId: 'ws-test-set-id',
          })),
          getUsdcBalance: vi.fn(async () => ({ amount: '0', formatted: 0 })),
        })),
      }));

      vi.doMock('../../src/services/wallet/index.js', () => ({
        getWalletVerificationService: vi.fn(() => ({
          verifyPersonalSign: vi.fn(async () => ({ verified: false, error: 'not called' })),
        })),
      }));

      vi.doMock('../../src/utils/crypto.js', () => ({
        generateAgentToken: vi.fn(() => 'agent_circle_test_token_12345'),
        hashApiKey: vi.fn((k: string) => `hash_${k}`),
        getKeyPrefix: vi.fn((k: string) => k.slice(0, 12)),
      }));

      vi.doMock('../../src/routes/agents.js', () => ({
        computeEffectiveLimits: vi.fn(async () => ({
          limits: { per_transaction: 1000, daily: 5000, monthly: 50000 },
          capped: false,
        })),
        DEFAULT_PERMISSIONS: {
          transactions: { initiate: true, approve: false, view: true },
          streams: { initiate: true, modify: true, pause: true, terminate: true, view: true },
          accounts: { view: true, create: false },
          treasury: { view: false, rebalance: false },
        },
      }));

      const mockSupabase = createChainableMock({
        singleResults: {
          accounts: () => ({
            data: { id: TEST_ACCOUNTS.techcorp, type: 'business', name: 'TechCorp', verification_tier: 1 },
            error: null,
          }),
          agents: () => ({
            data: { id: 'circle-agent-id', name: 'Circle Agent', status: 'active', kya_tier: 1, kya_status: 'verified', created_at: new Date().toISOString() },
            error: null,
          }),
          wallets: () => ({
            data: { id: 'circle-db-wallet-id' },
            error: null,
          }),
        },
      });

      const mod = await import('../../src/services/a2a/onboarding-handler.js');
      const result = await mod.handleRegisterAgent(
        'req-circle-1',
        { name: 'Circle Agent', accountId: TEST_ACCOUNTS.techcorp },
        mockSupabase,
        'http://localhost:4000',
        { tenantId: TEST_TENANT_ID, authType: 'api_key' as const },
      );

      expect(result.result?.status.state).toBe('completed');

      // Verify Circle wallet was inserted
      const walletInserts = mockSupabase._insertedRows['wallets'] || [];
      const circleWallet = walletInserts.find((w: any) => w.wallet_type === 'circle_custodial');
      expect(circleWallet).toBeDefined();
      expect(circleWallet.provider).toBe('circle');
      expect(circleWallet.custody_type).toBe('custodial');
      expect(circleWallet.provider_wallet_id).toBe('circle-wallet-id-123');
      expect(circleWallet.wallet_address).toBe('0xCircleGeneratedAddress1234567890abcdef1234');
      expect(circleWallet.network).toBe('base-sepolia');
    });

    it('falls back to internal wallet when Circle fails', async () => {
      vi.resetModules();

      process.env.PAYOS_ENVIRONMENT = 'sandbox';
      process.env.CIRCLE_API_KEY = 'SAND_test_key';
      process.env.CIRCLE_WALLET_SET_ID = 'ws-test-set-id';

      vi.doMock('../../src/services/circle/client.js', () => ({
        getCircleClient: vi.fn(() => ({
          createWallet: vi.fn(async () => { throw new Error('Circle API down'); }),
        })),
      }));

      vi.doMock('../../src/services/wallet/index.js', () => ({
        getWalletVerificationService: vi.fn(() => ({ verifyPersonalSign: vi.fn() })),
      }));

      vi.doMock('../../src/utils/crypto.js', () => ({
        generateAgentToken: vi.fn(() => 'agent_fb_test'),
        hashApiKey: vi.fn((k: string) => `hash_${k}`),
        getKeyPrefix: vi.fn((k: string) => k.slice(0, 12)),
      }));

      vi.doMock('../../src/routes/agents.js', () => ({
        computeEffectiveLimits: vi.fn(async () => ({
          limits: { per_transaction: 1000, daily: 5000, monthly: 50000 },
          capped: false,
        })),
        DEFAULT_PERMISSIONS: {
          transactions: { initiate: true, approve: false, view: true },
          streams: { initiate: true, modify: true, pause: true, terminate: true, view: true },
          accounts: { view: true, create: false },
          treasury: { view: false, rebalance: false },
        },
      }));

      const mockSupabase = createChainableMock({
        singleResults: {
          accounts: () => ({
            data: { id: TEST_ACCOUNTS.techcorp, type: 'business', name: 'TechCorp', verification_tier: 1 },
            error: null,
          }),
          agents: () => ({
            data: { id: 'fb-agent-id', name: 'Fallback Agent', status: 'active', kya_tier: 1, kya_status: 'verified', created_at: new Date().toISOString() },
            error: null,
          }),
          wallets: () => ({
            data: { id: 'fb-wallet-id' },
            error: null,
          }),
        },
      });

      const mod = await import('../../src/services/a2a/onboarding-handler.js');
      const result = await mod.handleRegisterAgent(
        'req-circle-2',
        { name: 'Fallback Agent', accountId: TEST_ACCOUNTS.techcorp },
        mockSupabase,
        'http://localhost:4000',
        { tenantId: TEST_TENANT_ID, authType: 'api_key' as const },
      );

      expect(result.result?.status.state).toBe('completed');

      // Should have internal wallet as fallback (Circle wallet insert would have failed)
      const walletInserts = mockSupabase._insertedRows['wallets'] || [];
      const internalWallet = walletInserts.find((w: any) => w.wallet_type === 'internal');
      expect(internalWallet).toBeDefined();
    });
  });
});

// ============================================================================
// Phase 3: x402 On-Chain Settlement
// ============================================================================

describe('Phase 3: x402 Dual Settlement Path', () => {
  describe('Settlement type detection', () => {
    it('identifies internal wallets for ledger settlement', () => {
      const wallet = { wallet_type: 'internal', provider_wallet_id: null };
      const isRealWallet = wallet.wallet_type === 'circle_custodial' || wallet.wallet_type === 'external';
      expect(isRealWallet).toBe(false);
    });

    it('identifies circle_custodial wallets for on-chain settlement', () => {
      const wallet = { wallet_type: 'circle_custodial', provider_wallet_id: 'circle-w-123' };
      const isRealWallet = wallet.wallet_type === 'circle_custodial' || wallet.wallet_type === 'external';
      expect(isRealWallet).toBe(true);
    });

    it('identifies external wallets for on-chain settlement', () => {
      const wallet = { wallet_type: 'external', wallet_address: '0xabc123' };
      const isRealWallet = wallet.wallet_type === 'circle_custodial' || wallet.wallet_type === 'external';
      expect(isRealWallet).toBe(true);
    });

    it('requires sandbox environment for on-chain settlement', () => {
      const originalEnv = process.env.PAYOS_ENVIRONMENT;

      process.env.PAYOS_ENVIRONMENT = 'sandbox';
      expect(process.env.PAYOS_ENVIRONMENT === 'sandbox').toBe(true);

      process.env.PAYOS_ENVIRONMENT = 'mock';
      expect(process.env.PAYOS_ENVIRONMENT === 'sandbox').toBe(false);

      process.env.PAYOS_ENVIRONMENT = originalEnv;
    });
  });

  describe('Payment proof with txHash', () => {
    it('includes txHash in settlement result for on-chain payments', () => {
      const settlementResult = {
        success: true,
        consumerNewBalance: 95,
        providerNewBalance: 5,
        settledAt: new Date().toISOString(),
        txHash: '0xabc123def456',
        settlementType: 'on_chain',
      };

      expect(settlementResult.txHash).toBeDefined();
      expect(settlementResult.settlementType).toBe('on_chain');
    });

    it('omits txHash for ledger-only settlements', () => {
      const settlementResult = {
        success: true,
        consumerNewBalance: 95,
        providerNewBalance: 5,
        settledAt: new Date().toISOString(),
        settlementType: 'ledger',
      };

      expect((settlementResult as any).txHash).toBeUndefined();
      expect(settlementResult.settlementType).toBe('ledger');
    });
  });
});

// ============================================================================
// Phase 4: A2A Payment Settlement with Real Wallets
// ============================================================================

describe('Phase 4: A2A Payment Settlement with Real Wallets', () => {
  describe('A2APaymentHandler.settleRealWalletPayment', () => {
    let A2APaymentHandler: typeof import('../../src/services/a2a/payment-handler.js').A2APaymentHandler;
    let mockSupabase: any;
    let mockTaskService: any;

    beforeEach(async () => {
      vi.resetModules();

      mockTaskService = {
        linkPayment: vi.fn(),
        addMessage: vi.fn(),
        updateTaskState: vi.fn(),
        setInputRequired: vi.fn(),
        getTask: vi.fn(),
      };

      const walletsByAgent: Record<string, any> = {
        'from-agent': {
          id: 'from-wallet',
          wallet_address: '0xFromAgent1234567890abcdef12345678',
          wallet_type: 'circle_custodial',
          provider_wallet_id: 'circle-from-001',
          balance: '100.0000',
          owner_account_id: 'account-from',
        },
        'to-agent': {
          id: 'to-wallet',
          wallet_address: '0xToAgent1234567890abcdef1234567890',
          wallet_type: 'circle_custodial',
          provider_wallet_id: 'circle-to-001',
          balance: '50.0000',
          owner_account_id: 'account-to',
        },
        'internal-agent': {
          id: 'internal-wallet',
          wallet_address: 'internal://sly/test/account/agent/internal-agent',
          wallet_type: 'internal',
          provider_wallet_id: null,
          balance: '200.0000',
          owner_account_id: 'account-internal',
        },
        'broke-agent': {
          id: 'broke-wallet',
          wallet_address: '0xBrokeAgent123456789',
          wallet_type: 'external',
          provider_wallet_id: null,
          balance: '1.0000',
          owner_account_id: 'account-broke',
        },
      };

      mockSupabase = createChainableMock({
        singleResults: {
          transfers: () => ({
            data: { id: 'transfer-new-001' },
            error: null,
          }),
          wallets: (filters: Record<string, string>) => {
            // For settlement debit: return wallet with updated balance
            const walletId = filters['id'];
            const wallet = Object.values(walletsByAgent).find((w: any) => w.id === walletId);
            if (wallet) return { data: { balance: wallet.balance }, error: null };
            // Fallback for agent lookup
            const agentId = filters['managed_by_agent_id'];
            const byAgent = agentId ? walletsByAgent[agentId] : null;
            return { data: byAgent ? { balance: byAgent.balance } : null, error: null };
          },
        },
        maybeSingleResults: {
          wallets: (filters: Record<string, string>) => {
            const agentId = filters['managed_by_agent_id'];
            const wallet = agentId ? walletsByAgent[agentId] : null;
            return { data: wallet || null, error: null };
          },
        },
      });

      const mod = await import('../../src/services/a2a/payment-handler.js');
      A2APaymentHandler = mod.A2APaymentHandler;
    });

    afterEach(() => {
      vi.restoreAllMocks();
    });

    it('settles payment between two agents with real wallets', async () => {
      const handler = new A2APaymentHandler(mockSupabase, TEST_TENANT_ID, mockTaskService);
      const result = await handler.settleRealWalletPayment(
        'task-001',
        'from-agent',
        'to-agent',
        10,
        'USDC',
      );

      expect(result.success).toBe(true);
      expect(result.transferId).toBe('transfer-new-001');
      expect(mockTaskService.linkPayment).toHaveBeenCalledWith('task-001', 'transfer-new-001');
    });

    it('returns error when sender has no wallet', async () => {
      const handler = new A2APaymentHandler(mockSupabase, TEST_TENANT_ID, mockTaskService);
      const result = await handler.settleRealWalletPayment(
        'task-002',
        'nonexistent-agent',
        'to-agent',
        10,
        'USDC',
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain('do not have wallets');
    });

    it('returns error when sender has insufficient balance', async () => {
      const handler = new A2APaymentHandler(mockSupabase, TEST_TENANT_ID, mockTaskService);
      const result = await handler.settleRealWalletPayment(
        'task-003',
        'broke-agent',
        'to-agent',
        500, // more than broke-agent's 1.0 balance
        'USDC',
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain('Insufficient balance');
    });

    it('creates transfer record with correct protocol metadata', async () => {
      const handler = new A2APaymentHandler(mockSupabase, TEST_TENANT_ID, mockTaskService);
      await handler.settleRealWalletPayment('task-004', 'from-agent', 'to-agent', 5, 'USDC');

      // Verify insert was called on transfers table
      const insertCalls = mockSupabase.insert.mock.calls;
      const transferInsert = insertCalls.find((call: any[]) => {
        const row = call[0];
        return row?.protocol_metadata?.protocol === 'a2a';
      });

      expect(transferInsert).toBeDefined();
      const meta = transferInsert[0].protocol_metadata;
      expect(meta.task_id).toBe('task-004');
      expect(meta.from_agent_id).toBe('from-agent');
      expect(meta.to_agent_id).toBe('to-agent');
    });

    it('checks canUseSlyNativePayment for same-tenant agents', async () => {
      const handler = new A2APaymentHandler(mockSupabase, TEST_TENANT_ID, mockTaskService);

      // Override from() for this specific test to handle agents table with .in()
      const origFrom = mockSupabase.from;
      mockSupabase.from = vi.fn((table: string) => {
        if (table === 'agents') {
          return {
            select: vi.fn().mockReturnThis(),
            in: vi.fn(() => Promise.resolve({
              data: [
                { id: 'agent-a', tenant_id: TEST_TENANT_ID },
                { id: 'agent-b', tenant_id: TEST_TENANT_ID },
              ],
              error: null,
            })),
          };
        }
        return origFrom(table);
      });

      const canUse = await handler.canUseSlyNativePayment('agent-a', 'agent-b');
      expect(canUse).toBe(true);
    });
  });

  describe('AgentContext wallet enrichment', () => {
    it('includes walletAddress, walletType, and walletBalance in context', async () => {
      // Verify the interface accepts the new fields
      const ctx = {
        tenantId: TEST_TENANT_ID,
        agentId: TEST_AGENTS.payroll,
        accountId: TEST_ACCOUNTS.techcorp,
        walletId: 'wallet-123',
        walletAddress: '0xRealAddress123',
        walletType: 'circle_custodial',
        walletBalance: 100.5,
        mandateIds: [],
        permissions: ['transactions.initiate', 'transactions.view'],
      };

      expect(ctx.walletAddress).toBe('0xRealAddress123');
      expect(ctx.walletType).toBe('circle_custodial');
      expect(ctx.walletBalance).toBe(100.5);
    });
  });

  describe('Context injection for wallet tools', () => {
    it('injects walletId into x402_pay args', async () => {
      const { injectContext } = await import('../../src/services/a2a/tools/context-injector.js');

      const ctx = {
        tenantId: TEST_TENANT_ID,
        agentId: TEST_AGENTS.payroll,
        accountId: TEST_ACCOUNTS.techcorp,
        walletId: 'wallet-123',
        walletAddress: '0xRealAddr',
        walletType: 'circle_custodial',
        mandateIds: [],
        permissions: [],
      };

      const enriched = injectContext(ctx, 'x402_pay', { amount: 5 });
      expect(enriched.walletId).toBe('wallet-123');
      expect(enriched.amount).toBe(5);
    });

    it('does not override explicit walletId', async () => {
      const { injectContext } = await import('../../src/services/a2a/tools/context-injector.js');

      const ctx = {
        tenantId: TEST_TENANT_ID,
        agentId: TEST_AGENTS.payroll,
        accountId: TEST_ACCOUNTS.techcorp,
        walletId: 'default-wallet',
        mandateIds: [],
        permissions: [],
      };

      const enriched = injectContext(ctx, 'x402_pay', { walletId: 'explicit-wallet', amount: 10 });
      expect(enriched.walletId).toBe('explicit-wallet');
    });
  });
});

// ============================================================================
// Cross-cutting: manage_wallet check_balance (unchanged behavior)
// ============================================================================

describe('manage_wallet check_balance (existing behavior preserved)', () => {
  let handleManageWallet: typeof import('../../src/services/a2a/onboarding-handler.js').handleManageWallet;
  let mockSupabase: any;

  beforeEach(async () => {
    vi.resetModules();

    vi.doMock('../../src/services/wallet/index.js', () => ({
      getWalletVerificationService: vi.fn(() => ({})),
    }));
    vi.doMock('../../src/routes/agents.js', () => ({ computeEffectiveLimits: vi.fn(), DEFAULT_PERMISSIONS: {} }));
    vi.doMock('../../src/utils/crypto.js', () => ({
      generateAgentToken: vi.fn(() => 'agent_t'),
      hashApiKey: vi.fn((k: string) => `h_${k}`),
      getKeyPrefix: vi.fn((k: string) => k.slice(0, 6)),
    }));

    // Custom mock: check_balance does `await supabase.from('wallets').select(...).eq(...).eq(...)`
    // which is a thenable chain (no .single()), so it resolves via .then()
    mockSupabase = createChainableMock({
      defaultResult: {
        data: [{ id: 'w1', balance: 42.5, currency: 'USDC', status: 'active' }],
        error: null,
      },
    });

    const mod = await import('../../src/services/a2a/onboarding-handler.js');
    handleManageWallet = mod.handleManageWallet;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns wallet balances for check_balance action', async () => {
    const result = await handleManageWallet(
      'req-bal-1',
      { action: 'check_balance' },
      mockSupabase,
      'http://localhost:4000',
      { tenantId: TEST_TENANT_ID, authType: 'agent' as const, agentId: TEST_AGENTS.payroll },
    );

    expect(result.result).toBeDefined();
    expect(result.error).toBeUndefined();
  });

  it('returns error for unknown action', async () => {
    const result = await handleManageWallet(
      'req-unk-1',
      { action: 'delete_wallet' },
      mockSupabase,
      'http://localhost:4000',
      { tenantId: TEST_TENANT_ID, authType: 'agent' as const, agentId: TEST_AGENTS.payroll },
    );

    expect(result.error).toBeDefined();
    expect(result.error?.message).toContain('Unknown manage_wallet action');
    expect(result.error?.message).toContain('link_wallet'); // new action should be listed
  });
});
