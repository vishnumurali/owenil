import { Capacitor, SystemBars, SystemBarsStyle } from '@capacitor/core';
import * as React from 'react';

export type ThemePreference = 'light' | 'dark' | 'system';
const KEY = 'owenil.theme';

interface ThemeContextValue {
  theme: ThemePreference;
  resolved: 'light' | 'dark';
  setTheme: (t: ThemePreference) => void;
}

const ThemeContext = React.createContext<ThemeContextValue | null>(null);

function systemDark() {
  return typeof window !== 'undefined' && window.matchMedia?.('(prefers-color-scheme: dark)').matches;
}

function apply(resolved: 'light' | 'dark', animate: boolean) {
  const root = document.documentElement;
  const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  if (animate && !reduce) {
    root.classList.add('theme-transition');
    window.setTimeout(() => root.classList.remove('theme-transition'), 320);
  }
  root.classList.toggle('dark', resolved === 'dark');
  document.querySelectorAll('meta[name="theme-color"]').forEach((m) => m.setAttribute('content', resolved === 'dark' ? '#0a1020' : '#f9f8f5'));
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setThemeState] = React.useState<ThemePreference>(() => {
    try {
      const v = localStorage.getItem(KEY);
      return v === 'light' || v === 'dark' || v === 'system' ? v : 'system';
    } catch {
      return 'system';
    }
  });
  const [sysDark, setSysDark] = React.useState(systemDark);
  const resolved: 'light' | 'dark' = theme === 'system' ? (sysDark ? 'dark' : 'light') : theme;
  const first = React.useRef(true);

  React.useEffect(() => {
    const mql = window.matchMedia?.('(prefers-color-scheme: dark)');
    if (!mql) return;
    const fn = () => setSysDark(mql.matches);
    mql.addEventListener('change', fn);
    return () => mql.removeEventListener('change', fn);
  }, []);

  React.useEffect(() => {
    apply(resolved, !first.current);
    first.current = false;
    // Phone apps: status-bar icons that stay readable on the app's own theme.
    if (Capacitor.isNativePlatform()) {
      void SystemBars.setStyle({ style: resolved === 'dark' ? SystemBarsStyle.Dark : SystemBarsStyle.Light }).catch(() => {});
    }
  }, [resolved]);

  const setTheme = React.useCallback((t: ThemePreference) => {
    try {
      localStorage.setItem(KEY, t);
    } catch {
      /* storage unavailable — theme still applies for this session */
    }
    setThemeState(t);
  }, []);

  const value = React.useMemo(() => ({ theme, resolved, setTheme }), [theme, resolved, setTheme]);
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  const ctx = React.useContext(ThemeContext);
  if (!ctx) throw new Error('useTheme must be used inside ThemeProvider');
  return ctx;
}
