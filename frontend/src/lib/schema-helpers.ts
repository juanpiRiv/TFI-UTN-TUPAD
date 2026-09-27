import { z } from 'zod'

/** Optional text input: trims it and turns an empty string into null. */
export const optionalText = (max: number, message?: string) =>
  z
    .string()
    .trim()
    .max(max, message ?? `Hasta ${max} caracteres`)
    .transform((value) => (value === '' ? null : value))

/**
 * Normalizes a number typed by the user into a decimal string, without turning it into a
 * JS number. "1.500,50" (es-AR) and "1500.50" both become "1500.50".
 */
export function normalizeDecimal(input: string): string {
  const value = input.trim().replace(/\s/g, '')
  return value.includes(',') ? value.replace(/\./g, '').replace(',', '.') : value
}

/** True when `value` is a plain decimal string with up to `decimals` decimal places. */
export function isDecimal(value: string, decimals: number): boolean {
  return new RegExp(`^\\d+(\\.\\d{1,${decimals}})?$`).test(value)
}

/** True when a normalized decimal string is greater than zero, without float math. */
export function isPositiveDecimal(value: string): boolean {
  return /[1-9]/.test(value)
}
