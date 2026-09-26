import { http, HttpResponse } from 'msw'
import { API_URL } from '@/lib/api'
import { centsToDecimal } from '../money'
import { invalidData, resolveUser } from './context'

/** Last business day on or before `date` (weekends only; the real backend also skips holidays). */
function lastBusinessDay(date: string): string {
  const day = new Date(`${date}T12:00:00Z`)
  while (day.getUTCDay() === 0 || day.getUTCDay() === 6) day.setUTCDate(day.getUTCDate() - 1)
  return day.toISOString().slice(0, 10)
}

/** A deterministic, plausible USD rate for the demo: it moves a little with the date. */
function sampleRate(date: string): string {
  const [year = 0, month = 0, day = 0] = date.split('-').map(Number)
  const cents = 130_000n + BigInt((year - 2026) * 36_500 + month * 1_500 + day * 50)
  return `${centsToDecimal(cents)}0000`
}

export const exchangeRateHandlers = [
  http.get(`${API_URL}/api/exchange-rates/usd`, ({ request }) => {
    const context = resolveUser(request)
    if (context instanceof Response) return context
    const date = new URL(request.url).searchParams.get('date') ?? ''
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return invalidData([{ field: 'date', message: 'Invalid date' }])
    }
    const observedAt = lastBusinessDay(date)
    return HttpResponse.json({
      date,
      observedAt,
      value: sampleRate(observedAt),
      source: 'BCRA',
      rateType: 'ESTADISTICAS_CAMBIARIAS',
    })
  }),
]
