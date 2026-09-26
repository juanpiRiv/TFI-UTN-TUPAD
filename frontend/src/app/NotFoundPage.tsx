import { Link } from 'react-router'

export function NotFoundPage() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col items-center justify-center gap-4 px-4 text-center">
      <h1 className="text-xl font-semibold">No encontramos esta página</h1>
      <Link to="/" className="font-medium text-brand-700 underline">
        Volver al inicio
      </Link>
    </main>
  )
}
