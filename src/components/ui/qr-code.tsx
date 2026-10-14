import * as React from 'react';
import qrcode from 'qrcode-generator';
import { cn } from '@/lib/utils';

/**
 * A QR code drawn as SVG on the device (no network calls). Always dark-on-white
 * with a quiet zone, because phone scanners expect that in dark mode too.
 */
export function QrCode({ value, label, className }: { value: string; label: string; className?: string }) {
  const { path, size } = React.useMemo(() => {
    const qr = qrcode(0, 'M');
    qr.addData(value, 'Byte');
    qr.make();
    const n = qr.getModuleCount();
    const quiet = 4;
    let d = '';
    for (let r = 0; r < n; r++) {
      for (let c = 0; c < n; c++) {
        if (qr.isDark(r, c)) d += `M${c + quiet} ${r + quiet}h1v1h-1z`;
      }
    }
    return { path: d, size: n + quiet * 2 };
  }, [value]);

  return (
    <svg viewBox={`0 0 ${size} ${size}`} role="img" aria-label={label} shapeRendering="crispEdges"
      className={cn('rounded-xl bg-white', className)}>
      <rect width={size} height={size} fill="#ffffff" />
      <path d={path} fill="#0a1020" />
    </svg>
  );
}
