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
          lazy: () =>
            import('@/features/organizations/OnboardingPage').then((m) => ({
              Component: m.OnboardingPage,
            })),
        },
        {
          loader: guards.requireOrganization,
          lazy: () => import('./layout/AppShell').then((m) => ({ Component: m.AppShell })),
          children: [
            {
              index: true,
              lazy: () =>
                import('@/features/dashboard/DashboardPage').then((m) => ({
                  Component: m.DashboardPage,
                })),
            },
            {
              path: 'movimientos',
              lazy: () =>
                import('@/features/transactions/TransactionsPage').then((m) => ({
                  Component: m.TransactionsPage,
                })),
            },
            {
              path: 'clientes',
              lazy: () =>
                import('@/features/clients/ClientsPage').then((m) => ({
                  Component: m.ClientsPage,
                })),
            },
            {
              path: 'categorias',
              lazy: () =>
                import('@/features/categories/CategoriesPage').then((m) => ({
                  Component: m.CategoriesPage,
                })),
            },
            {
              path: 'organizacion',
              lazy: () =>
                import('@/features/organizations/OrganizationPage').then((m) => ({
                  Component: m.OrganizationPage,
                })),
            },
          ],
        },
        { path: '*', Component: NotFoundPage },
      ],
    },
  ]
}
