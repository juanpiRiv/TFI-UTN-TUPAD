import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { dashboardKeys } from '@/features/dashboard/queries'
import * as transactionsApi from './api'
import type { TransactionFilters } from './schemas'

export const transactionKeys = {
  all: ['transactions'] as const,
  lists: () => [...transactionKeys.all, 'list'] as const,
  list: (filters: TransactionFilters) => [...transactionKeys.lists(), filters] as const,
}

export const exchangeRateKeys = {
  all: ['exchange-rates'] as const,
  usd: (date: string) => [...exchangeRateKeys.all, 'usd', date] as const,
}

export function useTransactions(filters: TransactionFilters) {
  return useQuery({
    queryKey: transactionKeys.list(filters),
    queryFn: ({ signal }) => transactionsApi.listTransactions(filters, signal),
    placeholderData: keepPreviousData,
  })
}

export function useCreateTransaction() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: transactionsApi.createTransaction,
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: transactionKeys.all }),
        // The dashboard totals depend on the transactions.
        queryClient.invalidateQueries({ queryKey: dashboardKeys.all }),
      ])
    },
  })
}

/** Suggested USD rate for a date. It is only a suggestion: the user can edit it. */
export function useUsdExchangeRate(date: string, enabled: boolean) {
  return useQuery({
    queryKey: exchangeRateKeys.usd(date),
    queryFn: ({ signal }) => transactionsApi.getUsdExchangeRate(date, signal),
    enabled: enabled && /^\d{4}-\d{2}-\d{2}$/.test(date),
    staleTime: 60 * 60_000,
    retry: false,
  })
}
