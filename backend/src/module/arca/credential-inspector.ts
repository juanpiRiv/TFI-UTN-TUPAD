import { createHash, createPrivateKey, createPublicKey, X509Certificate } from 'node:crypto'

/** Error de una credencial que el usuario puede corregir. El mensaje es apto para mostrarse tal cual. */
export class CredentialError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'CredentialError'
  }
}

export interface InspectedCredential {
  /** Fecha de vencimiento del certificado. */
  expiresAt: Date
  /** CUIT que figura en el sujeto del certificado (serialNumber), si lo trae. */
  certificateCuit: string | null
  /** Huella del certificado: sirve de clave para el ticket de acceso y para detectar cambios. */
  fingerprint: string
}

const HEADER_CERTIFICATE = /BEGIN CERTIFICATE/
const HEADER_PRIVATE_KEY = /BEGIN (RSA )?PRIVATE KEY/

/** Normaliza saltos de línea: los PEM pegados a mano suelen traer `\n` escritos como texto. */
export function normalizePem(pem: string): string {
  return pem.replace(/\\n/g, '\n').replace(/\r\n/g, '\n').trim()
}

/** Revisa solo la forma de los PEM (cabeceras y que la clave no esté cifrada). No lee ningún archivo. */
export function assertPemShape(certificatePem: string, privateKeyPem: string): void {
  if (!HEADER_CERTIFICATE.test(certificatePem)) {
    throw new CredentialError('El certificado no parece un PEM: falta la cabecera BEGIN CERTIFICATE.')
  }
  if (privateKeyPem.includes('ENCRYPTED')) {
    throw new CredentialError('La clave privada está cifrada con contraseña: hace falta una clave sin contraseña.')
  }
  if (!HEADER_PRIVATE_KEY.test(privateKeyPem)) {
    throw new CredentialError('La clave privada no parece un PEM sin cifrar: falta la cabecera BEGIN PRIVATE KEY.')
  }
}

/**
 * Comprueba que el certificado y la clave sirvan para firmar ante ARCA: que se puedan leer, que el
 * certificado esté vigente, que la clave corresponda al certificado y que el CUIT del certificado sea
 * el de la organización. Nunca incluye el contenido de los PEM en los mensajes.
 */
export function inspectCredential(input: {
  certificatePem: string
  privateKeyPem: string
  expectedCuit: string
  now?: Date
}): InspectedCredential {
  const certificatePem = normalizePem(input.certificatePem)
  const privateKeyPem = normalizePem(input.privateKeyPem)
  assertPemShape(certificatePem, privateKeyPem)

  let certificate: X509Certificate
  try {
    certificate = new X509Certificate(certificatePem)
  } catch {
    throw new CredentialError('No se pudo leer el certificado: el contenido no es un certificado X.509 válido.')
  }

  let privateKey: ReturnType<typeof createPrivateKey>
  try {
    privateKey = createPrivateKey(privateKeyPem)
  } catch {
    throw new CredentialError('No se pudo leer la clave privada: el contenido no es una clave válida.')
  }

  const now = input.now ?? new Date()
  const expiresAt = new Date(certificate.validTo)
  if (new Date(certificate.validFrom) > now) throw new CredentialError('El certificado todavía no está vigente.')
  if (expiresAt <= now) throw new CredentialError('El certificado está vencido.')

  const fromCertificate = certificate.publicKey.export({ type: 'spki', format: 'der' })
  const fromPrivateKey = createPublicKey(privateKey).export({ type: 'spki', format: 'der' })
  if (!Buffer.from(fromCertificate).equals(Buffer.from(fromPrivateKey))) {
    throw new CredentialError('La clave privada no corresponde a este certificado.')
  }

  // El CUIT es el del atributo serialNumber: la razón social (O) del pedido también puede decir "CUIT 3071..." y no cuenta.
  const certificateCuit = /^serialNumber=CUIT\s*(\d{11})/m.exec(certificate.subject)?.[1] ?? /CUIT\s*(\d{11})/.exec(certificate.subject)?.[1] ?? null
  if (certificateCuit && certificateCuit !== input.expectedCuit) {
    throw new CredentialError('El CUIT del certificado no es el de la organización.')
  }

  const fingerprint = createHash('sha256').update(certificate.raw).digest('hex')
  return { expiresAt, certificateCuit, fingerprint }
}
