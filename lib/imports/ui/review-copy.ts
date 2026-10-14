/**
 * Las palabras de la revisión de un archivo (`importar/[batchId]`): el título
 * (que dice la tarea, no el origen), el número de arriba y su oración, el
 * estado de cada hoja, la pregunta en criollo de cada cosa que falta y los
 * renglones del papel.
 *
 * Por qué existe: los textos del servidor (`lib/imports/server/types.ts`) están
 * escritos para una lista de avisos («Elegí la cuenta contra la que va»). Acá
 * cada cosa que falta es UNA pregunta con sus respuestas, en palabras de dueño
 * de bar. Las claves y lo que se manda no cambian.
 *
 * Puro (sin React). Nunca nombra un bar ni un sistema de caja, y respeta los
 * textos que la Guía ya enseña («Ya está cargado», «Es el mismo: no lo
 * cargues», «Es otro: cargalo»).
 */

import { capitalizeFirst, formatDayMonth, isRealIsoDay } from '@/lib/dates'
import { formatCuit } from '@/lib/fiscal'
import type {
  ImportNeed,
  ManualReason,
  NeedKey,
  NoteKey,
  PartyRole,
  ProposalStatus,
  ProposalSummary,
  SkipReason,
} from '@/lib/imports/server/types'
import { formatCents, formatCentsShort } from '@/lib/money'
import { NEED_SHORT_TEXT } from './filters'
import { batchSubject, type InboxTone } from './inbox'
import {
  formatFxRate,
  IMPORT_SOURCE_COPY,
  IVA_CONDITION_TEXT,
  MP_CHANNEL_TEXT,
  type UiImportSource,
} from './labels'
import { count } from './progress'

// ─── El título ───────────────────────────────────────────────────────────────

export type ReviewStage = 'pending' | 'loaded' | 'nothing' | 'cancelled' | 'staging'

/** «Revisá las compras de septiembre» · «Mercado Pago del 07/10 al 08/10, cargado». */
export function reviewTitle(input: {
  source: UiImportSource
  stage: ReviewStage
  periodFrom: string | null
  periodTo: string | null
  /** La cuenta del banco de este archivo, si se sabe. */
  treasuryName?: string | null
}): string {
  const subject = batchSubject(
    { source: input.source, periodFrom: input.periodFrom, periodTo: input.periodTo },
    input.treasuryName,
  )
  const name = capitalizeFirst(subject)
  if (input.stage === 'pending') return `Revisá ${subject}`
  if (input.stage === 'loaded') {
    return `${name}, ${input.source === 'arca_recibidos' ? 'cargadas' : 'cargado'}`
  }
  if (input.stage === 'cancelled') return `${name} (archivo descartado)`
  return name
}

// ─── El número de arriba ─────────────────────────────────────────────────────

export type ReviewTally = {
  /** Con una pregunta (falta un dato, cambió o no se pudo cargar). */
  questions: number
  ready: number
  posted: number
  /** Ya estaban cargados (no se repiten). */
  already: number
  /** No van: descartados, anulados, plata retenida. */
  out: number
  total: number
}

export function reviewTally(
  byStatus: Readonly<Partial<Record<ProposalStatus, number>>>,
  alreadyLoaded: number,
): ReviewTally {
  const n = (s: ProposalStatus) => byStatus[s] ?? 0
  const questions = n('needs_input') + n('stale') + n('error')
  const ready = n('ready') + n('posting')
  const posted = n('posted')
  const skipped = n('skipped') + n('voided')
  const already = Math.min(Math.max(0, alreadyLoaded), skipped)
  return {
    questions,
    ready,
    posted,
    already,
    out: skipped - already,
    total: questions + ready + posted + skipped,
  }
}

export type ReviewHeroCopy = {
  stage: ReviewStage
  /** «TE FALTA CONTESTAR»; `null` cuando no hay nada para hacer. */
  label: string | null
  /** El número grande (o «Nada para cargar»). */
  value: string
  /** La unidad chica y gris pegada al número. */
  unit: string | null
  sentence: string
}

function listWords(parts: readonly string[]): string {
  if (parts.length <= 1) return parts[0] ?? ''
  return `${parts.slice(0, -1).join(', ')} y ${parts[parts.length - 1]}`
}

