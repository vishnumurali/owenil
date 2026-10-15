import * as React from 'react';
import { Slot } from '@radix-ui/react-slot';
import { cva, type VariantProps } from 'class-variance-authority';
import { Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';

const buttonVariants = cva(
  'relative inline-flex select-none items-center justify-center gap-2 whitespace-nowrap rounded-full font-semibold tracking-[-0.01em] transition-[background-color,color,box-shadow,transform,opacity,filter] duration-200 ease-out-expo active:scale-[0.96] disabled:pointer-events-none disabled:opacity-50 [&_svg]:size-4 [&_svg]:shrink-0',
  {
    variants: {
      variant: {
        primary: 'bg-primary-gradient text-primary-fg shadow-glow hover:brightness-110',
        ink: 'bg-ink text-ink-fg shadow-sm hover:brightness-125',
        secondary: 'bg-fg/[0.06] text-fg hover:bg-fg/[0.1]',
        outline: 'bg-surface/70 text-fg ring-1 ring-inset ring-border hover:bg-surface hover:ring-fg-subtle/40 dark:bg-white/[0.04] dark:hover:bg-white/[0.08]',
        ghost: 'text-fg-muted hover:bg-fg/[0.06] hover:text-fg',
        danger: 'bg-negative text-white shadow-sm hover:brightness-110',
        'danger-ghost': 'text-negative hover:bg-negative-soft',
        plus: 'bg-gradient-to-r from-plus to-accent text-white shadow-glow-accent hover:brightness-110',
        link: 'h-auto rounded-md px-0 text-primary underline-offset-4 hover:underline active:scale-100',
      },
      size: {
        sm: 'h-9 px-4 text-[13px]',
        md: 'h-11 px-5 text-sm',
        lg: 'h-12 px-7 text-[15px]',
        icon: 'size-10',
        'icon-sm': 'size-9',
      },
    },
    defaultVariants: { variant: 'primary', size: 'md' },
  },
);

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof buttonVariants> {
  asChild?: boolean;
  loading?: boolean;
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, loading = false, disabled, children, ...props }, ref) => {
    const Comp = asChild ? Slot : 'button';
    return (
      <Comp
        ref={ref}
        className={cn(buttonVariants({ variant, size }), className)}
        disabled={asChild ? undefined : disabled || loading}
        aria-busy={loading || undefined}
        {...props}
      >
        {asChild ? (
          children
        ) : (
          <>
            {loading && <Loader2 className="animate-spin" aria-hidden />}
            {children}
          </>
        )}
      </Comp>
    );
  },
);
Button.displayName = 'Button';
export { buttonVariants };
