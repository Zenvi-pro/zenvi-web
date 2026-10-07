/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_SUPABASE_URL?: string;
  readonly VITE_SUPABASE_PUBLISHABLE_KEY?: string;
  readonly VITE_ZENVI_BACKEND_URL?: string;
  readonly VITE_ZENVI_CLOUD_URL?: string;
  readonly VITE_ZENVI_WEBSITE_CALLBACK?: string;
  readonly VITE_ENABLE_OAUTH?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
