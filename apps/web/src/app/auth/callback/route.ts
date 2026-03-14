import { createSupabaseServerClient } from '@/lib/supabase/server';
import { NextResponse } from 'next/server';

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get('code');
  const next = searchParams.get('next') ?? '/dashboard';

  if (code) {
    const supabase = await createSupabaseServerClient();
    const { error, data } = await supabase.auth.exchangeCodeForSession(code);
    if (!error && data.session) {
      // Check if user has a tenant provisioned
      try {
        const apiUrl = process.env.NEXT_PUBLIC_API_URL || process.env.API_URL || 'http://localhost:4000';
        const meResponse = await fetch(`${apiUrl}/v1/auth/me`, {
          headers: {
            'Authorization': `Bearer ${data.session.access_token}`,
          },
        });

        if (meResponse.ok) {
          const meData = await meResponse.json();
          // Response may be wrapped as { data: { user, tenant } }
          const me = meData.data || meData;
          if (!me.tenant) {
            // No tenant — during closed beta, block new OAuth users
            const isClosedBeta = process.env.NEXT_PUBLIC_CLOSED_BETA === 'true';
            if (isClosedBeta) {
              return NextResponse.redirect(`${origin}/auth/no-access`);
            }
            return NextResponse.redirect(`${origin}/auth/setup`);
          }
        } else {
          // API error — redirect to no-access during beta, setup otherwise
          const isClosedBeta = process.env.NEXT_PUBLIC_CLOSED_BETA === 'true';
          return NextResponse.redirect(`${origin}/auth/${isClosedBeta ? 'no-access' : 'setup'}`);
        }
      } catch {
        // API unreachable — redirect to no-access during beta, setup otherwise
        const isClosedBeta = process.env.NEXT_PUBLIC_CLOSED_BETA === 'true';
        return NextResponse.redirect(`${origin}/auth/${isClosedBeta ? 'no-access' : 'setup'}`);
      }

      // User has tenant — proceed to requested page
      return NextResponse.redirect(`${origin}${next}`);
    }
  }

  // Return to login with error
  return NextResponse.redirect(`${origin}/auth/login?error=Could not authenticate`);
}

