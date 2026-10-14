import * as React from 'react';
import type { Session, User } from '@supabase/supabase-js';
import { useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { isSupabaseConfigured } from '@/lib/env';

interface AuthContextValue {
  session: Session | null;
  user: User | null;
  loading: boolean;
  /** True right after the user followed a password-recovery link. */
  recovery: boolean;
  clearRecovery: () => void;
  signOut: (scope?: 'local' | 'global') => Promise<void>;
}

const AuthContext = React.createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const qc = useQueryClient();
  const [session, setSession] = React.useState<Session | null>(null);
  const [loading, setLoading] = React.useState(isSupabaseConfigured);
  const [recovery, setRecovery] = React.useState(false);

  React.useEffect(() => {
    if (!isSupabaseConfigured) return;
    let mounted = true;
    supabase.auth.getSession().then(({ data }) => {
      if (!mounted) return;
      setSession(data.session);
      setLoading(false);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((event, s) => {
      setSession(s);
      setLoading(false);
      if (event === 'PASSWORD_RECOVERY') setRecovery(true);
      if (event === 'SIGNED_OUT') qc.clear();
    });
    return () => {
      mounted = false;
      sub.subscription.unsubscribe();
    };
  }, [qc]);

  const signOut = React.useCallback(
    async (scope: 'local' | 'global' = 'local') => {
      await supabase.auth.signOut({ scope });
      qc.clear();
    },
    [qc],
  );

  const value = React.useMemo<AuthContextValue>(
    () => ({ session, user: session?.user ?? null, loading, recovery, clearRecovery: () => setRecovery(false), signOut }),
    [session, loading, recovery, signOut],
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = React.useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}

/** The signed-in user's id. Only use inside protected routes. */
export function useUserId(): string {
  const { user } = useAuth();
  if (!user) throw new Error('Not signed in');
  return user.id;
}
