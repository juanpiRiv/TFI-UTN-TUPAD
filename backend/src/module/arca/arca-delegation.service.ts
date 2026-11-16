import { prisma } from '../../lib/prisma.js'
import { AppError } from '../../lib/error.js'
import { ArcaSdkError } from './sdk/errors.js'
import { wrapSdkError } from './sdk/mapping.js'
import { ProviderUnavailableError } from './errors.js'
import { evictOrganizationProviders } from './provider-cache.js'
import { environmentOf, getDelegatedProvider, loadPlatformCredentials, type DelegationEnv, type PlatformCredentials } from './delegation-platform.js'
import type { FiscalProvider } from './fiscal-provider.js'
import { isPlatformCuit, isPlatformOwnerEmail, type PlatformOwnerEnv } from './platform-owner.js'

/** Espacio del bloqueo asesor de PostgreSQL: serializa verificar y borrar la delegación de una misma organización. */
const LOCK_NAMESPACE = 7301
/** Mínimo entre dos verificaciones de la misma organización y tope de verificaciones simultáneas contra ARCA. */
const MIN_INTERVAL_MS = 15_000
const MAX_CONCURRENT_VERIFICATIONS = 3

// Límites en memoria, por proceso: alcanzan para frenar un abuso sin dependencias nuevas.
const lastVerifyAt = new Map<number, number>()
let inFlight = 0

/** Solo para tests. */
export function resetVerifyLimits(): void {
  lastVerifyAt.clear()
  inFlight = 0
}

/** Motivos de autenticación que la librería clasifica y que se muestran como «todavía no figura la delegación». */
export const NOT_DELEGATED_REASONS = ['missing_relationship', 'invalid_token'] as const

type Env = DelegationEnv & PlatformOwnerEnv

const FACTURA_C = 11

export const MESSAGES = {
  unavailable: 'La conexión por delegación no está disponible en este momento.',
  tooSoon: 'Esperá unos segundos antes de volver a verificar.',
  busy: 'Hay muchas verificaciones en curso. Probá de nuevo en unos segundos.',
  changed: 'Los datos de la organización cambiaron mientras se verificaba. Volvé a verificar.',
  noPointOfSale: 'Creá primero tu punto de venta para poder verificar la conexión.',
  arcaDown: 'No pudimos comunicarnos con ARCA en este momento. Probá de nuevo más tarde.',
  notDelegated: (platformCuit: string) =>
    `Todavía no figura la delegación en ARCA. Revisá que delegaste «Facturación Electrónica» al CUIT ${platformCuit} y volvé a verificar.`,
} as const

export interface ArcaDelegationView {
  available: boolean
  platformCuit?: string
  status: 'NOT_STARTED' | 'VERIFIED' | 'FAILED'
  verifiedAt?: string
  lastCheckedAt?: string
  message?: string
}

export interface VerifyDeps {
  /** Solo para tests: reemplaza la construcción del proveedor delegado. */
  buildProvider?: (org: { id: number; cuit: string }, platform: PlatformCredentials) => FiscalProvider
  now?: () => Date
}

async function requireOrganization(userId: number) {
  const org = await prisma.organization.findUnique({ where: { userId }, select: { id: true, cuit: true, user: { select: { email: true } } } })
  if (!org) throw new AppError(403, 'Organization required')
  return org
}

async function viewOf(env: Env, org: { id: number; cuit: string }, platform: PlatformCredentials | null, extraMessage?: string): Promise<ArcaDelegationView> {
  if (!platform) return { available: false, status: 'NOT_STARTED' }
  const row = await prisma.arcaDelegation.findUnique({ where: { organizationId: org.id } })
  // Una fila de otro ambiente (homologación vs. producción) o de otro CUIT no vale acá: se informa como si no existiera.
  const current = row && row.environment === environmentOf(env) && row.verifiedCuit === org.cuit ? row : null
  const message = extraMessage ?? (current?.status === 'FAILED' ? (current.lastError ?? undefined) : undefined)
  return {
    available: true,
    platformCuit: platform.credentials.cuit,
    status: current?.status ?? 'NOT_STARTED',
    ...(current?.verifiedAt ? { verifiedAt: current.verifiedAt.toISOString() } : {}),
    ...(current ? { lastCheckedAt: current.lastCheckedAt.toISOString() } : {}),
    ...(message === undefined ? {} : { message }),
  }
}

/** Estado de la delegación de la organización. No llama a ARCA. */
export async function getArcaDelegation(userId: number, env: Env): Promise<ArcaDelegationView> {
  const org = await requireOrganization(userId)
  return viewOf(env, org, loadPlatformCredentials(env))
}

/** ARCA dice que el CUIT representado no le delegó el servicio a quien firma. */
export function isNotDelegated(error: ArcaSdkError): boolean {
  if (error.kind !== 'authentication') return false
  return (NOT_DELEGATED_REASONS as readonly string[]).includes(error.authReason ?? '') || error.providerCode === '600' || error.providerCode === '601'
}

/**
 * Comprueba con una consulta de solo lectura (último comprobante autorizado del primer punto de venta activo) que ARCA
 * acepta a la plataforma como representante de la organización.
 */
