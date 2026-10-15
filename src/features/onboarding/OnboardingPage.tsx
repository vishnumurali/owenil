import * as React from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { AnimatePresence, motion } from 'framer-motion';
import { ArrowLeft, ArrowRight, LayoutGrid, Monitor, Moon, Sun, UserPlus } from 'lucide-react';
import { toast } from 'sonner';
import { CURRENCIES } from '@owenil/core';
import { supabase } from '@/lib/supabase';
import { errorMessage } from '@/lib/errors';
import { useDocumentTitle } from '@/lib/hooks';
import { useTheme, type ThemePreference } from '@/lib/theme';
import { cn, safeNextPath } from '@/lib/utils';
import { qk, useMe, useMyPhone } from '@/data/queries';
import { formatPhone, normalizePhone, saveMyPhone } from '@/data/people';
import { useAuth } from '@/features/auth/AuthProvider';
import { Logo } from '@/components/brand/Logo';
import { Button } from '@/components/ui/button';
import { Field, Input, NativeSelect } from '@/components/ui/input';
import { FullPageSpinner } from '@/components/layout/Splash';
import { Illustration } from '@/components/ui/illustrations';

const STEPS = ['You', 'Look', 'Start'] as const;

export default function OnboardingPage() {
  useDocumentTitle('Welcome');
  const me = useMe();
  const myPhone = useMyPhone();
  const { user } = useAuth();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const { theme, setTheme } = useTheme();
  const [step, setStep] = React.useState(0);
  const [name, setName] = React.useState('');
  const [currency, setCurrency] = React.useState('INR');
  const [phone, setPhone] = React.useState<string | null>(null);
  const [phoneError, setPhoneError] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);
  // Saved number, else the one typed at sign-up (kept if it couldn't be saved then).
  const signupPhone = typeof user?.user_metadata?.phone === 'string' ? (user.user_metadata.phone as string) : '';
  const phoneValue = phone ?? (myPhone.data ? formatPhone(myPhone.data) : signupPhone ? formatPhone(signupPhone) : '');

  React.useEffect(() => {
    if (me.data) {
      setName(me.data.profile.display_name);
      setCurrency(me.data.profile.default_currency);
    }
  }, [me.data]);

  if (!me.data) return <FullPageSpinner />;

  // Step 1 → 2: the phone number is required (not verified by SMS yet).
  const continueFromYou = async () => {
    setPhoneError(null);
    const e164 = normalizePhone(phoneValue);
    if (!e164) return setPhoneError('Enter your mobile number, for example +91 98765 43210.');
    if (e164 !== myPhone.data) {
      setBusy(true);
      try {
        qc.setQueryData(qk.myPhone, await saveMyPhone(e164));
      } catch (e) {
        setBusy(false);
        return setPhoneError(errorMessage(e));
      }
      setBusy(false);
    }
    setStep(1);
  };

  const finish = async (destination: string) => {
    setBusy(true);
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    const { error } = await supabase
      .from('profiles')
      .update({ display_name: name.trim() || me.data!.profile.display_name, default_currency: currency, onboarded_at: new Date().toISOString(), ...(tz ? { timezone: tz } : {}) })
      .eq('id', me.data!.profile.id);
    if (!error) await supabase.from('user_preferences').update({ theme }).eq('user_id', me.data!.profile.id);
    setBusy(false);
    if (error) return toast.error(errorMessage(error));
    await qc.invalidateQueries({ queryKey: qk.me });
    const next = safeNextPath(params.get('next'), destination);
    navigate(next !== '/onboarding' ? next : destination, { replace: true });
  };

  return (
    <div className="safe-top flex min-h-dvh flex-col bg-bg">
      <div className="pointer-events-none fixed inset-0 bg-hero-glow" />
      <header className="relative flex items-center justify-between p-5">
        <Logo />
        <div className="flex gap-1.5" aria-label={`Step ${step + 1} of ${STEPS.length}`}>
          {STEPS.map((s, i) => (
            <span key={s} className={cn('h-1.5 rounded-full transition-all duration-500', i <= step ? 'w-8 bg-primary' : 'w-4 bg-border')} />
          ))}
        </div>
      </header>
      <main className="relative flex flex-1 items-center justify-center px-5 pb-16">
        <div className="w-full max-w-md">
          <AnimatePresence mode="wait">
            <motion.div key={step} initial={{ opacity: 0, x: 24 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -24 }} transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}>
              {step === 0 && (
                <div className="space-y-5">
                  <div>
                    <p className="text-sm font-medium text-primary">Welcome to Owenil</p>
                    <h1 className="mt-1 text-3xl font-semibold">Let’s set you up</h1>
                    <p className="mt-2 text-fg-muted">This is how friends will see you.</p>
                  </div>
                  <Field label="Your name" htmlFor="ob-name"><Input id="ob-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={60} autoFocus /></Field>
                  <Field label="Mobile number" htmlFor="ob-phone" error={phoneError ?? undefined} hint="Friends who have your number can find you. Never shown to anyone.">
                    <Input id="ob-phone" type="tel" inputMode="tel" autoComplete="tel" placeholder="+91 98765 43210" value={phoneValue} onChange={(e) => setPhone(e.target.value)} maxLength={24} />
                  </Field>
                  <Field label="Usual currency" htmlFor="ob-cur" hint="You can use any currency on individual expenses.">
                    <NativeSelect id="ob-cur" value={currency} onChange={(e) => setCurrency(e.target.value)}>
                      {CURRENCIES.map((c) => <option key={c.code} value={c.code}>{c.code} — {c.name}</option>)}
                    </NativeSelect>
                  </Field>
                  <Button size="lg" className="w-full" disabled={!name.trim() || myPhone.isLoading} loading={busy} onClick={() => void continueFromYou()}>Continue <ArrowRight /></Button>
                </div>
              )}
              {step === 1 && (
                <div className="space-y-5">
                  <div>
                    <h1 className="text-3xl font-semibold">Pick your look</h1>
                    <p className="mt-2 text-fg-muted">Change it any time from the menu.</p>
                  </div>
                  <div className="grid grid-cols-3 gap-3" role="radiogroup" aria-label="Theme">
                    {([['light', 'Light', Sun], ['dark', 'Dark', Moon], ['system', 'System', Monitor]] as [ThemePreference, string, React.ElementType][]).map(([v, label, Icon]) => (
                      <button key={v} role="radio" aria-checked={theme === v} onClick={() => setTheme(v)}
                        className={cn('flex flex-col items-center gap-2 rounded-2xl border-2 p-5 text-sm font-medium transition-all', theme === v ? 'border-primary bg-primary-soft text-primary' : 'border-border hover:bg-muted')}>
                        <Icon className="size-6" />{label}
                      </button>
                    ))}
                  </div>
                  <div className="flex gap-2">
                    <Button variant="outline" size="lg" onClick={() => setStep(0)}><ArrowLeft /></Button>
                    <Button size="lg" className="flex-1" onClick={() => setStep(2)}>Continue <ArrowRight /></Button>
                  </div>
                </div>
              )}
              {step === 2 && (
                <div className="space-y-5">
                  <Illustration name="groups" className="mx-auto h-32 w-48" />
                  <div className="text-center">
                    <h1 className="text-3xl font-semibold">How do you want to start?</h1>
                    <p className="mt-2 text-fg-muted">Groups are best for trips and homes. Friends work for one-to-one splits.</p>
                  </div>
                  <div className="grid gap-3">
                    <button onClick={() => finish('/groups/new')} disabled={busy} className="flex items-center gap-4 rounded-2xl border border-border bg-surface p-4 text-left shadow-card transition-all hover:-translate-y-0.5 hover:border-primary">
                      <span className="flex size-11 items-center justify-center rounded-xl bg-primary-soft text-primary"><LayoutGrid className="size-5" /></span>
                      <span><span className="block font-semibold">Create a group</span><span className="text-sm text-fg-muted">For a trip, flat, couple or family</span></span>
                    </button>
                    <button onClick={() => finish('/friends')} disabled={busy} className="flex items-center gap-4 rounded-2xl border border-border bg-surface p-4 text-left shadow-card transition-all hover:-translate-y-0.5 hover:border-primary">
                      <span className="flex size-11 items-center justify-center rounded-xl bg-accent-soft text-accent"><UserPlus className="size-5" /></span>
                      <span><span className="block font-semibold">Invite a friend</span><span className="text-sm text-fg-muted">Split one-to-one without a group</span></span>
                    </button>
                  </div>
                  <Button variant="ghost" className="w-full" loading={busy} onClick={() => finish('/dashboard')}>Skip — take me to the dashboard</Button>
                </div>
              )}
            </motion.div>
          </AnimatePresence>
        </div>
      </main>
    </div>
  );
}
