import { useState } from 'react'
import { Button } from '@/components/ui/Button'
import { Modal } from '@/components/ui/Modal'
import { PageHeader } from '@/components/ui/PageHeader'
import { EmptyState, ErrorState, LoadingState } from '@/components/ui/States'
import { cn } from '@/lib/cn'
import { CategoryForm } from './CategoryForm'
import { useCategories, useCreateCategory, useUpdateCategory } from './queries'
import type { Category, MovementType } from './schemas'

type Editing = { mode: 'create'; type: MovementType } | { mode: 'edit'; category: Category } | null

const sections: { type: MovementType; title: string }[] = [
  { type: 'INCOME', title: 'Ingresos' },
  { type: 'EXPENSE', title: 'Egresos' },
]

export function CategoriesPage() {
  const [includeInactive, setIncludeInactive] = useState(false)
  const [editing, setEditing] = useState<Editing>(null)
  const categories = useCategories({ includeInactive })
  const createCategory = useCreateCategory()
  const updateCategory = useUpdateCategory()

  return (
    <>
      <PageHeader
        title="Categorías"
        description="Cada categoría es de ingreso o de egreso. No se borran: se dan de baja."
        actions={
          <Button onClick={() => setEditing({ mode: 'create', type: 'INCOME' })}>
            Nueva categoría
          </Button>
        }
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

      {categories.isPending ? (
        <LoadingState />
      ) : categories.isError ? (
        <ErrorState onRetry={() => void categories.refetch()} />
      ) : (
        <div className="grid gap-6 md:grid-cols-2">
          {sections.map((section) => {
            const items = categories.data.filter((category) => category.type === section.type)
            return (
              <section key={section.type} aria-labelledby={`categories-${section.type}`}>
                <div className="mb-2 flex items-center justify-between">
                  <h2 id={`categories-${section.type}`} className="font-semibold">
                    {section.title}
                  </h2>
                  <Button
                    variant="ghost"
                    onClick={() => setEditing({ mode: 'create', type: section.type })}
                  >
                    Agregar
                  </Button>
                </div>
                {items.length === 0 ? (
                  <EmptyState title="Sin categorías" />
                ) : (
                  <ul className="divide-y divide-slate-100 rounded-xl border border-slate-200 bg-white">
                    {items.map((category) => (
                      <li
                        key={category.id}
                        className="flex items-center justify-between gap-3 px-4 py-3"
                      >
                        <span
                          className={cn(
                            'min-w-0 truncate',
                            !category.isActive && 'text-slate-400 line-through',
                          )}
                        >
                          {category.name}
                        </span>
                        <div className="flex shrink-0 gap-3 text-sm">
                          <button
                            type="button"
                            className="text-slate-700 underline"
                            onClick={() => setEditing({ mode: 'edit', category })}
                          >
                            Editar
                          </button>
                          <button
                            type="button"
                            className="text-slate-700 underline"
                            onClick={() =>
                              updateCategory.mutate({
                                id: category.id,
                                input: { isActive: !category.isActive },
                              })
                            }
                          >
                            {category.isActive ? 'Dar de baja' : 'Reactivar'}
                          </button>
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            )
          })}
        </div>
      )}

      <Modal
        open={editing !== null}
        title={editing?.mode === 'edit' ? 'Editar categoría' : 'Nueva categoría'}
        onClose={() => setEditing(null)}
      >
        {editing && (
          <CategoryForm
            key={editing.mode === 'edit' ? editing.category.id : `new-${editing.type}`}
            category={editing.mode === 'edit' ? editing.category : undefined}
            defaultType={editing.mode === 'create' ? editing.type : undefined}
            onSubmit={(input) =>
              editing.mode === 'edit'
                ? updateCategory.mutateAsync({
                    id: editing.category.id,
                    input: { name: input.name },
                  })
                : createCategory.mutateAsync(input)
            }
            onDone={() => setEditing(null)}
          />
        )}
      </Modal>
    </>
  )
}
