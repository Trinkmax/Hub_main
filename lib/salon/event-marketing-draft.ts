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

/** Lo que hay escrito en cada campo, tal cual. `revenueOpen` es el «+ Sumar la facturación». */
export type MarketingDraft = {
  adSpendUsd: string
  messages: string
  reach: string
  revenueArs: string
  usdArsRate: string
  notes: string
  revenueOpen: boolean
}

export type NumericMarketingField = Exclude<MarketingField, 'notes'>

export const MARKETING_NUMBER_KINDS: Readonly<Record<NumericMarketingField, NumberKind>> = {
  adSpendUsd: 'money',
  messages: 'count',
  reach: 'count',
  revenueArs: 'money',
  usdArsRate: 'rate',
}

/** Orden de los campos en pantalla: manda el foco inicial y el «Corregí …». */
export const MARKETING_FIELD_ORDER: readonly MarketingField[] = [
  'adSpendUsd',
  'messages',
  'reach',
  'revenueArs',
  'usdArsRate',
  'notes',
]

/** Las etiquetas visibles, que son también las que nombra «Corregí «…» para guardar». */
export const MARKETING_FIELD_LABELS: Readonly<Record<MarketingField, string>> = {
  adSpendUsd: 'Gastado',
  messages: 'Mensajes',
  reach: 'Alcance',
  revenueArs: 'Facturación del evento',
  usdArsRate: 'Dólar del día',
  notes: 'Nota',
}

export const EMPTY_MARKETING_DRAFT: MarketingDraft = {
  adSpendUsd: '',
  messages: '',
  reach: '',
  revenueArs: '',
  usdArsRate: '',
  notes: '',
  revenueOpen: false,
}

/**
 * Lo guardado, escrito como quedaría en el input después del blur. «No tuvo
 * pauta» (gasto 0) abre VACÍO: un `0,00` en «Gastado» sería un número que el
 * formulario mismo rechaza.
 */
export function draftFromRow(row: EventMarketingRow | null): MarketingDraft {
  if (row === null || row.adSpendUsdCents <= 0) return { ...EMPTY_MARKETING_DRAFT }
  const hasRevenue = row.revenueArsCents !== null && row.usdArsRate !== null
  return {
    adSpendUsd: canonicalInput(row.adSpendUsdCents / 100, 'money'),
    messages: row.messages === null ? '' : canonicalInput(row.messages, 'count'),
    reach: row.reach === null ? '' : canonicalInput(row.reach, 'count'),
    revenueArs:
      row.revenueArsCents === null ? '' : canonicalInput(row.revenueArsCents / 100, 'money'),
    usdArsRate: row.usdArsRate === null ? '' : canonicalInput(row.usdArsRate, 'rate'),
    notes: row.notes ?? '',
    revenueOpen: hasRevenue,
  }
}

/**
 * ¿Hay algo distinto de lo guardado? Decide si al reabrir se dice «Seguís con
 * lo que habías escrito». La facturación abierta pero vacía no cuenta como
 * cambio: tocar el botón no es escribir un número.
 */
export function sameDraft(a: MarketingDraft, b: MarketingDraft): boolean {
  const norm = (d: MarketingDraft) => {
    const revenueArs = d.revenueArs.trim()
    const usdArsRate = d.usdArsRate.trim()
    return [
      d.adSpendUsd.trim(),
      d.messages.trim(),
      d.reach.trim(),
      d.revenueOpen ? revenueArs : '',
      d.revenueOpen ? usdArsRate : '',
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
 * sin avisar. Queda a la vista y solo se va con «Quitar la facturación».
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
    revenueArs: read('revenueArs'),
    usdArsRate: read('usdArsRate'),
  }
}

function parseMessage(
  field: NumericMarketingField,
  reason: Extract<ParsedNumber, { ok: false }>['reason'],
): string | null {
  const M = MARKETING_FIELD_MESSAGES
  switch (reason) {
    // Vacío solo es error en «Gastado»: todo lo demás es opcional o va de a
    // pares (y el par lo resuelve el chequeo de abajo, en el campo que falta).
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
 * Todo lo que se sabe del borrador antes de mandarlo, en tres capas:
 *
 * 1. Lo que no se puede leer (`parseLocaleNumber`): ilegible, negativo, con
 *    decimales, o «Gastado» vacío.
 * 2. Facturación y dólar van juntos: el error cae en el que FALTA (vacío), no
 *    en el que está mal escrito, que ya tiene su propio error.
 * 3. El schema del server, para rangos y topes con sus mismas palabras.
 *
 * La facturación solo cuenta con la sección abierta y a la vista
 * (`marketingRevenueVisible`): lo que no se ve no viaja.
 */
export function checkMarketingDraft(
  draft: MarketingDraft,
  ctx: { scheduledEventId: string; expectedUpdatedAt: string | null; revenueVisible: boolean },
): DraftCheck {
  const fieldErrors: Partial<Record<MarketingField, string>> = {}
  const revenueEnabled = draft.revenueOpen && ctx.revenueVisible

  const numbers: Record<NumericMarketingField, number | null> = {
    adSpendUsd: null,
    messages: null,
    reach: null,
    revenueArs: null,
    usdArsRate: null,
  }
  const empty = new Set<NumericMarketingField>()

  for (const field of Object.keys(MARKETING_NUMBER_KINDS) as NumericMarketingField[]) {
    if (!revenueEnabled && (field === 'revenueArs' || field === 'usdArsRate')) continue
    const parsed = parseLocaleNumber(draft[field], MARKETING_NUMBER_KINDS[field])
    if (parsed.ok) {
      numbers[field] = parsed.value
      continue
    }
    if (parsed.reason === 'vacio') empty.add(field)
    const message = parseMessage(field, parsed.reason)
    if (message) fieldErrors[field] = message
  }

  if (revenueEnabled) {
    if (numbers.revenueArs !== null && empty.has('usdArsRate')) {
      fieldErrors.usdArsRate = MARKETING_FIELD_MESSAGES.rateMissing
    }
    if (numbers.usdArsRate !== null && empty.has('revenueArs')) {
      fieldErrors.revenueArs = MARKETING_FIELD_MESSAGES.revenueMissing
    }
  }

  const notes = draft.notes.trim()
  const candidate: SaveEventMarketingInput = {
    scheduledEventId: ctx.scheduledEventId,
    // Un «Gastado» ilegible viaja como 0 solo para que el schema revise el
    // resto: su error de lectura ya está puesto y tiene prioridad.
    adSpendUsd: numbers.adSpendUsd ?? 0,
    messages: numbers.messages,
    reach: numbers.reach,
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
 * La facturación entra solo si su sección está a la vista.
 */
export function firstEmptyField(draft: MarketingDraft, revenueVisible: boolean): MarketingField {
  const candidates: MarketingField[] = ['adSpendUsd', 'messages', 'reach']
  if (revenueVisible && draft.revenueOpen) candidates.push('revenueArs', 'usdArsRate')
  for (const field of candidates) {
    if (field !== 'notes' && draft[field].trim() === '') return field
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
