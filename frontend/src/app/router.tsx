import type { QueryClient } from '@tanstack/react-query'
import type { RouteObject } from 'react-router'
import { LoadingState } from '@/components/ui/States'
import { createGuards } from './guards'
import { NotFoundPage } from './NotFoundPage'
import { RouteError } from './RouteError'

export function createRoutes(queryClient: QueryClient): RouteObject[] {
  const guards = createGuards(queryClient)

  return [
    {
      errorElement: <RouteError />,
      hydrateFallbackElement: <LoadingState />,
      children: [
        {
          loader: guards.publicOnly,
          lazy: () =>
            import('@/features/auth/AuthLayout').then((m) => ({ Component: m.AuthLayout })),
          children: [
            {
              path: 'login',
              lazy: () =>
                import('@/features/auth/LoginPage').then((m) => ({ Component: m.LoginPage })),
            },
            {
              path: 'registro',
              lazy: () =>
                import('@/features/auth/RegisterPage').then((m) => ({ Component: m.RegisterPage })),
            },
          ],
        },
        {
          path: 'onboarding',
          loader: guards.requireOnboarding,
          element: <h1 className="p-6 text-xl">Onboarding (próximamente)</h1>,
        },
        {
          loader: guards.requireOrganization,
          lazy: () => import('./layout/AppShell').then((m) => ({ Component: m.AppShell })),
          children: [{ index: true, element: <h1 className="text-xl">Dashboard</h1> }],
        },
        { path: '*', Component: NotFoundPage },
      ],
    },
  ]
}