/**
 * El número que cambia con la tarea (te falta contestar → listos → cargados) y
 * la oración que cuenta el resto. En Mercado Pago y en el banco la oración no
 * lleva importe: sumar lo que entró con lo que salió no dice nada.
 */
export function reviewHero(input: {
  source: UiImportSource
  tally: ReviewTally
  readyCents: number
  /** Renglones que ya habían entrado con otro archivo. */
  duplicates?: number
  cancelled?: boolean
}): ReviewHeroCopy {
  const { tally: t, source } = input
  const [one, many] = IMPORT_SOURCE_COPY[source].unit
  const unit = (n: number) => (n === 1 ? one : many)
  const money = source === 'arca_recibidos' ? formatCentsShort(input.readyCents) : null
  const already = (n: number) => (n === 1 ? '1 ya estaba cargado' : `${n} ya estaban cargados`)
  const dup =
    (input.duplicates ?? 0) > 0
      ? ` ${count(input.duplicates ?? 0, 'renglón ya había entrado', 'renglones ya habían entrado')} con otro archivo: no se ${input.duplicates === 1 ? 'repite' : 'repiten'}.`
      : ''

  if (input.cancelled) {
    return {
      stage: 'cancelled',
      label: null,
      value: 'Archivo descartado',
      unit: null,
      sentence:
        t.posted > 0
          ? `${t.posted === 1 ? 'El que ya se había cargado sigue registrado' : `Los ${t.posted} que ya se habían cargado siguen registrados`}.`
          : 'No se había cargado nada.',
    }
  }

  if (t.questions > 0) {
    const rest: string[] = []
    if (t.ready > 0) {
      rest.push(
        `${t.ready === 1 ? 'el otro ya se puede cargar' : `los otros ${t.ready} ya se pueden cargar`}${money ? ` (${money})` : ''}`,
      )
    }
    if (t.posted > 0) rest.push(t.posted === 1 ? '1 ya se cargó' : `${t.posted} ya se cargaron`)
    if (t.already > 0) rest.push(already(t.already))
    if (t.out > 0) rest.push(t.out === 1 ? '1 no va' : `${t.out} no van`)
    return {
      stage: 'pending',
      label: 'Te falta contestar',
      value: String(t.questions),
      unit: `de ${t.total} ${unit(t.total)}`,
      sentence: `${rest.length > 0 ? `${capitalizeFirst(listWords(rest))}.` : 'Contestá lo que te pregunto y ya se puede cargar.'}${dup}`,
    }
  }

  if (t.ready > 0) {
    const parts = [
      money ? `${t.ready === 1 ? 'Es' : 'Son'} ${money}.` : null,
      t.already > 0
        ? `${capitalizeFirst(already(t.already))}: no se ${t.already === 1 ? 'repite' : 'repiten'}.`
        : null,
    ].filter(Boolean)
    return {
      stage: 'pending',
      label: 'Listos para cargar',
      value: String(t.ready),
      unit: unit(t.ready),
      sentence: `${parts.length > 0 ? parts.join(' ') : 'Todavía no se cargó nada: tocá el botón de abajo.'}${dup}`,
    }
  }

  if (t.posted > 0) {
    const rest: string[] = []
    if (t.already > 0) rest.push(already(t.already))
    if (t.out > 0) rest.push(t.out === 1 ? '1 no iba' : `${t.out} no iban`)
    return {
      stage: 'loaded',
      label: 'Cargados',
      value: String(t.posted),
      unit: unit(t.posted),
      sentence: `${rest.length > 0 ? `${capitalizeFirst(listWords(rest))}.` : 'No quedó nada pendiente.'}${dup}`,
    }
  }

  const all = t.total === 1 ? 'El único' : `Los ${t.total}`
  return {
    stage: 'nothing',
    label: null,
    value: 'Nada para cargar',
    unit: null,
    sentence:
      t.total === 0
        ? `Este archivo no dejó nada para cargar.${dup}`
        : t.already === t.total
          ? `${all} ya ${t.total === 1 ? 'estaba cargado' : 'estaban cargados'}: no se ${t.total === 1 ? 'repite' : 'repiten'}.${dup}`
          : t.already === 0
            ? `${all} ${t.total === 1 ? 'quedó' : 'quedaron'} en «No van».${dup}`
            : `${capitalizeFirst(already(t.already))} y ${t.out === 1 ? '1 no va' : `${t.out} no van`}.${dup}`,
  }
}

// ─── El estado de cada hoja ──────────────────────────────────────────────────

