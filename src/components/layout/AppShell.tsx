import * as React from 'react';
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { RouteErrorBoundary } from './RouteErrorBoundary';
import { AnimatePresence, motion } from 'framer-motion';
import {
  BarChart3, Bell, CalendarClock, ChevronRight, CircleHelp, Download, HandCoins, Home, LayoutGrid, LogOut, Menu, Monitor, Moon,
  PiggyBank, Plus, Receipt, Scale, Search, Settings, Shield, Sparkles, Sun, Users, Wallet, Coins,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useTheme } from '@/lib/theme';
import { useAuth } from '@/features/auth/AuthProvider';
import { useMe, useNotifications } from '@/data/queries';
import { Logo } from '@/components/brand/Logo';
import { Avatar } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Badge } from '@/components/ui/misc';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

const NAV = [
  {
    title: 'Overview',
    items: [
      { to: '/dashboard', label: 'Dashboard', icon: Home },
      { to: '/balances', label: 'Balances', icon: Scale },
      { to: '/analytics', label: 'Analytics', icon: BarChart3 },
    ],
  },
  {
    title: 'Money',
    items: [
      { to: '/expenses', label: 'Expenses', icon: Receipt },
      { to: '/settlements', label: 'Repayments', icon: HandCoins },
      { to: '/recurring', label: 'Recurring', icon: CalendarClock },
      { to: '/budgets', label: 'Budgets', icon: PiggyBank },
    ],
  },
  {
    title: 'People',
    items: [
      { to: '/groups', label: 'Groups', icon: LayoutGrid },
      { to: '/friends', label: 'Friends', icon: Users },
    ],
  },
];

const SECONDARY = [
  { to: '/settings', label: 'Profile & preferences', icon: Settings },
  { to: '/settings/currency', label: 'Currency', icon: Coins },
  { to: '/settings/privacy', label: 'Privacy', icon: Shield },
  { to: '/export', label: 'Export centre', icon: Download },
  { to: '/help', label: 'Help & support', icon: CircleHelp },
];

/** Applies the theme saved in the user's preferences once per session (local choice wins afterwards). */
function ThemeSync() {
  const me = useMe();
  const { theme, setTheme } = useTheme();
  const done = React.useRef(false);
  React.useEffect(() => {
    if (done.current || !me.data) return;
    done.current = true;
    if (me.data.preferences.theme !== theme) setTheme(me.data.preferences.theme);
  }, [me.data, theme, setTheme]);
  return null;
}

export function AppShell() {
  const location = useLocation();
  const navigate = useNavigate();
  const [moreOpen, setMoreOpen] = React.useState(false);

  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(t.tagName) || e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === 'n') {
        e.preventDefault();
        navigate('/expenses/new');
      } else if (e.key === '/') {
        e.preventDefault();
        navigate('/expenses?focus=search');
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [navigate]);

  React.useEffect(() => {
    window.scrollTo({ top: 0 });
    setMoreOpen(false);
  }, [location.pathname]);

  return (
    <div className="min-h-dvh bg-bg">
      <ThemeSync />
      <a href="#main" className="sr-only z-50 rounded-lg bg-primary px-4 py-2 text-primary-fg focus:not-sr-only focus:fixed focus:left-4 focus:top-4">
        Skip to content
      </a>
      <Sidebar />
      <div className="lg:pl-[264px]">
        <TopBar onMenu={() => setMoreOpen(true)} />
        <main id="main" className="mx-auto w-full max-w-6xl px-4 pb-28 pt-6 sm:px-6 lg:px-8 lg:pb-12">
          {/* Keyed by path: each page fades in with CSS. No exit animation and no
              JavaScript-held opacity, so navigation can never get stuck invisible. */}
          <div key={location.pathname} className="animate-page-in">
            <RouteErrorBoundary>
              <React.Suspense fallback={<PageSkeleton />}>
                <Outlet />
              </React.Suspense>
            </RouteErrorBoundary>
          </div>
        </main>
      </div>
      <MobileNav onMore={() => setMoreOpen(true)} />
      <MoreSheet open={moreOpen} onOpenChange={setMoreOpen} />
    </div>
  );
}

