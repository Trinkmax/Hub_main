'use server'

/**
 * Leer con IA la foto de un comprobante (pedido de los socios del 16/11/2026).
 *
 * La pantalla primero busca el QR de ARCA en el navegador (exacto y gratis). Si no lo encuentra,
 * manda acá la foto achicada y vuelve una PROPUESTA de datos (`InvoiceRead`): la persona la revisa
 * y recién después guarda. Esta acción no escribe nada.
 *
 * - Es de quien carga en Administración de ese bar (escritura), como subir la foto.
 * - Sin la clave de la API (`ANTHROPIC_API_KEY`) contesta `disabled` y la pantalla no vuelve a pedir.
 * - Tiene un tope por persona: una foto cuesta, y un error que se repite no puede gastar sin fin.
 * - No se registra nada de lo leído (son datos de un proveedor): solo que falló y por qué clase de error.
 */

import Anthropic from '@anthropic-ai/sdk'
import { z } from 'zod'
import { authorizeAccounting } from '@/lib/accounting/access'
import type { AccSimpleState } from '@/lib/accounting/action-state'
import { type InvoiceRead, readFromAi } from '@/lib/accounting/invoice-read'
import { invoiceReaderEnabled, readInvoiceImage } from '@/lib/accounting/server/invoice-reader'
import { todayInCordoba } from '@/lib/dates'
import { RateLimitedError, rateLimit } from '@/lib/rate-limit'

/** Lo que entra en una Server Action (`bodySizeLimit: '4mb'`), con margen para el resto del pedido. */
const MAX_BASE64 = 3_600_000
/** 30 lecturas cada 10 minutos por persona: sobra para cargar una pila de facturas. */
const RATE_LIMIT = { limit: 30, windowMs: 10 * 60 * 1000 }

const inputSchema = z.object({
  mime: z.enum(['image/jpeg', 'image/png', 'image/webp', 'application/pdf']),
  data: z
    .string()
    .min(100)
    .max(MAX_BASE64)
    .regex(/^[A-Za-z0-9+/]+={0,2}$/),
})

export type InvoiceReadResult = {
  /** `null`: se leyó, pero no es un comprobante o no se rescató ningún dato. */
  read: InvoiceRead | null
}

export async function readInvoicePhoto(
  slug: string,
  raw: unknown,
): Promise<AccSimpleState<InvoiceReadResult>> {
  // Leer la foto es parte de cargar una compra: también con «solo compras y pagos».
  const auth = await authorizeAccounting(slug, 'buy_write')
  if (!auth.ok) return auth.state
  if (!invoiceReaderEnabled()) {
    return { ok: false, code: 'disabled', message: 'La lectura con IA no está prendida.' }
  }
  const parsed = inputSchema.safeParse(raw)
  if (!parsed.success) {
    return { ok: false, code: 'invalid', message: 'No pudimos leer esa foto: probá con otra.' }
  }
  try {
    rateLimit({ key: `acc-invoice-read:${auth.userId}`, ...RATE_LIMIT })
  } catch (error) {
    if (error instanceof RateLimitedError) {
      return {
        ok: false,
        code: 'conflict',
        message: 'Leíste muchas fotos seguidas. Esperá unos minutos o cargala a mano.',
      }
    }
    throw error
  }

  try {
    const reading = await readInvoiceImage(parsed.data)
    return { ok: true, data: { read: readFromAi(reading, todayInCordoba()) }, message: '' }
  } catch (error) {
    // Solo la clase del error: el mensaje de la API puede traer parte del pedido (CLAUDE.md §9).
    const kind =
      error instanceof Anthropic.RateLimitError
        ? 'rate_limit'
        : error instanceof Anthropic.AuthenticationError
          ? 'auth'
          : error instanceof Anthropic.BadRequestError
            ? 'bad_request'
            : error instanceof Anthropic.APIConnectionError
              ? 'connection'
              : error instanceof Anthropic.APIError
                ? `api_${error.status ?? 'unknown'}`
                : 'unknown'
    console.error('[accounting.invoice-read]', kind)
    return {
      ok: false,
      code: 'error',
      message: 'No pudimos leerla con IA esta vez. Cargá los datos a mano o probá de nuevo.',
    }
  }
}
