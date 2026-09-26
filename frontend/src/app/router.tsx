import type { QueryClient } from '@tanstack/react-query'
import type { RouteObject } from 'react-router'
import { LoadingState } from '@/components/ui/States'
import { AppLayout } from './layout/AppLayout'
import { NotFoundPage } from './NotFoundPage'
import { RouteError } from './RouteError'

export function createRoutes(_queryClient: QueryClient): RouteObject[] {
  return [
    {
      errorElement: <RouteError />,
      hydrateFallbackElement: <LoadingState />,
      children: [
        { path: 'login', element: <h1 className="p-6 text-xl">Login (próximamente)</h1> },
        {
          Component: AppLayout,
          children: [{ index: true, element: <h1 className="text-xl">Dashboard</h1> }],
        },
        { path: '*', Component: NotFoundPage },
      ],
    },
  ]
}
