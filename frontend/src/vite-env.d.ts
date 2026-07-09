/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Committed overlays: "true" in .env.development, "false" in .env.sidecar. */
  readonly VITE_DISABLE_AUTH?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
