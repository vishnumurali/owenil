export function Kbd({ children }: { children: React.ReactNode }) {
  return <kbd className="rounded-md border border-border bg-fg/[0.06] px-1.5 py-0.5 font-sans text-xs text-fg-muted">{children}</kbd>;
}
