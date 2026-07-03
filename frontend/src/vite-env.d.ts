/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Committed overlays: "true" in .env.development, "false" in .env.homectl. */
  readonly VITE_DISABLE_AUTH?: string;
  readonly VITE_AUTH_SERVICE_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
