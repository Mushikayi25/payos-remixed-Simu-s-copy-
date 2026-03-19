/**
 * Protocol Definitions
 * Epic 49, Story 49.1: All protocol metadata
 */

import { Protocol, ProtocolId } from './types';

const DOCS_BASE_URL = 'https://docs.payos.com/protocols';

export const PROTOCOLS: Record<ProtocolId, Protocol> = {
  x402: {
    id: 'x402',
    name: 'x402 Micropayments',
    description: 'HTTP 402 Payment Required protocol for API monetization. Enable pay-per-call pricing for your APIs with automatic metering and USDC settlement.',
    version: '2024-12-01',
    status: 'stable',
    prerequisites: {
      wallet: true,
    },
    capabilities: [
      'micropayments',
      'pay-per-call',
      'metering',
      'automatic-settlement',
      'usage-tracking',
    ],
    docs: {
      overview: `${DOCS_BASE_URL}/x402`,
      quickstart: `${DOCS_BASE_URL}/x402/quickstart`,
      api: `${DOCS_BASE_URL}/x402/api-reference`,
    },
  },

  ap2: {
    id: 'ap2',
    name: 'AP2 Agent Payments',
    description: 'Mandate-based payments for autonomous AI agents. Define spending limits and authorization rules for agent-initiated transactions.',
    version: '2024-11-01',
    status: 'stable',
    prerequisites: {
      wallet: true,
    },
    capabilities: [
      'mandates',
      'recurring-payments',
      'agent-authorization',
      'spending-limits',
      'approval-workflows',
    ],
    docs: {
      overview: `${DOCS_BASE_URL}/ap2`,
      quickstart: `${DOCS_BASE_URL}/ap2/quickstart`,
      api: `${DOCS_BASE_URL}/ap2/api-reference`,
    },
  },

  acp: {
    id: 'acp',
    name: 'Agent Commerce Protocol',
    description: 'E-commerce checkout for AI agents. Stripe/OpenAI compatible protocol for agent-initiated purchases with cart management.',
    version: '2024-10-01',
    status: 'stable',
    prerequisites: {
      paymentHandler: true,
    },
    capabilities: [
      'checkout',
      'cart-management',
      'order-tracking',
      'agent-purchases',
      'stripe-compatible',
    ],
    docs: {
      overview: `${DOCS_BASE_URL}/acp`,
      quickstart: `${DOCS_BASE_URL}/acp/quickstart`,
      api: `${DOCS_BASE_URL}/acp/api-reference`,
    },
  },

  ucp: {
    id: 'ucp',
    name: 'Universal Commerce Protocol',
    description: 'Google + Shopify standard for agentic commerce. Full e-commerce capabilities including checkout, orders, identity linking, and product discovery.',
    version: '2026-01-11',
    status: 'stable',
    prerequisites: {
      paymentHandler: true,
    },
    capabilities: [
      'checkout',
      'hosted-checkout',
      'orders',
      'identity-linking',
      'oauth',
      'product-discovery',
      'pix-settlement',
      'spei-settlement',
    ],
    docs: {
      overview: `${DOCS_BASE_URL}/ucp`,
      quickstart: `${DOCS_BASE_URL}/ucp/quickstart`,
      api: `${DOCS_BASE_URL}/ucp/api-reference`,
    },
  },

  mpp: {
    id: 'mpp',
    name: 'Machine Payments Protocol',
    description: 'HTTP 402 machine-to-machine payments (Stripe/Tempo Labs). Supports one-shot charges, streaming sessions, and multi-method settlement (Tempo stablecoins, Stripe cards, Lightning).',
    version: '2026-03-18',
    status: 'beta',
    prerequisites: {
      wallet: true,
      kyaLevel: 1,
    },
    capabilities: [
      'one-shot-payments',
      'streaming-sessions',
      'http-402',
      'multi-method-settlement',
      'tempo-stablecoins',
      'receipt-verification',
      'service-discovery',
    ],
    docs: {
      overview: `${DOCS_BASE_URL}/mpp`,
      quickstart: `${DOCS_BASE_URL}/mpp/quickstart`,
      api: `${DOCS_BASE_URL}/mpp/api-reference`,
    },
  },
};

/**
 * Get all protocols as an array
 */
export function getAllProtocols(): Protocol[] {
  return Object.values(PROTOCOLS);
}

/**
 * Get a protocol by ID
 */
export function getProtocol(id: ProtocolId): Protocol | undefined {
  return PROTOCOLS[id];
}

/**
 * Check if a protocol ID is valid
 */
export function isValidProtocolId(id: string): id is ProtocolId {
  return id in PROTOCOLS;
}

/**
 * Get protocol IDs
 */
export function getProtocolIds(): ProtocolId[] {
  return Object.keys(PROTOCOLS) as ProtocolId[];
}
