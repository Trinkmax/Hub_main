import { z } from 'zod'
import {
  type EventMarketingRow,
  formatArs,
  formatPesosRate,
  type MarketingField,
  shortName,
} from './event-marketing'

/**
 * Bordes de "Pauta en Meta" (`scheduled_event_marketing`).
 *
 * El form parsea lo que el dueño tipea con `parseLocaleNumber` y manda NÚMEROS
 * en unidades (US$ 175,26 → `175.26`, $ 2.480.000 → `2480000`), nunca
 * centavos: la conversión a centavos vive acá abajo (`toMarketingDbFields`) y
 * en ningún otro lado. Igual se revalida todo: una Server Action es un endpoint
 * público y el form no es la única manera de pegarle.
 *
 * Los mensajes son los del form (§8.6 del spec) para que el error del server
 * caiga en el mismo campo y con las mismas palabras que el del cliente.
 *
 * Los topes copian los CHECK de las migraciones `20260915120000` y
 * `20260919120000` (en unidades): si el schema dejara pasar algo que la DB
 * rechaza, el dueño vería "No se pudo guardar" en vez de saber qué número
 * revisar.
 */

export const EVENT_MARKETING_LIMITS = {
  /** US$ 100.000 = 10.000.000 centavos, el CHECK de `ad_spend_usd_cents`. */
  adSpendUsdMax: 100_000,
  messagesMax: 1_000_000,
  reachMax: 100_000_000,
  revenueArsMin: 1,
  /** $ 1.000.000.000 = 100.000.000.000 centavos, el CHECK de `revenue_ars_cents`. */
  revenueArsMax: 1_000_000_000,
  usdArsRateMin: 100,
  usdArsRateMax: 100_000,
  /**
   * $ 1.000.000 = 100.000.000 centavos, el CHECK de `revenue_per_guest_ars_cents`
   * y de `cost_per_guest_ars_cents` (migración `20260919120000`). Un cubierto más
   * caro que eso es alguien que tipeó los centavos o le sobró un cero.
   */
  perGuestArsMax: 1_000_000,
  notesMax: 280,
  expectedUpdatedAtMax: 40,
} as const

export const MARKETING_FIELD_MESSAGES = {
  spendMissing: 'Poné cuánto se gastó. Si no hubo pauta, usá «No tuvo pauta».',
  unreadable: 'No entendí el número.',
  negative: 'No puede ser negativo.',
  withDecimals: 'Va sin decimales.',
  spendTooHigh: 'Revisá el monto: más de US$ 100.000 no parece la pauta de una fecha.',
  countOutOfRange: 'Revisá el número.',
  /**
   * Desde que se borró el CHECK `sem_revenue_needs_rate`, estos dos NO son
   * errores del server: la carga entra igual. Quedan como aviso de la UI —
   * sin el dólar la pauta no se puede pasar a pesos y la cuenta llega hasta el
   * margen bruto, que es peor que guardar el dato pero mucho mejor que
   * rebotarlo.
   */
  rateMissing: 'Para calcular el retorno falta el dólar del día.',
  revenueMissing: 'Cargaste el dólar pero no la facturación.',
  revenueOutOfRange: 'Revisá la facturación.',
  revenueInFuture: 'La facturación se carga cuando pasa la fecha.',
  revenuePerGuestOutOfRange: `Revisá el ingreso por persona: el tope es ${formatArs(EVENT_MARKETING_LIMITS.perGuestArsMax)}.`,
  costPerGuestOutOfRange: `Revisá el costo por persona: el tope es ${formatArs(EVENT_MARKETING_LIMITS.perGuestArsMax)}.`,
  notesTooLong: 'La nota puede tener hasta 280 caracteres.',
} as const

/** `Revisá el dólar: quedó en $ 14,50.` — el número va porque suele ser un punto de más o de menos. */
export function rateOutOfRangeMessage(rate: number): string {
  return `Revisá el dólar: quedó en ${formatPesosRate(rate)}.`
}

const M = MARKETING_FIELD_MESSAGES
const L = EVENT_MARKETING_LIMITS

/**
 * `timestamptz` tal como lo devuelve PostgREST (`2026-09-15T17:32:11.123456+00:00`).
 * Se valida la forma porque viaja directo a un `.eq('updated_at', …)`: basura
 * acá sería un 22007 de Postgres en vez de un "recargá".
 */
