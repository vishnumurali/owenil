import * as React from 'react';
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import { AnimatePresence, motion } from 'framer-motion';
import {
  BarChart3, Bell, BookUser, CalendarClock, CircleHelp, Coins, Download, HandCoins, Home, IndianRupee, LayoutGrid, LogOut, Monitor,
  Moon, PiggyBank, Plus, Receipt, Scale, Search, Settings, Shield, Sparkles, Sun, UserPlus, Users, X, type LucideIcon,
} from 'lucide-react';
import { RouteErrorBoundary } from './RouteErrorBoundary';
import { cn } from '@/lib/utils';
import { useTheme } from '@/lib/theme';
import { isNativeApp } from '@/lib/native-upi';
import { useAuth } from '@/features/auth/AuthProvider';
import { useMe, useNotifications } from '@/data/queries';
import { Logo } from '@/components/brand/Logo';
import { Avatar } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/misc';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

// Opened from the "+" button; loaded on first use so the phone-number library stays out of the main bundle.
const SettleUpDialog = React.lazy(() => import('@/features/balances/SettleUpDialog').then((m) => ({ default: m.SettleUpDialog })));
const AddFriendDialog = React.lazy(() => import('@/features/friends/AddFriendDialog').then((m) => ({ default: m.AddFriendDialog })));

interface Dest {
  to: string;
  label: string;
  icon: LucideIcon;
}

/** The phone dock: the places people go most. Everything else is in the launcher. */
const DOCK: Dest[] = [
  { to: '/dashboard', label: 'Home', icon: Home },
  { to: '/groups', label: 'Groups', icon: LayoutGrid },
  { to: '/friends', label: 'Friends', icon: Users },
];

/** The desktop rail has room for a few more. */
const RAIL: Dest[] = [
  { to: '/dashboard', label: 'Home', icon: Home },
  { to: '/groups', label: 'Groups', icon: LayoutGrid },
  { to: '/friends', label: 'Friends', icon: Users },
  { to: '/expenses', label: 'Expenses', icon: Receipt },
  { to: '/balances', label: 'Balances', icon: Scale },
  { to: '/pay', label: 'Pay', icon: IndianRupee },
];

