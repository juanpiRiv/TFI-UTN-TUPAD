import { describe, expect, it } from 'vitest'
import { ArcaSdkError } from './sdk/errors.js'
import { isNotDelegated, NOT_DELEGATED_REASONS } from './arca-delegation.service.js'

const auth = (extra: { authReason?: string; providerCode?: string }) => new ArcaSdkError('authentication', 'x', extra)

describe('qué cuenta como «no delegado» (contrato)', () => {
  it('solo estas razones de autenticación', () => {
    expect([...NOT_DELEGATED_REASONS].sort()).toEqual(['invalid_token', 'missing_relationship'])
  })

  it.each(['missing_relationship', 'invalid_token'])('el motivo %s cuenta', (authReason) => {
    expect(isNotDelegated(auth({ authReason }))).toBe(true)
  })

  it.each(['600', '601'])('el código %s de ARCA cuenta aunque no haya motivo', (providerCode) => {
    expect(isNotDelegated(auth({ providerCode }))).toBe(true)
  })

  it.each(['unauthorized_computer', 'authentication_rejected'])('el motivo %s no cuenta: es un problema de la plataforma', (authReason) => {
    expect(isNotDelegated(auth({ authReason }))).toBe(false)
  })

  it('un error que no es de autenticación no cuenta, aunque traiga el mismo código', () => {
    expect(isNotDelegated(new ArcaSdkError('service', 'x', { providerCode: '600' }))).toBe(false)
    expect(isNotDelegated(new ArcaSdkError('transport', 'x'))).toBe(false)
    expect(isNotDelegated(auth({}))).toBe(false)
  })
})
