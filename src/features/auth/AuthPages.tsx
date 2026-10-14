import * as React from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { motion } from 'framer-motion';
import { ArrowLeft, Eye, EyeOff, MailCheck, ShieldCheck } from 'lucide-react';
import { toast } from 'sonner';
import { CURRENCIES, emailSchema, passwordSchema } from '@owenil/core';
import { supabase } from '@/lib/supabase';
import { authRedirectUrl } from '@/lib/native-auth';
import { errorMessage, toAppError } from '@/lib/errors';
import { useDocumentTitle } from '@/lib/hooks';
import { safeNextPath } from '@/lib/utils';
import { normalizePhone } from '@/data/people';
import { useAuth } from './AuthProvider';
import { GoogleSignIn } from './oauth';
import { Logo } from '@/components/brand/Logo';
import { Button } from '@/components/ui/button';
import { Field, Input, NativeSelect } from '@/components/ui/input';
import { Spinner } from '@/components/ui/misc';

type Mode = 'login' | 'register' | 'forgot' | 'reset' | 'callback';

export default function AuthPages({ mode }: { mode: Mode }) {
  return (
    <div className="grid min-h-dvh bg-bg lg:grid-cols-[1.05fr_1fr]">
      <BrandPanel />
      <div className="flex flex-col px-5 py-6 sm:px-10">
        <div className="flex items-center justify-between">
          <Link to="/" className="lg:invisible" aria-label="Owenil home">
            <Logo />
          </Link>
          <Link to="/" className="inline-flex items-center gap-1 text-sm text-fg-muted hover:text-fg">
            <ArrowLeft className="size-4" /> Home
          </Link>
        </div>
        <div className="flex flex-1 items-center justify-center py-10">
          <motion.div key={mode} initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.35, ease: [0.16, 1, 0.3, 1] }} className="w-full max-w-sm">
            {mode === 'login' && <LoginForm />}
            {mode === 'register' && <RegisterForm />}
            {mode === 'forgot' && <ForgotForm />}
            {mode === 'reset' && <ResetForm />}
            {mode === 'callback' && <Callback />}
          </motion.div>
        </div>
        <p className="text-center text-xs text-fg-subtle">Owenil records shared expenses. It never moves money.</p>
      </div>
    </div>
  );
}

function BrandPanel() {
  return (
    <div className="relative hidden overflow-hidden bg-[hsl(226_45%_7%)] p-10 text-white lg:flex lg:flex-col">
      <div className="absolute inset-0 bg-[radial-gradient(70%_60%_at_20%_10%,hsl(160_70%_40%/0.35),transparent_60%),radial-gradient(60%_60%_at_90%_90%,hsl(192_80%_45%/0.3),transparent_60%)]" />
      <div className="relative">
        <Logo className="text-white" />
      </div>
      <div className="relative mt-auto max-w-md">
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1, duration: 0.6, ease: [0.16, 1, 0.3, 1] }}>
          <h2 className="text-4xl font-semibold leading-tight">Shared expenses. Clear balances. Better together.</h2>
          <p className="mt-4 text-white/70">Trips, flats, couples and families — split any bill fairly, see who owes whom, and settle up without awkward maths.</p>
        </motion.div>
        <div className="mt-10 grid grid-cols-3 gap-3">
          {[
            ['Exact', 'to the paisa'],
            ['6 ways', 'to split'],
            ['Private', 'by design'],
          ].map(([a, b], i) => (
            <motion.div key={a} initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.25 + i * 0.08 }} className="rounded-2xl border border-white/10 bg-white/5 p-4 backdrop-blur">
              <p className="font-display text-lg font-semibold">{a}</p>
              <p className="text-xs text-white/60">{b}</p>
            </motion.div>
          ))}
        </div>
      </div>
    </div>
  );
}

