import { describe, expect, it, vi } from 'vitest'
import type { ArcaClient } from 'facturas'
import { ArcaSdkClient } from './arca-sdk-client.js'

const base = { cuit: '20000000001', certificatePem: 'c', privateKeyPem: 'k' }

function configFor(extra: { timeoutMs?: number } = {}) {
  const clientFactory = vi.fn((_config: unknown) => ({}) as ArcaClient)
  new ArcaSdkClient({ ...base, ...extra, clientFactory })
  return clientFactory.mock.calls[0]![0] as { timeout: number; environment: string }
}

describe('ArcaSdkClient: tiempo máximo de cada pedido', () => {
  it('por defecto corta a los 25 s (menos que el bloqueo de 60 s del ticket de WSAA)', () => {
    expect(configFor().timeout).toBe(25_000)
  })

  it('un timeoutMs explícito reemplaza el de por defecto', () => {
    expect(configFor({ timeoutMs: 1_500 }).timeout).toBe(1_500)
    expect(configFor({ timeoutMs: 120_000 }).timeout).toBe(120_000)
  })

  it('el tiempo por defecto es menor que el bloqueo de WSAA', () => {
    // Si alguien sube el tiempo del pedido por encima del bloqueo, otra instancia podría pedir un segundo ticket.
    expect(configFor().timeout).toBeLessThan(60_000)
  })
})
