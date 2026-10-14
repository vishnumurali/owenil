import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const signInWithOAuth = vi.fn(async () => ({ data: {}, error: null }));
vi.mock('@/lib/supabase', () => ({ supabase: { auth: { signInWithOAuth } } }));
vi.mock('@/lib/env', () => ({
  env: { supabaseUrl: 'https://example-ref.supabase.co', supabaseKey: 'sb_publishable_test', basePath: '/owenil/' },
  isSupabaseConfigured: true,
  appUrl: (p: string) => `https://vishnumurali.github.io/owenil/${p.replace(/^\//, '')}`,
}));

const { GoogleSignIn } = await import('./oauth');

function renderWithProviders(google: boolean, next: string | null) {
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ external: { email: true, google } }), { status: 200 })));
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <GoogleSignIn next={next} />
    </QueryClientProvider>,
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
  signInWithOAuth.mockClear();
});

describe('Continue with Google', () => {
  it('stays hidden while Google sign-in is off in Supabase', async () => {
    renderWithProviders(false, null);
    await waitFor(() => expect(fetch).toHaveBeenCalledWith('https://example-ref.supabase.co/auth/v1/settings', expect.anything()));
    expect(screen.queryByRole('button', { name: /Continue with Google/ })).toBeNull();
  });

  it('starts the Google flow and returns to the callback page with a safe "next"', async () => {
    renderWithProviders(true, '/groups');
    fireEvent.click(await screen.findByRole('button', { name: /Continue with Google/ }));
    await waitFor(() => expect(signInWithOAuth).toHaveBeenCalledTimes(1));
    expect(signInWithOAuth).toHaveBeenCalledWith({
      provider: 'google',
      options: { redirectTo: 'https://vishnumurali.github.io/owenil/auth/callback?next=%2Fgroups' },
    });
  });

  it('drops an off-site "next" so sign-in cannot redirect elsewhere', async () => {
    renderWithProviders(true, '//evil.example/steal');
    fireEvent.click(await screen.findByRole('button', { name: /Continue with Google/ }));
    await waitFor(() => expect(signInWithOAuth).toHaveBeenCalledTimes(1));
    expect(signInWithOAuth).toHaveBeenCalledWith({ provider: 'google', options: { redirectTo: 'https://vishnumurali.github.io/owenil/auth/callback' } });
  });
});