/** Every section, as tiles in the launcher. */
const LAUNCHER: { title: string; items: Dest[] }[] = [
  {
    title: 'Money',
    items: [
      { to: '/expenses', label: 'Expenses', icon: Receipt },
      { to: '/balances', label: 'Balances', icon: Scale },
      { to: '/pay', label: 'Pay', icon: IndianRupee },
      { to: '/settlements', label: 'Repayments', icon: HandCoins },
      { to: '/recurring', label: 'Recurring', icon: CalendarClock },
      { to: '/budgets', label: 'Budgets', icon: PiggyBank },
      { to: '/analytics', label: 'Analytics', icon: BarChart3 },
    ],
  },
  {
    title: 'People',
    items: [
      { to: '/dashboard', label: 'Home', icon: Home },
      { to: '/groups', label: 'Groups', icon: LayoutGrid },
      { to: '/friends', label: 'Friends', icon: Users },
      { to: '/notifications', label: 'Notifications', icon: Bell },
    ],
  },
  {
    title: 'You',
    items: [
      { to: '/settings', label: 'Profile', icon: Settings },
      { to: '/plus', label: 'Owenil Plus', icon: Sparkles },
      { to: '/settings/currency', label: 'Currency', icon: Coins },
      { to: '/settings/privacy', label: 'Privacy', icon: Shield },
      { to: '/export', label: 'Export', icon: Download },
      { to: '/help', label: 'Help', icon: CircleHelp },
    ],
  },
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

type Sheet = null | 'launcher' | 'actions' | 'settle' | 'add-friend';

/**
 * The signed-in app. The screen never scrolls as a whole: a slim top bar, the
 * page area (which scrolls only when a page is taller than the screen; pages
 * built as a FitScreen keep their own lists scrolling inside), and floating
 * controls: on phones a dock (Home, Groups, Friends, All) with the "+" orb for
 * quick actions; on desktop a rail with the same.
 */
export function AppShell() {
  const location = useLocation();
  const navigate = useNavigate();
  const mainRef = React.useRef<HTMLElement>(null);
  const [sheet, setSheet] = React.useState<Sheet>(null);
  // Task screens (filling in an expense or a group) hide the dock and the "+" on phones; they have their own bottom bar.
  const task = /^\/(expenses\/new|expenses\/[^/]+\/edit|groups\/new|groups\/[^/]+\/edit)$/.test(location.pathname);

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
    mainRef.current?.scrollTo({ top: 0 });
    setSheet((s) => (s === 'launcher' || s === 'actions' ? null : s));
  }, [location.pathname]);

  return (
    <div className="safe-top flex h-dvh overflow-hidden bg-canvas">
      <ThemeSync />
      <a href="#main" className="sr-only z-50 rounded-full bg-primary px-4 py-2 text-primary-fg focus:not-sr-only focus:fixed focus:left-4 focus:top-4">
        Skip to content
      </a>
      <Rail onLauncher={() => setSheet('launcher')} onActions={() => setSheet('actions')} />
      <div className="flex min-w-0 flex-1 flex-col">
        <TopBar />
        <main id="main" ref={mainRef} className="scrollbar-thin relative min-h-0 flex-1 overflow-y-auto overscroll-contain">
          {/* Keyed by path: each page fades in with CSS. No exit animation and no
              JavaScript-held opacity, so navigation can never get stuck invisible. */}
          <div
            key={location.pathname}
            className={cn('page-frame mx-auto flex min-h-full w-full max-w-6xl animate-page-in flex-col px-4 pt-3 sm:px-6 lg:px-10 lg:pb-10 lg:pt-6', task ? 'pb-0' : 'pb-[calc(7rem_+_env(safe-area-inset-bottom))]')}
          >
            <RouteErrorBoundary>
              <React.Suspense fallback={<PageSkeleton />}>
                <Outlet />
              </React.Suspense>
            </RouteErrorBoundary>
          </div>
        </main>
      </div>
      {!task && <Dock onLauncher={() => setSheet('launcher')} launcherOpen={sheet === 'launcher'} />}
      <ActionOrb open={sheet === 'actions'} onOpenChange={(o) => setSheet(o ? 'actions' : null)} onPick={setSheet} hideTrigger={task} />
      <Launcher open={sheet === 'launcher'} onOpenChange={(o) => setSheet(o ? 'launcher' : null)} />
      <React.Suspense fallback={null}>
        {sheet === 'settle' && <SettleUpDialog open onOpenChange={(o) => !o && setSheet(null)} defaults={{}} />}
        {sheet === 'add-friend' && <AddFriendDialog open onOpenChange={(o) => !o && setSheet(null)} />}
      </React.Suspense>
    </div>
  );
}

function PageSkeleton() {
  return (
    <div className="space-y-4" aria-hidden>
      <div className="h-8 w-48 animate-pulse rounded-full bg-surface" />
      <div className="h-40 animate-pulse rounded-2xl bg-surface" />
      <div className="h-64 animate-pulse rounded-2xl bg-surface" />
    </div>
  );
}

/* ---------------------------------------------------------------- Rail ---- */

function Rail({ onLauncher, onActions }: { onLauncher: () => void; onActions: () => void }) {
  return (
    <aside className="hidden w-[92px] shrink-0 flex-col items-center gap-3 py-4 lg:flex">
      <Link to="/dashboard" aria-label="Owenil home" className="flex size-11 items-center justify-center">
        <Logo compact />
      </Link>
      <button
        type="button"
        onClick={onActions}
        aria-label="Quick actions"
        className="flex size-12 items-center justify-center rounded-2xl bg-brand-gradient text-white shadow-glow transition-transform hover:scale-105 active:scale-95"
      >
        <Plus className="size-6" strokeWidth={2.5} />
      </button>
      <nav aria-label="Main" className="scrollbar-thin flex w-full flex-1 flex-col items-center gap-1 overflow-y-auto px-2 py-2">
        {RAIL.map((d) => (
          <RailLink key={d.to} {...d} />
        ))}
      </nav>
      <button
        type="button"
        onClick={onLauncher}
        className="flex w-[76px] flex-col items-center gap-1 rounded-2xl py-2 text-[11px] font-medium text-fg-muted transition-colors hover:bg-surface hover:text-fg"
      >
        <LayoutGrid className="size-5" /> All
      </button>
    </aside>
  );
}