function PageSkeleton() {
  return (
    <div className="space-y-4" aria-hidden>
      <div className="h-8 w-48 animate-pulse rounded-lg bg-muted" />
      <div className="grid gap-4 sm:grid-cols-3">
        {[0, 1, 2].map((i) => (
          <div key={i} className="h-28 animate-pulse rounded-2xl bg-muted" />
        ))}
      </div>
      <div className="h-64 animate-pulse rounded-2xl bg-muted" />
    </div>
  );
}

function NavItem({ to, label, icon: Icon, badge }: { to: string; label: string; icon: React.ElementType; badge?: React.ReactNode }) {
  return (
    <NavLink
      to={to}
      end={to === '/settings'}
      className={({ isActive }) =>
        cn(
          'group relative flex items-center gap-3 rounded-xl px-3 py-2 text-sm font-medium transition-colors',
          isActive ? 'text-fg' : 'text-fg-muted hover:bg-muted/70 hover:text-fg',
        )
      }
    >
      {({ isActive }) => (
        <>
          {isActive && (
            <motion.span layoutId="nav-active" className="absolute inset-0 rounded-xl bg-primary-soft" transition={{ type: 'spring', stiffness: 500, damping: 40 }} />
          )}
          <Icon className={cn('relative size-[18px]', isActive ? 'text-primary' : 'text-fg-subtle group-hover:text-fg-muted')} />
          <span className="relative flex-1">{label}</span>
          {badge && <span className="relative">{badge}</span>}
        </>
      )}
    </NavLink>
  );
}

function Sidebar() {
  const me = useMe();
  return (
    <aside className="fixed inset-y-0 left-0 z-30 hidden w-[264px] flex-col border-r border-border bg-surface/60 backdrop-blur lg:flex">
      <div className="flex h-16 items-center px-5">
        <Link to="/dashboard" aria-label="Owenil home">
          <Logo />
        </Link>
      </div>
      <div className="px-4 pb-3">
        <Button asChild className="w-full justify-start" size="md">
          <Link to="/expenses/new">
            <Plus /> Add expense
            <span className="ml-auto rounded border border-primary-fg/30 px-1.5 text-2xs opacity-80">N</span>
          </Link>
        </Button>
      </div>
      <nav aria-label="Main" className="scrollbar-thin flex-1 space-y-5 overflow-y-auto px-3 pb-4">
        {NAV.map((section) => (
          <div key={section.title}>
            <p className="mb-1.5 px-3 text-2xs font-semibold uppercase tracking-wider text-fg-subtle">{section.title}</p>
            <div className="space-y-0.5">
              {section.items.map((i) => (
                <NavItem key={i.to} {...i} />
              ))}
            </div>
          </div>
        ))}
      </nav>
      <div className="space-y-2 border-t border-border p-3">
        {me.data && !me.data.isPlus && (
          <Link to="/plus" className="group block rounded-xl bg-gradient-to-br from-plus/15 to-accent/10 p-3 transition-colors hover:from-plus/20">
            <p className="flex items-center gap-1.5 text-sm font-semibold">
              <Sparkles className="size-4 text-plus" /> Owenil Plus
            </p>
            <p className="mt-0.5 text-xs text-fg-muted">Budgets, receipts, exports and deeper insights.</p>
          </Link>
        )}
        <NavItem to="/help" label="Help & support" icon={CircleHelp} />
      </div>
    </aside>
  );
}