export async function verifyArcaDelegation(userId: number, env: Env, deps: VerifyDeps = {}): Promise<ArcaDelegationView> {
  const { user, ...org } = await requireOrganization(userId)
  const platform = loadPlatformCredentials(env)
  if (!platform) throw new AppError(409, MESSAGES.unavailable)
  // El CUIT de la plataforma lo puede registrar cualquiera: solo sus dueños pueden verificarlo.
  if (isPlatformCuit(env, org.cuit) && !isPlatformOwnerEmail(env, user.email)) throw new AppError(409, MESSAGES.unavailable)

  const pointOfSale = await prisma.pointOfSale.findFirst({ where: { organizationId: org.id, isActive: true }, orderBy: { number: 'asc' }, select: { number: true } })
  if (!pointOfSale) return viewOf(env, org, platform, MESSAGES.noPointOfSale)

  const now = (deps.now ?? (() => new Date()))()
  if (inFlight >= MAX_CONCURRENT_VERIFICATIONS) throw new AppError(429, MESSAGES.busy)
  const last = lastVerifyAt.get(org.id)
  if (last !== undefined && now.getTime() - last < MIN_INTERVAL_MS) throw new AppError(429, MESSAGES.tooSoon)
  lastVerifyAt.set(org.id, now.getTime())
  inFlight++
  try {
    return await runVerification(userId, env, org, platform, pointOfSale.number, now, deps)
  } finally {
    inFlight--
  }
}

async function runVerification(
  userId: number,
  env: Env,
  org: { id: number; cuit: string },
  platform: PlatformCredentials,
  pointOfSale: number,
  now: Date,
  deps: VerifyDeps,
): Promise<ArcaDelegationView> {
  const environment = environmentOf(env)
  // Marca para saber si alguien borró la delegación mientras ARCA contestaba: si es así, el borrado gana.
  const lastDelete = async (db: Pick<typeof prisma, 'auditLog'>) =>
    (await db.auditLog.aggregate({ _max: { id: true }, where: { organizationId: org.id, action: 'arca_delegation.deleted' } }))._max.id ?? 0
  const deleteMark = await lastDelete(prisma)

  let failure: string | null = null
  try {
    const provider = deps.buildProvider ? deps.buildProvider(org, platform) : getDelegatedProvider(env, org, platform)
    await provider.getLastAuthorized({ cuit: org.cuit, pointOfSale, voucherType: FACTURA_C })
  } catch (error) {
    const wrapped = error instanceof ProviderUnavailableError ? null : wrapSdkError(error)
    if (wrapped && isNotDelegated(wrapped)) {
      failure = MESSAGES.notDelegated(platform.credentials.cuit)
      // `invalid_token` también puede ser un problema del certificado de la plataforma: el motivo queda en el registro.
      console.warn(`[arca] delegación no verificada (organización ${org.id}): authReason=${wrapped.authReason ?? 'n/a'} providerCode=${wrapped.providerCode ?? 'n/a'}`)
    } else {
      // El detalle (códigos de ARCA, red, configuración) queda en el registro del servidor; el usuario ve un texto genérico.
      console.error(`[arca] no se pudo verificar la delegación de la organización ${org.id}: ${error instanceof Error ? `${error.name}: ${error.message}` : 'error desconocido'}`)
      throw new AppError(503, MESSAGES.arcaDown)
    }
  }

  const data = failure
    ? { environment, status: 'FAILED' as const, verifiedCuit: org.cuit, lastCheckedAt: now, lastError: failure }
    : { environment, status: 'VERIFIED' as const, verifiedCuit: org.cuit, lastCheckedAt: now, verifiedAt: now, lastError: null }

  // Escribir y comprobar van juntos y bajo el mismo bloqueo que el borrado: nada se escribe si el CUIT cambió o si se
  // borró la delegación mientras se esperaba a ARCA.
  await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(${LOCK_NAMESPACE}, ${org.id})`
    const fresh = await tx.organization.findUnique({ where: { id: org.id }, select: { cuit: true } })
    if (!fresh || fresh.cuit !== org.cuit) throw new AppError(409, MESSAGES.changed)
    if ((await lastDelete(tx)) !== deleteMark) return false
    const row = await tx.arcaDelegation.upsert({ where: { organizationId: org.id }, create: { organizationId: org.id, ...data }, update: data })
    await tx.auditLog.create({
      data: { organizationId: org.id, userId, action: failure ? 'arca_delegation.failed' : 'arca_delegation.verified', entity: 'ArcaDelegation', entityId: row.id },
    })
    return true
  })
  evictOrganizationProviders(org.id)
  return viewOf(env, org, platform)
}

/** Borra la delegación (idempotente) y olvida el cliente guardado. No toca nada en ARCA: la delegación se quita allá. */
export async function deleteArcaDelegation(userId: number): Promise<void> {
  const { user: _user, ...org } = await requireOrganization(userId)
  await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(${LOCK_NAMESPACE}, ${org.id})`
    await tx.arcaDelegation.deleteMany({ where: { organizationId: org.id } })
    await tx.auditLog.create({
      data: { organizationId: org.id, userId, action: 'arca_delegation.deleted', entity: 'ArcaDelegation', entityId: org.id },
    })
  })
  evictOrganizationProviders(org.id)
}
