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
    <div role="radiogroup" aria-label={ariaLabel} className={cn('inline-flex max-w-full overflow-x-auto rounded-full bg-surface p-1 shadow-tile ring-1 ring-border/60 scrollbar-thin [scrollbar-width:none]', className)}>
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
              'relative flex-1 whitespace-nowrap rounded-full font-medium transition-colors disabled:opacity-40',
              size === 'sm' ? 'px-2 py-1.5 text-xs' : 'px-3.5 py-1.5 text-sm',
              active ? 'text-ink-fg' : 'text-fg-muted hover:text-fg',
            )}
          >
            {active && (
              <motion.span layoutId={`seg-${id}`} className="absolute inset-0 rounded-full bg-ink shadow-sm" transition={{ type: 'spring', stiffness: 500, damping: 38 }} />
            )}
            <span className="relative z-10 inline-flex items-center gap-1.5">{o.label}</span>
          </button>
        );
      })}
    </div>
  );
}
