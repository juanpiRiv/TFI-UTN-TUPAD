import { useState } from 'react'
import { Button } from '@/components/ui/Button'
import { Modal } from '@/components/ui/Modal'
import { PageHeader } from '@/components/ui/PageHeader'
import { EmptyState, ErrorState, FormError, LoadingState } from '@/components/ui/States'
import { ApiError } from '@/lib/api'
import { cn } from '@/lib/cn'
import { PointOfSaleForm } from './PointOfSaleForm'
import { useCreatePointOfSale, usePointsOfSale, useUpdatePointOfSale } from './queries'
import { formatPointOfSaleNumber, type PointOfSale } from './schemas'

type Editing = { mode: 'create' } | { mode: 'edit'; pointOfSale: PointOfSale } | null

export function PointsOfSalePage() {
  const [includeInactive, setIncludeInactive] = useState(false)
  const [editing, setEditing] = useState<Editing>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const pointsOfSale = usePointsOfSale({ includeInactive })
  const createPointOfSale = useCreatePointOfSale()
  const updatePointOfSale = useUpdatePointOfSale()

  function toggleActive(pointOfSale: PointOfSale) {
    setActionError(null)
    updatePointOfSale.mutate(
      { id: pointOfSale.id, input: { isActive: !pointOfSale.isActive } },
      {
        onError: (error) =>
          setActionError(
            error instanceof ApiError ? error.message : 'No se pudo guardar el cambio.',
          ),
      },
    )
  }

  return (
    <>
      <PageHeader
        title="Puntos de venta"
        description="Los puntos de venta que habilitaste en ARCA para facturar por Web Service. Las facturas nuevas usan el activo de menor número."
        actions={
          <Button onClick={() => setEditing({ mode: 'create' })}>Nuevo punto de venta</Button>
        }
      />
      <label className="mb-4 flex items-center gap-2 text-sm text-slate-700">
        <input
          type="checkbox"
          checked={includeInactive}
          onChange={(event) => setIncludeInactive(event.target.checked)}
          className="size-4 accent-brand-700"
        />
        Mostrar dados de baja
      </label>
      <div className="mb-4">
        <FormError message={actionError} />
      </div>

      {pointsOfSale.isPending ? (
        <LoadingState />
      ) : pointsOfSale.isError ? (
        <ErrorState onRetry={() => void pointsOfSale.refetch()} />
      ) : pointsOfSale.data.length === 0 ? (
        <EmptyState
          title="Todavía no cargaste puntos de venta"
          description="Hace falta al menos uno para emitir facturas."
          action={
            <Button onClick={() => setEditing({ mode: 'create' })}>Cargar punto de venta</Button>
          }
        />
      ) : (
        <ul className="divide-y divide-slate-100 rounded-xl border border-slate-200 bg-white">
          {pointsOfSale.data.map((pointOfSale) => (
            <li
              key={pointOfSale.id}
              className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center sm:justify-between"
            >
              <div className="min-w-0">
                <p
                  className={cn(
                    'font-medium tabular-nums',
                    !pointOfSale.isActive && 'text-slate-400 line-through',
                  )}
                >
                  N° {formatPointOfSaleNumber(pointOfSale.number)}
                </p>
                <p className="truncate text-sm text-slate-500">
                  {pointOfSale.address ?? 'Sin domicilio cargado'}
                </p>
              </div>
              <div className="flex shrink-0 flex-wrap gap-3 text-sm">
                <button
                  type="button"
                  className="text-slate-700 underline"
                  onClick={() => setEditing({ mode: 'edit', pointOfSale })}
                >
                  Editar
                </button>
                <button
                  type="button"
                  className="text-slate-700 underline"
                  onClick={() => toggleActive(pointOfSale)}
                >
                  {pointOfSale.isActive ? 'Dar de baja' : 'Reactivar'}
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}

      <Modal
        open={editing !== null}
        title={editing?.mode === 'edit' ? 'Editar punto de venta' : 'Nuevo punto de venta'}
        onClose={() => setEditing(null)}
      >
        {editing && (
          <PointOfSaleForm
            key={editing.mode === 'edit' ? editing.pointOfSale.id : 'new'}
            pointOfSale={editing.mode === 'edit' ? editing.pointOfSale : undefined}
            onSubmit={(input) =>
              editing.mode === 'edit'
                ? updatePointOfSale.mutateAsync({ id: editing.pointOfSale.id, input })
                : createPointOfSale.mutateAsync(input)
            }
            onDone={() => setEditing(null)}
          />
        )}
      </Modal>
    </>
  )
}
