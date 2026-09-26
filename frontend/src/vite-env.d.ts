/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Backend base URL, without the `/api` suffix. Defaults to http://localhost:3000. */
  readonly VITE_API_URL?: string
  /** When "true", MSW simulates the endpoints the backend does not have yet. */
  readonly VITE_USE_MOCKS?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