const PasswordInput = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(function PasswordInput(props, ref) {
  const [show, setShow] = React.useState(false);
  return (
    <div className="relative">
      <Input {...props} ref={ref} type={show ? 'text' : 'password'} className="pr-10" />
      <button type="button" onClick={() => setShow((s) => !s)} className="absolute right-2 top-1/2 -translate-y-1/2 rounded-md p-1.5 text-fg-subtle hover:text-fg" aria-label={show ? 'Hide password' : 'Show password'}>
        {show ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
      </button>
    </div>
  );
});

const loginSchema = z.object({ email: emailSchema, password: z.string().min(1, 'Enter your password') });

function LoginForm() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const [unconfirmed, setUnconfirmed] = React.useState<string | null>(null);
  useDocumentTitle('Sign in');
  const form = useForm<z.infer<typeof loginSchema>>({ resolver: zodResolver(loginSchema), defaultValues: { email: '', password: '' } });
  const onSubmit = form.handleSubmit(async (v) => {
    setUnconfirmed(null);
    const { error } = await supabase.auth.signInWithPassword({ email: v.email, password: v.password });
    if (error) {
      const e = toAppError(error);
      if (e.code === 'email_not_confirmed') setUnconfirmed(v.email);
      form.setError('root', { message: e.message });
      return;
    }
    navigate(safeNextPath(params.get('next')), { replace: true });
  });
  return (
    <form onSubmit={onSubmit} className="space-y-5" noValidate>
      <div>
        <h1 className="text-2xl font-semibold">Welcome back</h1>
        <p className="mt-1 text-sm text-fg-muted">Sign in to see your balances.</p>
      </div>
      <GoogleSignIn next={params.get('next')} />
      <Field label="Email" htmlFor="email" error={form.formState.errors.email?.message}>
        <Input id="email" type="email" autoComplete="email" autoFocus aria-invalid={!!form.formState.errors.email} {...form.register('email')} />
      </Field>
      <Field label="Password" htmlFor="password" error={form.formState.errors.password?.message}>
        <PasswordInput id="password" autoComplete="current-password" aria-invalid={!!form.formState.errors.password} {...form.register('password')} />
      </Field>
      <div className="flex justify-end">
        <Link to="/forgot-password" className="text-sm font-medium text-primary hover:underline">
          Forgot password?
        </Link>
      </div>
      {form.formState.errors.root && (
        <div role="alert" className="rounded-xl bg-negative-soft px-3 py-2.5 text-sm text-negative">
          {form.formState.errors.root.message}
          {unconfirmed && <ResendButton email={unconfirmed} className="mt-2" />}
        </div>
      )}
      <Button type="submit" className="w-full" size="lg" loading={form.formState.isSubmitting}>
        Sign in
      </Button>
      <p className="text-center text-sm text-fg-muted">
        New to Owenil?{' '}
        <Link to={`/register${params.get('next') ? `?next=${encodeURIComponent(params.get('next')!)}` : ''}`} className="font-medium text-primary hover:underline">
          Create an account
        </Link>
      </p>
    </form>
  );
}

function ResendButton({ email, className }: { email: string; className?: string }) {
  const [busy, setBusy] = React.useState(false);
  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      className={className}
      loading={busy}
      onClick={async () => {
        setBusy(true);
        const { error } = await supabase.auth.resend({ type: 'signup', email, options: { emailRedirectTo: authRedirectUrl('auth/callback') } });
        setBusy(false);
        if (error) toast.error(errorMessage(error));
        else toast.success('Verification email sent. Check your inbox.');
      }}
    >
      Resend verification email
    </Button>
  );
}

const registerSchema = z
  .object({
    display_name: z.string().trim().min(1, 'Enter your name').max(60),
    email: emailSchema,
    phone: z.string().refine((v) => !!normalizePhone(v), 'Enter your mobile number, for example +91 98765 43210'),
    password: passwordSchema,
    confirm: z.string(),
    default_currency: z.string().length(3),
    accept: z.literal(true, { errorMap: () => ({ message: 'Please accept to continue' }) }),
  })
  .refine((v) => v.password === v.confirm, { message: 'Passwords do not match', path: ['confirm'] });

