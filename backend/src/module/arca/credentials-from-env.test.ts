import { describe, expect, it } from 'vitest'
import { loadArcaCredentialsFromEnv } from './credentials-from-env.js'

const CERT = '-----BEGIN CERTIFICATE-----\nfalso\n-----END CERTIFICATE-----'
const KEY = '-----BEGIN PRIVATE KEY-----\nfalso\n-----END PRIVATE KEY-----'

describe('loadArcaCredentialsFromEnv', () => {
  it('arma las credenciales con rutas a archivos', () => {
    const files: Record<string, string> = { '/x/cert.crt': CERT, '/x/clave.key': KEY }
    const read = (path: string) => {
      const content = files[path]
      if (content === undefined) throw new Error('ENOENT')
      return content
    }

    const credentials = loadArcaCredentialsFromEnv(
      { ARCA_CUIT: '20000000001', ARCA_CERT_PATH: '/x/cert.crt', ARCA_KEY_PATH: '/x/clave.key' },
      read,
    )

    expect(credentials).toEqual({ cuit: '20000000001', certificatePem: CERT, privateKeyPem: KEY })
  })

  it('arma las credenciales con PEM en variables y normaliza los \\n escritos a mano', () => {
    const credentials = loadArcaCredentialsFromEnv({
      ARCA_CUIT: '20000000001',
      ARCA_CERT_PEM: CERT.replace(/\n/g, '\\n'),
      ARCA_KEY_PEM: KEY.replace(/\n/g, '\\n'),
    })

    expect(credentials.certificatePem).toBe(CERT)
    expect(credentials.privateKeyPem).toBe(KEY)
  })

  it('exige un CUIT de 11 dígitos', () => {
    expect(() => loadArcaCredentialsFromEnv({ ARCA_CERT_PEM: CERT, ARCA_KEY_PEM: KEY })).toThrow(/ARCA_CUIT es obligatoria/)
    expect(() => loadArcaCredentialsFromEnv({ ARCA_CUIT: '2000', ARCA_CERT_PEM: CERT, ARCA_KEY_PEM: KEY })).toThrow(/11 dígitos/)
  })

  it('rechaza mezclar rutas y PEM', () => {
    expect(() =>
      loadArcaCredentialsFromEnv({ ARCA_CUIT: '20000000001', ARCA_CERT_PATH: '/x', ARCA_KEY_PEM: KEY }),
    ).toThrow(/no las dos formas a la vez/)
  })

  it('pide las dos piezas, certificado y clave', () => {
    expect(() => loadArcaCredentialsFromEnv({ ARCA_CUIT: '20000000001', ARCA_CERT_PEM: CERT })).toThrow(/ARCA_CERT_PEM o ARCA_KEY_PEM/)
    expect(() => loadArcaCredentialsFromEnv({ ARCA_CUIT: '20000000001', ARCA_CERT_PATH: '/x' })).toThrow(/ARCA_CERT_PATH o ARCA_KEY_PATH/)
    expect(() => loadArcaCredentialsFromEnv({ ARCA_CUIT: '20000000001' })).toThrow(/ARCA_CERT_PATH o ARCA_KEY_PATH/)
  })

  it('si no puede leer un archivo, nombra la variable y no filtra el error del sistema', () => {
    const read = () => {
      throw new Error('ENOENT: /secreto/ruta/clave.key')
    }

    expect.assertions(2)
    try {
      loadArcaCredentialsFromEnv({ ARCA_CUIT: '20000000001', ARCA_CERT_PATH: '/x/c', ARCA_KEY_PATH: '/x/k' }, read)
    } catch (error) {
      expect((error as Error).message).toMatch(/ARCA_CERT_PATH/)
      expect((error as Error).message).not.toMatch(/secreto/)
    }
  })

  it('rechaza archivos que no son un PEM válido y una clave cifrada', () => {
    expect(() => loadArcaCredentialsFromEnv({ ARCA_CUIT: '20000000001', ARCA_CERT_PEM: 'hola', ARCA_KEY_PEM: KEY })).toThrow(/BEGIN CERTIFICATE/)
    expect(() => loadArcaCredentialsFromEnv({ ARCA_CUIT: '20000000001', ARCA_CERT_PEM: CERT, ARCA_KEY_PEM: 'hola' })).toThrow(/clave privada no parece/)
    expect(() =>
      loadArcaCredentialsFromEnv({
        ARCA_CUIT: '20000000001',
        ARCA_CERT_PEM: CERT,
        ARCA_KEY_PEM: '-----BEGIN ENCRYPTED PRIVATE KEY-----\nx\n-----END ENCRYPTED PRIVATE KEY-----',
      }),
    ).toThrow(/cifrada/)
  })

  it('el mensaje de error nunca incluye el contenido del PEM', () => {
    expect.assertions(1)
    try {
      loadArcaCredentialsFromEnv({ ARCA_CUIT: '20000000001', ARCA_CERT_PEM: CERT, ARCA_KEY_PEM: 'CONTENIDO-SECRETO' })
    } catch (error) {
      expect((error as Error).message).not.toMatch(/CONTENIDO-SECRETO/)
    }
  })
})
