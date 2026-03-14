'use client';

import { useEffect } from 'react';
import { createSupabaseBrowserClient } from '@/lib/supabase/client';
import { Button } from '@sly/ui';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@sly/ui';
import { ShieldX } from 'lucide-react';
import Link from 'next/link';

export default function NoAccessPage() {
  // Sign out the dangling Supabase session so they don't stay authenticated
  useEffect(() => {
    const supabase = createSupabaseBrowserClient();
    supabase.auth.signOut();
  }, []);

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-background via-background to-primary/5 p-4">
      <Card className="w-full max-w-md">
        <CardHeader className="space-y-1 text-center">
          <div className="flex justify-center mb-4">
            <div className="rounded-full bg-orange-100 dark:bg-orange-900/20 p-3">
              <ShieldX className="h-8 w-8 text-orange-600" />
            </div>
          </div>
          <CardTitle className="text-2xl font-bold">Invite required</CardTitle>
          <CardDescription>
            Sly is currently in closed beta. You need an invite code to create an account.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <Button asChild className="w-full">
            <Link href="/auth/signup">Apply for early access</Link>
          </Button>
          <Button asChild variant="outline" className="w-full">
            <Link href="/auth/login">Back to login</Link>
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
