/**
 * El borrador del formulario de "Pauta en Meta": lo que el dueño está tipeando,
 * todavía como TEXTO, y todo lo que hace falta decidir sobre él sin tocar React.
 *
 * Vive aparte de `event-marketing.ts` por una razón de imports, no de gusto: el
 * chequeo del borrador corre el MISMO schema zod que la Server Action
 * (`event-marketing-schemas.ts`), y ese archivo ya importa de
 * `event-marketing.ts`. Meterlo allá armaba un ciclo de imports entre dos
 * módulos con constantes. Acá el orden es lineal: cuentas → schema → borrador.
 *
 * Por qué el form corre el schema del server: el error tiene que caer en el
 * mismo campo y con las mismas palabras de los dos lados. Si el cliente dijera
 * «Revisá el número» y el server «No se pudo guardar», el dueño no sabría qué
 * tocar.
 *
 * Puro: sin DB ni React.
 */

import {
  canonicalInput,
  type EventMarketingRow,
  formatDayMonth,
  formatLoadedAt,
  formatPesosRate,
  isNoAdsSpend,
  type MarketingActionState,
  type MarketingField,
  type MarketingPhase,
  type MonthEdition,
  type MonthPendingRow,
  type NumberKind,
  type ParsedNumber,
  parseLocaleNumber,
} from './event-marketing'
import {
  MARKETING_FIELD_MESSAGES,
  marketingFieldErrors,
  type SaveEventMarketingInput,
  saveEventMarketingSchema,
} from './event-marketing-schemas'

// ─── Forma del borrador ──────────────────────────────────────────────────────

/**
 * Lo que hay escrito en cada campo, tal cual. `moneyOpen` es el desplegable
 * «Sumar la plata de la noche», que hoy guarda los cuatro números de plata:
 * ingreso y costo por persona, la facturación real y el dólar del día.
 */
export type MarketingDraft = {
  adSpendUsd: string
  messages: string
  reach: string
  revenuePerGuestArs: string
  costPerGuestArs: string
  revenueArs: string
  usdArsRate: string
  notes: string
  moneyOpen: boolean
}

export type NumericMarketingField = Exclude<MarketingField, 'notes'>

export const MARKETING_NUMBER_KINDS: Readonly<Record<NumericMarketingField, NumberKind>> = {
  adSpendUsd: 'money',
  messages: 'count',
  reach: 'count',
  revenuePerGuestArs: 'money',
  costPerGuestArs: 'money',
  revenueArs: 'money',
  usdArsRate: 'rate',
}

/**
 * Los que viven dentro del desplegable de plata. Cerrado, ninguno viaja: lo que
 * no se ve no se guarda.
 */
export const MARKETING_MONEY_FIELDS: readonly NumericMarketingField[] = [
  'revenuePerGuestArs',
  'costPerGuestArs',
  'revenueArs',
  'usdArsRate',
]

/** Orden de los campos en pantalla: manda el foco inicial y el «Corregí …». */
export const MARKETING_FIELD_ORDER: readonly MarketingField[] = [
  'adSpendUsd',
  'messages',
  'reach',
  'revenuePerGuestArs',
  'costPerGuestArs',
  'revenueArs',
  'usdArsRate',
  'notes',
]

/** Las etiquetas visibles, que son también las que nombra «Corregí «…» para guardar». */
export const MARKETING_FIELD_LABELS: Readonly<Record<MarketingField, string>> = {
  adSpendUsd: 'Gastado',
  messages: 'Mensajes',
  reach: 'Alcance',
  revenuePerGuestArs: 'Ingreso por persona',
  costPerGuestArs: 'Costo por persona',
  revenueArs: 'Facturación del evento',
  usdArsRate: 'Dólar del día',
  notes: 'Nota',
}

/** La ayuda de una línea que va debajo de cada campo de plata. */
export const MARKETING_MONEY_HINTS = {
  revenuePerGuestArs: 'Lo que deja cada persona.',
  costPerGuestArs: 'Lo que cuesta servirla: comida y bebida, sin sueldos.',
  revenueArs: 'Solo lo del evento, sin las mesas normales. Si la cargás, manda sobre el estimado.',
  usdArsRate: 'El que usaste para pagar Meta (el de la tarjeta). Pasa la pauta a pesos.',
} as const

