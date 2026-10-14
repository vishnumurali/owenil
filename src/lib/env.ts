/** Public, build-time configuration. Nothing secret may ever be read here. */
export const env = {
  supabaseUrl: import.meta.env.VITE_SUPABASE_URL ?? '',
  supabaseKey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY ?? '',
  basePath: import.meta.env.BASE_URL, // e.g. "/owenil/"
  /** The website's address. Set for app builds so links that leave the app point at the site. */
  publicUrl: import.meta.env.VITE_PUBLIC_URL ?? '',
  /** "android" in the Android app build, otherwise "web". */
  platform: import.meta.env.VITE_PLATFORM === 'android' ? ('android' as const) : ('web' as const),
  devTools: import.meta.env.VITE_ENABLE_DEV_TOOLS === 'true' || import.meta.env.DEV,
  plusPriceMonthly: import.meta.env.VITE_PLUS_PRICE_MONTHLY ?? '₹149',
  plusPriceYearly: import.meta.env.VITE_PLUS_PRICE_YEARLY ?? '₹1,299',
};

export const isSupabaseConfigured = Boolean(env.supabaseUrl && env.supabaseKey);

/**
 * Absolute URL of a route on the website (auth emails, invite links). Inside
 * the Android app this is the public website, never the app's local origin.
 */
export function appUrl(path: string): string {
  const site = env.publicUrl || `${window.location.origin}${env.basePath}`;
  return `${site.endsWith('/') ? site : `${site}/`}${path.replace(/^\//, '')}`;
}
