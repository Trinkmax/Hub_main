import { NextResponse } from 'next/server'
import { z } from 'zod'
import type { CustomerSearchOptionWire } from '@/components/customers/customer-picker'
import { type CustomerSearchResult, searchCustomers } from '@/lib/customers/search'
import { formatPhoneForDisplay } from '@/lib/phone'
import { parseServiceAlerts } from '@/lib/salon/alerts'
import { searchQuerySchema } from '@/lib/search/entity-option'
import {
  RESERVATION_OPERATOR_ROLES,
  RoleRequiredError,
  requireRole,
  requireTenantAccess,
  TenantNotFoundError,
  UnauthenticatedError,
} from '@/lib/tenant'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * Búsqueda de clientes del CRM para el `CustomerPicker`
 * (`components/customers/customer-picker.tsx`): `GET ?slug=<bar>&q=<texto>`.
 *
 * Es un GET y no una Server Action (decisión 19 del kit): las acciones se
 * encolan de a una, así que tipear rápido encolaba búsquedas y el «Guardar»
 * que viniera después esperaba detrás de ellas. Con un GET, el `AbortController`
 * del Combobox cancela de verdad la búsqueda anterior en cada tecla.
 *
 * La consulta es la de `lib/customers/search.ts` (la misma que usan el alta de
 * reserva y Mensajería): nombre, apellido o teléfono, desde 2 letras y hasta 8
 * resultados.
 *
 * Contrato (`lib/search/entity-option.ts`): `{ options: [{ value, label,
 * description, data }] }`. `data` lleva el cliente entero (puntos y avisos de
 * servicio) para quien lo elige; un consumidor genérico lo ignora.
 *
 * Devuelve PII (nombre y teléfono): solo staff que vincula clientes
 * (`RESERVATION_OPERATOR_ROLES`), `Cache-Control: private, no-store` y nada de
 * lo buscado ni de lo encontrado en los logs.
 */

const NO_STORE = { 'Cache-Control': 'private, no-store' } as const

const querySchema = z.object({
  slug: z.string().trim().min(1).max(64),
  q: searchQuerySchema,
})

function toCustomerOption(customer: CustomerSearchResult): CustomerSearchOptionWire {
  const label = `${customer.first_name ?? ''} ${customer.last_name ?? ''}`.trim()
  return {
    value: customer.id,
    label: label || 'Sin nombre',
    description: formatPhoneForDisplay(customer.phone),
    data: { ...customer, service_alerts: parseServiceAlerts(customer.service_alerts) },
  }
}

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams
  const parsed = querySchema.safeParse({
    slug: params.get('slug') ?? '',
    q: params.get('q') ?? '',
  })
  if (!parsed.success) {
    return NextResponse.json({ error: 'invalid_query' }, { status: 400, headers: NO_STORE })
  }
  const { slug, q } = parsed.data

  try {
    const access = await requireTenantAccess(slug)
    requireRole(access.role, RESERVATION_OPERATOR_ROLES)

    // `searchCustomers` vuelve a validar acceso y rol por su cuenta (también
    // es una Server Action que se llama desde el cliente): acá se valida antes
    // para poder contestar 401/403 en vez de una lista vacía.
    const customers = await searchCustomers(slug, q)
    return NextResponse.json({ options: customers.map(toCustomerOption) }, { headers: NO_STORE })
  } catch (error) {
    if (error instanceof UnauthenticatedError) {
      return NextResponse.json({ error: 'unauthenticated' }, { status: 401, headers: NO_STORE })
    }
    if (error instanceof TenantNotFoundError || error instanceof RoleRequiredError) {
      return NextResponse.json({ error: 'forbidden' }, { status: 403, headers: NO_STORE })
    }
    // Sin PII: ni lo buscado ni lo encontrado, solo el bar y el motivo.
    console.error('[customers.search] falló la búsqueda', {
      slug,
      error: error instanceof Error ? error.message : String(error),
    })
    return NextResponse.json({ error: 'search_failed' }, { status: 500, headers: NO_STORE })
  }
}
