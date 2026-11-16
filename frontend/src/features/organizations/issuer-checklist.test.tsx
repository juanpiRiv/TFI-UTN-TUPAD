import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { delay, http, HttpResponse } from 'msw'
import { beforeEach, describe, expect, it } from 'vitest'
import { API_URL } from '@/lib/api'
import { resetArcaCredentials } from '@/mocks/handlers/arca-credential'
import { server } from '@/mocks/node'
import { loginAs, seedOrganization, seedUser } from '@/test/fixtures'
import { renderApp } from '@/test/render'
import type { Organization } from './types'

let userId: number

beforeEach(() => {
  resetArcaCredentials()
  userId = seedUser('lucia@example.com').id
  loginAs(userId)
})

function seed(overrides: Partial<Organization>) {
  return seedOrganization(userId, overrides)
}

const FULL = {
  commercialAddress: 'Av. Siempreviva 742',
  activityStartDate: '2020-01-15T00:00:00.000Z',
  grossIncomeNumber: '901-123456-7',
}

const completeness = () => screen.getByRole('region', { name: 'Datos para facturar' })

function expectUniqueIds() {
  const ids = [...document.querySelectorAll('[id]')].map((node) => node.id)
  const duplicated = ids.filter((id, index) => ids.indexOf(id) !== index)
  expect(duplicated).toEqual([])
}

describe('Datos para facturar: states', () => {
  it('everything missing (responsable inscripto) lists every item with its own button', async () => {
    seed({ taxCondition: 'RESPONSABLE_INSCRIPTO' })
    renderApp('/organizacion')

    const region = within(await screen.findByRole('region', { name: 'Datos para facturar' }))

    expect(region.getAllByRole('listitem')).toHaveLength(3)
    expect(region.getByText('Domicilio comercial')).toBeInTheDocument()
    expect(region.getByText('Fecha de inicio de actividades')).toBeInTheDocument()
    expect(region.getByText(/Ingresos Brutos/)).toBeInTheDocument()
    expect(region.getAllByRole('button')).toHaveLength(3)
  })

  it('nothing missing says it is complete and offers no buttons', async () => {
    seed({ ...FULL, taxCondition: 'RESPONSABLE_INSCRIPTO' })
    renderApp('/organizacion')

    const region = within(await screen.findByRole('region', { name: 'Datos para facturar' }))
    expect(region.getByText('Tus datos están completos para emitir facturas.')).toBeInTheDocument()
    expect(region.queryByRole('button')).not.toBeInTheDocument()
    expect(region.queryByRole('list')).not.toBeInTheDocument()
  })

  it('one missing item lists just that one', async () => {
    seed({ ...FULL, taxCondition: 'RESPONSABLE_INSCRIPTO', commercialAddress: null })
    renderApp('/organizacion')

    const region = within(await screen.findByRole('region', { name: 'Datos para facturar' }))

    expect(region.getAllByRole('listitem')).toHaveLength(1)
    expect(
      region.getByRole('button', { name: 'Completar Domicilio comercial' }),
    ).toBeInTheDocument()
  })

  it('a blank (whitespace) address still counts as missing', async () => {
    seed({ ...FULL, commercialAddress: '   ' })
    renderApp('/organizacion')

    expect(
      await screen.findByRole('button', { name: 'Completar Domicilio comercial' }),
    ).toBeInTheDocument()
  })

  it('MONOTRIBUTO does not require Ingresos Brutos', async () => {
    seed({
      taxCondition: 'MONOTRIBUTO',
      commercialAddress: FULL.commercialAddress,
      activityStartDate: FULL.activityStartDate,
    })
    renderApp('/organizacion')

    expect(
      await screen.findByText('Tus datos están completos para emitir facturas.'),
    ).toBeInTheDocument()
    expect(screen.queryByText(/Ingresos Brutos/)).not.toBeInTheDocument()
  })

  it('a MONOTRIBUTO that lacks other data still does not list Ingresos Brutos', async () => {
    seed({ taxCondition: 'MONOTRIBUTO' })
    renderApp('/organizacion')

    const region = within(await screen.findByRole('region', { name: 'Datos para facturar' }))

    expect(region.getAllByRole('listitem')).toHaveLength(2)
    expect(region.queryByText(/Ingresos Brutos/)).not.toBeInTheDocument()
  })

  it('renders exactly what the server lists, labels as plain text', async () => {
    seed({})
    server.use(
      http.get(`${API_URL}/api/organizations/me`, () =>
        HttpResponse.json({
          id: 1,
          issuerCompleteness: {
            complete: false,
            missing: [{ field: 'cuit', label: '<img src=x onerror=alert(1)> CUIT' }],
          },
        }),
      ),
    )
    renderApp('/organizacion')

    const item = await screen.findByRole('listitem')
    expect(item.querySelector('img')).toBeNull()
    expect(item).toHaveTextContent('<img src=x onerror=alert(1)> CUIT')
  })

  it('shows nothing (and never "complete") while loading, then the checklist', async () => {
    seed({})
    server.use(
      http.get(`${API_URL}/api/organizations/me`, async () => {
        await delay(200)
        return HttpResponse.json({
          id: 1,
          issuerCompleteness: {
            complete: false,
            missing: [{ field: 'commercialAddress', label: 'Domicilio comercial' }],
          },
        })
      }),
    )
    renderApp('/organizacion')

    await screen.findByRole('heading', { name: 'Mi negocio' })
    expect(screen.queryByText(/datos están completos/)).not.toBeInTheDocument()
    expect(screen.queryByRole('region', { name: 'Datos para facturar' })).not.toBeInTheDocument()
    expect(await screen.findByRole('region', { name: 'Datos para facturar' })).toBeInTheDocument()
  })

  it('on a server error it never claims the data is complete and the form keeps working', async () => {
    seed({})
    server.use(
      http.get(`${API_URL}/api/organizations/me`, () =>
        HttpResponse.json({ error: 'boom' }, { status: 500 }),
      ),
    )
    renderApp('/organizacion')

    expect(await screen.findByRole('button', { name: 'Guardar cambios' })).toBeEnabled()
    await screen.findByRole('heading', { name: 'Facturación electrónica con ARCA' })
    expect(screen.queryByText(/datos están completos/)).not.toBeInTheDocument()
  })
})

