import { http, HttpResponse } from 'msw'
import { API_URL } from '@/lib/api'

// Por defecto no hay facturas: las pantallas que las necesitan (por ejemplo la lista de primeros pasos del
// inicio) piden el listado, y los tests de facturas pisan este handler con sus propios datos.
export const invoiceHandlers = [http.get(`${API_URL}/api/invoices`, () => HttpResponse.json([]))]