/** Salteadas porque ya están registradas (la misma regla que `getImportReview`). */
const ALREADY_REASONS: ReadonlySet<string> = new Set([
  'already_loaded',
  'manual_overlap',
  'posted_in_other_batch',
])

export type ProposalBadge = { label: string; tone: InboxTone }

/** El estado de una hoja, en una o dos palabras. La Guía enseña «Ya está cargado». */
export function proposalBadge(status: ProposalStatus, reason?: string | null): ProposalBadge {
  switch (status) {
    case 'needs_input':
      return { label: 'Con una pregunta', tone: 'warn' }
    case 'ready':
      return { label: 'Listo', tone: 'info' }
    case 'posting':
      return { label: 'Cargando', tone: 'info' }
    case 'posted':
      return { label: 'Cargado', tone: 'ok' }
    case 'stale':
      return { label: 'Cambió: miralo de nuevo', tone: 'warn' }
    case 'error':
      return { label: 'No se pudo cargar', tone: 'late' }
    case 'voided':
      return { label: 'Anulado', tone: 'muted' }
    default:
      if (reason && ALREADY_REASONS.has(reason)) return { label: 'Ya está cargado', tone: 'muted' }
      if (reason === 'ignored') return { label: 'No es nuestro', tone: 'muted' }
      return { label: 'No va', tone: 'muted' }
  }
}

/** Los tres grupos de «No se cargan». */
export type OutGroup = 'already' | 'ours' | 'other'

export const OUT_GROUP_TITLE: Readonly<Record<OutGroup, string>> = {
  already: 'Ya estaban cargados',
  ours: 'Dijiste que no son nuestros',
  other: 'No van',
}

export function outGroup(status: ProposalStatus, reason?: string | null): OutGroup {
  if (status === 'skipped' && reason && ALREADY_REASONS.has(reason)) return 'already'
  if (status === 'skipped' && reason === 'ignored') return 'ours'
  return 'other'
}

/** Por qué no se carga una hoja, en palabras. */
export const SKIP_COPY: Readonly<Record<SkipReason | 'post_failed', string>> = {
  already_loaded: 'Ya está cargado.',
  manual_overlap:
    'Ese día ya tiene movimientos de Mercado Pago cargados a mano: subí desde el día siguiente o anulá lo manual.',
  replaced: 'Se reemplazó al volver a armar el archivo.',
  ignored: 'Dijiste que no es nuestro.',
  reserve: 'Es plata que Mercado Pago retiene y devuelve sola: no se carga.',
  rule_ignore: 'Me enseñaste que esto no va.',
  posted_in_other_batch: 'Ya entró con otro archivo.',
  active_in_other_batch: 'Está pendiente en otro archivo: cargalo desde ahí.',
  nothing_to_load: 'No hay nada para cargar.',
  post_failed: 'No se pudo cargar.',
}

export function skipText(reason: string | null | undefined): string {
  return reason && reason in SKIP_COPY ? SKIP_COPY[reason as SkipReason] : ''
}

export const VOIDED_QUESTION = 'El comprobante se anuló. ¿Lo cargo de nuevo?'
export const STALE_QUESTION =
  'Cambió algo desde que lo miraste (un saldo, un mes que cerraste o los datos del proveedor). ¿Lo cargo como queda ahora?'

/** Las notas de una hoja, en palabras de dueño. */
export const NOTE_COPY: Readonly<Record<NoteKey, string>> = {
  rounding_absorbed: 'ARCA redondeó: la diferencia de centavos va al importe más grande.',
  gap_to_other_taxes:
    'El total es más que la suma de sus partes: la diferencia va a «otros impuestos».',
  converted: 'Pasado a pesos con el cambio que dice la factura.',
  missing_close:
    'Falta el cierre de ese día: el cobro queda a favor y se acomoda solo cuando lo cargues.',
  inferred_method: 'Cómo lo llamás en el cierre lo deduje por el nombre: fijate.',
  balance_chain: 'El saldo del reporte no sigue renglón a renglón ese día.',
  unmatched_charges: 'Hay cargos de IVA o de impuestos que no encajan con ninguna comisión.',
  rule_applied: 'Se aplicó algo que me enseñaste.',
  reimport: 'El comprobante anterior se anuló: esta es una carga nueva.',
}

// ─── Lo que falta: la etiqueta corta ─────────────────────────────────────────