function RailLink({ to, label, icon: Icon }: Dest) {
  return (
    <NavLink
      to={to}
      className={({ isActive }) =>
        cn(
          'group flex w-[76px] flex-col items-center gap-1 rounded-2xl py-2 text-[11px] font-medium transition-colors',
          isActive ? 'text-fg' : 'text-fg-muted hover:text-fg',
        )
      }
    >
      {({ isActive }) => (
        <>
          <span className={cn('flex h-8 w-14 items-center justify-center rounded-full transition-colors', isActive ? 'bg-ink text-ink-fg' : 'group-hover:bg-surface')}>
            <Icon className="size-[18px]" />
          </span>
          {label}
        </>
      )}
    </NavLink>
  );
}

/* ---------------------------------------------------------------- Dock ---- */

function Dock({ onLauncher, launcherOpen }: { onLauncher: () => void; launcherOpen: boolean }) {
  return (
    <nav
      aria-label="Primary"
      className="fixed bottom-[calc(env(safe-area-inset-bottom)_+_0.75rem)] left-3 z-30 flex items-center gap-1 rounded-full bg-ink p-1.5 text-ink-muted shadow-dock lg:hidden"
    >
      {DOCK.map(({ to, label, icon: Icon }) => (
        <NavLink
          key={to}
          to={to}
          className={({ isActive }) =>
            cn('relative flex h-12 w-[62px] flex-col items-center justify-center gap-0.5 rounded-full text-[10.5px] font-medium transition-colors', isActive ? 'text-ink' : 'hover:text-ink-fg')
          }
        >
          {({ isActive }) => (
            <>
              {isActive && <motion.span layoutId="dock-active" className="absolute inset-0 rounded-full bg-ink-fg" transition={{ type: 'spring', stiffness: 520, damping: 40 }} />}
              <Icon className="relative size-[19px]" />
              <span className="relative">{label}</span>
            </>
          )}
        </NavLink>
      ))}
      <button
        type="button"
        onClick={onLauncher}
        aria-expanded={launcherOpen}
        className="flex h-12 w-[62px] flex-col items-center justify-center gap-0.5 rounded-full text-[10.5px] font-medium transition-colors hover:text-ink-fg"
      >
        <LayoutGrid className="size-[19px]" />
        All
      </button>
    </nav>
  );
}

/* ------------------------------------------------------ Quick actions ---- */

