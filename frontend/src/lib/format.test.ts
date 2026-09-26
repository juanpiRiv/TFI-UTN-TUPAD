import { describe, expect, it } from 'vitest'
import { formatDate, formatMoney } from '@/lib/format'

// Intl separates the symbol with a non-breaking space; normalize it to compare.
const plain = (value: string) => value.replace(/\s/g, ' ')

describe('format', () => {
  it('formats decimal strings as es-AR money without float math', () => {
    expect(plain(formatMoney('1234567.5'))).toBe('$ 1.234.567,50')
    expect(plain(formatMoney('10', 'USD'))).toBe('US$ 10,00')
  })

  it('formats ISO dates without timezone shifts', () => {
    expect(formatDate('2026-09-01')).toBe('01/09/2026')
    expect(formatDate('2026-09-01T00:00:00.000Z')).toBe('01/09/2026')
  })
})