function RegisterForm() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const [sentTo, setSentTo] = React.useState<string | null>(null);
  useDocumentTitle('Create account');
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || 'Asia/Kolkata';
  const form = useForm<z.infer<typeof registerSchema>>({
    resolver: zodResolver(registerSchema),
    defaultValues: { display_name: '', email: '', phone: '', password: '', confirm: '', default_currency: 'INR', accept: undefined as unknown as true },
  });
  const onSubmit = form.handleSubmit(async (v) => {
    const next = safeNextPath(params.get('next'), '');
    const { data, error } = await supabase.auth.signUp({
      email: v.email,
      password: v.password,
      options: {
        data: { display_name: v.display_name, default_currency: v.default_currency, timezone: tz, phone: normalizePhone(v.phone) },
        emailRedirectTo: authRedirectUrl(`auth/callback${next ? `?next=${encodeURIComponent(next)}` : ''}`),
      },
    });
    if (error) {
      form.setError('root', { message: errorMessage(error) });
      return;
    }
    if (data.session) navigate('/onboarding', { replace: true });
    else setSentTo(v.email);
  });

  if (sentTo) {
    return (
      <div className="space-y-5 text-center">
        <div className="mx-auto flex size-16 items-center justify-center rounded-2xl bg-primary-soft text-primary">
          <MailCheck className="size-8" />
        </div>
        <div>
          <h1 className="text-2xl font-semibold">Check your inbox</h1>
          <p className="mt-2 text-sm text-fg-muted">
            We sent a verification link to <strong className="text-fg">{sentTo}</strong>. Open it on this device to activate your account.
          </p>
        </div>
        <ResendButton email={sentTo} />
        <p className="text-xs text-fg-subtle">Didn’t get it? Check spam, or wait a minute — email delivery can be rate limited on free plans.</p>
        <Link to="/login" className="block text-sm font-medium text-primary hover:underline">
          Back to sign in
        </Link>
      </div>
    );
  }

  const err = form.formState.errors;
  return (
    <form onSubmit={onSubmit} className="space-y-4" noValidate>
      <div>
        <h1 className="text-2xl font-semibold">Create your account</h1>
        <p className="mt-1 text-sm text-fg-muted">Free forever for everyday splitting.</p>
      </div>
      <GoogleSignIn next={params.get('next')} note="Owenil only records shared expenses and never transfers money." />
      <Field label="Your name" htmlFor="display_name" error={err.display_name?.message}>
        <Input id="display_name" autoComplete="name" autoFocus aria-invalid={!!err.display_name} {...form.register('display_name')} />
      </Field>
      <Field label="Email" htmlFor="email" error={err.email?.message}>
        <Input id="email" type="email" autoComplete="email" aria-invalid={!!err.email} {...form.register('email')} />
      </Field>
      <Field label="Mobile number" htmlFor="phone" error={err.phone?.message} hint="Friends who have your number can find you. Never shown to anyone.">
        <Input id="phone" type="tel" inputMode="tel" autoComplete="tel" placeholder="+91 98765 43210" aria-invalid={!!err.phone} {...form.register('phone')} />
      </Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Password" htmlFor="password" error={err.password?.message}>
          <PasswordInput id="password" autoComplete="new-password" aria-invalid={!!err.password} {...form.register('password')} />
        </Field>
        <Field label="Confirm" htmlFor="confirm" error={err.confirm?.message}>
          <PasswordInput id="confirm" autoComplete="new-password" aria-invalid={!!err.confirm} {...form.register('confirm')} />
        </Field>
      </div>
      <Field label="Default currency" htmlFor="currency" hint={`Time zone: ${tz}`}>
        <NativeSelect id="currency" {...form.register('default_currency')}>
          {CURRENCIES.map((c) => (
            <option key={c.code} value={c.code}>
              {c.code} — {c.name}
            </option>
          ))}
        </NativeSelect>
      </Field>
      <label className="flex items-start gap-2.5 text-sm text-fg-muted">
        <input type="checkbox" className="mt-0.5 size-4 accent-[hsl(var(--primary))]" {...form.register('accept')} />
        <span>I understand Owenil only records shared expenses and never transfers money.</span>
      </label>
      {err.accept && <p className="text-xs font-medium text-negative">{err.accept.message}</p>}
      {err.root && (
        <div role="alert" className="rounded-xl bg-negative-soft px-3 py-2.5 text-sm text-negative">
          {err.root.message}
        </div>
      )}
      <Button type="submit" className="w-full" size="lg" loading={form.formState.isSubmitting}>
        Create account
      </Button>
      <p className="text-center text-sm text-fg-muted">
        Already have an account?{' '}
        <Link to="/login" className="font-medium text-primary hover:underline">
          Sign in
        </Link>
      </p>
    </form>
  );
}

