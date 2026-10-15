/** @type {import('tailwindcss').Config} */
// Owenil design tokens. Colours are CSS variables (see src/index.css) so the
// light/dark themes swap without re-rendering components.
const v = (name) => `hsl(var(--${name}) / <alpha-value>)`;

export default {
  darkMode: ['class'],
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    container: { center: true, padding: '1rem', screens: { '2xl': '1280px' } },
    extend: {
      colors: {
        bg: v('bg'),
        canvas: v('canvas'),
        ink: { DEFAULT: v('ink'), fg: v('ink-fg'), muted: v('ink-muted') },
        surface: v('surface'),
        elevated: v('elevated'),
        muted: v('muted'),
        border: v('border'),
        ring: v('ring'),
        fg: v('fg'),
        'fg-muted': v('fg-muted'),
        'fg-subtle': v('fg-subtle'),
        primary: { DEFAULT: v('primary'), fg: v('primary-fg'), soft: v('primary-soft') },
        accent: { DEFAULT: v('accent'), soft: v('accent-soft') },
        positive: { DEFAULT: v('positive'), soft: v('positive-soft') },
        negative: { DEFAULT: v('negative'), soft: v('negative-soft') },
        warning: { DEFAULT: v('warning'), soft: v('warning-soft') },
        plus: { DEFAULT: v('plus'), soft: v('plus-soft') },
      },
      fontFamily: {
        sans: ['"Geist Variable"', 'Geist', 'system-ui', '-apple-system', 'Segoe UI', 'Roboto', 'sans-serif'],
        display: ['"Geist Variable"', 'Geist', 'system-ui', '-apple-system', 'Segoe UI', 'Roboto', 'sans-serif'],
      },
      fontSize: {
        '2xs': ['0.6875rem', { lineHeight: '1rem' }],
      },
      borderRadius: {
        sm: 'calc(var(--radius) - 6px)',
        md: 'calc(var(--radius) - 4px)',
        lg: 'var(--radius)',
        xl: 'calc(var(--radius) + 4px)',
        '2xl': 'calc(var(--radius) + 8px)',
      },
      boxShadow: {
        card: '0 1px 2px hsl(var(--shadow) / 0.06), 0 4px 16px -4px hsl(var(--shadow) / 0.08)',
        lift: '0 2px 4px hsl(var(--shadow) / 0.06), 0 12px 32px -8px hsl(var(--shadow) / 0.18)',
        glow: '0 10px 30px -8px hsl(var(--primary) / 0.55)',
        'glow-accent': '0 12px 34px -8px hsl(var(--accent) / 0.55)',
        tile: '0 1px 1px hsl(var(--shadow) / 0.04), 0 14px 34px -20px hsl(var(--shadow) / 0.3)',
        dock: '0 1px 0 hsl(0 0% 100% / 0.06) inset, 0 18px 40px -12px hsl(var(--shadow) / 0.55)',
      },
      backgroundImage: {
        'brand-gradient': 'linear-gradient(135deg, hsl(var(--brand-1)) 0%, hsl(var(--brand-2)) 55%, hsl(var(--brand-3)) 100%)',
        'hero-glow': 'radial-gradient(60% 50% at 50% 0%, hsl(var(--primary) / 0.18) 0%, transparent 70%)',
      },
      transitionTimingFunction: {
        'out-expo': 'cubic-bezier(0.16, 1, 0.3, 1)',
      },
      keyframes: {
        shimmer: { '100%': { transform: 'translateX(100%)' } },
        'fade-in': { from: { opacity: '0' }, to: { opacity: '1' } },
        // Page entrance. The resting state is fully visible, so a skipped or
        // interrupted animation can never leave a page hidden.
        'page-in': { from: { opacity: '0', transform: 'translateY(8px)' }, to: { opacity: '1', transform: 'none' } },
        // The quick-action fan and the launcher grid. Resting state visible, as above.
        'pop-in': { from: { opacity: '0', transform: 'translateY(10px) scale(0.96)' }, to: { opacity: '1', transform: 'none' } },
      },
      animation: {
        shimmer: 'shimmer 1.6s infinite',
        'fade-in': 'fade-in 200ms ease-out',
        'page-in': 'page-in 220ms cubic-bezier(0.16, 1, 0.3, 1)',
        'pop-in': 'pop-in 240ms cubic-bezier(0.16, 1, 0.3, 1) both',
      },
    },
  },
  plugins: [],
};
