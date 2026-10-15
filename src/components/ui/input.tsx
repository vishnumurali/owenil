import * as React from 'react';
import { cn } from '@/lib/utils';

export const inputClass =
  // 16px text on phones, so iPhone Safari doesn't zoom into a field when it's focused.
  'flex h-11 w-full rounded-2xl border-0 bg-surface/80 px-4 text-base text-fg ring-1 ring-inset ring-border transition-[box-shadow,background-color] placeholder:text-fg-subtle hover:ring-fg-subtle/40 focus-visible:bg-surface focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/60 focus-visible:ring-offset-0 disabled:cursor-not-allowed disabled:opacity-60 aria-[invalid=true]:ring-2 aria-[invalid=true]:ring-negative/60 dark:bg-white/[0.04] dark:focus-visible:bg-white/[0.07] sm:text-sm';

export const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(({ className, ...props }, ref) => (
  <input ref={ref} className={cn(inputClass, className)} {...props} />
));
Input.displayName = 'Input';

export const Textarea = React.forwardRef<HTMLTextAreaElement, React.TextareaHTMLAttributes<HTMLTextAreaElement>>(({ className, ...props }, ref) => (
  <textarea ref={ref} className={cn(inputClass, 'h-auto min-h-[88px] py-3', className)} {...props} />
));
Textarea.displayName = 'Textarea';

export const NativeSelect = React.forwardRef<HTMLSelectElement, React.SelectHTMLAttributes<HTMLSelectElement>>(({ className, children, ...props }, ref) => (
  <div className="relative">
    <select ref={ref} className={cn(inputClass, 'appearance-none pr-10', className)} {...props}>
      {children}
    </select>
    <svg aria-hidden viewBox="0 0 20 20" className="pointer-events-none absolute right-3.5 top-1/2 size-4 -translate-y-1/2 text-fg-subtle">
      <path d="m5 8 5 5 5-5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  </div>
));
NativeSelect.displayName = 'NativeSelect';

export function Label({ className, ...props }: React.LabelHTMLAttributes<HTMLLabelElement>) {
  return <label className={cn('text-[13px] font-semibold text-fg', className)} {...props} />;
}

interface FieldProps {
  label?: React.ReactNode;
  htmlFor?: string;
  error?: string;
  hint?: React.ReactNode;
  className?: string;
  children: React.ReactNode;
  optional?: boolean;
}

export function Field({ label, htmlFor, error, hint, className, children, optional }: FieldProps) {
  return (
    <div className={cn('space-y-1.5', className)}>
      {label && (
        <Label htmlFor={htmlFor} className="flex items-center gap-1.5">
          {label}
          {optional && <span className="text-xs font-normal text-fg-subtle">optional</span>}
        </Label>
      )}
      {children}
      {error ? (
        <p role="alert" className="text-xs font-medium text-negative">
          {error}
        </p>
      ) : hint ? (
        <p className="text-xs text-fg-subtle">{hint}</p>
      ) : null}
    </div>
  );
}
