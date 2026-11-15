import { X509Certificate } from 'node:crypto'
import { prisma } from '../../lib/prisma.js'
import { AppError } from '../../lib/error.js'
import { CredentialError, inspectCredential, normalizePem } from './credential-inspector.js'
import { decryptSecret, encryptSecret, EncryptionKeyError, parseEncryptionKey } from './secret-box.js'
import type { ArcaCredentials } from './provider-factory.js'
import { evictOrganizationProviders } from './provider-cache.js'
import { generateCsr } from './arca-csr.service.js'

/** Por ahora solo se cargan credenciales de homologación y del servicio de facturación electrónica. */
const ENVIRONMENT = 'HOMOLOGACION' as const
const SERVICE = 'wsfe'

export interface ArcaCredentialStatus {
  configured: boolean
  environment?: 'HOMOLOGACION' | 'PRODUCCION'
  certificateExpiresAt?: string
  updatedAt?: string
  /** Solicitud de certificado en curso (CSR generado en la aplicación, a la espera del certificado de ARCA). */
  pendingCsr?: { csr: string; createdAt: string }
}

export interface PendingCsr {
  csr: string
  createdAt: string
}

// El dato asociado ata el secreto a la organización, al ambiente y al servicio: copiado a otra fila no se descifra.
export const aadFor = (organizationId: number) => `arca-credential:${organizationId}:${ENVIRONMENT}:${SERVICE}`
// Distinto del de la credencial: una clave pendiente no se puede pasar por una credencial guardada ni al revés.
export const csrAadFor = (organizationId: number) => `arca-csr:${organizationId}`
const whereFor = (organizationId: number) => ({
  organizationId_environment_service: { organizationId, environment: ENVIRONMENT, service: SERVICE },
})

async function requireOrganization(userId: number) {
  const org = await prisma.organization.findUnique({ where: { userId }, select: { id: true, cuit: true, legalName: true } })
  if (!org) throw new AppError(403, 'Organization required')
  return org
}

function encryptionKey(hex: string | undefined): Buffer {
  try {
    return parseEncryptionKey(hex)
  } catch (error) {
    if (error instanceof EncryptionKeyError) {
      console.error('[arca] falta o es inválida ARCA_ENCRYPTION_KEY: no se puede guardar ni leer credenciales.')
      throw new AppError(503, 'La conexión con ARCA no está disponible en este momento. Probá de nuevo más tarde.')
    }
    throw error
  }
}

function statusOf(row: { environment: string; certificate: string; updatedAt: Date }): ArcaCredentialStatus {
  return {
    configured: true,
    environment: row.environment as 'HOMOLOGACION' | 'PRODUCCION',
    certificateExpiresAt: new Date(new X509Certificate(row.certificate).validTo).toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  }
}

/** Estado de la credencial de ARCA de la organización. Nunca devuelve la clave. */
export async function getArcaCredentialStatus(userId: number): Promise<ArcaCredentialStatus> {
  const org = await requireOrganization(userId)
  const [row, pending] = await Promise.all([
    prisma.arcaCredential.findUnique({ where: whereFor(org.id) }),
    prisma.arcaCsrRequest.findUnique({ where: { organizationId: org.id } }),
  ])
  const status = row ? statusOf(row) : { configured: false }
  return pending ? { ...status, pendingCsr: { csr: pending.csr, createdAt: pending.createdAt.toISOString() } } : status
}

/**
 * Genera la clave y el pedido de certificado (CSR) de la organización. La clave queda cifrada en la base y
 * nunca se devuelve; un pedido pendiente anterior se reemplaza.
 */
export async function createArcaCsr(userId: number, encryptionKeyHex: string | undefined): Promise<PendingCsr> {
  const org = await requireOrganization(userId)
  const key = encryptionKey(encryptionKeyHex)
  const { csr, privateKeyPem } = await generateCsr({ legalName: org.legalName, cuit: org.cuit })
  const privateKeyEncrypted = encryptSecret(privateKeyPem, key, csrAadFor(org.id))
  const row = await prisma.arcaCsrRequest.upsert({
    where: { organizationId: org.id },
    create: { organizationId: org.id, csr, privateKeyEncrypted },
    update: { csr, privateKeyEncrypted },
  })
  await prisma.auditLog.create({
    data: { organizationId: org.id, userId, action: 'arca_csr.created', entity: 'ArcaCsrRequest', entityId: row.id },
  })
  return { csr: row.csr, createdAt: row.createdAt.toISOString() }
}

/**
 * Completa el alta con el certificado que ARCA devolvió para el pedido pendiente: usa la clave guardada, valida
 * y guarda la credencial como `saveArcaCredential`, y borra el pedido.
 */
