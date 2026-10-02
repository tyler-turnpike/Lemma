/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Optional public API origin; same-origin /api/v1 when unset. Never put secrets in VITE_ variables. */
  readonly VITE_LEMMA_API_URL?: string;
}
