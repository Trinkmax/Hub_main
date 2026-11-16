import 'server-only'

import Anthropic from '@anthropic-ai/sdk'
import { betaZodOutputFormat } from '@anthropic-ai/sdk/helpers/beta/zod'
import {
  READING_INSTRUCTIONS,
  READING_SCHEMA,
  type TexAttachmentMime,
  type TexAttachmentReading,
} from '@/lib/tex/read-attachment'

/**
 * La foto de una factura, leída con IA (pedido de los socios del 16/11/2026: el QR «raras veces
 * detecta»). Un solo pedido, de una vez: entra la imagen, salen los datos del papel con el mismo
 * esquema que usa Tex para sus adjuntos.
 *
 * **El modelo.** Leer bien una foto torcida de un tique térmico es justo donde un modelo más capaz
 * se equivoca menos, y un número mal leído termina en los libros: va Claude Opus 5.5 con esfuerzo
 * bajo (es una lectura, no un razonamiento). Una factura sale unos centavos de dólar. Tex sigue con
 * su modelo (`TEX_MODEL`); para cambiar el de las fotos alcanza con esta constante.
 *
 * **Si el modelo se niega** (un filtro de seguridad puede frenar un pedido): se pide el modelo de
 * respaldo que recomienda Anthropic (`fallbacks: 'default'`). Si igual no hay lectura, se contesta
 * `null` y la pantalla dice que la carguen a mano: nunca se inventa un dato.
 */
export const INVOICE_READER_MODEL = 'claude-opus-5-5'

/**
 * Para el formulario, «dudas» es solo lo que hay que mirar antes de guardar: un dato de los que se
 * completan que no se leyó bien. Sin esto el modelo comenta todo lo que el papel no trae (que no
 * tiene percepciones, que no dice el vencimiento) y el aviso deja de servir.
 */
const FORM_INSTRUCTIONS = `${READING_INSTRUCTIONS} En "dudas" anotá solamente lo que no pudiste leer bien entre estos datos: quién lo emite, su CUIT, el punto de venta, el número, la fecha de emisión y el total; en una frase corta. Si esos datos se leen bien, "dudas" va null: no comentes lo que el papel no trae ni ningún otro dato.`

/** Lo que tarda como mucho una lectura antes de soltar: la persona está esperando con la foto en la mano. */
const READ_TIMEOUT_MS = 40_000

export type InvoiceFile = { mime: TexAttachmentMime; data: string }

/** ¿Hay clave para leer con IA? Sin ella la foto sigue leyendo solo el QR. */
export function invoiceReaderEnabled(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY)
}

/**
 * Lee el comprobante. `null`: el modelo se negó o no devolvió datos con la forma pedida. Los
 * errores de la API (sin crédito, sin red, límite) salen como excepción: los traduce quien llama.
 */
export async function readInvoiceImage(file: InvoiceFile): Promise<TexAttachmentReading | null> {
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
  const source: Anthropic.Beta.BetaContentBlockParam =
    file.mime === 'application/pdf'
      ? {
          type: 'document',
          source: { type: 'base64', media_type: 'application/pdf', data: file.data },
        }
      : {
          type: 'image',
          source: { type: 'base64', media_type: file.mime, data: file.data },
        }
  const response = await client.beta.messages.parse(
    {
      model: INVOICE_READER_MODEL,
      max_tokens: 4000,
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      output_config: { effort: 'low', format: betaZodOutputFormat(READING_SCHEMA) },
      messages: [{ role: 'user', content: [source, { type: 'text', text: FORM_INSTRUCTIONS }] }],
    },
    { timeout: READ_TIMEOUT_MS, maxRetries: 1 },
  )
  // Un filtro de seguridad frenó el pedido (también en el modelo de respaldo): no hay lectura.
  if (response.stop_reason === 'refusal') return null
  return response.parsed_output ?? null
}
