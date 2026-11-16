import { isDelegationEnabled } from './delegation-platform.js'

export interface PlatformOwnerEnv {
  ARCA_PROVIDER?: string | undefined
  ARCA_CUIT?: string | undefined
  ARCA_DELEGATION?: string | undefined
  ARCA_PLATFORM_OWNER_EMAILS?: string | undefined
  NODE_ENV?: string | undefined
}

/**
 * El CUIT dueño del certificado de la plataforma está protegido cuando las variables ARCA_* firman de verdad:
 * con el proveedor sdk o con el modo delegado. Sin eso no hay certificado que proteger.
 */
export function isPlatformCuit(env: PlatformOwnerEnv, cuit: string): boolean {
  const platformCuit = env.ARCA_CUIT?.trim()
  if (!platformCuit || platformCuit !== cuit) return false
  return env.ARCA_PROVIDER?.trim() === 'sdk' || isDelegationEnabled(env)
}

/** Lista blanca de correos (ARCA_PLATFORM_OWNER_EMAILS) que pueden operar con el CUIT de la plataforma. Vacía = nadie. */
export function isPlatformOwnerEmail(env: PlatformOwnerEnv, email: string | null | undefined): boolean {
  if (!email) return false
  const allowed = (env.ARCA_PLATFORM_OWNER_EMAILS ?? '').split(',').map((e) => e.trim().toLowerCase()).filter(Boolean)
  return allowed.includes(email.trim().toLowerCase())
}