function ActionOrb({ open, onOpenChange, onPick, hideTrigger }: { open: boolean; onOpenChange: (o: boolean) => void; onPick: (s: Sheet) => void; hideTrigger?: boolean }) {
  const actions: { label: string; hint: string; icon: LucideIcon; tone: string; to?: string; sheet?: Sheet }[] = [
    { label: 'Add expense', hint: 'Split a bill', icon: Receipt, tone: 'bg-primary text-primary-fg', to: '/expenses/new' },
    { label: 'Pay with UPI', hint: 'Everything you owe, per person', icon: IndianRupee, tone: 'bg-accent text-white', to: '/pay' },
    { label: 'Record repayment', hint: 'Cash or bank transfer', icon: HandCoins, tone: 'bg-positive text-white', sheet: 'settle' },
    { label: 'Add friend', hint: 'By email or phone number', icon: UserPlus, tone: 'bg-plus text-white', sheet: 'add-friend' },
    { label: 'New group', hint: 'Trip, flat, family…', icon: LayoutGrid, tone: 'bg-warning text-white', to: '/groups/new' },
  ];
  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Trigger
        aria-label="Quick actions"
        className={cn('fixed bottom-[calc(env(safe-area-inset-bottom)_+_0.75rem)] right-3 z-30 flex size-[60px] items-center justify-center rounded-full bg-brand-gradient text-white shadow-glow transition-transform active:scale-95 lg:hidden', hideTrigger && 'hidden')}
      >
        <Plus className="size-7" strokeWidth={2.5} />
      </DialogPrimitive.Trigger>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-50 animate-fade-in bg-[hsl(226_45%_4%/0.5)] backdrop-blur-sm" />
        <DialogPrimitive.Content
          aria-describedby={undefined}
          className="fixed bottom-[calc(env(safe-area-inset-bottom)_+_0.75rem)] right-3 z-50 flex w-[min(20rem,calc(100vw-1.5rem))] flex-col items-end gap-2 focus:outline-none lg:bottom-auto lg:left-[104px] lg:right-auto lg:top-20 lg:items-start"
        >
          <DialogPrimitive.Title className="sr-only">Quick actions</DialogPrimitive.Title>
          <nav aria-label="Quick actions" className="flex w-full flex-col gap-2">
            {actions.map((a, i) => {
              const body = (
                <>
                  <span className={cn('flex size-10 shrink-0 items-center justify-center rounded-full', a.tone)}>
                    <a.icon className="size-[18px]" />
                  </span>
                  <span className="min-w-0 text-left">
                    <span className="block text-sm font-semibold text-fg">{a.label}</span>
                    <span className="block truncate text-xs text-fg-muted">{a.hint}</span>
                  </span>
                </>
              );
              const cls = 'flex w-full animate-pop-in items-center gap-3 rounded-full bg-surface p-1.5 pr-5 shadow-lift ring-1 ring-border/60 transition-transform active:scale-[0.98]';
              const style = { animationDelay: `${(actions.length - i) * 35}ms` };
              return a.to ? (
                <Link key={a.label} to={a.to} className={cls} style={style} onClick={() => onOpenChange(false)}>
                  {body}
                </Link>
              ) : (
                <button key={a.label} type="button" className={cls} style={style} onClick={() => onPick(a.sheet!)}>
                  {body}
                </button>
              );
            })}
          </nav>
          <DialogPrimitive.Close
            aria-label="Close quick actions"
            className="flex size-[60px] items-center justify-center self-end rounded-full bg-ink text-ink-fg shadow-dock lg:hidden"
          >
            <X className="size-7" />
          </DialogPrimitive.Close>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

/* ------------------------------------------------------------ Launcher ---- */

function Launcher({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const me = useMe();
  const { signOut } = useAuth();
  const navigate = useNavigate();
  const sections = isNativeApp()
    ? LAUNCHER.map((s) => (s.title === 'People' ? { ...s, items: [...s.items, { to: '/friends/contacts', label: 'From contacts', icon: BookUser }] } : s))
    : LAUNCHER;
  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-50 animate-fade-in bg-[hsl(226_45%_4%/0.55)] backdrop-blur-sm" />
        <DialogPrimitive.Content
          aria-describedby={undefined}
          className="scrollbar-thin fixed inset-x-2 bottom-[calc(env(safe-area-inset-bottom)_+_0.5rem)] top-[max(0.5rem,env(safe-area-inset-top))] z-50 flex animate-pop-in flex-col overflow-y-auto rounded-[28px] bg-canvas p-4 shadow-lift focus:outline-none sm:inset-x-auto sm:left-1/2 sm:top-1/2 sm:bottom-auto sm:max-h-[86dvh] sm:w-[34rem] sm:-translate-x-1/2 sm:-translate-y-1/2"
        >
          <div className="mb-3 flex items-center gap-3">
            {me.data && <Avatar name={me.data.profile.display_name} color={me.data.profile.avatar_color} url={me.data.profile.avatar_url} />}
            <div className="min-w-0 flex-1">
              <DialogPrimitive.Title className="truncate font-display text-lg font-semibold">{me.data?.profile.display_name ?? 'Owenil'}</DialogPrimitive.Title>
              <p className="truncate text-xs text-fg-muted">{me.data?.email}</p>
            </div>
            <DialogPrimitive.Close aria-label="Close" className="flex size-10 items-center justify-center rounded-full bg-surface text-fg-muted shadow-tile">
              <X className="size-5" />
            </DialogPrimitive.Close>
          </div>
          <nav aria-label="All sections" className="space-y-4">
            {sections.map((s) => (
              <section key={s.title}>
                <h2 className="mb-2 px-1 text-2xs font-semibold uppercase tracking-wider text-fg-subtle">{s.title}</h2>
                <div className="grid grid-cols-4 gap-2">
                  {s.items.map(({ to, label, icon: Icon }) => (
                    <NavLink
                      key={to}
                      to={to}
                      end
                      onClick={() => onOpenChange(false)}
                      className={({ isActive }) =>
                        cn(
                          'flex aspect-square flex-col items-center justify-center gap-1.5 rounded-[20px] p-1 text-center text-[11px] font-medium leading-tight shadow-tile ring-1 transition-transform active:scale-95',
                          isActive ? 'bg-ink text-ink-fg ring-ink' : 'bg-surface text-fg ring-border/60',
                        )
                      }
                    >
                      <Icon className="size-5" />
                      {label}
                    </NavLink>
                  ))}
                </div>
              </section>
            ))}
          </nav>
          <div className="mt-4 space-y-2">
            <ThemeSwitch />
            {me.data && !me.data.isPlus && (
              <Link to="/plus" onClick={() => onOpenChange(false)} className="block rounded-2xl bg-gradient-to-br from-plus/15 to-accent/10 p-3">
                <p className="flex items-center gap-1.5 text-sm font-semibold"><Sparkles className="size-4 text-plus" /> Owenil Plus</p>
                <p className="mt-0.5 text-xs text-fg-muted">Budgets, receipts, exports and deeper insights.</p>
              </Link>
            )}
            <Button
              variant="ghost"
              className="w-full text-negative hover:bg-negative-soft hover:text-negative"
              onClick={async () => {
                onOpenChange(false);
                await signOut();
                navigate('/login');
              }}
            >
              <LogOut /> Sign out
            </Button>
          </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

function ThemeSwitch() {
  const { theme, setTheme } = useTheme();
  const opts = [
    { v: 'light' as const, label: 'Light', icon: Sun },
    { v: 'dark' as const, label: 'Dark', icon: Moon },
    { v: 'system' as const, label: 'System', icon: Monitor },
  ];
  return (
    <div className="grid grid-cols-3 gap-1 rounded-full bg-surface p-1 shadow-tile ring-1 ring-border/60" role="radiogroup" aria-label="Theme">
      {opts.map((o) => (
        <button
          key={o.v}
          role="radio"
          aria-checked={theme === o.v}
          onClick={() => setTheme(o.v)}
          className={cn('flex items-center justify-center gap-1.5 rounded-full py-2 text-xs font-medium transition-colors', theme === o.v ? 'bg-ink text-ink-fg' : 'text-fg-muted hover:text-fg')}
        >
          <o.icon className="size-4" />
          {o.label}
        </button>
      ))}
    </div>
  );
}

/* ------------------------------------------------------------- Top bar ---- */

function TopBar() {
  const me = useMe();
  const { signOut } = useAuth();
  const navigate = useNavigate();
  const notifications = useNotifications();
  const unread = notifications.data?.filter((n) => !n.read_at).length ?? 0;
  const { resolved, setTheme } = useTheme();
  const [q, setQ] = React.useState('');

  return (
    <header className="z-20 shrink-0">
      <div className="mx-auto flex h-14 max-w-6xl items-center gap-3 px-4 sm:px-6 lg:h-16 lg:px-10">
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
          <Search className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-fg-subtle" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search expenses…"
            aria-label="Search expenses"
            className="h-10 w-full rounded-full bg-surface pl-10 pr-10 text-sm shadow-tile ring-1 ring-border/60 placeholder:text-fg-subtle focus-visible:ring-2 focus-visible:ring-ring/40 focus-visible:ring-offset-0"
          />
          <span className="pointer-events-none absolute right-3.5 top-1/2 -translate-y-1/2 rounded border border-border px-1.5 text-2xs text-fg-subtle">/</span>
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
                  className="absolute right-1 top-1 flex min-w-[18px] items-center justify-center rounded-full bg-negative px-1 text-[10px] font-bold leading-[18px] text-white"
                >
                  {unread > 9 ? '9+' : unread}
                </motion.span>
              )}
            </Link>
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger className="ml-1 rounded-full focus-visible:ring-2 focus-visible:ring-ring" aria-label="Account menu">
              {me.data ? <Avatar name={me.data.profile.display_name} color={me.data.profile.avatar_color} url={me.data.profile.avatar_url} size="sm" /> : <span className="block size-8 rounded-full bg-surface" />}
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
        </div>
      </div>
    </header>
  );
}
