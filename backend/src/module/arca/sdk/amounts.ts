import { ArcaSdkInputError } from './errors.js'

const DECIMAL = /^(0|[1-9]\d{0,12})(?:\.(\d{1,2}))?$/

/**
 * Convierte un importe decimal en string ("1000.00") a centavos enteros.
 * Rechaza notacion cientifica, signos, separador de miles y mas de 2 decimales.
 * Limite 13 enteros + 2 decimales: Manual WSFEv1 V4.8, PDF p.29 (tipo "Double (13+2)"),
 * consultado 2026-10-19.
 */
export function decimalStringToCents(value: string, field: string): bigint {
  const m = DECIMAL.exec(value)
  if (!m) {
    throw new ArcaSdkInputError(`${field} no es un decimal valido (max 13 enteros y 2 decimales): "${value}"`, { field })
  }
  const whole = m[1] as string
  const frac = (m[2] ?? '').padEnd(2, '0')
  return BigInt(whole) * 100n + BigInt(frac)
}

/**
 * La API de bajo nivel del SDK (wsfe.issue) recibe importes como number en unidades de moneda
 * con hasta 2 decimales y los reserializa con BigInt. Se arma el number desde el string
 * canonico para no hacer aritmetica de punto flotante propia.
 */
export function centsToSdkNumber(cents: bigint): number {
  const s = cents.toString().padStart(3, '0')
  return Number(`${s.slice(0, -2)}.${s.slice(-2)}`)
}

export function decimalStringToSdkNumber(value: string, field: string): number {
  return centsToSdkNumber(decimalStringToCents(value, field))
}
