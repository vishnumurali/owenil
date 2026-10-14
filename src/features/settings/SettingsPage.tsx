import * as React from 'react';
import { Link, useLocation } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { Check, ChevronRight, Coins, Download, FlaskConical, Monitor, Moon, Phone, RefreshCw, Shield, Smartphone, Sun } from 'lucide-react';
import { toast } from 'sonner';
import { CURRENCIES, isValidUpiId, normalizeUpiId, profileFormSchema } from '@owenil/core';
import { supabase } from '@/lib/supabase';
import { env } from '@/lib/env';
import { errorMessage, unwrap } from '@/lib/errors';
import { useDocumentTitle } from '@/lib/hooks';
import { useTheme, type ThemePreference } from '@/lib/theme';
import { cn } from '@/lib/utils';
import { invalidateFinancial, qk, useMe, useMyPhone, useUpiId } from '@/data/queries';
import { formatPhone, normalizePhone, saveMyPhone } from '@/data/people';
import type { Preferences } from '@/types/db';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Field, Input, NativeSelect } from '@/components/ui/input';
import { Skeleton, Switch } from '@/components/ui/misc';
import { Avatar } from '@/components/ui/avatar';
import { FitBody, FitScreen, PageHeader } from '@/components/ui/layout-bits';
import { Segmented } from '@/components/ui/segmented';

const AVATAR_COLORS = ['#14b8a6', '#10b981', '#0ea5e9', '#6366f1', '#8b5cf6', '#ec4899', '#f43f5e', '#f97316', '#eab308', '#64748b'];

function timeZones(): string[] {
  try {
    return (Intl as unknown as { supportedValuesOf?: (k: string) => string[] }).supportedValuesOf?.('timeZone') ?? ['Asia/Kolkata', 'UTC'];
  } catch {
    return ['Asia/Kolkata', 'UTC'];
  }
}

type SettingsTab = 'profile' | 'preferences' | 'more';

