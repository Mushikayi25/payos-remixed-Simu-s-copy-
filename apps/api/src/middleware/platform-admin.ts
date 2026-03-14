import type { Context, Next } from 'hono';
import crypto from 'crypto';

const ADMIN_ALLOWED_DOMAIN = 'getsly.ai';

/**
 * Platform Admin Authentication Middleware
 *
 * Protects /admin/* routes. Accepts two auth methods:
 * 1. Static API key (PLATFORM_ADMIN_API_KEY) — for scripts/CI
 * 2. Admin session token — issued after Google OAuth sign-in (getsly.ai domain only)
 */
export async function platformAdminMiddleware(c: Context, next: Next) {
  const authHeader = c.req.header('Authorization');
  if (!authHeader?.startsWith('Bearer ')) {
    return c.json({ error: 'Missing or invalid authorization header' }, 401);
  }

  const token = authHeader.slice(7);

  // Try admin session token first (contains a dot separator)
  if (token.includes('.')) {
    const session = verifyAdminSessionToken(token);
    if (session) {
      c.set('platformAdmin', true);
      c.set('adminEmail', session.email);
      c.set('adminName', session.name);
      await next();
      return;
    }
    return c.json({ error: 'Invalid or expired admin session' }, 403);
  }

  // Fall back to static API key
  const adminKey = process.env.PLATFORM_ADMIN_API_KEY;
  if (!adminKey) {
    return c.json({ error: 'Platform admin access not configured' }, 503);
  }

  if (!timingSafeEqual(token, adminKey)) {
    return c.json({ error: 'Invalid platform admin credentials' }, 403);
  }

  c.set('platformAdmin', true);
  await next();
}

// ============================================
// Admin Session Tokens
// ============================================

const SESSION_DURATION_SECONDS = 8 * 3600; // 8 hours

function getSessionSecret(): string {
  // Use PLATFORM_ADMIN_API_KEY as the HMAC secret for session tokens
  const secret = process.env.PLATFORM_ADMIN_API_KEY;
  if (!secret) throw new Error('PLATFORM_ADMIN_API_KEY required for session tokens');
  return secret;
}

export function createAdminSessionToken(email: string, name: string): { token: string; expiresAt: string } {
  const payload = {
    email,
    name,
    iat: Math.floor(Date.now() / 1000),
    exp: Math.floor(Date.now() / 1000) + SESSION_DURATION_SECONDS,
  };
  const payloadB64 = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const sig = crypto.createHmac('sha256', getSessionSecret()).update(payloadB64).digest('base64url');
  return {
    token: `${payloadB64}.${sig}`,
    expiresAt: new Date(payload.exp * 1000).toISOString(),
  };
}

export function verifyAdminSessionToken(token: string): { email: string; name: string } | null {
  const parts = token.split('.');
  if (parts.length !== 2) return null;
  const [payloadB64, sig] = parts;

  const expectedSig = crypto.createHmac('sha256', getSessionSecret()).update(payloadB64).digest('base64url');

  if (!timingSafeEqual(sig, expectedSig)) return null;

  try {
    const payload = JSON.parse(Buffer.from(payloadB64, 'base64url').toString());
    if (payload.exp < Math.floor(Date.now() / 1000)) return null;
    if (!payload.email?.endsWith(`@${ADMIN_ALLOWED_DOMAIN}`)) return null;
    return { email: payload.email, name: payload.name };
  } catch {
    return null;
  }
}

// ============================================
// Google ID Token Verification
// ============================================

export async function verifyGoogleIdToken(idToken: string): Promise<{
  email: string;
  name: string;
  hd: string;
  picture: string;
} | null> {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  if (!clientId) {
    console.error('[platform-admin] GOOGLE_CLIENT_ID not configured');
    return null;
  }

  try {
    const res = await fetch(`https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(idToken)}`);
    if (!res.ok) return null;

    const data = await res.json();

    // Verify audience matches our client ID
    if (data.aud !== clientId) return null;

    // Verify email is verified
    if (data.email_verified !== 'true') return null;

    // Verify hosted domain
    if (data.hd !== ADMIN_ALLOWED_DOMAIN) return null;

    return {
      email: data.email,
      name: data.name || data.email,
      hd: data.hd,
      picture: data.picture || '',
    };
  } catch (err) {
    console.error('[platform-admin] Google token verification failed:', err);
    return null;
  }
}

// ============================================
// Helpers
// ============================================

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  const encoder = new TextEncoder();
  const bufA = encoder.encode(a);
  const bufB = encoder.encode(b);
  return crypto.timingSafeEqual(bufA, bufB);
}
