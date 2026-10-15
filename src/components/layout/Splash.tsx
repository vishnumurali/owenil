import { motion } from 'framer-motion';
import { LogoMark } from '@/components/brand/Logo';

export function FullPageSpinner() {
  return (
    <div className="aurora flex min-h-dvh items-center justify-center" role="status" aria-label="Loading Owenil">
      <motion.div
        initial={{ opacity: 0, scale: 0.9 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 0.4, ease: [0.16, 1, 0.3, 1] }}
        className="flex flex-col items-center gap-4"
      >
        <motion.div animate={{ rotate: [0, 0, 180, 180, 360] }} transition={{ duration: 2.4, repeat: Infinity, ease: 'easeInOut' }}>
          <LogoMark className="size-12" />
        </motion.div>
      </motion.div>
    </div>
  );
}

/** Shown when the build has no Supabase configuration (never fakes a working app). */
export function SetupRequired() {
  return (
    <div className="aurora flex min-h-dvh items-center justify-center p-6">
      <div className="max-w-lg tile rounded-[22px] p-8">
        <LogoMark className="mb-5 size-12" />
        <h1 className="text-2xl font-semibold">Owenil needs a database connection</h1>
        <p className="mt-2 text-sm text-fg-muted">
          This build was created without Supabase settings, so nothing can be saved yet. Add these to <code className="rounded bg-fg/[0.06] px-1">.env.local</code> and rebuild:
        </p>
        <pre className="mt-4 overflow-x-auto rounded-xl bg-fg/[0.06] p-4 text-xs">
          VITE_SUPABASE_URL=https://your-ref.supabase.co{'\n'}VITE_SUPABASE_PUBLISHABLE_KEY=sb_publishable_…
        </pre>
        <p className="mt-4 text-sm text-fg-muted">See README → “Supabase setup”.</p>
      </div>
    </div>
  );
}
