import { useEffect, useRef, useState } from 'react';
import { animate } from 'framer-motion';
import { formatMoney } from '@owenil/core';
import { cn } from '@/lib/utils';
import { usePrefersReducedMotion } from '@/lib/hooks';

interface MoneyProps {
  amountMinor: number;
  currency: string;
  className?: string;
  /** Colour by sign: positive = owed to you, negative = you owe. */
  tone?: 'auto' | 'none';
  signDisplay?: 'auto' | 'always' | 'exceptZero' | 'never';
  trim?: boolean;
}

export function Money({ amountMinor, currency, className, tone = 'none', signDisplay = 'auto', trim }: MoneyProps) {
  const color = tone === 'auto' ? (amountMinor > 0 ? 'text-positive' : amountMinor < 0 ? 'text-negative' : 'text-fg-muted') : '';
  return <span className={cn('tabular', color, className)}>{formatMoney(amountMinor, currency, { signDisplay, trimZeroFraction: trim })}</span>;
}

/** Counts smoothly from the previous value to the new one (respects reduced motion). */
export function AnimatedMoney({ amountMinor, currency, className, tone = 'none', signDisplay = 'auto' }: MoneyProps) {
  const reduce = usePrefersReducedMotion();
  const [display, setDisplay] = useState(reduce ? amountMinor : 0);
  const prev = useRef(reduce ? amountMinor : 0);
  useEffect(() => {
    if (reduce) {
      setDisplay(amountMinor);
      prev.current = amountMinor;
      return;
    }
    const controls = animate(prev.current, amountMinor, {
      duration: 0.9,
      ease: [0.16, 1, 0.3, 1],
      onUpdate: (v) => setDisplay(Math.round(v)),
    });
    prev.current = amountMinor;
    return () => controls.stop();
  }, [amountMinor, reduce]);
  const color = tone === 'auto' ? (amountMinor > 0 ? 'text-positive' : amountMinor < 0 ? 'text-negative' : 'text-fg-muted') : '';
  return (
    <span className={cn('tabular', color, className)} aria-label={formatMoney(amountMinor, currency, { signDisplay })}>
      <span aria-hidden>{formatMoney(display, currency, { signDisplay })}</span>
    </span>
  );
}
