import { readFileSync } from 'node:fs'
import { assertPemShape, CredentialError, normalizePem } from './credential-inspector.js'
import { ProviderUnavailableError } from './errors.js'
import type { ArcaCredentials } from './provider-factory.js'

/** Variables de entorno que alimentan las credenciales fiscales de prueba. */
export interface ArcaCredentialEnv {
  ARCA_CUIT?: string | undefined
  ARCA_CERT_PATH?: string | undefined
  ARCA_KEY_PATH?: string | undefined
  ARCA_CERT_PEM?: string | undefined
  ARCA_KEY_PEM?: string | undefined
}

type ReadFile = (path: string) => string

const CUIT = /^\d{11}$/

function readPem(path: string, read: ReadFile, name: string): string {
  try {
    return read(path)
  } catch {
    // El mensaje no incluye el contenido del archivo ni el error del sistema: solo la variable que falló.
    throw new ProviderUnavailableError(`No se pudo leer el archivo que indica ${name}.`)
  }
}

/**
 * Arma las credenciales de ARCA a partir de variables de entorno. Sirve para probar contra
 * homologación con un certificado propio, sin pasar por la tabla ArcaCredential.
 *
 * Acepta el certificado y la clave como rutas (ARCA_CERT_PATH y ARCA_KEY_PATH) o como texto PEM
 * (ARCA_CERT_PEM y ARCA_KEY_PEM). Nunca incluye el contenido de los PEM en los mensajes de error.
 */
export function loadArcaCredentialsFromEnv(vars: ArcaCredentialEnv, read: ReadFile = (p) => readFileSync(p, 'utf8')): ArcaCredentials {
  const cuit = vars.ARCA_CUIT?.trim()
  if (!cuit || !CUIT.test(cuit)) {
    throw new ProviderUnavailableError('ARCA_CUIT es obligatoria y tiene que tener 11 dígitos.')
  }

  const hasPaths = Boolean(vars.ARCA_CERT_PATH?.trim() || vars.ARCA_KEY_PATH?.trim())
  const hasPem = Boolean(vars.ARCA_CERT_PEM?.trim() || vars.ARCA_KEY_PEM?.trim())
  if (hasPaths && hasPem) {
    throw new ProviderUnavailableError('Definí el certificado y la clave como rutas (ARCA_CERT_PATH y ARCA_KEY_PATH) o como PEM (ARCA_CERT_PEM y ARCA_KEY_PEM), no las dos formas a la vez.')
  }

  let certificatePem: string
  let privateKeyPem: string
  if (hasPem) {
    if (!vars.ARCA_CERT_PEM?.trim() || !vars.ARCA_KEY_PEM?.trim()) {
      throw new ProviderUnavailableError('Faltan ARCA_CERT_PEM o ARCA_KEY_PEM: hacen falta las dos.')
    }
    certificatePem = normalizePem(vars.ARCA_CERT_PEM)
    privateKeyPem = normalizePem(vars.ARCA_KEY_PEM)
  } else {
    if (!vars.ARCA_CERT_PATH?.trim() || !vars.ARCA_KEY_PATH?.trim()) {
      throw new ProviderUnavailableError('Faltan ARCA_CERT_PATH o ARCA_KEY_PATH: hacen falta las dos.')
    }
    certificatePem = normalizePem(readPem(vars.ARCA_CERT_PATH.trim(), read, 'ARCA_CERT_PATH'))
    privateKeyPem = normalizePem(readPem(vars.ARCA_KEY_PATH.trim(), read, 'ARCA_KEY_PATH'))
  }

  try {
    assertPemShape(certificatePem, privateKeyPem)
  } catch (error) {
    // Mismo mensaje que antes para el desarrollador; sin contenido de los PEM.
    throw error instanceof CredentialError ? new ProviderUnavailableError(error.message) : error
  }

  return { cuit, certificatePem, privateKeyPem }
}
