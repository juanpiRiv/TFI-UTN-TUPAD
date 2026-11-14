import type { FiscalProvider } from './fiscal-provider.js'

// Un cliente por organización y certificado: así se reutiliza el ticket de acceso de WSAA. Cada cliente
// guarda la clave privada en memoria, por eso se limpia cuando la organización la reemplaza o la borra.
const providers = new Map<string, FiscalProvider>()

const keyFor = (organizationId: number, fingerprint: string) => `${organizationId}:${fingerprint}`

export const getCachedProvider = (organizationId: number, fingerprint: string) => providers.get(keyFor(organizationId, fingerprint))

export const setCachedProvider = (organizationId: number, fingerprint: string, provider: FiscalProvider) => {
  providers.set(keyFor(organizationId, fingerprint), provider)
}

/** Olvida todos los clientes de una organización (al cargar otra credencial o borrarla). */
export function evictOrganizationProviders(organizationId: number): void {
  for (const key of providers.keys()) {
    if (key.startsWith(`${organizationId}:`)) providers.delete(key)
  }
}

export function clearProviderCache(): void {
  providers.clear()
}