/** En pantalla, dos etiquetas se dicen distinto que en `NEED_SHORT_TEXT` (ver ahí por qué). */
const NEED_PILL_OVERRIDE: Readonly<Partial<Record<NeedKey, string>>> = {
  new_supplier: '¿Los tenés de antes?',
  other_taxes_as: 'Otros impuestos',
}

export function needPillLabel(key: NeedKey): string {
  return NEED_PILL_OVERRIDE[key] ?? NEED_SHORT_TEXT[key]
}

// ─── Lo que falta: la pregunta ───────────────────────────────────────────────

/** Las respuestas que la Guía ya enseña con estas palabras exactas. */
export const ANSWER = {
  same: 'Es el mismo: no lo cargues',
  other: 'Es otro: cargalo',
  byHand: 'Cargarlo a mano',
  notOurs: 'No es nuestro',
  later: 'No sé: lo dejo para después',
  takeOut: 'Sacarlo de este archivo',
  save: 'Guardar',
  pick: 'Elegir',
} as const

export const PARTY_QUESTION: Readonly<Record<PartyRole, string>> = {
  supplier: '¿A quién le pagaste?',
  tax_agency: '¿A qué organismo le pagaste?',
  payroll: '¿De quién es el sueldo?',
  card_processor: '¿Qué tarjeta o procesador es?',
  any: '¿De quién es?',
}

const CURRENCY_WORD: Readonly<Record<string, string>> = {
  USD: 'dólares',
  EUR: 'euros',
  BRL: 'reales',
}

/**
 * Por qué una hoja no se puede armar sola. `owner` es el contexto de la pregunta
 * (le dice qué hacer a quien carga); `reader` es para quien solo mira: el
 * motivo, sin pedirle que haga algo que no puede. Los textos del servidor
 * (`MANUAL_REASON_TEXT`) hablan de «la SAS», «otros tributos» y «se importa».
 */
export const MANUAL_COPY: Readonly<Record<ManualReason, { owner: string; reader: string }>> = {
  cheque: {
    owner: 'Es un cheque: cargalo a mano con su comprobante.',
    reader: 'es un cheque, se carga a mano con su comprobante.',
  },
  commissions_extras: {
    owner: 'La factura de comisiones trae otros impuestos: cargala a mano para separarlos.',
    reader: 'la factura de comisiones trae otros impuestos y se carga a mano.',
  },
  unsupported: {
    owner: 'Este movimiento todavía no lo sé leer: cargalo a mano.',
    reader: 'este movimiento todavía no se lee del archivo.',
  },
  not_ours: {
    owner: 'Está a nombre de otro CUIT o de un DNI: si no es del bar, marcalo «No es nuestro».',
    reader: 'está a nombre de otro CUIT o de un DNI.',
  },
  check_row: {
    owner:
      'El archivo trae un dato raro en este renglón: revisalo y, si está bien, cargalo a mano.',
    reader: 'el archivo trae un dato raro en este renglón.',
  },
}

/** Cuando el motor no dice por qué. */
const ENGINE_FALLBACK = 'No se pudo armar con estos datos.'

/** Qué clase de pregunta es: `ask` espera una respuesta; `info` no se puede resolver acá. */
export type QuestionTone = 'ask' | 'info'

export type QuestionCopy = { question: string; context: string | null; tone: QuestionTone }

/**
 * La pregunta de cada cosa que puede faltar, sin los datos de una hoja en
 * particular (sirve de respaldo y para comprobar que ninguna queda sin texto).
 */
