'use server'

import { getAppUrl } from '@/lib/app-url'
import { renderQrPngDataUrl, renderQrSvg } from '@/lib/qr'
import {
  RoleRequiredError,
  requireRole,
  requireTenantAccess,
  TenantNotFoundError,
  UnauthenticatedError,
} from '@/lib/tenant'
import { getOrCreateCanonicalCaptureLink } from './canonical'

export type ClubQr = {
  /** A dónde lleva: la carta pública con el formulario del club abierto. */
  url: string
  /** El QR dibujado, para mostrarlo en pantalla. */
  svg: string
  /** El mismo QR como imagen, para bajarlo e imprimirlo. */
  pngDataUrl: string
}

export type ClubQrResult = { ok: true; qr: ClubQr } | { ok: false; message: string }

/**
 * El QR del club (`/carta/<bar>?club=1`), para el botón «QR del club» de la pantalla del Club.
 *
 * Se arma recién cuando el dueño abre el diálogo: dibujar dos QR en cada carga del editor del Club
 * era trabajo tirado. De paso garantiza que exista el link de captura del bar (lo que usa el
 * formulario del club para saber de qué bar es): antes eso pasaba al entrar a la vieja pantalla
 * «QR de la carta y del club».
 */
export async function getClubQr(slug: string): Promise<ClubQrResult> {
  let tenantId: string
  try {
    const access = await requireTenantAccess(slug)
    requireRole(access.role, ['owner'])
    tenantId = access.tenant.id
  } catch (error) {
    if (
      error instanceof RoleRequiredError ||
      error instanceof TenantNotFoundError ||
      error instanceof UnauthenticatedError
    ) {
      return { ok: false, message: 'No tenés permiso para ver el QR del club.' }
    }
    throw error
  }

  const [appUrl] = await Promise.all([
    getAppUrl(),
    getOrCreateCanonicalCaptureLink({ tenantId, tenantSlug: slug }),
  ])
  const url = `${appUrl}/carta/${slug}?club=1`
  const [svg, pngDataUrl] = await Promise.all([renderQrSvg(url), renderQrPngDataUrl(url)])
  return { ok: true, qr: { url, svg, pngDataUrl } }
}