const TIMESTAMP_RE = /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(\.\d{1,6})?(Z|[+-]\d{2}(:?\d{2})?)?$/

const eventIdField = z.uuid('No encontramos esa fecha.')

const baselineField = z
  .string('Recargá la página y probá de nuevo.')
  .max(L.expectedUpdatedAtMax, 'Recargá la página y probá de nuevo.')
  .regex(TIMESTAMP_RE, 'Recargá la página y probá de nuevo.')

/**
 * Un conteo de Ads Manager: entero, no negativo y con techo. El orden de los
 * checks importa: `marketingFieldErrors` se queda con el PRIMER issue de cada
 * campo, y `-3,5` tiene que decir "negativo" antes que "sin decimales" (mismo
 * orden que `parseLocaleNumber`).
 */
function countField(max: number) {
  return z
    .number(M.unreadable)
    .nonnegative(M.negative)
    .int(M.withDecimals)
    .max(max, M.countOutOfRange)
}

/**
 * Plata POR PERSONA, en pesos: el cubierto ($ 27.000) y lo que cuesta servirlo
 * ($ 15.000). Con decimales, como la facturación — se guardan en centavos.
 *
 * El 0 entra a propósito: la DB lo acepta (`between 0 and 100000000`) y es un
 * número que el dueño puede haber tipeado en serio ("esa noche no me costó
 * nada"). Distinto del gasto en pauta, donde el 0 tiene su propia acción
 * («No tuvo pauta») y por eso sí es un error.
 */
function perGuestField(tooHigh: string) {
  return z.number(M.unreadable).nonnegative(M.negative).max(L.perGuestArsMax, tooHigh).nullish()
}

/**
 * Los opcionales son `.nullish()` campo por campo y los `null` se completan en
 * UN transform al final del objeto. Dos trampas de zod v4 que esto esquiva:
 * una `z.union([schema, z.null(), …])` que falla se resume en un genérico
 * «Invalid input» (se pierde el mensaje del campo), y una key AUSENTE solo es
 * válida si su schema es opcional de verdad (`nullish`), no una unión con
 * `z.undefined()`. Un campo que no viaja en el payload no es un error del
 * dueño: es un campo vacío.
 */
export const saveEventMarketingSchema = z
  .object({
    scheduledEventId: eventIdField,
    // "Gastado" en 0 no es un número válido: para eso está «No tuvo pauta», que
    // es otra acción y otro estado. Tiene que redondear a 1 centavo como mínimo
    // o se guardaría un 0 disfrazado.
    adSpendUsd: z
      .number(M.unreadable)
      .nonnegative(M.negative)
      .max(L.adSpendUsdMax, M.spendTooHigh)
      .refine((v) => Math.round(v * 100) >= 1, M.spendMissing),
    messages: countField(L.messagesMax).nullish(),
    reach: countField(L.reachMax).nullish(),
    // Facturación y dólar YA NO van de a pares: la migración `20260919120000`
    // borró el CHECK `sem_revenue_needs_rate` porque el dólar dejó de ser "lo
    // que acompaña a la facturación" y pasó a ser lo que convierte la PAUTA a
    // pesos. Cada uno entra solo; si falta el dólar, la pantalla muestra el
    // margen bruto y lo avisa (ver `rateMissing`), pero nunca se rebota un
    // número que el dueño se tomó el trabajo de cargar.
    revenueArs: z
      .number(M.unreadable)
      .nonnegative(M.negative)
      .min(L.revenueArsMin, M.revenueOutOfRange)
      .max(L.revenueArsMax, M.revenueOutOfRange)
      .nullish(),
    // Un dólar de $ 14,50 es casi siempre un `1.450` que perdió los ceros al
    // pegarlo: el rango lo caza y el mensaje muestra lo que quedó.
    usdArsRate: z
      .number(M.unreadable)
      .nonnegative(M.negative)
      .superRefine((v, ctx) => {
        if (v < L.usdArsRateMin || v > L.usdArsRateMax) {
          ctx.addIssue({ code: 'custom', message: rateOutOfRangeMessage(v) })
        }
      })
      .nullish(),
    // El CHECK `sem_no_ads_is_bare` ahora también los mira: con gasto 0 los dos
    // tienen que ir en null. Este schema no puede violarlo — `adSpendUsd` exige
    // al menos 1 centavo y corta antes con «Poné cuánto se gastó…», que es el
    // mensaje humano del caso — y la única fila con gasto 0 la escribe
    // `markEventWithoutAds`, que inserta la fila pelada.
    revenuePerGuestArs: perGuestField(M.revenuePerGuestOutOfRange),
    costPerGuestArs: perGuestField(M.costPerGuestOutOfRange),
    // `.trim()` corre antes que `.max()`: el tope es sobre lo que se guarda.
    // `.length` cuenta como el `maxLength` del textarea (unidades UTF-16), más
    // estricto que el `char_length` de Postgres: nunca pasa algo que la DB rebote.
    notes: z
      .string('La nota tiene que ser texto.')
      .trim()
      .max(L.notesMax, M.notesTooLong)
      .nullish(),
    /** `null` = alta; con valor = edición sobre esa versión (chequeo de stale). */
    expectedUpdatedAt: baselineField.nullish(),
  })
  .transform((v) => ({
    scheduledEventId: v.scheduledEventId,
    adSpendUsd: v.adSpendUsd,
    messages: v.messages ?? null,
    reach: v.reach ?? null,
    revenueArs: v.revenueArs ?? null,
    usdArsRate: v.usdArsRate ?? null,
    revenuePerGuestArs: v.revenuePerGuestArs ?? null,
    costPerGuestArs: v.costPerGuestArs ?? null,
    notes: v.notes ? v.notes : null,
    expectedUpdatedAt: v.expectedUpdatedAt ?? null,
  }))

