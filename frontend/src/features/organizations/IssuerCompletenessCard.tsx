import { useIssuerCompleteness } from './queries'

/** Moves the focus to a field of the organization form on this same page. */
function goToField(field: string) {
  const element = document.getElementById(field)
  if (element) {
    element.focus()
  }
}

export function IssuerCompletenessCard() {
  const completeness = useIssuerCompleteness()
  const data = completeness.data
  if (!data) return null

  if (data.complete) {
    return (
      <section
        aria-labelledby="issuer-title"
        className="mb-4 rounded-lg bg-brand-50 px-3 py-2 text-sm text-brand-800"
      >
        <h2 id="issuer-title" className="font-semibold">
          Datos para facturar
        </h2>
        <p role="status">Tus datos están completos para emitir facturas.</p>
      </section>
    )
  }

  return (
    <section
      aria-labelledby="issuer-title"
      className="mb-4 rounded-2xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900"
    >
      <h2 id="issuer-title" className="font-semibold">
        Datos para facturar
      </h2>
      <p className="mt-1">
        Para emitir facturas faltan estos datos. Completalos en el formulario de abajo y guardá los
        cambios.
      </p>
      <ul className="mt-2 list-disc space-y-1 pl-5">
        {data.missing.map((item) => (
          <li key={item.field}>
            {item.label}{' '}
            <button
              type="button"
              aria-label={`Completar ${item.label}`}
              onClick={() => goToField(item.field)}
              className="font-medium underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-700"
            >
              Completar
            </button>
          </li>
        ))}
      </ul>
    </section>
  )
}
