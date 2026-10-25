import { screen, waitFor, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { db } from '@/mocks/db'
import { loginAs, seedOrganization, seedUser } from '@/test/fixtures'
import { renderApp } from '@/test/render'

type User = ReturnType<typeof renderApp>['user']

function setup() {
  const user = seedUser('lucia@example.com')
  seedOrganization(user.id)
  loginAs(user.id)
}

/** The list row (<li>) that shows an activity, to look for its badge and buttons. */
async function findRow(description: string) {
  const row = (await screen.findByText(description)).closest('li')
  if (!row) throw new Error(`No row for ${description}`)
  return within(row)
}

async function createActivity(user: User, description: string, kind: string, code = '') {
  await user.click(await screen.findByRole('button', { name: 'Nueva actividad' }))
  const dialog = within(await screen.findByRole('dialog'))
  await user.type(dialog.getByLabelText('Descripción'), description)
  await user.selectOptions(dialog.getByLabelText('¿Qué vendés con esta actividad?'), kind)
  if (code) await user.type(dialog.getByLabelText('Código de actividad de ARCA (opcional)'), code)
  await user.click(dialog.getByRole('button', { name: 'Crear actividad' }))
}

describe('activities', () => {
  it('is reachable from the main menu and starts empty', async () => {
    setup()
    const { user, router } = renderApp('/categorias')

    await user.click(await screen.findByRole('link', { name: 'Actividades' }))

    expect(await screen.findByText('Todavía no cargaste actividades')).toBeInTheDocument()
    expect(router.state.location.pathname).toBe('/actividades')
  })

  it('creates several activities of each kind and the first one is the primary', async () => {
    setup()
    const { user } = renderApp('/actividades')

    await createActivity(user, 'Desarrollo de software', 'SERVICES', '620100')
    await screen.findByText('Desarrollo de software')
    await createActivity(user, 'Venta de equipos y soporte', 'BOTH')

    const second = await findRow('Venta de equipos y soporte')
    expect(second.getByText('Productos y servicios')).toBeInTheDocument()
    expect(second.queryByText('Principal')).not.toBeInTheDocument()

    const first = await findRow('Desarrollo de software')
    expect(first.getByText('Principal')).toBeInTheDocument()
    expect(first.getByText(/Código 620100/)).toBeInTheDocument()
  })

  it('validates the ARCA code before calling the backend', async () => {
    setup()
    const { user } = renderApp('/actividades')

    await createActivity(user, 'Diseño gráfico', 'SERVICES', '1234')

    expect(await screen.findByText('El código tiene 6 números')).toBeInTheDocument()
    expect(db.activities).toHaveLength(0)
  })

  it('edits an activity and changes the primary one', async () => {
    setup()
    const { user } = renderApp('/actividades')
    await createActivity(user, 'Desarrollo de software', 'SERVICES')
    await createActivity(user, 'Venta de equipos', 'GOODS')

    await user.click((await findRow('Venta de equipos')).getByRole('button', { name: 'Editar' }))
    const dialog = within(await screen.findByRole('dialog'))
    const description = dialog.getByLabelText('Descripción')
    await user.clear(description)
    await user.type(description, 'Venta de computadoras')
    await user.click(dialog.getByRole('button', { name: 'Guardar cambios' }))

    const edited = await findRow('Venta de computadoras')
    await user.click(edited.getByRole('button', { name: 'Marcar como principal' }))

    expect(
      await (await findRow('Venta de computadoras')).findByText('Principal'),
    ).toBeInTheDocument()
    expect(db.activities.filter((activity) => activity.isPrimary)).toHaveLength(1)
  })

  it('deactivates a secondary activity and can show it again', async () => {
    setup()
    const { user } = renderApp('/actividades')
    await createActivity(user, 'Desarrollo de software', 'SERVICES')
    await createActivity(user, 'Venta de equipos', 'GOODS')

    await user.click(
      (await findRow('Venta de equipos')).getByRole('button', { name: 'Dar de baja' }),
    )
    await waitFor(() => expect(screen.queryByText('Venta de equipos')).not.toBeInTheDocument())

    await user.click(screen.getByLabelText('Mostrar dadas de baja'))
    const inactive = await findRow('Venta de equipos')
    expect(inactive.getByRole('button', { name: 'Reactivar' })).toBeInTheDocument()
  })
})