/** Lo que manda el form. Números en unidades, nunca centavos. */
export type SaveEventMarketingInput = {
  scheduledEventId: string
  adSpendUsd: number
  messages: number | null
  reach: number | null
  revenueArs: number | null
  usdArsRate: number | null
  /** El cubierto, en PESOS (los $ 27.000 del ejemplo del dueño). */
  revenuePerGuestArs: number | null
  /** Lo que cuesta servir a una persona, en PESOS (los $ 15.000 del ejemplo). */
  costPerGuestArs: number | null
  notes: string | null
  expectedUpdatedAt: string | null
}

export type SaveEventMarketingValues = z.output<typeof saveEventMarketingSchema>

export const markEventWithoutAdsSchema = z.object({ scheduledEventId: eventIdField })

export const deleteEventMarketingSchema = z.object({
  scheduledEventId: eventIdField,
  // Borrar SIEMPRE lleva la versión: sin ella no hay forma de saber si el dueño
  // está borrando los números que vio o los que otro cargó recién.
  expectedUpdatedAt: baselineField,
})

const MARKETING_FIELDS: ReadonlySet<string> = new Set<MarketingField>([
  'adSpendUsd',
  'messages',
  'reach',
  'revenueArs',
  'usdArsRate',
  'revenuePerGuestArs',
  'costPerGuestArs',
  'notes',
])

/**
 * Un mensaje por campo del form: el primero que haya tirado zod. Los issues que
 * no son de un campo visible (id de la fecha, versión) no entran: esos van al
 * `message` general del estado.
 */
export function marketingFieldErrors(error: {
  issues: ReadonlyArray<{ path: ReadonlyArray<PropertyKey>; message: string }>
}): Partial<Record<MarketingField, string>> {
  const out: Partial<Record<MarketingField, string>> = {}
  for (const issue of error.issues) {
    const key = issue.path[0]
    if (typeof key !== 'string' || !MARKETING_FIELDS.has(key)) continue
    const field = key as MarketingField
    if (out[field] === undefined) out[field] = issue.message
  }
  return out
}

/**
 * Unidades → columnas. Único lugar donde se multiplica por 100.
 *
 * `Math.round` y no truncar: `175.26 * 100` en coma flotante es
 * `17525.999999999996`, y truncar guardaría un centavo menos de lo que el dueño
 * tipeó. El dólar va a 2 decimales como la columna `numeric(12,2)`, así la fila
 * que vuelve a la pantalla es la misma que quedó en la DB.
 */