/**
 * Los que se apagan cuando «Gastado» es 0: sin anuncio no hay mensajes ni
 * alcance de Meta, y el dólar está para pasar la pauta a pesos. Apagados no
 * viajan (la DB los rechaza con gasto 0), pero lo escrito se conserva en el
 * borrador: si el 0 era un error de tipeo, al corregirlo vuelven solos.
 */
export const MARKETING_NO_ADS_OFF_FIELDS: readonly NumericMarketingField[] = [
  'messages',
  'reach',
  'usdArsRate',
]

/** La ayuda de esos tres mientras están apagados: por qué, en vez de «En Meta: …». */
export const MARKETING_NO_ADS_HINTS: Readonly<Record<'messages' | 'reach' | 'usdArsRate', string>> =
  {
    messages: 'Sin pauta no hay mensajes de Meta.',
    reach: 'Sin pauta no hay alcance de Meta.',
    usdArsRate: 'Sin pauta no hace falta: es para pasar la pauta a pesos.',
  }

export const EMPTY_MARKETING_DRAFT: MarketingDraft = {
  adSpendUsd: '',
  messages: '',
  reach: '',
  revenuePerGuestArs: '',
  costPerGuestArs: '',
  revenueArs: '',
  usdArsRate: '',
  notes: '',
  moneyOpen: false,
}

/**
 * Lo guardado, escrito como quedaría en el input después del blur. «No tuvo
 * pauta» abre con `0` en «Gastado»: es lo que está guardado, y con el 0 el form
 * ya sabe que es una noche orgánica (apaga lo de Meta y deja la plata).
 *
 * El desplegable de plata abre si hay CUALQUIERA de los cuatro números: si se
 * abriera solo con la facturación, un ingreso por persona ya guardado quedaría
 * escondido y el guardado siguiente lo borraría sin que nadie lo vea.
 */
export function draftFromRow(row: EventMarketingRow | null): MarketingDraft {
  if (row === null) return { ...EMPTY_MARKETING_DRAFT }
  const pesos = (cents: number | null) =>
    cents === null ? '' : canonicalInput(cents / 100, 'money')
  const draft: MarketingDraft = {
    adSpendUsd: canonicalInput(row.adSpendUsdCents / 100, 'money'),
    messages: row.messages === null ? '' : canonicalInput(row.messages, 'count'),
    reach: row.reach === null ? '' : canonicalInput(row.reach, 'count'),
    revenuePerGuestArs: pesos(row.revenuePerGuestArsCents),
    costPerGuestArs: pesos(row.costPerGuestArsCents),
    revenueArs: pesos(row.revenueArsCents),
    usdArsRate: row.usdArsRate === null ? '' : canonicalInput(row.usdArsRate, 'rate'),
    notes: row.notes ?? '',
    moneyOpen: false,
  }
  draft.moneyOpen = MARKETING_MONEY_FIELDS.some((field) => draft[field] !== '')
  return draft
}

/**
 * ¿Hay algo distinto de lo guardado? Decide si al reabrir se dice «Seguís con
 * lo que habías escrito». La sección de plata abierta pero vacía no cuenta como
 * cambio: tocar el botón no es escribir un número.
 */
export function sameDraft(a: MarketingDraft, b: MarketingDraft): boolean {
  // Lo apagado no cuenta, igual que lo que no se ve: no se va a guardar.
  const norm = (d: MarketingDraft) => {
    const on = (field: NumericMarketingField) =>
      MARKETING_NO_ADS_OFF_FIELDS.includes(field) && draftIsNoAds(d) ? '' : d[field].trim()
    return [
      d.adSpendUsd.trim(),
      on('messages'),
      on('reach'),
      ...MARKETING_MONEY_FIELDS.map((field) => (d.moneyOpen ? on(field) : '')),
      d.notes.trim(),
    ]
  }
  const x = norm(a)
  const y = norm(b)
  return x.every((value, i) => value === y[i])
}

