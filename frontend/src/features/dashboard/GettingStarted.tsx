import { useState } from 'react'
import { Link } from 'react-router'
import { Button } from '@/components/ui/Button'
import { useMe } from '@/features/auth/queries'
import { useClients } from '@/features/clients/queries'
import { useInvoicesQuery } from '@/features/invoices/queries'
import { cn } from '@/lib/cn'

const HIDDEN_KEY = 'primeros-pasos-ocultos'

function readHidden(): boolean {
  try {
    return window.localStorage.getItem(HIDDEN_KEY) === 'true'
  } catch {
    return false
  }
}

function writeHidden(): void {
  try {
    window.localStorage.setItem(HIDDEN_KEY, 'true')
  } catch {
    // Sin almacenamiento (modo privado): se oculta solo mientras la página siga abierta.
  }
}

type Step = { id: string; label: string; hint: string; to: string; done: boolean }

/**
 * Lista de primeros pasos para quien recién empieza. Cada paso se tilda solo cuando ya está hecho
 * (según los datos que ya tiene el usuario), se puede ocultar y desaparece cuando todos están completos.
 */
export function GettingStarted() {
  const [hidden, setHidden] = useState(readHidden)
  const { data: me } = useMe()
  const clients = useClients()
  const invoices = useInvoicesQuery()

  // Mientras carga o si algo falla no se muestra nada: una lista a medias confunde más de lo que ayuda.
  if (hidden || !me?.organization || !clients.data || !invoices.data) return null

  const organization = me.organization
  const list = invoices.data
  const steps: Step[] = [
    {
      id: 'negocio',
      label: 'Completá los datos de tu negocio',
      hint: 'Domicilio comercial e inicio de actividades: van impresos en cada factura.',
      to: '/organizacion',
      done: Boolean(organization.commercialAddress && organization.activityStartDate),
    },
    {
      id: 'cliente',
      label: 'Cargá tu primer cliente',
      hint: 'A quién le vas a facturar.',
      to: '/clientes',
      done: clients.data.length > 0,
    },
    {
      id: 'factura',
      label: 'Creá tu primera factura',
      hint: 'Queda como borrador hasta que la facturás.',
      to: '/facturas/nueva',
      done: list.length > 0,
    },
    {
      id: 'facturar',
      label: 'Facturá el borrador',
      hint: 'Pide la autorización y le asigna número.',
      to: '/facturas',
      done: list.some((invoice) => invoice.status !== 'DRAFT'),
    },
    {
      id: 'cobro',
      label: 'Registrá tu primer cobro',
      hint: 'Así ves la diferencia entre lo facturado y lo cobrado.',
      to: '/facturas',
      done: list.some((invoice) => Number(invoice.totalPaid) > 0),
    },
  ]
  const completed = steps.filter((step) => step.done).length
  if (completed === steps.length) return null

  return (
    <section
      aria-label="Primeros pasos"
      className="mb-6 rounded-xl border border-brand-200 bg-brand-50/50 p-5"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold text-slate-900">Primeros pasos</h2>
          <p className="mt-0.5 text-sm text-slate-600">
            Para dejar todo listo y emitir tu primera factura.{' '}
            <span className="font-medium">{completed} de {steps.length} pasos</span>
          </p>
        </div>
        <Button
          variant="ghost"
          onClick={() => {
            writeHidden()
            setHidden(true)
          }}
        >
          Ocultar
        </Button>
      </div>
      <ol className="mt-4 grid gap-2">
        {steps.map((step, index) => (
          <li
            key={step.id}
            data-testid={`step-${step.id}`}
            data-done={step.done}
            className="flex items-start gap-3 rounded-lg bg-white px-3 py-2"
          >
            <span
              aria-hidden="true"
              className={cn(
                'mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full text-xs font-semibold',
                step.done ? 'bg-emerald-600 text-white' : 'border border-slate-300 text-slate-500',
              )}
            >
              {step.done ? '✓' : index + 1}
            </span>
            <div className="min-w-0">
              <Link
                to={step.to}
                className={cn(
                  'text-sm font-medium hover:underline',
                  step.done ? 'text-slate-500 line-through' : 'text-brand-700',
                )}
              >
                {step.label}
              </Link>
              <p className="text-xs text-slate-500">
                {step.done && <span className="sr-only">Hecho. </span>}
                {step.hint}
              </p>
            </div>
          </li>
        ))}
      </ol>
    </section>
  )
}
