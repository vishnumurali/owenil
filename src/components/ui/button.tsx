import * as React from 'react';
import { Slot } from '@radix-ui/react-slot';
import { cva, type VariantProps } from 'class-variance-authority';
import { Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';

const buttonVariants = cva(
  'relative inline-flex select-none items-center justify-center gap-2 whitespace-nowrap rounded-full font-medium transition-[background-color,color,box-shadow,transform,opacity,filter] duration-150 ease-out-expo active:scale-[0.97] disabled:pointer-events-none disabled:opacity-50 [&_svg]:size-4 [&_svg]:shrink-0',
  {
    variants: {
      variant: {
        primary: 'bg-primary text-primary-fg shadow-sm hover:brightness-110 hover:shadow-glow',
        ink: 'bg-ink text-ink-fg shadow-sm hover:brightness-125',
        secondary: 'bg-muted text-fg hover:bg-muted/70',
        outline: 'bg-surface text-fg ring-1 ring-inset ring-border hover:bg-muted/60',
        ghost: 'text-fg-muted hover:bg-muted hover:text-fg',
        danger: 'bg-negative text-white hover:brightness-110',
        'danger-ghost': 'text-negative hover:bg-negative-soft',
        plus: 'bg-gradient-to-r from-plus to-accent text-white shadow-sm hover:brightness-110',
        link: 'h-auto rounded-md px-0 text-primary underline-offset-4 hover:underline active:scale-100',
      },
      size: {
        sm: 'h-8 px-3.5 text-sm',
        md: 'h-10 px-5 text-sm',
        lg: 'h-12 px-7 text-base',
        icon: 'size-10',
        'icon-sm': 'size-8',
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