export function toMarketingDbFields(values: SaveEventMarketingValues) {
  return {
    ad_spend_usd_cents: Math.round(values.adSpendUsd * 100),
    messages: values.messages,
    reach: values.reach,
    revenue_ars_cents: values.revenueArs === null ? null : Math.round(values.revenueArs * 100),
    usd_ars_rate: values.usdArsRate === null ? null : Math.round(values.usdArsRate * 100) / 100,
    revenue_per_guest_ars_cents:
      values.revenuePerGuestArs === null ? null : Math.round(values.revenuePerGuestArs * 100),
    cost_per_guest_ars_cents:
      values.costPerGuestArs === null ? null : Math.round(values.costPerGuestArs * 100),
    notes: values.notes,
  }
}

/**
 * ¿La facturación que llega es la MISMA que ya está guardada? Decide si una
 * fecha futura puede guardar facturación: cargarla o cambiarla no, pero una
 * edición que se movió a una fecha futura y ya la tenía la manda tal cual (el
 * form la muestra), y rechazarla obligaba a borrarla para corregir una nota.
 *
 * Mira SOLO la facturación. Antes también exigía que el dólar fuera el mismo,
 * porque la DB los guardaba de a pares; desde que se borró ese CHECK, el dólar
 * es de la pauta y no de la caja, y una fecha futura tiene todo el derecho a
 * cambiarlo (la pauta se gasta ANTES del evento). Compararlo hacía rebotar esa
 * edición con «La facturación se carga cuando pasa la fecha», que además es
 * mentira: nadie tocó la facturación.
 *
 * Se compara en centavos, lo que guarda la DB: el ida y vuelta por el input no
 * cuenta como cambio por coma flotante.
 */
export function sameStoredRevenue(
  fields: Pick<ReturnType<typeof toMarketingDbFields>, 'revenue_ars_cents'>,
  stored: Pick<EventMarketingDbRow, 'revenue_ars_cents'>,
): boolean {
  const storedRevenue = toNumberOrNull(stored.revenue_ars_cents)
  if (fields.revenue_ars_cents === null || storedRevenue === null) return false
  return fields.revenue_ars_cents === storedRevenue
}

/** Las columnas que alimentan `EventMarketingRow`. Queries y actions leen lo mismo. */
export const EVENT_MARKETING_DB_SELECT =
  'scheduled_event_id, ad_spend_usd_cents, messages, reach, revenue_ars_cents, usd_ars_rate, revenue_per_guest_ars_cents, cost_per_guest_ars_cents, notes, updated_at, updated_by'

/**
 * Una fila como llega de PostgREST. `numeric` y `bigint` pueden venir como
 * string según la versión y el tamaño del número, así que se tipan anchos y se
 * normalizan en `toEventMarketingRow`.
 */
export type EventMarketingDbRow = {
  scheduled_event_id: string
  ad_spend_usd_cents: number | string
  messages: number | string | null
  reach: number | string | null
  revenue_ars_cents: number | string | null
  usd_ars_rate: number | string | null
  revenue_per_guest_ars_cents: number | string | null
  cost_per_guest_ars_cents: number | string | null
  notes: string | null
  updated_at: string
  updated_by: string | null
}

function toNumberOrNull(value: number | string | null | undefined): number | null {
  if (value === null || value === undefined) return null
  const n = Number(value)
  return Number.isFinite(n) ? n : null
}

/**
 * DB → dominio. Los centavos SIGUEN en centavos (`adSpendUsdCents`,
 * `revenueArsCents`): pasarlos a unidades es cosa de los formateadores de
 * `event-marketing.ts`. `displayName` es el nombre completo del gestor; acá se
 * abrevia ('Nacho Badra' → 'Nacho B.').
 */
export function toEventMarketingRow(
  raw: EventMarketingDbRow,
  displayName: string | null,
): EventMarketingRow {
  return {
    scheduledEventId: raw.scheduled_event_id,
    adSpendUsdCents: toNumberOrNull(raw.ad_spend_usd_cents) ?? 0,
    messages: toNumberOrNull(raw.messages),
    reach: toNumberOrNull(raw.reach),
    revenueArsCents: toNumberOrNull(raw.revenue_ars_cents),
    usdArsRate: toNumberOrNull(raw.usd_ars_rate),
    revenuePerGuestArsCents: toNumberOrNull(raw.revenue_per_guest_ars_cents),
    costPerGuestArsCents: toNumberOrNull(raw.cost_per_guest_ars_cents),
    notes: raw.notes,
    updatedAt: raw.updated_at,
    updatedByName: shortName(displayName),
  }
}
