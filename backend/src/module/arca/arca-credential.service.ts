import { X509Certificate } from 'node:crypto'
import { prisma } from '../../lib/prisma.js'
import { AppError } from '../../lib/error.js'
import { CredentialError, inspectCredential, normalizePem } from './credential-inspector.js'
import { decryptSecret, encryptSecret, EncryptionKeyError, parseEncryptionKey } from './secret-box.js'
import type { ArcaCredentials } from './provider-factory.js'
import { evictOrganizationProviders } from './provider-cache.js'

/** Por ahora solo se cargan credenciales de homologación y del servicio de facturación electrónica. */
const ENVIRONMENT = 'HOMOLOGACION' as const
const SERVICE = 'wsfe'

export interface ArcaCredentialStatus {
  configured: boolean
  environment?: 'HOMOLOGACION' | 'PRODUCCION'
  certificateExpiresAt?: string
  updatedAt?: string
}

// El dato asociado ata el secreto a la organización, al ambiente y al servicio: copiado a otra fila no se descifra.
export const aadFor = (organizationId: number) => `arca-credential:${organizationId}:${ENVIRONMENT}:${SERVICE}`
const whereFor = (organizationId: number) => ({
  organizationId_environment_service: { organizationId, environment: ENVIRONMENT, service: SERVICE },
})

async function requireOrganization(userId: number) {
  const org = await prisma.organization.findUnique({ where: { userId }, select: { id: true, cuit: true } })
  if (!org) throw new AppError(403, 'Organization required')
  return org
}

function encryptionKey(hex: string | undefined): Buffer {
  try {
    return parseEncryptionKey(hex)
  } catch (error) {
    if (error instanceof EncryptionKeyError) {
      throw new AppError(503, 'El servidor no tiene configurada la clave de cifrado de ARCA: no se puede guardar la credencial.')
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
  const row = await prisma.arcaCredential.findUnique({ where: whereFor(org.id) })
  return row ? statusOf(row) : { configured: false }
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

  try {
    inspectCredential({ certificatePem: input.certificate, privateKeyPem: input.privateKey, expectedCuit: org.cuit })
  } catch (error) {
    if (error instanceof CredentialError) throw new AppError(422, error.message)
    throw error
  }

  const certificate = normalizePem(input.certificate)
  const privateKeyEncrypted = encryptSecret(normalizePem(input.privateKey), key, aadFor(org.id))
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