function ForgotForm() {
  const [sent, setSent] = React.useState(false);
  useDocumentTitle('Reset password');
  const form = useForm<{ email: string }>({ resolver: zodResolver(z.object({ email: emailSchema })), defaultValues: { email: '' } });
  const onSubmit = form.handleSubmit(async (v) => {
    const { error } = await supabase.auth.resetPasswordForEmail(v.email, { redirectTo: authRedirectUrl('reset-password') });
    if (error && toAppError(error).code === 'over_email_send_rate_limit') {
      form.setError('root', { message: errorMessage(error) });
      return;
    }
    setSent(true); // Always the same response — never reveal whether an account exists.
  });
  if (sent) {
    return (
      <div className="space-y-4 text-center">
        <div className="mx-auto flex size-16 items-center justify-center rounded-2xl bg-primary-soft text-primary">
          <MailCheck className="size-8" />
        </div>
        <h1 className="text-2xl font-semibold">Check your email</h1>
        <p className="text-sm text-fg-muted">If an account exists for that address, a reset link is on its way.</p>
        <Link to="/login" className="block text-sm font-medium text-primary hover:underline">
          Back to sign in
        </Link>
      </div>
    );
  }
  return (
    <form onSubmit={onSubmit} className="space-y-5" noValidate>
      <div>
        <h1 className="text-2xl font-semibold">Forgot your password?</h1>
        <p className="mt-1 text-sm text-fg-muted">We’ll email you a secure link to choose a new one.</p>
      </div>
      <Field label="Email" htmlFor="email" error={form.formState.errors.email?.message}>
        <Input id="email" type="email" autoComplete="email" autoFocus {...form.register('email')} />
      </Field>
      {form.formState.errors.root && <p className="text-sm text-negative">{form.formState.errors.root.message}</p>}
      <Button type="submit" className="w-full" size="lg" loading={form.formState.isSubmitting}>
        Send reset link
      </Button>
      <Link to="/login" className="block text-center text-sm font-medium text-primary hover:underline">
        Back to sign in
      </Link>
    </form>
  );
}

function ResetForm() {
  const { session, loading, clearRecovery } = useAuth();
  const navigate = useNavigate();
  useDocumentTitle('Choose a new password');
  const schema = z.object({ password: passwordSchema, confirm: z.string() }).refine((v) => v.password === v.confirm, { message: 'Passwords do not match', path: ['confirm'] });
  const form = useForm<z.infer<typeof schema>>({ resolver: zodResolver(schema), defaultValues: { password: '', confirm: '' } });
  const onSubmit = form.handleSubmit(async (v) => {
    const { error } = await supabase.auth.updateUser({ password: v.password });
    if (error) {
      form.setError('root', { message: errorMessage(error) });
      return;
    }
    clearRecovery();
    toast.success('Password updated');
    navigate('/dashboard', { replace: true });
  });
  if (loading) return <div className="flex justify-center"><Spinner /></div>;
  if (!session) {
    return (
      <div className="space-y-3 text-center">
        <h1 className="text-2xl font-semibold">Link expired</h1>
        <p className="text-sm text-fg-muted">This password reset link is invalid or has expired. Request a new one.</p>
        <Button asChild>
          <Link to="/forgot-password">Request a new link</Link>
        </Button>
      </div>
    );
  }
  return (
    <form onSubmit={onSubmit} className="space-y-5" noValidate>
      <div>
        <div className="mb-3 flex size-12 items-center justify-center rounded-2xl bg-primary-soft text-primary">
          <ShieldCheck className="size-6" />
        </div>
        <h1 className="text-2xl font-semibold">Choose a new password</h1>
      </div>
      <Field label="New password" htmlFor="password" error={form.formState.errors.password?.message}>
        <PasswordInput id="password" autoComplete="new-password" autoFocus {...form.register('password')} />
      </Field>
      <Field label="Confirm new password" htmlFor="confirm" error={form.formState.errors.confirm?.message}>
        <PasswordInput id="confirm" autoComplete="new-password" {...form.register('confirm')} />
      </Field>
      {form.formState.errors.root && <p className="text-sm text-negative">{form.formState.errors.root.message}</p>}
      <Button type="submit" className="w-full" size="lg" loading={form.formState.isSubmitting}>
        Update password
      </Button>
    </form>
  );
}

function Callback() {
  const { session, loading } = useAuth();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const errorDesc = params.get('error_description') ?? new URLSearchParams(window.location.hash.slice(1)).get('error_description');
  React.useEffect(() => {
    if (!loading && session) {
      navigate(safeNextPath(params.get('next')), { replace: true });
    }
  }, [loading, session, navigate, params]);
  if (errorDesc) {
    return (
      <div className="space-y-3 text-center">
        <h1 className="text-2xl font-semibold">We couldn’t sign you in</h1>
        <p className="text-sm text-fg-muted">{errorDesc}</p>
        <Button asChild>
          <Link to="/login">Go to sign in</Link>
        </Button>
      </div>
    );
  }
  if (!loading && !session) {
    return (
      <div className="space-y-3 text-center">
        <h1 className="text-2xl font-semibold">Almost there</h1>
        <p className="text-sm text-fg-muted">If you opened a verification link in a different browser, or sign-in was cancelled, sign in here to continue.</p>
        <Button asChild>
          <Link to="/login">Sign in</Link>
        </Button>
      </div>
    );
  }
  return (
    <div className="flex flex-col items-center gap-3 text-sm text-fg-muted">
      <Spinner /> Verifying…
    </div>
  );
}
