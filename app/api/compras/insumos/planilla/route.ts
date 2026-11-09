import { deflateRawSync } from 'node:zlib'
import { NextResponse } from 'next/server'
import { z } from 'zod'
import { formatDateTime } from '@/lib/dates/format'
import { todayInCordoba } from '@/lib/dates/zone'
import { isFeatureEnabled } from '@/lib/platform/features'
import { getCatalog } from '@/lib/purchasing/queries'
import { itemsSheetFileName, itemsWorkbook } from '@/lib/purchasing/sheet'
import {
  PURCHASING_MANAGE_ROLES,
  RoleRequiredError,
  requireRole,
  requireTenantAccess,
  TenantNotFoundError,
  UnauthenticatedError,
} from '@/lib/tenant'
import { buildXlsx } from '@/lib/xlsx/write'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const slugSchema = z.string().trim().min(1).max(80)

/**
 * Bajar la planilla de insumos (Compras › Insumos › Planilla, `lib/purchasing/sheet.ts`): un `.xlsx` con la
 * lista entera, para cambiarla en Excel o Google Sheets y volver a subirla. Es un GET con
 * `Content-Disposition: attachment` para que el botón sea un link común y ande igual en el celular.
 * Solo el dueño, con Compras prendido (`/api` no pasa por el ruteo del proxy). No trae datos de clientes.
 *
 * `GET /api/compras/insumos/planilla?slug=`
 */
export async function GET(request: Request) {
  const slug = slugSchema.safeParse(new URL(request.url).searchParams.get('slug'))
  if (!slug.success) return NextResponse.json({ error: 'missing_slug' }, { status: 400 })

  try {
    const access = await requireTenantAccess(slug.data)
    requireRole(access.role, PURCHASING_MANAGE_ROLES)
    if (!access.isPlatformAdmin && !isFeatureEnabled(access.tenant, 'purchasing')) {
      return NextResponse.json({ error: 'forbidden' }, { status: 403 })
    }

    const catalog = await getCatalog(access.tenant.id)
    const now = new Date()
    const bytes = buildXlsx(
      itemsWorkbook({
        items: catalog.items,
        zones: catalog.zones,
        suppliers: catalog.suppliers,
        barName: access.tenant.name,
        downloadedAt: formatDateTime(now),
      }),
      { deflateRaw: (data) => new Uint8Array(deflateRawSync(data)), at: now },
    )
    const filename = itemsSheetFileName(access.tenant.slug, todayInCordoba(now))
    return new NextResponse(new Blob([bytes as Uint8Array<ArrayBuffer>]), {
      status: 200,
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename="${filename}"`,
        'Cache-Control': 'no-store',
      },
    })
  } catch (error) {
    if (error instanceof UnauthenticatedError) {
      return NextResponse.json({ error: 'unauthenticated' }, { status: 401 })
    }
    if (error instanceof TenantNotFoundError || error instanceof RoleRequiredError) {
      return NextResponse.json({ error: 'forbidden' }, { status: 403 })
    }
    console.error('[compras.planilla] no se pudo armar la planilla', {
      error: error instanceof Error ? error.message : String(error),
    })
    return NextResponse.json({ error: 'export_failed' }, { status: 500 })
  }
}
