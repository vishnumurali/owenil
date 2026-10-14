import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { env, isSupabaseConfigured } from './env';

/**
 * Browser Supabase client. Uses ONLY the publishable key; every table is
 * protected by Row Level Security and financial writes go through validated
 * database functions. PKCE flow keeps auth codes out of URL fragments.
 */
export const supabase: SupabaseClient = createClient(
  isSupabaseConfigured ? env.supabaseUrl : 'https://not-configured.invalid',
  isSupabaseConfigured ? env.supabaseKey : 'not-configured',
  {
    auth: {
      flowType: 'pkce',
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
      storageKey: 'owenil.auth',
    },
    global: { headers: { 'x-client-info': 'owenil-web/0.1' } },
  },
);
