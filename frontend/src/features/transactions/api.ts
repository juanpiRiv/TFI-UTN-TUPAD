import { apiFetch } from '@/lib/api'
import type { ExchangeRate, Transaction, TransactionFilters, TransactionInput } from './schemas'

export function listTransactions(
  filters: TransactionFilters,
  signal?: AbortSignal,
): Promise<Transaction[]> {
  return apiFetch<Transaction[]>('/api/transactions', { query: filters, signal })
}

export function createTransaction(input: TransactionInput): Promise<Transaction> {
  return apiFetch<Transaction>('/api/transactions', { method: 'POST', body: input })
}

export function getUsdExchangeRate(date: string, signal?: AbortSignal): Promise<ExchangeRate> {
  return apiFetch<ExchangeRate>('/api/exchange-rates/usd', { query: { date }, signal })
}
