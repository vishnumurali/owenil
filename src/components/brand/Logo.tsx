import { useId } from 'react';
import { cn } from '@/lib/utils';

/** Owenil mark: a coin split into two balanced halves. */
export function LogoMark({ className, title = 'Owenil' }: { className?: string; title?: string }) {
  const id = useId();
  return (
    <svg viewBox="0 0 64 64" className={cn('size-8', className)} role="img" aria-label={title}>
      <defs>
        <linearGradient id={`g${id}`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#34d399" />
          <stop offset=".55" stopColor="#14b8a6" />
          <stop offset="1" stopColor="#0ea5e9" />
        </linearGradient>
      </defs>
      <rect width="64" height="64" rx="16" fill={`url(#g${id})`} />
      <path d="M30 13 A18 18 0 0 0 30 47 Z" fill="#fff" />
      <path d="M34 17 A18 18 0 0 1 34 51 Z" fill="#fff" fillOpacity=".72" />
    </svg>
  );
}

export function Logo({ className, compact = false }: { className?: string; compact?: boolean }) {
  return (
    <span className={cn('inline-flex items-center gap-2.5', className)}>
      <LogoMark className="size-8 drop-shadow-sm" />
      {!compact && <span className="font-display text-[1.15rem] font-semibold tracking-tight">Owenil</span>}
    </span>
  );
}
