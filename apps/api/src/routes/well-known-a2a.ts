/**
 * A2A Well-Known Endpoint
 *
 * Public discovery endpoint for Google A2A protocol.
 * Returns Sly's platform Agent Card for capability negotiation.
 *
 * This endpoint enables:
 * - Discovery by external A2A agents
 * - Capability negotiation with other platforms
 * - Protocol-level interoperability
 *
 * @see Epic 57: Google A2A Protocol Integration
 * @see https://google.github.io/A2A/
 */

import { Hono } from 'hono';
import { generatePlatformCard } from '../services/a2a/agent-card.js';

const router = new Hono();

/**
 * OPTIONS /.well-known/agent.json
 *
 * CORS preflight for discovery endpoint.
 */
router.options('/', (c) => {
  return new Response(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      'Access-Control-Max-Age': '86400',
    },
  });
});

/**
 * GET /.well-known/agent.json
 *
 * Returns the Sly platform A2A Agent Card.
 * This endpoint is PUBLIC (no authentication required).
 *
 * Cache-Control: 1 hour (cards change infrequently).
 */
router.get('/', async (c) => {
  const url = new URL(c.req.url);
  const card = generatePlatformCard(`${url.protocol}//${url.host}`);

  // Return raw card without response wrapper — A2A spec requires
  // the agent card at the root level.
  // Using new Response() bypasses the responseWrapperMiddleware.
  return new Response(JSON.stringify(card), {
    status: 200,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'public, max-age=3600',
      'Access-Control-Allow-Origin': '*',
      'A2A-Version': '1.0',
    },
  });
});

export default router;
