import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { assertPemShape, CredentialError, inspectCredential, normalizePem } from './credential-inspector.js'

function hasOpenssl(): boolean {
  try {
    execFileSync('openssl', ['version'], { stdio: 'ignore' })
    return true
  } catch {
    return false
  }
}

const directory = mkdtempSync(join(tmpdir(), 'cred-inspector-'))
afterAll(() => rmSync(directory, { recursive: true, force: true }))

/** Genera un certificado autofirmado de prueba con el CUIT en el sujeto, como los de WSASS. */
function makeCredential(name: string, cuit = '20000000001') {
  const key = join(directory, `${name}.key`)
  const cert = join(directory, `${name}.crt`)
  execFileSync(
    'openssl',
    ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', key, '-out', cert, '-days', '30', '-subj', `/CN=prueba/serialNumber=CUIT ${cuit}`],
    { stdio: 'ignore' },
  )
  return { certificatePem: readFileSync(cert, 'utf8'), privateKeyPem: readFileSync(key, 'utf8') }
}

describe.skipIf(!hasOpenssl())('inspectCredential', () => {
  const valid = makeCredential('valida')

  it('acepta un certificado vigente con su clave y devuelve vencimiento, CUIT y huella', () => {
    const result = inspectCredential({ ...valid, expectedCuit: '20000000001' })

    expect(result.certificateCuit).toBe('20000000001')
    expect(result.expiresAt.getTime()).toBeGreaterThan(Date.now())
    expect(result.fingerprint).toMatch(/^[0-9a-f]{64}$/)
  })

  it('rechaza una clave que no corresponde al certificado', () => {
    const other = makeCredential('otra')

    expect(() => inspectCredential({ certificatePem: valid.certificatePem, privateKeyPem: other.privateKeyPem, expectedCuit: '20000000001' })).toThrow(
      /no corresponde a este certificado/,
    )
  })

  it('rechaza un certificado de otro CUIT', () => {
    expect(() => inspectCredential({ ...valid, expectedCuit: '30711111118' })).toThrow(/CUIT del certificado no es el de la organización/)
  })

  it('rechaza un certificado vencido o todavía no vigente', () => {
    const afterExpiry = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000)
    const beforeIssue = new Date(Date.now() - 365 * 24 * 60 * 60 * 1000)

    expect(() => inspectCredential({ ...valid, expectedCuit: '20000000001', now: afterExpiry })).toThrow(/vencido/)
    expect(() => inspectCredential({ ...valid, expectedCuit: '20000000001', now: beforeIssue })).toThrow(/todavía no está vigente/)
  })

  it('rechaza contenido que tiene la cabecera pero no es un certificado o una clave', () => {
    const fakeCert = '-----BEGIN CERTIFICATE-----\nZm9v\n-----END CERTIFICATE-----'
    const fakeKey = '-----BEGIN PRIVATE KEY-----\nZm9v\n-----END PRIVATE KEY-----'

    expect(() => inspectCredential({ certificatePem: fakeCert, privateKeyPem: valid.privateKeyPem, expectedCuit: '20000000001' })).toThrow(/no es un certificado/)
    expect(() => inspectCredential({ certificatePem: valid.certificatePem, privateKeyPem: fakeKey, expectedCuit: '20000000001' })).toThrow(/no es una clave válida/)
  })

  it('acepta PEM con los saltos de línea escritos como \\n', () => {
    const escaped = { certificatePem: valid.certificatePem.replace(/\n/g, '\\n'), privateKeyPem: valid.privateKeyPem.replace(/\n/g, '\\n') }

    expect(inspectCredential({ ...escaped, expectedCuit: '20000000001' }).certificateCuit).toBe('20000000001')
  })

  it('los mensajes de error no incluyen el contenido de la clave', () => {
    expect.assertions(1)
    try {
      inspectCredential({ certificatePem: valid.certificatePem, privateKeyPem: makeCredential('x').privateKeyPem, expectedCuit: '20000000001' })
    } catch (error) {
      expect((error as Error).message).not.toMatch(/MII|BEGIN/)
    }
  })
})

describe('assertPemShape y normalizePem', () => {
  it('pide las cabeceras correctas y una clave sin cifrar', () => {
    expect(() => assertPemShape('hola', '-----BEGIN PRIVATE KEY-----')).toThrow(CredentialError)
    expect(() => assertPemShape('-----BEGIN CERTIFICATE-----', 'hola')).toThrow(/falta la cabecera/)
    expect(() => assertPemShape('-----BEGIN CERTIFICATE-----', '-----BEGIN ENCRYPTED PRIVATE KEY-----')).toThrow(/cifrada con contraseña/)
    expect(() => assertPemShape('-----BEGIN CERTIFICATE-----', '-----BEGIN RSA PRIVATE KEY-----')).not.toThrow()
  })

  it('normalizePem convierte \\n escritos a mano y \\r\\n en saltos de línea', () => {
    expect(normalizePem('a\\nb\r\nc ')).toBe('a\nb\nc')
  })
})
