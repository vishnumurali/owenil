import * as React from 'react';
import { motion } from 'framer-motion';
import { cn } from '@/lib/utils';

interface SegmentedProps<T extends string> {
  value: T;
  onChange: (v: T) => void;
  options: { value: T; label: React.ReactNode; disabled?: boolean }[];
  className?: string;
  size?: 'sm' | 'md';
  ariaLabel?: string;
}

/** Pill-style segmented control with an animated selection indicator. */
export function Segmented<T extends string>({ value, onChange, options, className, size = 'md', ariaLabel }: SegmentedProps<T>) {
  const id = React.useId();
  return (
    <div role="radiogroup" aria-label={ariaLabel} className={cn('scrollbar-none inline-flex max-w-full overflow-x-auto rounded-full bg-fg/[0.06] p-1 ring-1 ring-inset ring-fg/[0.04]', className)}>
      {options.map((o) => {
        const active = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={active}
            disabled={o.disabled}
            onClick={() => onChange(o.value)}
            className={cn(
              'relative flex-1 whitespace-nowrap rounded-full font-semibold transition-colors disabled:opacity-40',
              size === 'sm' ? 'px-2 py-1.5 text-xs' : 'px-3.5 py-1.5 text-sm',
              active ? 'text-fg' : 'text-fg-muted hover:text-fg',
            )}
          >
            {active && (
              <motion.span layoutId={`seg-${id}`} className="absolute inset-0 rounded-full bg-surface shadow-[0_1px_2px_hsl(var(--shadow)/0.12),0_6px_16px_-6px_hsl(var(--shadow)/0.35)] dark:bg-white/[0.14]" transition={{ type: 'spring', stiffness: 520, damping: 38 }} />
            )}
            <span className="relative z-10 inline-flex items-center gap-1.5">{o.label}</span>
          </button>
        );
      })}
    </div>
  );
}
