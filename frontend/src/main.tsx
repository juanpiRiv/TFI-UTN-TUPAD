import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { createBrowserRouter } from 'react-router'
import { RouterProvider } from 'react-router/dom'
import { AppProviders } from './app/providers'
import { createQueryClient } from './app/query-client'
import { createRoutes } from './app/router'
import './index.css'

const queryClient = createQueryClient()
const router = createBrowserRouter(createRoutes(queryClient))

const rootElement = document.getElementById('root')
if (!rootElement) throw new Error('No se encontro el elemento #root')

createRoot(rootElement).render(
  <StrictMode>
    <AppProviders queryClient={queryClient}>
      <RouterProvider router={router} />
    </AppProviders>
  </StrictMode>,
)