export const QUESTION_COPY: Readonly<Record<NeedKey, QuestionCopy>> = {
  new_supplier: {
    question: 'Todavía no es un proveedor tuyo.',
    context: 'Decime arriba si ya lo tenés o si es nuevo.',
    tone: 'info',
  },
  supplier_account: {
    question: '¿En qué le comprás a este proveedor?',
    context:
      'Lo guardo en el proveedor: la próxima vez va solo. Vale para todas sus facturas de este archivo.',
    tone: 'ask',
  },
  supplier_inactive: {
    question: 'El proveedor está dado de baja. Para cargar esta factura hay que reactivarlo.',
    context: null,
    tone: 'info',
  },
  condition_mismatch: {
    question: 'La factura no va con cómo figura el proveedor. ¿Cuál es?',
    context: 'Si dudás, mirá su constancia de ARCA.',
    tone: 'ask',
  },
  other_taxes_as: {
    question: 'Esta factura trae «otros impuestos» y ARCA no dice cuáles. ¿Qué son?',
    context: null,
    tone: 'ask',
  },
  vat_rate: {
    question: 'Esto no lo puedo armar por mi cuenta.',
    context: 'ARCA no dice cuánto IVA trae este comprobante.',
    tone: 'info',
  },
  unsupported_voucher: {
    question: 'Esto no lo puedo armar por mi cuenta.',
    context: 'Este tipo de comprobante todavía no se trae de ARCA.',
    tone: 'info',
  },
  receipt: {
    question: 'Esto es un recibo, no una factura. ¿Es el pago de algo que ya cargaste?',
    context: null,
    tone: 'ask',
  },
  foreign_currency: {
    question: 'Está en otra moneda. ¿La cargo en pesos con el cambio de la factura?',
    context: null,
    tone: 'ask',
  },
  total_gap: {
    question: 'Esto no lo puedo armar por mi cuenta.',
    context: 'El total es menos que la suma de sus partes.',
    tone: 'info',
  },
  possible_duplicate: {
    question: '¿Es el mismo o es otro?',
    context: 'Ya cargaste uno con el mismo proveedor y el mismo total.',
    tone: 'ask',
  },
  mp_invoice: {
    question: '¿Es la factura mensual de Mercado Pago por las comisiones que ya te descontó?',
    context: 'Si es esa, no se paga de nuevo y te deja descontar su IVA.',
    tone: 'ask',
  },
  channel_method: {
    question: '¿Cómo lo llamás en tu cierre del día?',
    context: 'Lo guardo para las próximas.',
    tone: 'ask',
  },
  pick_party: { question: PARTY_QUESTION.any, context: null, tone: 'ask' },
  pick_treasury: {
    question: '¿A qué cuenta tuya fue (o de cuál vino) esta plata?',
    context: null,
    tone: 'ask',
  },
  counterpart_account: {
    question: 'No sé qué fue este movimiento. ¿Qué fue?',
    context: null,
    tone: 'ask',
  },
  unknown_tax: {
    question: 'Mercado Pago te descontó un impuesto que no conozco. ¿Dónde lo anoto?',
    context: 'Si no sabés, dejalo y consultalo con tu contadora.',
    tone: 'ask',
  },
  estimated_deductions: {
    question: 'Los descuentos de esta liquidación son estimados. ¿Los dejo así?',
    context: 'Cuando llegue la liquidación se corrige.',
    tone: 'ask',
  },
  accept_warning: { question: 'Leé esto antes de cargarlo.', context: null, tone: 'ask' },
  engine_error: {
    question: 'Esto no lo puedo armar por mi cuenta.',
    context: null,
    tone: 'info',
  },
  manual: { question: 'Esto no lo puedo armar por mi cuenta.', context: null, tone: 'info' },
}

export type QuestionContext = {
  /** El nombre del proveedor o de quien corresponda, si se sabe. */
  partyName: (id: string | null | undefined) => string | null
  /** El total de la hoja, en centavos. */
  totalCents: number
  /** La fecha de arranque del bar. */
  booksStartDate?: string | null
}

/** ¿El motor la rechaza por ser anterior al arranque? (No tiene sentido mandarla a cargar a mano.) */
export function isBeforeStart(need: ImportNeed): boolean {
  return need.key === 'engine_error' && need.error_key === 'date_before_start'
}

