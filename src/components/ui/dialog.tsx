import * as React from 'react';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import { AnimatePresence, motion } from 'framer-motion';
import { X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useMediaQuery } from '@/lib/hooks';

interface DialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: React.ReactNode;
  description?: React.ReactNode;
  children: React.ReactNode;
  footer?: React.ReactNode;
  size?: 'sm' | 'md' | 'lg' | 'xl';
  /** Render as a bottom sheet on small screens (default true). */
  sheetOnMobile?: boolean;
}

const sizes = { sm: 'max-w-sm', md: 'max-w-lg', lg: 'max-w-2xl', xl: 'max-w-4xl' };

/** Accessible modal: centred dialog on desktop, bottom sheet on phones. */
export function Dialog({ open, onOpenChange, title, description, children, footer, size = 'md', sheetOnMobile = true }: DialogProps) {
  const isDesktop = useMediaQuery('(min-width: 640px)');
  const sheet = sheetOnMobile && !isDesktop;
  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <AnimatePresence>
        {open && (
          <DialogPrimitive.Portal forceMount>
            <DialogPrimitive.Overlay asChild forceMount>
              <motion.div
                className="fixed inset-0 z-50 bg-[hsl(232_40%_4%/0.5)] backdrop-blur-sm"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.18 }}
              />
            </DialogPrimitive.Overlay>
            <DialogPrimitive.Content asChild forceMount>
              <motion.div
                className={cn(
                  'fixed z-50 flex max-h-[92dvh] w-full flex-col bg-elevated/[0.96] shadow-lift ring-1 ring-white/60 backdrop-blur-2xl focus:outline-none dark:ring-white/10',
                  sheet ? 'inset-x-0 bottom-0 rounded-t-[32px] safe-bottom' : cn('left-1/2 top-1/2 rounded-[28px]', sizes[size]),
                )}
                initial={sheet ? { y: '100%' } : { opacity: 0, scale: 0.96, x: '-50%', y: '-46%' }}
                animate={sheet ? { y: 0 } : { opacity: 1, scale: 1, x: '-50%', y: '-50%' }}
                exit={sheet ? { y: '100%' } : { opacity: 0, scale: 0.97, x: '-50%', y: '-48%' }}
                transition={{ type: 'spring', damping: 32, stiffness: 380 }}
              >
                {sheet && <div aria-hidden className="mx-auto mt-2.5 h-1.5 w-11 rounded-full bg-fg/15" />}
                <div className="flex items-start justify-between gap-4 px-5 pb-2 pt-4 sm:px-6 sm:pt-5">
                  <div className="space-y-1">
                    <DialogPrimitive.Title className="font-display text-xl font-semibold tracking-tight">{title}</DialogPrimitive.Title>
                    <DialogPrimitive.Description className={description ? 'text-sm text-fg-muted' : 'sr-only'}>
                      {description ?? (typeof title === 'string' ? title : 'Dialog')}
                    </DialogPrimitive.Description>
                  </div>
                  <DialogPrimitive.Close className="-mr-1 flex size-9 shrink-0 items-center justify-center rounded-full bg-fg/[0.06] text-fg-muted transition-colors hover:bg-fg/[0.1] hover:text-fg" aria-label="Close">
                    <X className="size-4" />
                  </DialogPrimitive.Close>
                </div>
                <div className="scrollbar-thin flex-1 overflow-y-auto px-5 pb-5 sm:px-6">{children}</div>
                {footer && <div className="flex flex-col-reverse gap-2 border-t border-border px-5 py-4 sm:flex-row sm:justify-end sm:px-6">{footer}</div>}
              </motion.div>
            </DialogPrimitive.Content>
          </DialogPrimitive.Portal>
        )}
      </AnimatePresence>
    </DialogPrimitive.Root>
  );
}

interface ConfirmProps {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  title: string;
  description: React.ReactNode;
  confirmLabel?: string;
  destructive?: boolean;
  loading?: boolean;
  confirmDisabled?: boolean;
  onConfirm: () => void;
  children?: React.ReactNode;
}

export function ConfirmDialog({ open, onOpenChange, title, description, confirmLabel = 'Confirm', destructive, loading, confirmDisabled, onConfirm, children }: ConfirmProps) {
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={title}
      description={description}
      size="sm"
      footer={
        <>
          <button
            type="button"
            className="inline-flex h-11 items-center justify-center rounded-full bg-surface/70 px-5 text-sm font-semibold ring-1 ring-inset ring-border transition-colors hover:bg-fg/[0.05]"
            onClick={() => onOpenChange(false)}
            disabled={loading}
          >
            Cancel
          </button>
          <button
            type="button"
            className={cn(
              'inline-flex h-10 items-center justify-center gap-2 rounded-lg px-4 text-sm font-medium text-white transition hover:brightness-110 disabled:opacity-50',
              destructive ? 'bg-negative' : 'bg-primary text-primary-fg',
            )}
            onClick={onConfirm}
            disabled={loading || confirmDisabled}
            aria-busy={loading || undefined}
          >
            {loading ? 'Working…' : confirmLabel}
          </button>
        </>
      }
    >
      {children}
    </Dialog>
  );
}