describe('Datos para facturar: buttons and keyboard', () => {
  it.each([
    ['Domicilio comercial', /^Domicilio comercial/],
    ['Fecha de inicio de actividades', /^Inicio de actividades/],
    ['Ingresos Brutos (número, Exento o Convenio)', /^Ingresos brutos/],
  ])('"Completar %s" focuses its field', async (label, field) => {
    seed({ taxCondition: 'RESPONSABLE_INSCRIPTO' })
    const { user } = renderApp('/organizacion')

    await user.click(await screen.findByRole('button', { name: `Completar ${label}` }))

    expect(screen.getByLabelText(field)).toHaveFocus()
  })

  it('works with the keyboard alone (Tab to the button, Enter and Space)', async () => {
    seed({ taxCondition: 'RESPONSABLE_INSCRIPTO' })
    const { user } = renderApp('/organizacion')
    const first = await screen.findByRole('button', { name: 'Completar Domicilio comercial' })

    first.focus()
    await user.keyboard('{Enter}')
    expect(screen.getByLabelText(/^Domicilio comercial/)).toHaveFocus()

    const second = screen.getByRole('button', { name: 'Completar Fecha de inicio de actividades' })
    second.focus()
    await user.keyboard(' ')
    expect(screen.getByLabelText(/^Inicio de actividades/)).toHaveFocus()

    // Tab order: the buttons are reachable in list order.
    first.focus()
    await user.tab()
    expect(second).toHaveFocus()
  })

  it('every button has a unique accessible name', async () => {
    seed({ taxCondition: 'RESPONSABLE_INSCRIPTO' })
    renderApp('/organizacion')
    await screen.findByRole('region', { name: 'Datos para facturar' })

    const names = within(completeness())
      .getAllByRole('button')
      .map((button) => button.getAttribute('aria-label'))

    expect(new Set(names).size).toBe(names.length)
    expect(names.every((name) => name?.startsWith('Completar '))).toBe(true)
  })

  it('a missing field that is not on the form does nothing and does not throw', async () => {
    seed({})
    server.use(
      http.get(`${API_URL}/api/organizations/me`, () =>
        HttpResponse.json({
          id: 1,
          issuerCompleteness: {
            complete: false,
            missing: [{ field: 'campoQueNoExiste', label: 'Algo raro' }],
          },
        }),
      ),
    )
    const { user } = renderApp('/organizacion')

    await user.click(await screen.findByRole('button', { name: 'Completar Algo raro' }))

    expect(screen.getByRole('region', { name: 'Datos para facturar' })).toBeInTheDocument()
  })
})

