import { NextResponse } from 'next/server'
import { z } from 'zod'
import { type EntityOptionWire, searchQuerySchema } from '@/lib/search/entity-option'
import {
  RoleRequiredError,
  requireRole,
  requireTenantAccess,
  TenantNotFoundError,
  UnauthenticatedError,
} from '@/lib/tenant'
import { SAMPLE_SUPPLIERS, supplierDescription } from '../_components/catalog/sample-data'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * La búsqueda de mentira del catálogo de componentes (kit HUB §6.3): el
 * `EntityPicker` del bloque «Combobox» busca acá, con el mismo contrato que
 * las búsquedas de verdad (`lib/search/entity-option.ts`: `?q=` de 2 a 80
 * caracteres, respuesta `{ options: [...] }`).
 *
 * - Tarda 400 ms a propósito: tipeando rápido se ve cómo cada tecla cancela
 *   la búsqueda anterior (el `AbortSignal` del Combobox corta el fetch, y acá
 *   `request.signal` deja de esperar).
 * - `?fallo=1` contesta 503: el Combobox muestra «No pudimos buscar» con
 *   «Reintentar».
 * - Solo proveedores de ejemplo: no toca la base. Igual valida sesión y rol
 *   (dueño o superadmin), como todo Route Handler del panel.
 */

const NO_STORE = { 'Cache-Control': 'private, no-store' } as const
const DELAY_MS = 400

const querySchema = z.object({
  q: searchQuerySchema,
  fallo: z.enum(['0', '1']).optional(),
})

function normalize(text: string): string {
  return text.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase()
}

/** Espera `ms`; `false` si el pedido se canceló antes (la persona siguió tipeando). */
function waitUnlessAborted(ms: number, signal: AbortSignal): Promise<boolean> {
  if (signal.aborted) return Promise.resolve(false)
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort)
      resolve(true)
    }, ms)
    function onAbort() {
      clearTimeout(timer)
      resolve(false)
    }
    signal.addEventListener('abort', onAbort, { once: true })
  })
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ tenantSlug: string }> },
) {
  const { tenantSlug } = await params
  const search = new URL(request.url).searchParams
  const parsed = querySchema.safeParse({
    q: search.get('q') ?? '',
    fallo: search.get('fallo') ?? undefined,
  })
  if (!parsed.success) {
    return NextResponse.json({ error: 'invalid_query' }, { status: 400, headers: NO_STORE })
  }

  try {
    const access = await requireTenantAccess(tenantSlug)
    if (!access.isPlatformAdmin) requireRole(access.role, ['owner'])
  } catch (error) {
    if (error instanceof UnauthenticatedError) {
      return NextResponse.json({ error: 'unauthenticated' }, { status: 401, headers: NO_STORE })
    }
    if (error instanceof TenantNotFoundError || error instanceof RoleRequiredError) {
      return NextResponse.json({ error: 'forbidden' }, { status: 403, headers: NO_STORE })
    }
    console.error('[catalogo.busqueda] no se pudo validar el acceso', {
      tenantSlug,
      error: error instanceof Error ? error.message : String(error),
    })
    return NextResponse.json({ error: 'search_failed' }, { status: 500, headers: NO_STORE })
  }

  const completed = await waitUnlessAborted(DELAY_MS, request.signal)
  // Cancelada: el cliente ya no escucha (499 = «el cliente cerró el pedido»).
  if (!completed) return new Response(null, { status: 499, headers: NO_STORE })

  if (parsed.data.fallo === '1') {
    return NextResponse.json({ error: 'simulated_failure' }, { status: 503, headers: NO_STORE })
  }

  const q = normalize(parsed.data.q)
  const options: EntityOptionWire[] = SAMPLE_SUPPLIERS.filter(
    (supplier) => normalize(supplier.name).includes(q) || normalize(supplier.category).includes(q),
  ).map((supplier) => ({
    value: supplier.id,
    label: supplier.name,
    description: supplierDescription(supplier),
  }))

  return NextResponse.json({ options }, { headers: NO_STORE })
}
