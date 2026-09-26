import { z } from 'zod'

/** Optional text input: trims it and turns an empty string into null. */
export const optionalText = (max: number, message?: string) =>
  z
    .string()
    .trim()
    .max(max, message ?? `Hasta ${max} caracteres`)
    .transform((value) => (value === '' ? null : value))

/**
 * Money amount typed by the user. Accepts "1500", "1500.50" or "1500,50" and returns a
 * normalized decimal string ("1500.50"). The value is never turned into a number.
 */
export const decimalString = (decimals: number, requiredMessage: string) =>
  z
    .string()
    .trim()
    .min(1, requiredMessage)
    // "1.500,50" uses dots as thousands separators; "1500.50" uses the dot as decimal point.
    .transform((value) =>
      value.includes(',') ? value.replace(/\./g, '').replace(',', '.') : value,
    )
    .refine((value) => new RegExp(`^\\d+(\\.\\d{1,${decimals}})?$`).test(value), {
      message: `Ingresá un número válido, con hasta ${decimals} decimales`,
    })

/** True when a normalized decimal string is greater than zero, without float math. */
export function isPositiveDecimal(value: string): boolean {
  return /[1-9]/.test(value)
}
