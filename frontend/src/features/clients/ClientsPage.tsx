import { useDeferredValue, useState } from 'react'
import { Link } from 'react-router'
import { Button } from '@/components/ui/Button'
import { Modal } from '@/components/ui/Modal'
import { PageHeader } from '@/components/ui/PageHeader'
import { EmptyState, ErrorState, LoadingState } from '@/components/ui/States'
import { Table, type Column } from '@/components/ui/Table'
import { ClientForm } from './ClientForm'
import { useClients, useCreateClient, useSetClientActive, useUpdateClient } from './queries'
import { docTypeLabels, taxConditionLabels, type Client } from './schemas'

type Editing = { mode: 'create' } | { mode: 'edit'; client: Client } | null

export function ClientsPage() {
  const [search, setSearch] = useState('')
  const [includeInactive, setIncludeInactive] = useState(false)
  const [editing, setEditing] = useState<Editing>(null)
  const deferredSearch = useDeferredValue(search.trim())

  const clients = useClients({ search: deferredSearch || undefined, includeInactive })
  const createClient = useCreateClient()
  const updateClient = useUpdateClient()
  const setActive = useSetClientActive()

  const toggleActive = (client: Client) => {
    const action = client.isActive ? 'dar de baja' : 'reactivar'
    if (!window.confirm(`¿Querés ${action} a ${client.name}?`)) return
    setActive.mutate({ id: client.id, isActive: !client.isActive })
  }

  const columns: Column<Client>[] = [
    {
      header: 'Nombre',
      cell: (client) => (
        <div className="min-w-0">
          <p className="font-medium text-slate-900">{client.name}</p>
          {client.email && <p className="truncate text-xs text-slate-500">{client.email}</p>}
        </div>
      ),
    },
    {
      header: 'Documento',
      hideOnMobile: true,
      cell: (client) =>
        client.docType ? `${docTypeLabels[client.docType]} ${client.docNumber ?? ''}` : '—',
    },
    {
      header: 'Condición IVA',
      hideOnMobile: true,
      cell: (client) => (client.taxCondition ? taxConditionLabels[client.taxCondition] : '—'),
    },
    {
      header: 'Estado',
      cell: (client) =>
        client.isActive ? (
          <span className="rounded-full bg-green-50 px-2 py-0.5 text-xs text-green-800">
            Activo
          </span>
        ) : (
          <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-600">
            De baja
          </span>
        ),
    },
    {
      header: 'Acciones',
      className: 'text-right',
      cell: (client) => (
        <div className="flex flex-wrap justify-end gap-x-3 gap-y-1 text-sm">
          <Link to={`/movimientos?clientId=${client.id}`} className="text-brand-700 underline">
            Historial
          </Link>
          <button
            type="button"
            className="text-slate-700 underline"
            onClick={() => setEditing({ mode: 'edit', client })}
          >
            Editar
          </button>
          <button
            type="button"
            className={client.isActive ? 'text-red-700 underline' : 'text-slate-700 underline'}
            onClick={() => toggleActive(client)}
          >
            {client.isActive ? 'Dar de baja' : 'Reactivar'}
          </button>
        </div>
      ),
    },
  ]

  return (
    <>
      <PageHeader
        title="Clientes"
        description="La baja es lógica: el cliente conserva su historial."
        actions={<Button onClick={() => setEditing({ mode: 'create' })}>Nuevo cliente</Button>}
      />

      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center">
        <input
          type="search"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Buscar por nombre, documento o email"
          aria-label="Buscar clientes"
          className="w-full min-w-0 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm sm:max-w-sm"
        />
        <label className="flex items-center gap-2 text-sm text-slate-700">
          <input
            type="checkbox"
            checked={includeInactive}
            onChange={(event) => setIncludeInactive(event.target.checked)}
            className="size-4 accent-brand-700"
          />
          Mostrar dados de baja
        </label>
      </div>

      {clients.isPending ? (
        <LoadingState />
      ) : clients.isError ? (
        <ErrorState onRetry={() => void clients.refetch()} />
      ) : clients.data.length === 0 ? (
        <EmptyState
          title={deferredSearch ? 'No hay clientes que coincidan' : 'Todavía no cargaste clientes'}
          action={
            !deferredSearch && (
              <Button onClick={() => setEditing({ mode: 'create' })}>Nuevo cliente</Button>
            )
          }
        />
      ) : (
        <Table
          caption="Clientes"
          columns={columns}
          rows={clients.data}
          rowKey={(client) => client.id}
        />
      )}

      <Modal
        open={editing !== null}
        title={editing?.mode === 'edit' ? 'Editar cliente' : 'Nuevo cliente'}
        onClose={() => setEditing(null)}
      >
        {editing && (
          <ClientForm
            key={editing.mode === 'edit' ? editing.client.id : 'new'}
            client={editing.mode === 'edit' ? editing.client : undefined}
            onSubmit={(input) =>
              editing.mode === 'edit'
                ? updateClient.mutateAsync({ id: editing.client.id, input })
                : createClient.mutateAsync(input)
            }
            onDone={() => setEditing(null)}
          />
        )}
      </Modal>
    </>
  )
}
