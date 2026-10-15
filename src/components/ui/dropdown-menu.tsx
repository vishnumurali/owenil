import * as DM from '@radix-ui/react-dropdown-menu';
import { cn } from '@/lib/utils';

export const DropdownMenu = DM.Root;
export const DropdownMenuTrigger = DM.Trigger;

export function DropdownMenuContent({ className, align = 'end', ...props }: DM.DropdownMenuContentProps) {
  return (
    <DM.Portal>
      <DM.Content
        align={align}
        sideOffset={6}
        className={cn('z-50 min-w-[210px] overflow-hidden rounded-[20px] bg-elevated/95 p-1.5 shadow-lift ring-1 ring-border/70 backdrop-blur-xl data-[state=open]:animate-pop-in dark:ring-white/10', className)}
        {...props}
      />
    </DM.Portal>
  );
}

export function DropdownMenuItem({ className, destructive, ...props }: DM.DropdownMenuItemProps & { destructive?: boolean }) {
  return (
    <DM.Item
      className={cn(
        'flex cursor-pointer select-none items-center gap-2.5 rounded-[14px] px-3 py-2.5 text-sm font-medium outline-none transition-colors data-[disabled]:pointer-events-none data-[highlighted]:bg-fg/[0.06] data-[disabled]:opacity-50 [&_svg]:size-4',
        destructive ? 'text-negative data-[highlighted]:bg-negative-soft' : 'text-fg',
        className,
      )}
      {...props}
    />
  );
}

export function DropdownMenuLabel({ className, ...props }: DM.DropdownMenuLabelProps) {
  return <DM.Label className={cn('px-2.5 py-1.5 text-xs font-medium text-fg-subtle', className)} {...props} />;
}

export function DropdownMenuSeparator({ className, ...props }: DM.DropdownMenuSeparatorProps) {
  return <DM.Separator className={cn('my-1 h-px bg-border', className)} {...props} />;
}
