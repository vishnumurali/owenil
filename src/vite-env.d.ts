/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_SUPABASE_URL?: string;
  readonly VITE_SUPABASE_PUBLISHABLE_KEY?: string;
  readonly VITE_BASE_PATH?: string;
  readonly VITE_ENABLE_DEV_TOOLS?: string;
  readonly VITE_PLUS_PRICE_MONTHLY?: string;
  readonly VITE_PLUS_PRICE_YEARLY?: string;
}
interface ImportMeta {
  readonly env: ImportMetaEnv;
}