/**
 * Lo tipeado que sobrevive a un Esc, con la versión de la fila contra la que se
 * escribió. Sin `baseAt`, al reabrir la base sería la fila de ESE momento: si
 * otro dueño guardó en el medio, el form no avisaría nada y el guardado pisaría
 * sus números con el `updated_at` nuevo, sin rebotar como stale.
 */
export type KeptMarketingDraft = { draft: MarketingDraft; baseAt: string | null }

/** Lo que se guarda al cancelar: `null` si no hay nada distinto de lo guardado. */
export function keepMarketingDraft(
  draft: MarketingDraft,
  saved: MarketingDraft,
  baseAt: string | null,
): KeptMarketingDraft | null {
  return sameDraft(draft, saved) ? null : { draft, baseAt }
}

/**
 * La versión que el dueño «tenía delante» al abrir: la del borrador guardado si
 * retoma uno, o la fila actual si abre de cero. Si difiere de la fila actual, el
 * form muestra «Lo que quedó guardado» antes de dejarlo pisar.
 */
export function marketingBaseline(
  kept: KeptMarketingDraft | null | undefined,
  row: EventMarketingRow | null,
): string | null {
  return kept ? kept.baseAt : (row?.updatedAt ?? null)
}

/**
 * ¿Se muestra la facturación? Una fecha que todavía no pasó no facturó nada, así
 * que en principio no. Pero si la fila YA tiene facturación (la edición se movió
 * a una fecha futura), se muestra igual: esconderla y mandarla vacía la borraba
 * sin avisar. Queda a la vista y solo se va con «Quitar la plata».
 *
 * Es SOLO sobre la facturación real. El ingreso y el costo por persona, y el
 * dólar, se cargan en cualquier fecha: el cubierto de la noche de ramen se sabe
 * antes, y la pauta se paga antes del evento.
 */
export function marketingRevenueVisible(
  phase: MarketingPhase,
  row: EventMarketingRow | null,
): boolean {
  return phase !== 'future' || (row !== null && row.revenueArsCents !== null)
}

// ─── Lectura campo por campo ─────────────────────────────────────────────────

/**
 * El último valor que se pudo leer, para la vista previa: mientras el dueño
 * tipea `175,` (que todavía no es un número) la cuenta sigue mostrando la de
 * `175`, en vez de parpadear a `—` a cada tecla. Vacío sí es vacío.
 */
export function nextLastValid(prev: number | null, raw: string, kind: NumberKind): number | null {
  const parsed = parseLocaleNumber(raw, kind)
  if (parsed.ok) return parsed.value
  return parsed.reason === 'vacio' ? null : prev
}

/** Lo último válido de cada campo numérico de un borrador recién abierto. */
export function lastValidFromDraft(
  draft: MarketingDraft,
): Record<NumericMarketingField, number | null> {
  const read = (field: NumericMarketingField) =>
    nextLastValid(null, draft[field], MARKETING_NUMBER_KINDS[field])
  return {
    adSpendUsd: read('adSpendUsd'),
    messages: read('messages'),
    reach: read('reach'),
    revenuePerGuestArs: read('revenuePerGuestArs'),
    costPerGuestArs: read('costPerGuestArs'),
    revenueArs: read('revenueArs'),
    usdArsRate: read('usdArsRate'),
  }
}

/**
 * ¿«Gastado» dice que no hubo pauta? Solo si se puede leer y da 0 centavos:
 * vacío es «todavía no lo cargó», no «no hubo».
 */
export function draftIsNoAds(draft: MarketingDraft): boolean {
  const parsed = parseLocaleNumber(draft.adSpendUsd, 'money')
  return parsed.ok && isNoAdsSpend(parsed.value)
}

/**
 * ¿Ese campo está prendido, y entonces viaja? Con «Gastado» en 0 se apagan los
 * de Meta y el dólar. Los de plata solo con la sección abierta, y la
 * facturación además solo cuando la fecha la admite (`marketingRevenueVisible`).
 * Lo mira el chequeo y también el formulario, para que lo que se dibuja y lo
 * que se manda no puedan separarse.
 */