export default function SettingsPage() {
  useDocumentTitle('Profile & preferences');
  const location = useLocation();
  const [tab, setTab] = React.useState<SettingsTab>(location.hash === '#notifications' ? 'preferences' : 'profile');
  const me = useMe();
  const qc = useQueryClient();
  const { theme, setTheme } = useTheme();
  const [name, setName] = React.useState('');
  const [color, setColor] = React.useState('#14b8a6');
  const [currency, setCurrency] = React.useState('INR');
  const [tz, setTz] = React.useState('Asia/Kolkata');
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const zones = React.useMemo(timeZones, []);
  // Browsers may list a zone under another name (Chrome: Asia/Calcutta for Asia/Kolkata), so the saved one is always offered.
  const zoneOptions = zones.includes(tz) ? zones : [tz, ...zones];

  React.useEffect(() => {
    if (me.data) {
      setName(me.data.profile.display_name);
      setColor(me.data.profile.avatar_color);
      setCurrency(me.data.profile.default_currency);
      setTz(me.data.profile.timezone);
    }
  }, [me.data]);

  const saveProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    const parsed = profileFormSchema.safeParse({ display_name: name, default_currency: currency, timezone: tz });
    if (!parsed.success) return setError(parsed.error.issues[0]?.message ?? 'Check your details');
    setBusy(true);
    const { error: err } = await supabase.from('profiles').update({ ...parsed.data, avatar_color: color }).eq('id', me.data!.profile.id);
    setBusy(false);
    if (err) return setError(errorMessage(err));
    toast.success('Profile saved');
    void qc.invalidateQueries({ queryKey: qk.me });
    void qc.invalidateQueries({ queryKey: qk.contacts });
  };

  const setPref = async (patch: Partial<Preferences>) => {
    const { error: err } = await supabase.from('user_preferences').update(patch).eq('user_id', me.data!.profile.id);
    if (err) toast.error(errorMessage(err));
    else void qc.invalidateQueries({ queryKey: qk.me });
  };

  const chooseTheme = (t: ThemePreference) => {
    setTheme(t);
    void setPref({ theme: t });
  };

  // Links like /settings#upi or #notifications open the right tab and scroll to the card.
  React.useEffect(() => {
    if (location.hash && me.data) document.getElementById(location.hash.slice(1))?.scrollIntoView({ block: 'start' });
  }, [location.hash, tab, me.data]);

  if (me.isLoading || !me.data) return <Skeleton className="h-96 rounded-2xl" />;
  const p = me.data.preferences;

  return (
    <FitScreen className="mx-auto w-full max-w-3xl">
      <PageHeader title="Profile & preferences" description={me.data.email} />
      <Segmented<SettingsTab> size="sm" value={tab} onChange={setTab} ariaLabel="Settings sections" className="mb-3 w-full shrink-0"
        options={[{ value: 'profile', label: 'Profile' }, { value: 'preferences', label: 'Preferences' }, { value: 'more', label: 'More' }]} />
      <FitBody className="space-y-4">
      {tab === 'profile' && (<>
      <Card className="p-5 sm:p-6">
        <h2 className="mb-4 font-semibold">Profile</h2>
        <form onSubmit={saveProfile} className="space-y-4">
          <div className="flex items-center gap-4">
            <Avatar name={name || '?'} color={color} size="xl" />
            <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Avatar colour">
              {AVATAR_COLORS.map((c) => (
                <button key={c} type="button" role="radio" aria-checked={color === c} aria-label={`Colour ${c}`} onClick={() => setColor(c)}
                  className="flex size-8 items-center justify-center rounded-full transition-transform hover:scale-110" style={{ background: c, boxShadow: color === c ? `0 0 0 2px hsl(var(--surface)), 0 0 0 4px ${c}` : undefined }}>
                  {color === c && <Check className="size-4 text-white" />}
                </button>
              ))}
            </div>
          </div>
          <Field label="Display name" htmlFor="s-name"><Input id="s-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={60} /></Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Default currency" htmlFor="s-cur">
              <NativeSelect id="s-cur" value={currency} onChange={(e) => setCurrency(e.target.value)}>
                {CURRENCIES.map((c) => <option key={c.code} value={c.code}>{c.code} — {c.name}</option>)}
              </NativeSelect>
            </Field>
            <Field label="Time zone" htmlFor="s-tz" hint="Used for “today” and recurring schedules.">
              <NativeSelect id="s-tz" value={tz} onChange={(e) => setTz(e.target.value)}>
                {zoneOptions.map((z) => <option key={z} value={z}>{z}</option>)}
              </NativeSelect>
            </Field>
          </div>
          {error && <p role="alert" className="text-sm text-negative">{error}</p>}
          <div className="flex justify-end"><Button type="submit" loading={busy}>Save profile</Button></div>
        </form>
      </Card>

      <PhoneCard />

      <UpiCard userId={me.data.profile.id} />
      </>)}

      {tab === 'preferences' && (<>
      <Card className="p-5 sm:p-6">
        <h2 className="mb-4 font-semibold">Appearance</h2>
        <div className="grid grid-cols-3 gap-3" role="radiogroup" aria-label="Theme">
          {([['light', 'Light', Sun], ['dark', 'Dark', Moon], ['system', 'System', Monitor]] as const).map(([v, label, Icon]) => (
            <button key={v} role="radio" aria-checked={theme === v} onClick={() => chooseTheme(v)}
              className={cn('flex flex-col items-center gap-2 rounded-xl border p-4 text-sm font-medium transition-all', theme === v ? 'border-primary bg-primary-soft text-primary' : 'border-border hover:bg-muted')}>
              <Icon className="size-5" /> {label}
            </button>
          ))}
        </div>
        <p className="mt-3 text-xs text-fg-subtle">Animations follow your system’s “reduce motion” setting.</p>
      </Card>

      <Card className="p-5 sm:p-6" id="notifications">
        <h2 className="mb-4 font-semibold">In-app notifications</h2>
        <div className="divide-y divide-border">
          {([
            ['notify_expenses', 'Expenses added, edited or deleted'],
            ['notify_settlements', 'Repayments recorded or reversed'],
            ['notify_comments', 'Comments on your expenses'],
            ['notify_budget_alerts', 'Budget alerts (Plus)'],
            ['notify_recurring', 'Recurring expenses created or paused'],
          ] as const).map(([k, label]) => (
            <label key={k} className="flex items-center justify-between gap-4 py-3 text-sm">
              {label}
              <Switch checked={p[k]} onCheckedChange={(v) => setPref({ [k]: v })} aria-label={label} />
            </label>
          ))}
        </div>
      </Card>

      </>)}

      {tab === 'more' && (<>
      <Card className="divide-y divide-border">
        {[
          { to: '/settings/currency', icon: Coins, label: 'Currency & exchange rates' },
          { to: '/settings/privacy', icon: Shield, label: 'Privacy, data export & account deletion' },
          { to: '/export', icon: Download, label: 'Export centre' },
        ].map((l) => (
          <Link key={l.to} to={l.to} className="flex items-center gap-3 p-4 text-sm font-medium transition-colors hover:bg-muted/50">
            <l.icon className="size-4 text-fg-subtle" /> <span className="flex-1">{l.label}</span> <ChevronRight className="size-4 text-fg-subtle" />
          </Link>
        ))}
      </Card>

      {env.devTools && <DevTools />}
      </>)}
      </FitBody>
    </FitScreen>
  );
}

