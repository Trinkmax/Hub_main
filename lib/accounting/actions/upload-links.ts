'use server'

/**
 * La foto por QR (reunión del 29/10/2026): «cuando pone agregar foto, te pone un QR, lo escaneás con
 * el celu, sacás la foto y ya se carga».
 *
 * La compu abre un link de subida: un token al azar (lo que va en el QR; en la base queda solo su
 * hash) y cinco URLs firmadas de Storage para que el celular suba sin iniciar sesión. Las firma el
 * servidor con la sesión de quien carga, así que la política de subida del bucket decide igual:
 * nunca `service_role` (CLAUDE.md §12). La ruta `<tenant>/<link>/<uuid>.jpg` es la que esa política
 * ya acepta.
 *
 * Lo que sigue es del navegador, con su sesión (`use-upload-link.ts`): mirar lo que subió el celular,
 * bajarlo a la memoria, cerrar el link y borrar la copia temporal.
 */

import { createHash, randomBytes, randomUUID } from 'node:crypto'
import { authorizeAccounting } from '@/lib/accounting/access'
import type { AccSimpleState } from '@/lib/accounting/action-state'
import { ATTACHMENT_BUCKET, MAX_ATTACHMENTS_PER_DOCUMENT } from '@/lib/accounting/attachments'
import { getAppUrl } from '@/lib/app-url'
import { renderQrSvg } from '@/lib/qr'
import { createClient } from '@/lib/supabase/server'
import { asRecord, rpcFailure, unexpectedFailure } from './support'

/** Cuántas fotos entran en un link: las mismas que en un comprobante. */
const SLOTS = MAX_ATTACHMENTS_PER_DOCUMENT
const LINK_MINUTES = 30

export type UploadLink = {
  linkId: string
  /** El bar de la URL: lo piden las RPC que mira el navegador. */
  tenantId: string
  url: string
  /** El QR de esa URL, ya dibujado. Se arma acá para no sumarle `qrcode` a la pantalla. */
  qrSvg: string
  /** Hasta cuándo sirve (ISO). */
  expiresAt: string
}

function stalePaths(data: unknown): string[] {
  const list = asRecord(data)?.stale_paths
  return Array.isArray(list) ? list.filter((path) => typeof path === 'string') : []
}

/**
 * Abre un link de subida. Solo quien puede cargar en Administración de este bar. Los archivos de
 * links vencidos que quedaron sin usar se borran acá de paso: es lo único que los limpia si alguien
 * cerró la pestaña sin terminar.
 */
export async function createUploadLink(slug: string): Promise<AccSimpleState<UploadLink>> {
  const op = 'uploadLinks.create'
  try {
    const auth = await authorizeAccounting(slug, 'write')
    if (!auth.ok) return auth.state
    const { tenantId } = auth

    const token = randomBytes(32).toString('base64url')
    const linkId = randomUUID()
    const expiresAt = new Date(Date.now() + LINK_MINUTES * 60_000).toISOString()

    const supabase = await createClient()
    const bucket = supabase.storage.from(ATTACHMENT_BUCKET)
    const slots = await Promise.all(
      Array.from({ length: SLOTS }, async () => {
        const path = `${tenantId}/${linkId}/${randomUUID()}.jpg`
        const signed = await bucket.createSignedUploadUrl(path)
        if (signed.error) throw signed.error
        return { path, token: signed.data.token }
      }),
    )

    const created = await supabase.rpc('acc_upload_link_create', {
      p_tenant_id: tenantId,
      p_link_id: linkId,
      p_token_hash: createHash('sha256').update(token, 'utf8').digest('hex'),
      p_slots: slots,
      p_expires_at: expiresAt,
    })
    if (created.error) return rpcFailure(op, created.error)

    const stale = stalePaths(created.data)
    if (stale.length > 0) {
      // Si falla no vuelven a aparecer (la base ya los olvidó): queda un archivo que nadie ve. No
      // frena el link.
      const removed = await bucket.remove(stale)
      if (removed.error) console.error(`[accounting.${op}] stale`, removed.error.name)
    }

    const url = `${await getAppUrl()}/subir/${token}`
    return {
      ok: true,
      data: { linkId, tenantId, url, qrSvg: await renderQrSvg(url), expiresAt },
      message: '',
    }
  } catch (error) {
    return unexpectedFailure(op, error)
  }
}
