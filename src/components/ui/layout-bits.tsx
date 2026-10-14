import * as React from 'react';
import { motion, type Variants } from 'framer-motion';
import { AlertTriangle, RefreshCw } from 'lucide-react';
import { cn } from '@/lib/utils';
import { errorMessage } from '@/lib/errors';
import { Illustration } from './illustrations';
import { Button } from './button';

export function PageHeader({
  title,
  description,
  actions,
  back,
  className,
}: {
  title: React.ReactNode;
  description?: React.ReactNode;
  actions?: React.ReactNode;
  back?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('mb-4 flex flex-col gap-3 sm:mb-6 sm:flex-row sm:items-end sm:justify-between', className)}>
      <div className="min-w-0 space-y-0.5">
        {back}
        <h1 className="truncate text-[1.45rem] font-semibold leading-tight sm:text-[1.9rem]">{title}</h1>
        {description && <p className="line-clamp-1 text-xs text-fg-muted sm:line-clamp-2 sm:text-sm">{description}</p>}
      </div>
      {actions && (
        <div className="-mx-4 flex items-center gap-2 overflow-x-auto px-4 pb-0.5 [scrollbar-width:none] sm:mx-0 sm:flex-wrap sm:overflow-visible sm:px-0 sm:pb-0">
          {actions}
        </div>
      )}
    </div>
  );
}

/**
 * A page that fits the screen: a fixed top part and a body that scrolls on its
 * own (lists), instead of the whole page scrolling. AppShell gives the page
 * the full height of the visible area when its first element is a FitScreen.
 */
export function FitScreen({ className, children }: { className?: string; children: React.ReactNode }) {
  return <div className={cn('fit-screen flex min-h-0 flex-1 flex-col', className)}>{children}</div>;
}

/** The scrolling part of a FitScreen; leaves room for the floating dock on phones. */
export function FitBody({ className, children }: { className?: string; children: React.ReactNode }) {
  return (
    <div className={cn('scrollbar-thin -mx-4 min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 pb-28 sm:-mx-6 sm:px-6 lg:mx-0 lg:px-0 lg:pb-8', className)}>
      {children}
    </div>
  );
}

export function EmptyState({
  illustration = 'expenses',
  title,
  description,
  action,
  className,
}: {
  illustration?: React.ComponentProps<typeof Illustration>['name'];
  title: string;
  description?: React.ReactNode;
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('flex flex-col items-center justify-center px-6 py-12 text-center', className)}>
      <Illustration name={illustration} className="mb-4 h-28 w-40" />
      <h3 className="text-base font-semibold">{title}</h3>
      {description && <p className="mt-1 max-w-sm text-sm text-fg-muted">{description}</p>}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}

export function ErrorState({ error, onRetry, className }: { error: unknown; onRetry?: () => void; className?: string }) {
  return (
    <div role="alert" className={cn('flex flex-col items-center justify-center rounded-2xl border border-dashed border-border px-6 py-10 text-center', className)}>
      <AlertTriangle className="mb-3 size-8 text-negative" />
      <h3 className="font-semibold">We couldn’t load this</h3>
      <p className="mt-1 max-w-sm text-sm text-fg-muted">{errorMessage(error)}</p>
      {onRetry && (
        <Button variant="outline" size="sm" className="mt-4" onClick={onRetry}>
          <RefreshCw /> Try again
        </Button>
      )}
    </div>
  );
}

export const staggerContainer: Variants = {
  hidden: {},
  show: { transition: { staggerChildren: 0.055, delayChildren: 0.04 } },
};

export const staggerItem: Variants = {
  hidden: { opacity: 0, y: 12 },
  show: { opacity: 1, y: 0, transition: { duration: 0.42, ease: [0.16, 1, 0.3, 1] } },
};

export function Stagger({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <motion.div variants={staggerContainer} initial="hidden" animate="show" className={className}>
      {children}
    </motion.div>
  );
}

export function StaggerItem({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <motion.div variants={staggerItem} className={className}>
      {children}
    </motion.div>
  );
}

export function SectionTitle({ children, action, className }: { children: React.ReactNode; action?: React.ReactNode; className?: string }) {
  return (
    <div className={cn('mb-3 flex items-center justify-between gap-2', className)}>
      <h2 className="text-sm font-semibold uppercase tracking-wider text-fg-subtle">{children}</h2>
      {action}
    </div>
  );
}