export function marketingFieldEnabled(
  field: NumericMarketingField,
  draft: MarketingDraft,
  revenueVisible: boolean,
): boolean {
  if (MARKETING_NO_ADS_OFF_FIELDS.includes(field) && draftIsNoAds(draft)) return false
  if (!MARKETING_MONEY_FIELDS.includes(field)) return true
  if (!draft.moneyOpen) return false
  return field !== 'revenueArs' || revenueVisible
}

function parseMessage(
  field: NumericMarketingField,
  reason: Extract<ParsedNumber, { ok: false }>['reason'],
): string | null {
  const M = MARKETING_FIELD_MESSAGES
  switch (reason) {
    // Vacío solo es error en «Gastado»: todo lo demás es opcional. Desde que se
    // borró el CHECK `sem_revenue_needs_rate`, tampoco hay campos que vayan de a
    // pares — cada número entra solo y la pantalla avisa qué falta para cerrar
    // la cuenta (ver `missingRateNotice` y la vista previa).
    case 'vacio':
      return field === 'adSpendUsd' ? M.spendMissing : null
    case 'ilegible':
      return M.unreadable
    case 'negativo':
      return M.negative
    case 'con-decimales':
      return M.withDecimals
  }
}

export const MESSAGES_OVER_REACH_WARNING =
  'Hay más mensajes que alcance. Revisá que en Meta sea el mismo rango de fechas.'

export type DraftCheck = {
  /** Un mensaje por campo, el primero que aplique. Vacío = se puede guardar. */
  fieldErrors: Partial<Record<MarketingField, string>>
  /** Lo que se le manda a `saveEventMarketing`. `null` mientras haya errores. */
  input: SaveEventMarketingInput | null
  /** Aviso que NO bloquea (más mensajes que alcance). */
  softWarning: string | null
}

/**
 * Todo lo que se sabe del borrador antes de mandarlo, en dos capas:
 *
 * 1. Lo que no se puede leer (`parseLocaleNumber`): ilegible, negativo, con
 *    decimales, o «Gastado» vacío.
 * 2. El schema del server, para rangos y topes con sus mismas palabras.
 *
 * Ya no hay campos que vayan de a pares. Antes, facturación sin dólar (o al
 * revés) era un error que bloqueaba el guardado, porque la DB los guardaba
 * juntos; desde que se borró ese CHECK el dólar es de la PAUTA y no de la caja,
 * así que cada número entra solo. Lo que falte para cerrar la cuenta lo dice la
 * vista previa, sin rebotar nada que el dueño se tomó el trabajo de cargar.
 *
 * Los campos de plata cuentan solo con la sección abierta, y la facturación
 * además solo si la fecha la admite: lo que no se ve no viaja.
 */
export function checkMarketingDraft(
  draft: MarketingDraft,
  ctx: { scheduledEventId: string; expectedUpdatedAt: string | null; revenueVisible: boolean },
): DraftCheck {
  const fieldErrors: Partial<Record<MarketingField, string>> = {}

  const numbers: Record<NumericMarketingField, number | null> = {
    adSpendUsd: null,
    messages: null,
    reach: null,
    revenuePerGuestArs: null,
    costPerGuestArs: null,
    revenueArs: null,
    usdArsRate: null,
  }

  for (const field of Object.keys(MARKETING_NUMBER_KINDS) as NumericMarketingField[]) {
    if (!marketingFieldEnabled(field, draft, ctx.revenueVisible)) continue
    const parsed = parseLocaleNumber(draft[field], MARKETING_NUMBER_KINDS[field])
    if (parsed.ok) {
      numbers[field] = parsed.value
      continue
    }
    const message = parseMessage(field, parsed.reason)
    if (message) fieldErrors[field] = message
  }

  const notes = draft.notes.trim()
  const candidate: SaveEventMarketingInput = {
    scheduledEventId: ctx.scheduledEventId,
    // Un «Gastado» vacío o ilegible viaja como un gasto cualquiera solo para
    // que el schema revise el resto: su error de lectura ya está puesto, tiene
    // prioridad y con él `input` sale en null. NO puede viajar como 0: el 0 es
    // «no hubo pauta» y el schema le reclamaría a Mensajes un error que no es.
    adSpendUsd: numbers.adSpendUsd ?? 1,
    messages: numbers.messages,
    reach: numbers.reach,
    revenuePerGuestArs: numbers.revenuePerGuestArs,
    costPerGuestArs: numbers.costPerGuestArs,
    revenueArs: numbers.revenueArs,
    usdArsRate: numbers.usdArsRate,
    notes: notes === '' ? null : notes,
    expectedUpdatedAt: ctx.expectedUpdatedAt,
  }

  const parsed = saveEventMarketingSchema.safeParse(candidate)
  if (!parsed.success) {
    const schemaErrors = marketingFieldErrors(parsed.error)
    for (const field of MARKETING_FIELD_ORDER) {
      const message = schemaErrors[field]
      if (message && fieldErrors[field] === undefined) fieldErrors[field] = message
    }
  }

  const softWarning =
    numbers.messages !== null && numbers.reach !== null && numbers.messages > numbers.reach
      ? MESSAGES_OVER_REACH_WARNING
      : null

  return {
    fieldErrors,
    input: Object.keys(fieldErrors).length === 0 ? candidate : null,
    softWarning,
  }
}

