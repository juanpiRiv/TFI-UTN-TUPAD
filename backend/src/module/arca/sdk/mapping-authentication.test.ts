import { describe, expect, it } from 'vitest'
import { ArcaAuthenticationError } from 'facturas'
import { wrapSdkError } from './mapping.js'

describe('wrapSdkError: autenticación', () => {
  it('conserva el motivo y el código que clasificó la librería (por ejemplo, falta la relación del representado)', () => {
    const error = new ArcaAuthenticationError('ARCA rejected authentication', { reason: 'missing_relationship', service: 'wsfe', operation: 'FECompUltimoAutorizado', providerCode: '600' })

    const wrapped = wrapSdkError(error)

    expect(wrapped.kind).toBe('authentication')
    expect(wrapped.authReason).toBe('missing_relationship')
    expect(wrapped.providerCode).toBe('600')
  })
})
