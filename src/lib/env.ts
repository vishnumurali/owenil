/** Public, build-time configuration. Nothing secret may ever be read here. */
export const env = {
  supabaseUrl: import.meta.env.VITE_SUPABASE_URL ?? '',
  supabaseKey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY ?? '',
  basePath: import.meta.env.BASE_URL, // e.g. "/owenil/"
  devTools: import.meta.env.VITE_ENABLE_DEV_TOOLS === 'true' || import.meta.env.DEV,
  plusPriceMonthly: import.meta.env.VITE_PLUS_PRICE_MONTHLY ?? '₹149',
  plusPriceYearly: import.meta.env.VITE_PLUS_PRICE_YEARLY ?? '₹1,299',
};

export const isSupabaseConfigured = Boolean(env.supabaseUrl && env.supabaseKey);

/** Absolute URL of an in-app route, honouring the base path (used for auth redirects & invite links). */
export function appUrl(path: string): string {
  const base = env.basePath.endsWith('/') ? env.basePath : `${env.basePath}/`;
  return `${window.location.origin}${base}${path.replace(/^\//, '')}`;
}