/** La pregunta de una hoja, con sus datos (proveedor, importe, moneda). */
export function questionFor(need: ImportNeed, ctx: QuestionContext): QuestionCopy {
  const base = QUESTION_COPY[need.key]
  switch (need.key) {
    case 'new_supplier':
      return { ...base, question: `${need.name} todavía no es un proveedor tuyo.` }
    case 'supplier_account': {
      const name = ctx.partyName(need.party_id)
      return name ? { ...base, question: `¿En qué le comprás a ${name}?` } : base
    }
    case 'supplier_inactive': {
      const name = ctx.partyName(need.party_id)
      return name
        ? {
            ...base,
            question: `${name} está dado de baja. Para cargar esta factura hay que reactivarlo.`,
          }
        : base
    }
    case 'condition_mismatch': {
      const name = ctx.partyName(need.party_id) ?? 'El proveedor'
      const now = IVA_CONDITION_TEXT[need.condition].toLowerCase()
      const paper = need.suggested_condition
        ? `de un ${IVA_CONDITION_TEXT[need.suggested_condition].toLowerCase()}`
        : 'de otra condición'
      return {
        ...base,
        question: `${name} figura como ${now}, pero esta factura es ${paper}. ¿Cuál es?`,
      }
    }
    case 'other_taxes_as':
      return {
        ...base,
        question: `Esta factura trae ${formatCents(need.amount_cents)} de «otros impuestos» y ARCA no dice cuáles. ¿Qué son?`,
      }
    case 'foreign_currency': {
      const word = CURRENCY_WORD[need.currency] ?? need.currency
      const original = `${formatCents(need.original_total_cents, { currency: false })} ${need.currency}`
      return {
        ...base,
        question: `Está en ${word}: ${original} × ${formatFxRate(need.fx_rate)} = ${formatCents(ctx.totalCents)}. ¿La cargo en pesos con ese cambio?`,
      }
    }
    case 'channel_method':
      return {
        ...base,
        question: `Mercado Pago le dice «${MP_CHANNEL_TEXT[need.channel]}». ¿Cómo lo llamás en tu cierre del día?`,
      }
    case 'pick_party':
      return { ...base, question: PARTY_QUESTION[need.role] }
    case 'counterpart_account':
      return need.direction === 'in'
        ? {
            ...base,
            question: 'Entró plata y no sé de qué es. ¿Qué fue?',
            context: 'Por ejemplo, un aporte de un socio o un ingreso extra.',
          }
        : {
            ...base,
            question: 'Salió plata y no sé para qué. ¿Qué fue?',
            context: 'Por ejemplo, un gasto o un retiro de un socio.',
          }
    case 'unknown_tax':
      return {
        ...base,
        question: `Mercado Pago te descontó ${formatCents(Math.abs(need.amount_cents))} de «${need.tax}» y no sé qué impuesto es. ¿Dónde lo anoto?`,
      }
    case 'engine_error': {
      if (isBeforeStart(need)) {
        const start = ctx.booksStartDate
        return {
          question:
            start && isRealIsoDay(start)
              ? `Esto es de antes del ${formatDayMonth(start)}, cuando arrancan tus números. Acá no se puede cargar.`
              : 'Esto es de antes de la fecha en que arrancan tus números. Acá no se puede cargar.',
          context: 'Lo que debías de antes va en los saldos iniciales.',
          tone: 'info',
        }
      }
      return { ...base, context: need.message || ENGINE_FALLBACK }
    }
    case 'manual':
      return { ...base, context: MANUAL_COPY[need.reason].owner }
    case 'unsupported_voucher':
      return {
        ...base,
        context: `Este tipo de comprobante (código ${need.code} de ARCA) todavía no se trae.`,
      }
    default:
      return base
  }
}

