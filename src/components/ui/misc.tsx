import * as React from 'react';
import * as SwitchPrimitive from '@radix-ui/react-switch';
import * as CheckboxPrimitive from '@radix-ui/react-checkbox';
import * as TooltipPrimitive from '@radix-ui/react-tooltip';
import { Check } from 'lucide-react';
import { cn } from '@/lib/utils';

export const Switch = React.forwardRef<HTMLButtonElement, SwitchPrimitive.SwitchProps>(({ className, ...props }, ref) => (
  <SwitchPrimitive.Root
    ref={ref}
    className={cn(
      'peer inline-flex h-7 w-12 shrink-0 cursor-pointer items-center rounded-full border-2 border-transparent bg-fg/15 transition-colors data-[state=checked]:bg-primary disabled:cursor-not-allowed disabled:opacity-50',
      className,
    )}
    {...props}
  >
    <SwitchPrimitive.Thumb className="pointer-events-none block size-6 rounded-full bg-white shadow-[0_2px_6px_hsl(var(--shadow)/0.3)] transition-transform duration-300 ease-out-expo data-[state=checked]:translate-x-5" />
  </SwitchPrimitive.Root>
));
Switch.displayName = 'Switch';

export const Checkbox = React.forwardRef<HTMLButtonElement, CheckboxPrimitive.CheckboxProps>(({ className, ...props }, ref) => (
  <CheckboxPrimitive.Root
    ref={ref}
    className={cn(
      'peer size-5 shrink-0 rounded-[7px] border border-fg-subtle/50 bg-surface transition-colors data-[state=checked]:border-primary data-[state=checked]:bg-primary data-[state=checked]:text-primary-fg',
      className,
    )}
    {...props}
  >
    <CheckboxPrimitive.Indicator className="flex items-center justify-center">
      <Check className="size-3.5" strokeWidth={3} />
    </CheckboxPrimitive.Indicator>
  </CheckboxPrimitive.Root>
));
Checkbox.displayName = 'Checkbox';

export function Tooltip({ content, children }: { content: React.ReactNode; children: React.ReactElement }) {
  return (
    <TooltipPrimitive.Provider delayDuration={250}>
      <TooltipPrimitive.Root>
        <TooltipPrimitive.Trigger asChild>{children}</TooltipPrimitive.Trigger>
        <TooltipPrimitive.Portal>
          <TooltipPrimitive.Content sideOffset={6} className="z-50 max-w-xs animate-fade-in rounded-xl bg-fg px-3 py-1.5 text-xs font-medium text-bg shadow-lift">
            {content}
          </TooltipPrimitive.Content>
        </TooltipPrimitive.Portal>
      </TooltipPrimitive.Root>
    </TooltipPrimitive.Provider>
  );
}

const badgeTones = {
  neutral: 'bg-fg/[0.07] text-fg-muted',
  primary: 'bg-primary-soft text-primary',
  positive: 'bg-positive-soft text-positive',
  negative: 'bg-negative-soft text-negative',
  warning: 'bg-warning-soft text-warning',
  plus: 'bg-plus-soft text-plus',
  accent: 'bg-accent-soft text-accent',
};

export function Badge({ tone = 'neutral', className, ...props }: React.HTMLAttributes<HTMLSpanElement> & { tone?: keyof typeof badgeTones }) {
  return <span className={cn('inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[11px] font-semibold [&_svg]:size-3', badgeTones[tone], className)} {...props} />;
}

export function Skeleton({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={cn('relative overflow-hidden rounded-xl bg-fg/[0.06]', className)} aria-hidden {...props}>
      <div className="absolute inset-0 -translate-x-full animate-shimmer bg-gradient-to-r from-transparent via-surface/50 to-transparent" />
    </div>
  );
}

export function Progress({ value, tone = 'primary', className, label }: { value: number; tone?: 'primary' | 'warning' | 'negative' | 'positive'; className?: string; label?: string }) {
  const color = { primary: 'bg-primary', warning: 'bg-warning', negative: 'bg-negative', positive: 'bg-positive' }[tone];
  return (
    <div
      className={cn('h-2 w-full overflow-hidden rounded-full bg-fg/[0.08]', className)}
      role="progressbar"
      aria-label={label}
      aria-valuenow={Math.round(value)}
      aria-valuemin={0}
      aria-valuemax={100}
    >
      <div className={cn('h-full rounded-full transition-[width] duration-700 ease-out-expo', color)} style={{ width: `${Math.min(100, Math.max(0, value))}%` }} />
    </div>
  );
}

export function Spinner({ className }: { className?: string }) {
  return <span className={cn('inline-block size-5 animate-spin rounded-full border-2 border-fg/15 border-t-primary', className)} role="status" aria-label="Loading" />;
}
