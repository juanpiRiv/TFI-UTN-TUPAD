import { useState } from 'react'
import { Button } from '@/components/ui/Button'
import { Modal } from '@/components/ui/Modal'
import { PageHeader } from '@/components/ui/PageHeader'
import { EmptyState, ErrorState, FormError, LoadingState } from '@/components/ui/States'
import { ApiError } from '@/lib/api'
import { cn } from '@/lib/cn'
import { ActivityForm } from './ActivityForm'
import { useActivities, useCreateActivity, useUpdateActivity } from './queries'
import { activityKindLabels, type Activity, type ActivityUpdate } from './schemas'

type Editing = { mode: 'create' } | { mode: 'edit'; activity: Activity } | null

export function ActivitiesPage() {
  const [includeInactive, setIncludeInactive] = useState(false)
  const [editing, setEditing] = useState<Editing>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const activities = useActivities({ includeInactive })
  const createActivity = useCreateActivity()
  const updateActivity = useUpdateActivity()

  // Quick actions from the list (primary, deactivate): errors show above the list.
  function runAction(id: number, input: ActivityUpdate) {
    setActionError(null)
    updateActivity.mutate(
      { id, input },
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
        title="Actividades"
        description="Las actividades bajo las que facturás. Una es la principal; no se borran: se dan de baja."
        actions={<Button onClick={() => setEditing({ mode: 'create' })}>Nueva actividad</Button>}
      />
      <label className="mb-4 flex items-center gap-2 text-sm text-slate-700">
        <input
          type="checkbox"
          checked={includeInactive}
          onChange={(event) => setIncludeInactive(event.target.checked)}
          className="size-4 accent-brand-700"
        />
        Mostrar dadas de baja
      </label>
      <div className="mb-4">
        <FormError message={actionError} />
      </div>

      {activities.isPending ? (
        <LoadingState />
      ) : activities.isError ? (
        <ErrorState onRetry={() => void activities.refetch()} />
      ) : activities.data.length === 0 ? (
        <EmptyState
          title="Todavía no cargaste actividades"
          description="Cargá al menos una: después se usa para clasificar tus facturas."
          action={<Button onClick={() => setEditing({ mode: 'create' })}>Cargar actividad</Button>}
        />
      ) : (
        <ul className="divide-y divide-slate-100 rounded-xl border border-slate-200 bg-white">
          {activities.data.map((activity) => (
            <li
              key={activity.id}
              className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center sm:justify-between"
            >
              <div className="min-w-0">
                <p
                  className={cn(
                    'flex flex-wrap items-center gap-2 font-medium',
                    !activity.isActive && 'text-slate-400 line-through',
                  )}
                >
                  <span className="truncate">{activity.description}</span>
                  {activity.isPrimary && (
                    <span className="rounded-full bg-brand-50 px-2 py-0.5 text-xs font-medium text-brand-800 no-underline">
                      Principal
                    </span>
                  )}
                </p>
                <p className="text-sm text-slate-500">
                  {activityKindLabels[activity.kind]}
                  {activity.arcaActivityCode && ` · Código ${activity.arcaActivityCode}`}
                </p>
              </div>
              <div className="flex shrink-0 flex-wrap gap-3 text-sm">
                <button
                  type="button"
                  className="text-slate-700 underline"
                  onClick={() => setEditing({ mode: 'edit', activity })}
                >
                  Editar
                </button>
                {activity.isActive && !activity.isPrimary && (
                  <button
                    type="button"
                    className="text-slate-700 underline"
                    onClick={() => runAction(activity.id, { isPrimary: true })}
                  >
                    Marcar como principal
                  </button>
                )}
                {!activity.isPrimary && (
                  <button
                    type="button"
                    className="text-slate-700 underline"
                    onClick={() => runAction(activity.id, { isActive: !activity.isActive })}
                  >
                    {activity.isActive ? 'Dar de baja' : 'Reactivar'}
                  </button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}

      <Modal
        open={editing !== null}
        title={editing?.mode === 'edit' ? 'Editar actividad' : 'Nueva actividad'}
        onClose={() => setEditing(null)}
      >
        {editing && (
          <ActivityForm
            key={editing.mode === 'edit' ? editing.activity.id : 'new'}
            activity={editing.mode === 'edit' ? editing.activity : undefined}
            onSubmit={(input) =>
              editing.mode === 'edit'
                ? updateActivity.mutateAsync({ id: editing.activity.id, input })
                : createActivity.mutateAsync(input)
            }
            onDone={() => setEditing(null)}
          />
        )}
      </Modal>
    </>
  )
}