/** Para quien solo mira: qué falta, en una línea y sin botones. */
export function needLine(need: ImportNeed, ctx: Pick<QuestionContext, 'partyName'>): string {
  switch (need.key) {
    case 'new_supplier':
      return `Falta: decir si ${need.name} (CUIT ${formatCuit(need.cuit)}) ya es un proveedor.`
    case 'supplier_account': {
      const name = ctx.partyName(need.party_id)
      return `Falta: en qué se le compra a ${name ?? 'este proveedor'}.`
    }
    case 'supplier_inactive': {
      const name = ctx.partyName(need.party_id)
      return `Falta: reactivar a ${name ?? 'el proveedor'}, que está dado de baja.`
    }
    case 'condition_mismatch': {
      const name = ctx.partyName(need.party_id)
      return `Falta: confirmar cómo factura ${name ?? 'el proveedor'}.`
    }
    case 'other_taxes_as':
      return `Falta: decir qué son los ${formatCents(need.amount_cents)} de «otros impuestos».`
    case 'foreign_currency':
      return 'Falta: confirmar el cambio a pesos.'
    case 'possible_duplicate':
      return `Falta: decir si es el mismo que ${need.label} o es otro.`
    case 'receipt':
      return 'Falta: decir si este recibo es el pago de algo ya cargado.'
    case 'mp_invoice':
      return 'Falta: decir si es la factura de comisiones de Mercado Pago.'
    case 'channel_method':
      return `Falta: decir cómo se llama «${MP_CHANNEL_TEXT[need.channel]}» en el cierre del día.`
    case 'pick_party':
      return `Falta: ${PARTY_QUESTION[need.role].replace(/^¿/, '').replace(/\?$/, '').toLowerCase()}.`
    case 'pick_treasury':
      return 'Falta: a qué cuenta del bar fue (o de cuál vino) la plata.'
    case 'counterpart_account':
      return need.direction === 'in'
        ? 'Falta: decir de qué es la plata que entró.'
        : 'Falta: decir para qué salió la plata.'
    case 'unknown_tax':
      return `Falta: dónde se anota el descuento «${need.tax}» de Mercado Pago.`
    case 'estimated_deductions':
      return 'Falta: confirmar los descuentos estimados.'
    case 'accept_warning':
      return 'Falta: leer y aceptar un aviso.'
    case 'engine_error':
      return isBeforeStart(need)
        ? 'Es de antes de la fecha de arranque: acá no se puede cargar.'
        : need.message
          ? `No se pudo armar: ${need.message}`
          : ENGINE_FALLBACK
    case 'manual':
      return `No se puede armar solo: ${MANUAL_COPY[need.reason].reader}`
    case 'unsupported_voucher':
      return `No se puede armar solo: este tipo de comprobante (código ${need.code} de ARCA) todavía no se trae.`
    case 'vat_rate':
      return 'No se puede armar solo: ARCA no dice cuánto IVA trae este comprobante.'
    case 'total_gap':
      return 'No se puede armar solo: el total es menos que la suma de sus partes.'
    default:
      return 'No se puede armar solo: se carga a mano.'
  }
}

// ─── La ruta: en qué orden ───────────────────────────────────────────────────

export type RouteStep = {
  key: 'suppliers' | 'questions' | 'load'
  title: string
  count: number
  href: string
}

/**
 * Los pasos que quedan, en orden: primero los proveedores (destraban lo demás),
 * después las preguntas, al final cargar. Con menos de dos cosas por hacer no
 * hay ruta: alcanza con el número de arriba.
 */
export function routeSteps(input: {
  newSuppliers: number
  /** Preguntas que no son «proveedor nuevo». */
  questions: number
  ready: number
  hrefFor: (query: Record<string, string | null>) => string
}): RouteStep[] {
  const steps: RouteStep[] = []
  if (input.newSuppliers > 0) {
    steps.push({
      key: 'suppliers',
      title: '¿Los tenés de antes?',
      count: input.newSuppliers,
      href: '#proveedores-nuevos',
    })
  }
  if (input.questions > 0) {
    steps.push({
      key: 'questions',
      title: 'Contestá lo que te pregunto',
      count: input.questions,
      href: input.hrefFor({ ver: 'revisar' }),
    })
  }
  if (steps.length === 0) return []
  steps.push({ key: 'load', title: 'Cargá', count: input.ready, href: '#cargar' })
  return steps.length >= 2 ? steps : []
}

// ─── El papel de una hoja ────────────────────────────────────────────────────

export type PaperLine = { label: string; value: string; hint?: string; strong?: boolean }

export type PaperCopy = {
  /** Los renglones de arriba de la raya. */
  lines: PaperLine[]
  total: { label: string; value: string } | null
  /** Lo que va aparte, debajo del total (el cierre del día contra Mercado Pago). */
  aside: PaperLine[]
}

const BANK_EXPENSE_LINES: ReadonlyArray<readonly [string, string]> = [
  ['fees_net_cents', 'Comisiones'],
  ['vat_cents', 'IVA de las comisiones'],
  ['vat_perception_cents', 'Adelanto de IVA'],
  ['ley25413_debit_cents', 'Impuesto al cheque (lo que sale)'],
  ['ley25413_credit_cents', 'Impuesto al cheque (lo que entra)'],
  ['sircreb_cents', 'Retención de Ingresos Brutos'],
  ['interest_cents', 'Intereses'],
  ['fees_no_vat_cents', 'Gastos sin IVA'],
  ['other_cents', 'Otros'],
]

function num(detail: ProposalSummary['detail'], key: string): number {
  const v = detail?.[key]
  return typeof v === 'number' && Number.isFinite(v) ? v : 0
}

function text(detail: ProposalSummary['detail'], key: string): string | null {
  const v = detail?.[key]
  return typeof v === 'string' && v.trim() !== '' ? v : null
}

