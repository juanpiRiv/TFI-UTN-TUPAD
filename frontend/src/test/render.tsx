import { QueryClient } from '@tanstack/react-query'
import { render } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createMemoryRouter, RouterProvider } from 'react-router'
import { AppProviders } from '@/app/providers'
import { createRoutes } from '@/app/router'
import { setUnauthorizedHandler } from '@/lib/api'

/** Renders the whole app (real routes, guards and lazy pages) starting at `path`. */
export function renderApp(path: string) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  const router = createMemoryRouter(createRoutes(queryClient), { initialEntries: [path] })
  setUnauthorizedHandler(() => {
    queryClient.clear()
    void router.navigate('/login', { replace: true })
  })
  const user = userEvent.setup()
  const view = render(
    <AppProviders queryClient={queryClient}>
      <RouterProvider router={router} />
    </AppProviders>,
  )
  return { ...view, user, router, queryClient }
}
