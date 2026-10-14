/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_SUPABASE_URL?: string;
  readonly VITE_SUPABASE_PUBLISHABLE_KEY?: string;
  readonly VITE_BASE_PATH?: string;
  readonly VITE_ENABLE_DEV_TOOLS?: string;
  readonly VITE_PLUS_PRICE_MONTHLY?: string;
  readonly VITE_PLUS_PRICE_YEARLY?: string;
  /** Website address used for outgoing links in app builds. */
  readonly VITE_PUBLIC_URL?: string;
  /** "android" in the Android app build. */
  readonly VITE_PLATFORM?: string;
}
interface ImportMeta {
  readonly env: ImportMetaEnv;
}
