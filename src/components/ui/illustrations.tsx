/**
 * Original Owenil illustrations (inline SVG, theme-aware via currentColor &
 * CSS variables). Simple geometric scenes: coins, receipts, people dots.
 */
type IllustrationName = 'groups' | 'expenses' | 'friends' | 'balanced' | 'activity' | 'chart' | 'notifications' | 'recurring' | 'error' | 'receipt';

const P = 'hsl(var(--primary))';
const A = 'hsl(var(--accent))';
const M = 'hsl(var(--muted))';
const B = 'hsl(var(--border))';
const S = 'hsl(var(--surface))';
const F = 'hsl(var(--fg-subtle))';

export function Illustration({ name, className }: { name: IllustrationName; className?: string }) {
  return (
    <svg viewBox="0 0 200 140" className={className} aria-hidden fill="none">
      <ellipse cx="100" cy="124" rx="70" ry="8" fill={M} />
      {scenes[name]}
    </svg>
  );
}

const coin = (cx: number, cy: number, r: number, c = P) => (
  <g>
    <circle cx={cx} cy={cy} r={r} fill={c} opacity=".9" />
    <path d={`M${cx - 1} ${cy - r * 0.62} A${r * 0.62} ${r * 0.62} 0 0 0 ${cx - 1} ${cy + r * 0.62} Z`} fill={S} />
    <path d={`M${cx + 1.5} ${cy - r * 0.5} A${r * 0.62} ${r * 0.62} 0 0 1 ${cx + 1.5} ${cy + r * 0.74} Z`} fill={S} opacity=".7" />
  </g>
);

const person = (cx: number, cy: number, c: string) => (
  <g>
    <circle cx={cx} cy={cy - 14} r="9" fill={c} />
    <path d={`M${cx - 15} ${cy + 14} q15 -26 30 0`} fill={c} opacity=".85" />
  </g>
);

const scenes: Record<IllustrationName, JSX.Element> = {
  groups: (
    <g>
      <rect x="40" y="34" width="120" height="78" rx="16" fill={S} stroke={B} strokeWidth="2" />
      {person(78, 76, P)}
      {person(100, 70, A)}
      {person(122, 76, F)}
      <circle cx="152" cy="34" r="12" fill={P} />
      <path d="M152 28v12M146 34h12" stroke={S} strokeWidth="3" strokeLinecap="round" />
    </g>
  ),
  expenses: (
    <g>
      <path d="M62 22h76v92l-9.5-6-9.5 6-9.5-6-9.5 6-9.5-6-9.5 6-9.5-6-9.5 6z" fill={S} stroke={B} strokeWidth="2" />
      <rect x="74" y="38" width="40" height="6" rx="3" fill={M} />
      <rect x="74" y="52" width="52" height="6" rx="3" fill={M} />
      <rect x="74" y="66" width="30" height="6" rx="3" fill={M} />
      <rect x="74" y="86" width="52" height="8" rx="4" fill={P} opacity=".35" />
      {coin(148, 92, 16)}
    </g>
  ),
  friends: (
    <g>
      {person(80, 84, P)}
      {person(120, 84, A)}
      <path d="M92 50c4-8 12-8 16 0" stroke={P} strokeWidth="3" strokeLinecap="round" />
      <circle cx="100" cy="36" r="10" fill={S} stroke={B} strokeWidth="2" />
      <path d="M96 36l3 3 5-6" stroke={P} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
    </g>
  ),
  balanced: (
    <g>
      <path d="M100 30v74" stroke={F} strokeWidth="3" strokeLinecap="round" />
      <path d="M60 52h80" stroke={F} strokeWidth="3" strokeLinecap="round" />
      <path d="M60 52l-14 30h28z" fill={M} stroke={B} strokeWidth="2" />
      <path d="M140 52l-14 30h28z" fill={M} stroke={B} strokeWidth="2" />
      {coin(60, 72, 9)}
      {coin(140, 72, 9, A)}
      <rect x="84" y="104" width="32" height="8" rx="4" fill={F} />
    </g>
  ),
  activity: (
    <g>
      <rect x="50" y="26" width="100" height="22" rx="11" fill={S} stroke={B} strokeWidth="2" />
      <rect x="50" y="56" width="100" height="22" rx="11" fill={S} stroke={B} strokeWidth="2" />
      <rect x="50" y="86" width="100" height="22" rx="11" fill={S} stroke={B} strokeWidth="2" />
      <circle cx="62" cy="37" r="5" fill={P} />
      <circle cx="62" cy="67" r="5" fill={A} />
      <circle cx="62" cy="97" r="5" fill={F} />
      <rect x="74" y="34" width="50" height="6" rx="3" fill={M} />
      <rect x="74" y="64" width="40" height="6" rx="3" fill={M} />
      <rect x="74" y="94" width="58" height="6" rx="3" fill={M} />
    </g>
  ),
  chart: (
    <g>
      <rect x="44" y="24" width="112" height="90" rx="14" fill={S} stroke={B} strokeWidth="2" />
      <rect x="62" y="74" width="14" height="28" rx="4" fill={M} />
      <rect x="84" y="58" width="14" height="44" rx="4" fill={A} opacity=".6" />
      <rect x="106" y="44" width="14" height="58" rx="4" fill={P} />
      <rect x="128" y="64" width="14" height="38" rx="4" fill={M} />
      <path d="M62 50l24-12 22 8 30-14" stroke={P} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
    </g>
  ),
  notifications: (
    <g>
      <path d="M100 28c-18 0-28 14-28 30v20l-8 12h72l-8-12V58c0-16-10-30-28-30z" fill={S} stroke={B} strokeWidth="2" />
      <circle cx="100" cy="100" r="7" fill={P} />
      <circle cx="128" cy="36" r="9" fill={A} />
    </g>
  ),
  recurring: (
    <g>
      <rect x="54" y="30" width="92" height="80" rx="14" fill={S} stroke={B} strokeWidth="2" />
      <rect x="54" y="30" width="92" height="20" rx="10" fill={P} opacity=".85" />
      <path d="M86 84a16 16 0 1 0 2-20" stroke={A} strokeWidth="4" strokeLinecap="round" />
      <path d="M84 56v10h10" stroke={A} strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" />
    </g>
  ),
  error: (
    <g>
      <circle cx="100" cy="68" r="40" fill={S} stroke={B} strokeWidth="2" />
      <path d="M84 56l32 26M116 56L84 82" stroke="hsl(var(--negative))" strokeWidth="5" strokeLinecap="round" />
    </g>
  ),
  receipt: (
    <g>
      <path d="M70 18h60v96l-7.5-5-7.5 5-7.5-5-7.5 5-7.5-5-7.5 5-7.5-5-7.5 5z" fill={S} stroke={B} strokeWidth="2" />
      <path d="M82 40h36M82 54h36M82 68h24" stroke={M} strokeWidth="6" strokeLinecap="round" />
      <circle cx="140" cy="42" r="14" fill={A} />
      <path d="M134 42h12M140 36v12" stroke={S} strokeWidth="3" strokeLinecap="round" />
    </g>
  ),
};