describe('Datos para facturar: updates after saving', () => {
  it('turns complete after saving the missing address', async () => {
    seed({ ...FULL, commercialAddress: null })
    const { user } = renderApp('/organizacion')
    await screen.findByRole('button', { name: 'Completar Domicilio comercial' })

    fireEvent.change(screen.getByLabelText(/^Domicilio comercial/), {
      target: { value: 'Calle 1' },
    })
    await user.click(screen.getByRole('button', { name: 'Guardar cambios' }))

    expect(
      await screen.findByText('Tus datos están completos para emitir facturas.'),
    ).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Completar/ })).not.toBeInTheDocument()
  })

  it('removes only the item that was filled in', async () => {
    seed({ taxCondition: 'RESPONSABLE_INSCRIPTO' })
    const { user } = renderApp('/organizacion')
    await screen.findByRole('button', { name: 'Completar Domicilio comercial' })

    fireEvent.change(screen.getByLabelText(/^Domicilio comercial/), {
      target: { value: 'Calle 1' },
    })
    await user.click(screen.getByRole('button', { name: 'Guardar cambios' }))

    await screen.findByText('Cambios guardados.')
    await waitFor(() => expect(within(completeness()).getAllByRole('listitem')).toHaveLength(2))
    expect(
      screen.queryByRole('button', { name: 'Completar Domicilio comercial' }),
    ).not.toBeInTheDocument()
  })

  it('switching the tax condition to MONOTRIBUTO drops the Ingresos Brutos item', async () => {
    seed({ ...FULL, grossIncomeNumber: null, taxCondition: 'RESPONSABLE_INSCRIPTO' })
    const { user } = renderApp('/organizacion')
    await screen.findByRole('button', { name: /Completar Ingresos Brutos/ })

    await user.selectOptions(screen.getByLabelText('Condición frente al IVA'), 'MONOTRIBUTO')
    await user.click(screen.getByRole('button', { name: 'Guardar cambios' }))

    expect(
      await screen.findByText('Tus datos están completos para emitir facturas.'),
    ).toBeInTheDocument()
  })

  it('a failed save leaves the checklist as it was', async () => {
    seed({ ...FULL, commercialAddress: null })
    server.use(
      http.patch(`${API_URL}/api/organizations/me`, () =>
        HttpResponse.json({ error: 'Falló el guardado' }, { status: 500 }),
      ),
    )
    const { user } = renderApp('/organizacion')
    await screen.findByRole('button', { name: 'Completar Domicilio comercial' })

    fireEvent.change(screen.getByLabelText(/^Domicilio comercial/), {
      target: { value: 'Calle 1' },
    })
    await user.click(screen.getByRole('button', { name: 'Guardar cambios' }))

    expect(await screen.findByText('Falló el guardado')).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: 'Completar Domicilio comercial' }),
    ).toBeInTheDocument()
  })
})

describe('Mi negocio: unique ids', () => {
  it('has no duplicated ids in any state of the page', async () => {
    seed({ taxCondition: 'RESPONSABLE_INSCRIPTO' })
    const app = renderApp('/organizacion')
    await app.user.click(await screen.findByText('Opciones avanzadas'))
    expectUniqueIds()

    await app.user.click(screen.getByRole('button', { name: 'Generar solicitud' }))
    await screen.findByLabelText('Solicitud de certificado (CSR)')
    expectUniqueIds()

    await app.user.click(screen.getByRole('button', { name: 'Continuar' }))
    expectUniqueIds()

    await app.user.click(screen.getByRole('button', { name: 'Ya tengo el certificado' }))
    await screen.findByLabelText('Pegá el certificado')
    fireEvent.change(screen.getByLabelText('Pegá el certificado'), { target: { value: 'nada' } })
    await app.user.click(screen.getByRole('button', { name: 'Subir certificado' }))
    await screen.findByText(/debe incluir BEGIN CERTIFICATE/)
    expectUniqueIds()
  })
})
