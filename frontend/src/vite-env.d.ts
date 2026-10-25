/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Backend base URL, without the `/api` suffix. Defaults to http://localhost:3000. */
  readonly VITE_API_URL?: string
  /**
   * Comma-separated list of modules to mock with MSW (e.g. "categories,organizations" or "all").
   * When unset or empty, MSW is not started and requests hit the real backend.
   */
  readonly VITE_MOCK_MODULES?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