function ThemeMenuItems() {
  const { theme, setTheme } = useTheme();
  const opts = [
    { v: 'light' as const, label: 'Light', icon: Sun },
    { v: 'dark' as const, label: 'Dark', icon: Moon },
    { v: 'system' as const, label: 'System', icon: Monitor },
  ];
  return (
    <div className="grid grid-cols-3 gap-1 p-1" role="radiogroup" aria-label="Theme">
      {opts.map((o) => (
        <button
          key={o.v}
          role="radio"
          aria-checked={theme === o.v}
          onClick={() => setTheme(o.v)}
          className={cn(
            'flex flex-col items-center gap-1 rounded-lg py-2 text-xs transition-colors',
            theme === o.v ? 'bg-primary-soft text-primary' : 'text-fg-muted hover:bg-muted',
          )}
        >
          <o.icon className="size-4" />
          {o.label}
        </button>
      ))}
    </div>
  );
}

function TopBar({ onMenu }: { onMenu: () => void }) {
  const me = useMe();
  const { signOut } = useAuth();
  const navigate = useNavigate();
  const notifications = useNotifications();
  const unread = notifications.data?.filter((n) => !n.read_at).length ?? 0;
  const { resolved, setTheme } = useTheme();
  const [q, setQ] = React.useState('');

  return (
    <header className="glass sticky top-0 z-20 border-b border-border/70">
      <div className="mx-auto flex h-16 max-w-6xl items-center gap-3 px-4 sm:px-6 lg:px-8">
        <Link to="/dashboard" className="lg:hidden" aria-label="Owenil home">
          <Logo />
        </Link>
        <form
          role="search"
          className="relative hidden max-w-sm flex-1 md:block"
          onSubmit={(e) => {
            e.preventDefault();
            navigate(`/expenses?search=${encodeURIComponent(q)}`);
          }}
        >
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-fg-subtle" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search expenses…"
            aria-label="Search expenses"
            className="h-10 w-full rounded-xl border border-border bg-surface/70 pl-9 pr-10 text-sm placeholder:text-fg-subtle focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/25 focus-visible:ring-offset-0"
          />
          <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 rounded border border-border px-1.5 text-2xs text-fg-subtle">/</span>
        </form>
        <div className="ml-auto flex items-center gap-1.5">
          {me.data?.profile.is_demo && (
            <Badge tone="warning" className="hidden sm:inline-flex">
              Demo data
            </Badge>
          )}
          <Button
            variant="ghost"
            size="icon"
            className="hidden sm:inline-flex"
            aria-label={`Switch to ${resolved === 'dark' ? 'light' : 'dark'} theme`}
            onClick={() => setTheme(resolved === 'dark' ? 'light' : 'dark')}
          >
            <AnimatePresence mode="wait" initial={false}>
              <motion.span key={resolved} initial={{ rotate: -90, opacity: 0 }} animate={{ rotate: 0, opacity: 1 }} exit={{ rotate: 90, opacity: 0 }} transition={{ duration: 0.2 }}>
                {resolved === 'dark' ? <Moon className="size-[18px]" /> : <Sun className="size-[18px]" />}
              </motion.span>
            </AnimatePresence>
          </Button>
          <Button variant="ghost" size="icon" asChild aria-label={`Notifications${unread ? `, ${unread} unread` : ''}`}>
            <Link to="/notifications" className="relative">
              <Bell className="size-[18px]" />
              {unread > 0 && (
                <motion.span
                  initial={{ scale: 0 }}
                  animate={{ scale: 1 }}
                  className="absolute right-1.5 top-1.5 flex min-w-[18px] items-center justify-center rounded-full bg-negative px-1 text-[10px] font-bold leading-[18px] text-white"
                >
                  {unread > 9 ? '9+' : unread}
                </motion.span>
              )}
            </Link>
          </Button>
          <Button asChild size="sm" className="hidden md:inline-flex lg:hidden">
            <Link to="/expenses/new">
              <Plus /> Add
            </Link>
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger className="ml-1 rounded-full focus-visible:ring-2 focus-visible:ring-ring" aria-label="Account menu">
              {me.data ? <Avatar name={me.data.profile.display_name} color={me.data.profile.avatar_color} url={me.data.profile.avatar_url} size="sm" /> : <span className="block size-8 rounded-full bg-muted" />}
            </DropdownMenuTrigger>
            <DropdownMenuContent className="w-64">
              {me.data && (
                <DropdownMenuLabel className="flex items-center gap-3 py-2">
                  <Avatar name={me.data.profile.display_name} color={me.data.profile.avatar_color} size="md" />
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-semibold text-fg">{me.data.profile.display_name}</span>
                    <span className="block truncate text-xs font-normal">{me.data.email}</span>
                  </span>
                </DropdownMenuLabel>
              )}
              <DropdownMenuSeparator />
              <ThemeMenuItems />
              <DropdownMenuSeparator />
              <DropdownMenuItem onSelect={() => navigate('/settings')}>
                <Settings /> Profile & preferences
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => navigate('/plus')}>
                <Sparkles /> {me.data?.isPlus ? 'Owenil Plus' : 'Upgrade to Plus'}
                {me.data?.isPlus && <Badge tone="plus" className="ml-auto">Active</Badge>}
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => navigate('/settings/privacy')}>
                <Shield /> Privacy
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => navigate('/export')}>
                <Download /> Export centre
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                destructive
                onSelect={async () => {
                  await signOut();
                  navigate('/login');
                }}
              >
                <LogOut /> Sign out
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          <Button variant="ghost" size="icon" className="lg:hidden md:hidden" aria-label="Open menu" onClick={onMenu}>
            <Menu className="size-5" />
          </Button>
        </div>
      </div>
    </header>
  );
}