/**
 * El aviso del dólar, que NO bloquea: con facturación cargada y sin dólar, el
 * recuadro «Retorno» de la ficha no se puede armar (es la facturación pasada a
 * dólares). Va debajo del campo como aviso, no como error de campo: no pinta el
 * input de rojo ni apaga «Guardar pauta». La carga entra igual y el resto de la
 * cuenta se muestra sin él.
 *
 * Para la otra mitad —la pauta que no se puede pasar a pesos— no hace falta un
 * aviso acá: la vista previa ya dice «Falta el dólar del día para pasar la
 * pauta a pesos: por ahora, esto es el margen bruto», con esas palabras.
 */
export function missingRateNotice(values: {
  revenueArs: number | null
  usdArsRate: number | null
}): string | null {
  return values.revenueArs !== null && values.usdArsRate === null
    ? MARKETING_FIELD_MESSAGES.rateMissing
    : null
}

/**
 * Por qué «Guardar pauta» está apagado, en palabras: `Corregí «Mensajes» para
 * guardar.` Recibe solo los errores que están A LA VISTA: un botón apagado por
 * un error que el dueño todavía no ve es un misterio.
 */
export function blockedSaveMessage(
  visibleErrors: Partial<Record<MarketingField, string>>,
): string | null {
  const names = MARKETING_FIELD_ORDER.filter((f) => visibleErrors[f]).map(
    (f) => `«${MARKETING_FIELD_LABELS[f]}»`,
  )
  if (names.length === 0) return null
  const list =
    names.length === 1 ? names[0] : `${names.slice(0, -1).join(', ')} y ${names[names.length - 1]}`
  return `Corregí ${list} para guardar.`
}

/**
 * Dónde cae el foco al abrir: el primer campo vacío. Si ya está todo, «Gastado».
 * Los de plata entran solo si su sección está abierta (y la facturación, además,
 * si la fecha la admite).
 */
export function firstEmptyField(draft: MarketingDraft, revenueVisible: boolean): MarketingField {
  for (const field of MARKETING_FIELD_ORDER) {
    if (field === 'notes') continue
    if (!marketingFieldEnabled(field, draft, revenueVisible)) continue
    if (draft[field].trim() === '') return field
  }
  return 'adSpendUsd'
}

/**
 * El chip del dólar: `Usar $ 1.450 (último, 07/09)`. Nunca un pre-llenado
 * silencioso: un dólar viejo se guardaría sin que nadie lo mire.
 */
export function lastRateChipLabel(last: { rate: number; loadedAt: string }): string {
  const at = formatLoadedAt(last.loadedAt)
  const day = at === '' ? '' : `, ${at.slice(0, 5)}`
  return `Usar ${formatPesosRate(last.rate)} (último${day})`
}

