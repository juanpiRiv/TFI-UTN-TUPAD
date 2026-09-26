import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { createBrowserRouter } from 'react-router'
import { RouterProvider } from 'react-router/dom'
import { AppProviders } from './app/providers'
import { createQueryClient } from './app/query-client'
import { createRoutes } from './app/router'
import { setUnauthorizedHandler } from './lib/api'
import './index.css'

async function enableMocks(): Promise<void> {
  if (import.meta.env.VITE_USE_MOCKS !== 'true') return
  const { startMockWorker } = await import('./mocks/browser')
  await startMockWorker()
}

async function bootstrap(): Promise<void> {
  await enableMocks()

  const queryClient = createQueryClient()
  const router = createBrowserRouter(createRoutes(queryClient))

  // Session expired or token rejected: drop cached data and go back to the login.
  setUnauthorizedHandler(() => {
    queryClient.clear()
    void router.navigate('/login', { replace: true })
  })

  const rootElement = document.getElementById('root')
  if (!rootElement) throw new Error('No se encontro el elemento #root')

  createRoot(rootElement).render(
    <StrictMode>
      <AppProviders queryClient={queryClient}>
        <RouterProvider router={router} />
      </AppProviders>
    </StrictMode>,
  )
}

void bootstrap()
