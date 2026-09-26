// Display-only formatting. Amounts arrive from the backend as decimal strings and are never
// summed or converted here: Intl formats the string without going through floating point math.

export type Currency = 'ARS' | 'USD'

const moneyFormatters = new Map<Currency, Intl.NumberFormat>()

function moneyFormatter(currency: Currency): Intl.NumberFormat {
  let formatter = moneyFormatters.get(currency)
  if (!formatter) {
    formatter = new Intl.NumberFormat('es-AR', {
      style: 'currency',
      currency,
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })
    moneyFormatters.set(currency, formatter)
  }
  return formatter
}

/** Formats a decimal string such as "1234.50" as "$ 1.234,50". */
export function formatMoney(amount: string, currency: Currency = 'ARS'): string {
  return moneyFormatter(currency).format(amount as Intl.StringNumericLiteral)
}

const rateFormatter = new Intl.NumberFormat('es-AR', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 6,
})

/** Formats an exchange rate such as "1385.500000" as "1.385,50". */
export function formatRate(rate: string): string {
  return rateFormatter.format(rate as Intl.StringNumericLiteral)
}

/** Formats an ISO date ("2026-09-10" or a full timestamp) as "10/09/2026" without timezone shifts. */
export function formatDate(isoDate: string): string {
  const [year, month, day] = isoDate.slice(0, 10).split('-')
  if (!year || !month || !day) return isoDate
  return `${day}/${month}/${year}`
}

/** Today's date as YYYY-MM-DD in the user's local time. */
export function todayIso(now: Date = new Date()): string {
  const month = String(now.getMonth() + 1).padStart(2, '0')
  const day = String(now.getDate()).padStart(2, '0')
  return `${now.getFullYear()}-${month}-${day}`
}

/** First and last day of the month that contains `now`, as YYYY-MM-DD. */
export function currentMonthRange(now: Date = new Date()): { from: string; to: string } {
  const first = new Date(now.getFullYear(), now.getMonth(), 1)
  const last = new Date(now.getFullYear(), now.getMonth() + 1, 0)
  return { from: todayIso(first), to: todayIso(last) }
}