/**
 * Un «Deshacer» de «No tuvo pauta» que falló: ¿se vuelve a mostrar la marca?
 * Solo si sigue siendo la verdad (falla de red con props todavía en esa versión
 * o sin traerla). Con stale, o con props ya en otra versión (se guardó encima
 * mientras el toast seguía), gana la del server: re-clavar la marca la dejaba
 * fija, porque el refresh trae la misma versión nueva y nada la despega.
 */
export function restoreMarkAfterFailedUndo(
  code: Extract<MarketingActionState, { ok: false }>['code'],
  propsAt: string | null,
  markedAt: string,
): boolean {
  return code !== 'stale' && (propsAt === null || propsAt === markedAt)
}

/**
 * Las filas del recuadro de pendientes, con la que tiene el form abierto
 * clavada aunque ya no esté pendiente.
 *
 * Si otro dueño completa esa fecha mientras se tipea, el guardado rebota como
 * stale y el refresh la saca de «pendientes»: sin esto, la fila y el form se
 * desmontaban con lo escrito, justo cuando el toast dice «revisalos y guardá de
 * nuevo». Clavada, recibe la fila nueva (y el form muestra lo que quedó
 * guardado) hasta que el dueño guarda, cancela o borra. Va en su lugar por fecha.
 */
export function pinOpenPendingRow(
  rows: ReadonlyArray<MonthPendingRow>,
  open: MonthPendingRow | null,
  editions: ReadonlyArray<Pick<MonthEdition, 'eventId' | 'row' | 'status'>>,
): MonthPendingRow[] {
  if (open === null || rows.some((r) => r.eventId === open.eventId)) return [...rows]
  const edition = editions.find((e) => e.eventId === open.eventId)
  const pinned: MonthPendingRow = edition
    ? { ...open, row: edition.row, incomplete: edition.status === 'incompleta' }
    : open
  const at = rows.findIndex((r) => r.date > pinned.date)
  return at === -1 ? [...rows, pinned] : [...rows.slice(0, at), pinned, ...rows.slice(at)]
}

// ─── Textos que nombran la fecha ─────────────────────────────────────────────

/**
 * Todo lo que repite «Noche Astral del 09/09». Los botones se repiten en cada
 * ficha (dos eventos en una noche, diez en el mes), así que el `aria-label`
 * dice de qué fecha son; y los toasts sobreviven a la ficha, así que también.
 */
export function marketingCopy(title: string, eventDate: string) {
  const dm = formatDayMonth(eventDate)
  const of = `${title} del ${dm}`
  return {
    formLabel: `Pauta en Meta de ${of}`,
    // El nombre accesible CONTIENE el texto visible del botón («Editar»,
    // «Cargar pauta», «No tuvo pauta»): quien maneja la compu con la voz dice
    // lo que ve, y un aria-label que no lo incluye no le responde.
    editAria: `Editar la pauta de ${of}`,
    loadAria: `Cargar pauta de ${of}`,
    noAdsAria: `No tuvo pauta: ${of}`,
    changeAria: `Cambiar la pauta de ${of}`,
    addMoneyAria: `Sumar la plata de la noche de ${of}`,
    updateAria: `Actualizar la pauta de ${of}`,
    deleteTitle: `¿Borrar la pauta de ${of}?`,
    deleteDescription: 'La fecha vuelve a quedar «Sin cargar». Los números de gente no cambian.',
    savedToast: `Pauta de ${title} ${dm} guardada.`,
    deletedToast: `Pauta de ${title} ${dm} borrada.`,
    noAdsToast: `${title} ${dm} quedó sin pauta.`,
    undoneToast: 'Listo: volvió a «Sin cargar».',
  }
}

/**
 * Lo que se dice cuando la Server Action ni siquiera contestó (red caída, deploy
 * en el medio). Mismas palabras que el estado `error` de cada acción: para el
 * dueño es el mismo problema. Viven acá porque un archivo `'use server'` solo
 * puede exportar funciones async.
 */
export const MARKETING_UNREACHABLE = {
  save: 'No se pudo guardar la pauta. Probá de nuevo.',
  noAds: 'No se pudo marcar la fecha sin pauta. Probá de nuevo.',
  delete: 'No se pudo borrar la pauta. Probá de nuevo.',
} as const