function MobileNav({ onMore }: { onMore: () => void }) {
  const items = [
    { to: '/dashboard', label: 'Home', icon: Home },
    { to: '/groups', label: 'Groups', icon: LayoutGrid },
    null,
    { to: '/balances', label: 'Balances', icon: Wallet },
  ];
  return (
    <nav aria-label="Primary" className="glass safe-bottom fixed inset-x-0 bottom-0 z-30 border-t border-border/70 lg:hidden">
      <div className="mx-auto grid h-16 max-w-md grid-cols-5 items-center px-2">
        {items.map((i, idx) =>
          i === null ? (
            <div key="fab" className="flex justify-center">
              <Link
                to="/expenses/new"
                aria-label="Add expense"
                className="-mt-7 flex size-14 items-center justify-center rounded-2xl bg-brand-gradient text-white shadow-glow transition-transform active:scale-95"
              >
                <Plus className="size-6" strokeWidth={2.5} />
              </Link>
            </div>
          ) : (
            <NavLink
              key={idx}
              to={i.to}
              className={({ isActive }) => cn('flex flex-col items-center gap-0.5 py-1 text-[11px] font-medium', isActive ? 'text-primary' : 'text-fg-subtle')}
            >
              <i.icon className="size-5" />
              {i.label}
            </NavLink>
          ),
        )}
        <button onClick={onMore} className="flex flex-col items-center gap-0.5 py-1 text-[11px] font-medium text-fg-subtle">
          <Menu className="size-5" />
          More
        </button>
      </div>
    </nav>
  );
}

function MoreSheet({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const all = [...NAV.flatMap((s) => s.items), { to: '/notifications', label: 'Notifications', icon: Bell }, { to: '/plus', label: 'Owenil Plus', icon: Sparkles }, ...SECONDARY];
  return (
    <Dialog open={open} onOpenChange={onOpenChange} title="Menu">
      <div className="mb-3">
        <ThemeMenuItems />
      </div>
      <div className="grid grid-cols-1 gap-1">
        {all.map((i) => (
          <Link key={i.to} to={i.to} className="flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium hover:bg-muted" onClick={() => onOpenChange(false)}>
            <i.icon className="size-[18px] text-fg-subtle" />
            <span className="flex-1">{i.label}</span>
            <ChevronRight className="size-4 text-fg-subtle" />
          </Link>
        ))}
      </div>
    </Dialog>
  );
}