/** Un descuento: siempre con su signo menos delante. */
function minus(cents: number): string {
  return formatCents(-Math.abs(cents))
}

/**
 * Lo que el archivo dice de una hoja, como renglones de un papel. Solo lo que
 * el resumen trae: una compra de ARCA no guarda neto ni IVA, así que no se
 * inventan.
 */
export function paperLines(summary: ProposalSummary): PaperCopy {
  const d = summary.detail
  const total = formatCents(summary.total_cents)

  if (summary.kind === 'mp_collection' && num(d, 'gross_cents') !== 0) {
    const retained = Math.abs(num(d, 'sirtac_cents')) + Math.abs(num(d, 'sircupa_cents'))
    const lines: PaperLine[] = [
      { label: 'Cobrado', value: formatCents(num(d, 'gross_cents')), strong: true },
    ]
    if (num(d, 'commission_cents') !== 0)
      lines.push({ label: 'Comisión', value: minus(num(d, 'commission_cents')) })
    if (num(d, 'commission_vat_cents') !== 0)
      lines.push({ label: 'IVA de la comisión', value: minus(num(d, 'commission_vat_cents')) })
    if (retained !== 0)
      lines.push({ label: 'Retenciones', value: minus(retained), hint: 'Ingresos Brutos' })
    if (num(d, 'ley25413_cents') !== 0)
      lines.push({ label: 'Impuesto al cheque', value: minus(num(d, 'ley25413_cents')) })
    const missing = (summary.notes ?? []).includes('missing_close')
    return {
      lines,
      total: { label: 'Te depositaron', value: formatCents(num(d, 'net_cents')) },
      aside: missing
        ? [{ label: 'Según tu cierre', value: '—', hint: 'Falta el cierre de ese día' }]
        : [
            { label: 'Según tu cierre', value: formatCents(num(d, 'close_cents')) },
            { label: 'Diferencia', value: formatCents(num(d, 'difference_cents')) },
          ],
    }
  }

  if (summary.kind === 'purchase' || summary.kind === 'credit_note') {
    const lines: PaperLine[] = []
    const cuit = text(d, 'cuit')
    if (cuit) lines.push({ label: 'CUIT', value: formatCuit(cuit) })
    const currency = text(d, 'currency')
    const rate = text(d, 'fx_rate')
    if (currency && currency !== 'ARS' && rate) {
      lines.push({
        label: `En ${CURRENCY_WORD[currency] ?? currency}`,
        value: `${formatCents(num(d, 'original_total_cents'), { currency: false })} ${currency}`,
        hint: `× ${formatFxRate(rate)}`,
      })
    }
    return {
      lines,
      total: { label: summary.kind === 'credit_note' ? 'A tu favor' : 'Total', value: total },
      aside: [],
    }
  }

  if (summary.kind === 'bank_expense') {
    const lines = BANK_EXPENSE_LINES.flatMap(([key, label]) =>
      num(d, key) !== 0 ? [{ label, value: formatCents(Math.abs(num(d, key))) }] : [],
    )
    return { lines, total: { label: 'Salió', value: total }, aside: [] }
  }

  if (summary.kind === 'mp_bank_tax') {
    const lines: PaperLine[] = []
    if (num(d, 'credit_cents') !== 0)
      lines.push({ label: 'Sobre lo que entró', value: formatCents(num(d, 'credit_cents')) })
    if (num(d, 'debit_cents') !== 0)
      lines.push({ label: 'Sobre lo que salió', value: formatCents(num(d, 'debit_cents')) })
    return { lines, total: { label: 'Salió', value: total }, aside: [] }
  }

  // Un movimiento del banco o de Mercado Pago: lo que dice el archivo, y si entró o salió.
  const direction = text(d, 'direction')
  const lines: PaperLine[] = []
  const voucher = text(d, 'voucher')
  if (voucher) lines.push({ label: 'Comprobante n.º', value: voucher })
  return {
    lines,
    total: {
      label: direction === 'credit' ? 'Entró' : direction === 'debit' ? 'Salió' : 'Importe',
      value: total,
    },
    aside: [],
  }
}

/** Cuántas hojas tienen «proveedor nuevo» entre lo que falta (para la ruta). */
export function otherQuestions(
  questions: number,
  needs: Readonly<Partial<Record<NeedKey, number>>>,
): number {
  return Math.max(0, questions - (needs.new_supplier ?? 0))
}
