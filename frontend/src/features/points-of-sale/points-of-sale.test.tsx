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

/** The list row (<li>) of a point of sale, found by its formatted number. */
async function findRow(label: string) {
  const row = (await screen.findByText(label)).closest('li')
  if (!row) throw new Error(`No row for ${label}`)
  return within(row)
}

async function createPointOfSale(user: User, number: string, address = '') {
  await user.click(await screen.findByRole('button', { name: 'Nuevo punto de venta' }))
  const dialog = within(await screen.findByRole('dialog'))
  await user.type(dialog.getByLabelText('Número'), number)
  if (address) await user.type(dialog.getByLabelText('Domicilio (opcional)'), address)
  await user.click(dialog.getByRole('button', { name: 'Crear punto de venta' }))
}

describe('points of sale', () => {
  it('is reachable from the main menu and starts empty', async () => {
    setup()
    const { user, router } = renderApp('/categorias')

    await user.click(await screen.findByRole('link', { name: 'Puntos de venta' }))

    expect(await screen.findByText('Todavía no cargaste puntos de venta')).toBeInTheDocument()
    expect(router.state.location.pathname).toBe('/puntos-de-venta')
  })

  it('creates points of sale and lists them by number with 5 digits', async () => {
    setup()
    const { user } = renderApp('/puntos-de-venta')

    await createPointOfSale(user, '3', 'Av. Siempreviva 742')
    await screen.findByText('N° 00003')
    await createPointOfSale(user, '1')

    const first = await findRow('N° 00001')
    expect(first.getByText('Sin domicilio cargado')).toBeInTheDocument()
    expect((await findRow('N° 00003')).getByText('Av. Siempreviva 742')).toBeInTheDocument()

    const labels = screen.getAllByText(/^N° \d{5}$/).map((element) => element.textContent)
    expect(labels).toEqual(['N° 00001', 'N° 00003'])
  })

  it('validates the number before calling the backend', async () => {
    setup()
    const { user } = renderApp('/puntos-de-venta')

    await createPointOfSale(user, '0')

    expect(await screen.findByText('El número tiene que ser mayor a 0')).toBeInTheDocument()
    expect(db.pointsOfSale).toHaveLength(0)
  })

  it('shows the duplicated number error under the field', async () => {
    setup()
    const { user } = renderApp('/puntos-de-venta')
    await createPointOfSale(user, '2')
    await screen.findByText('N° 00002')

    await createPointOfSale(user, '2')

    const dialog = within(await screen.findByRole('dialog'))
    expect(
      await dialog.findAllByText('There is already a point of sale with that number'),
    ).not.toHaveLength(0)
    expect(db.pointsOfSale).toHaveLength(1)
  })

  it('edits the address of a point of sale', async () => {
    setup()
    const { user } = renderApp('/puntos-de-venta')
    await createPointOfSale(user, '1')

    await user.click((await findRow('N° 00001')).getByRole('button', { name: 'Editar' }))
    const dialog = within(await screen.findByRole('dialog'))
    await user.type(dialog.getByLabelText('Domicilio (opcional)'), 'Calle Falsa 123')
    await user.click(dialog.getByRole('button', { name: 'Guardar cambios' }))

    expect(await (await findRow('N° 00001')).findByText('Calle Falsa 123')).toBeInTheDocument()
  })

  it('keeps at least one active point of sale', async () => {
    setup()
    const { user } = renderApp('/puntos-de-venta')
    await createPointOfSale(user, '1')
    await createPointOfSale(user, '2')

    await user.click((await findRow('N° 00002')).getByRole('button', { name: 'Dar de baja' }))
    await waitFor(() => expect(screen.queryByText('N° 00002')).not.toBeInTheDocument())

    await user.click((await findRow('N° 00001')).getByRole('button', { name: 'Dar de baja' }))
    expect(
      await screen.findByText('There must be at least one active point of sale'),
    ).toBeInTheDocument()

    await user.click(screen.getByLabelText('Mostrar dados de baja'))
    expect(
      (await findRow('N° 00002')).getByRole('button', { name: 'Reactivar' }),
    ).toBeInTheDocument()
  })
})