/** The user's mobile number (required at sign-up; lets friends who have it find them). */
function PhoneCard() {
  const qc = useQueryClient();
  const saved = useMyPhone();
  // null = not edited, so the saved value shows (and arriving data never overwrites typing).
  const [draft, setDraft] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const value = draft ?? (saved.data ? formatPhone(saved.data) : '');

  const save = async () => {
    setError(null);
    const e164 = normalizePhone(value);
    if (!e164) return setError('Enter your mobile number, for example +91 98765 43210.');
    setBusy(true);
    try {
      qc.setQueryData(qk.myPhone, await saveMyPhone(e164));
      setDraft(null);
      toast.success('Phone number saved');
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card className="p-5 sm:p-6" id="phone">
      <h2 className="flex items-center gap-2 font-semibold"><Phone className="size-4 text-primary" /> Mobile number</h2>
      <p className="mt-1 text-sm text-fg-muted">
        Friends who have your number can find you on Owenil. It’s never shown to anyone, and you can stop being found in Privacy. Numbers aren’t verified by SMS yet.
      </p>
      <form className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-end" onSubmit={(e) => { e.preventDefault(); void save(); }}>
        <Field label="Mobile number" htmlFor="s-phone" className="flex-1" hint="Include the country code; +91 is assumed if you leave it out.">
          <Input id="s-phone" type="tel" inputMode="tel" autoComplete="tel" value={value} onChange={(e) => setDraft(e.target.value)} placeholder="+91 98765 43210" maxLength={24} />
        </Field>
        <Button type="submit" loading={busy} disabled={saved.isLoading}>Save number</Button>
      </form>
      {error && <p role="alert" className="mt-2 text-sm text-negative">{error}</p>}
    </Card>
  );
}

/** Optional UPI ID so friends can pay you back from their UPI app in one tap. */
function UpiCard({ userId }: { userId: string }) {
  const qc = useQueryClient();
  const saved = useUpiId(userId);
  // null = not edited, so the saved value shows (and arriving data never overwrites typing).
  const [draft, setDraft] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const value = draft ?? saved.data ?? '';

  const save = async (next: string) => {
    setError(null);
    if (!next && !saved.data) return setError('Enter your UPI ID, for example asha.k@okhdfcbank.');
    if (next && !isValidUpiId(next)) return setError('Enter a UPI ID like name@bank, for example asha.k@okhdfcbank.');
    setBusy(true);
    try {
      const stored = unwrap(await supabase.rpc('set_upi_id', { p_upi_id: next ? normalizeUpiId(next) : '' })) as string | null;
      qc.setQueryData(qk.upi(userId), stored);
      setDraft(null);
      toast.success(stored ? 'UPI ID saved' : 'UPI ID removed');
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card className="p-5 sm:p-6" id="upi">
      <h2 className="flex items-center gap-2 font-semibold"><Smartphone className="size-4 text-primary" /> Get paid back with UPI</h2>
      <p className="mt-1 text-sm text-fg-muted">
        Add your UPI ID and friends can pay you from GPay, PhonePe, Paytm or any UPI app in one tap, with the amount filled in.
        Only your friends and people in your groups can see it. Owenil never moves money.
      </p>
      <form className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-end" onSubmit={(e) => { e.preventDefault(); void save(value.trim()); }}>
        <Field label="UPI ID" htmlFor="s-upi" optional className="flex-1">
          <Input id="s-upi" value={value} onChange={(e) => setDraft(e.target.value)} placeholder="name@bank" autoComplete="off" autoCapitalize="none" spellCheck={false} maxLength={100} />
        </Field>
        <div className="flex gap-2">
          {saved.data && (
            <Button type="button" variant="outline" disabled={busy} onClick={() => void save('')}>Remove</Button>
          )}
          <Button type="submit" loading={busy} disabled={saved.isLoading}>Save UPI ID</Button>
        </div>
      </form>
      {error && <p role="alert" className="mt-2 text-sm text-negative">{error}</p>}
    </Card>
  );
}

function DevTools() {
  const qc = useQueryClient();
  const [busy, setBusy] = React.useState(false);
  return (
    <Card className="border-dashed p-5 sm:p-6">
      <h2 className="flex items-center gap-2 font-semibold"><FlaskConical className="size-4 text-warning" /> Developer tools</h2>
      <p className="mt-1 text-sm text-fg-muted">Visible because this build has VITE_ENABLE_DEV_TOOLS=true. Each action is still authorised by the database.</p>
      <div className="mt-4 flex flex-wrap gap-2">
        <Button variant="outline" size="sm" asChild><Link to="/plus">Premium entitlement switch</Link></Button>
        <Button variant="outline" size="sm" loading={busy}
          onClick={async () => {
            setBusy(true);
            try {
              const n = unwrap(await supabase.rpc('run_due_recurring_now')) as number;
              toast.success(`Recurring generator ran: ${n} created`);
              invalidateFinancial(qc);
            } catch (e) {
              toast.error(errorMessage(e));
            } finally {
              setBusy(false);
            }
          }}>
          <RefreshCw /> Run due recurring expenses
        </Button>
      </div>
      <p className="mt-3 text-xs text-fg-subtle">Reset demo data from your terminal: <code className="rounded bg-muted px-1">npm run db:reset-demo</code></p>
    </Card>
  );
}