export async function attachArcaCertificate(
  userId: number,
  input: { certificate: string },
  encryptionKeyHex: string | undefined,
): Promise<ArcaCredentialStatus> {
  const org = await requireOrganization(userId)
  const key = encryptionKey(encryptionKeyHex)
  const pending = await prisma.arcaCsrRequest.findUnique({ where: { organizationId: org.id } })
  if (!pending) throw new AppError(422, 'Primero generá la solicitud de certificado.')

  let privateKey: string
  try {
    privateKey = decryptSecret(pending.privateKeyEncrypted, key, csrAadFor(org.id))
  } catch {
    throw new AppError(422, 'No se pudo leer la solicitud pendiente: generá una nueva.')
  }
  const status = await storeCredential(org, userId, input.certificate, privateKey, key)
  await prisma.arcaCsrRequest.deleteMany({ where: { organizationId: org.id } })
  return status
}

/**
 * Valida y guarda el certificado y la clave de la organización. La clave se guarda cifrada; el ticket de
 * acceso que hubiera quedado de una credencial anterior se descarta.
 */
export async function saveArcaCredential(
  userId: number,
  input: { certificate: string; privateKey: string },
  encryptionKeyHex: string | undefined,
): Promise<ArcaCredentialStatus> {
  const org = await requireOrganization(userId)
  const key = encryptionKey(encryptionKeyHex)
  return storeCredential(org, userId, input.certificate, input.privateKey, key)
}

async function storeCredential(
  org: { id: number; cuit: string },
  userId: number,
  certificateInput: string,
  privateKeyInput: string,
  key: Buffer,
): Promise<ArcaCredentialStatus> {
  try {
    inspectCredential({ certificatePem: certificateInput, privateKeyPem: privateKeyInput, expectedCuit: org.cuit })
  } catch (error) {
    if (error instanceof CredentialError) throw new AppError(422, error.message)
    throw error
  }

  const certificate = normalizePem(certificateInput)
  const privateKeyEncrypted = encryptSecret(normalizePem(privateKeyInput), key, aadFor(org.id))
  const row = await prisma.arcaCredential.upsert({
    where: whereFor(org.id),
    create: { organizationId: org.id, environment: ENVIRONMENT, service: SERVICE, certificate, privateKeyEncrypted },
    update: { certificate, privateKeyEncrypted, token: null, sign: null, tokenExpiresAt: null },
  })
  evictOrganizationProviders(org.id)
  await prisma.auditLog.create({
    data: { organizationId: org.id, userId, action: 'arca_credential.saved', entity: 'ArcaCredential', entityId: row.id },
  })
  return statusOf(row)
}

export async function deleteArcaCredential(userId: number): Promise<void> {
  const org = await requireOrganization(userId)
  await prisma.arcaCredential.deleteMany({ where: { organizationId: org.id, environment: ENVIRONMENT, service: SERVICE } })
  await prisma.arcaCsrRequest.deleteMany({ where: { organizationId: org.id } })
  // El ticket de WSAA guardado en la base (arca_wsaa_tickets) no se borra acá: su clave incluye la huella del
  // certificado y esta función no lo lee. Sin la credencial nadie puede usarlo y vence solo en 12 horas como máximo;
  // un certificado nuevo tiene otra huella y pide su propio ticket.
  evictOrganizationProviders(org.id)
  await prisma.auditLog.create({
    data: { organizationId: org.id, userId, action: 'arca_credential.deleted', entity: 'ArcaCredential', entityId: org.id },
  })
}

export interface StoredArcaCredentials {
  credentials: ArcaCredentials
  /** Huella del certificado: cambia cuando el cliente carga otro. */
  fingerprint: string
}

/**
 * Credenciales guardadas de una organización, descifradas, listas para el proveedor fiscal.
 * Devuelve null si la organización todavía no cargó ninguna. El CUIT es el de la organización.
 */
export async function loadArcaCredentialsForOrganization(
  org: { id: number; cuit: string },
  encryptionKeyHex: string | undefined,
): Promise<StoredArcaCredentials | null> {
  const row = await prisma.arcaCredential.findUnique({ where: whereFor(org.id) })
  if (!row) return null

  const key = parseEncryptionKey(encryptionKeyHex)
  const privateKeyPem = decryptSecret(row.privateKeyEncrypted, key, aadFor(org.id))
  // Vuelve a validar al usarla: el certificado pudo vencer desde que se cargó.
  const inspected = inspectCredential({ certificatePem: row.certificate, privateKeyPem, expectedCuit: org.cuit })
  return {
    credentials: { cuit: org.cuit, certificatePem: normalizePem(row.certificate), privateKeyPem },
    fingerprint: inspected.fingerprint,
  }
}
