import { cn, initials } from '@/lib/utils';

const sizes = { xs: 'size-6 text-[10px]', sm: 'size-8 text-xs', md: 'size-10 text-sm', lg: 'size-14 text-lg', xl: 'size-20 text-2xl' };

interface AvatarProps {
  name: string;
  color?: string | null;
  url?: string | null;
  size?: keyof typeof sizes;
  className?: string;
  ring?: boolean;
}

export function Avatar({ name, color, url, size = 'md', className, ring }: AvatarProps) {
  const bg = color ?? '#14b8a6';
  return (
    <span
      className={cn(
        'relative inline-flex shrink-0 select-none items-center justify-center overflow-hidden rounded-full font-semibold text-white',
        ring && 'ring-2 ring-surface',
        sizes[size],
        className,
      )}
      style={{ background: url ? undefined : `linear-gradient(135deg, ${bg}, ${shade(bg)})` }}
      aria-hidden
    >
      {url ? <img src={url} alt="" className="size-full object-cover" referrerPolicy="no-referrer" /> : initials(name)}
    </span>
  );
}

export function AvatarStack({ people, max = 4, size = 'sm' }: { people: { name: string; color?: string | null }[]; max?: number; size?: keyof typeof sizes }) {
  const shown = people.slice(0, max);
  return (
    <span className="flex -space-x-2">
      {shown.map((p, i) => (
        <Avatar key={i} name={p.name} color={p.color} size={size} ring />
      ))}
      {people.length > max && (
        <span className={cn('inline-flex items-center justify-center rounded-full bg-muted font-medium text-fg-muted ring-2 ring-surface', sizes[size])}>
          +{people.length - max}
        </span>
      )}
    </span>
  );
}

function shade(hex: string): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex);
  if (!m) return hex;
  const n = parseInt(m[1]!, 16);
  const f = (c: number) => Math.max(0, Math.round(c * 0.72));
  return `rgb(${f(n >> 16)}, ${f((n >> 8) & 255)}, ${f(n & 255)})`;
}
