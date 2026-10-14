/**
 * La portada de Ajustes (rediseño de octubre 2026), pura: qué dice cada uno de
 * los seis objetos —una oración con el dato y un estado en una palabra— con lo
 * que ya traen tres lecturas (el catálogo, la guía «Cómo arrancar» y los
 * accesos). Lo prueba `administracion-ajustes-portada.test.ts`.
 *
 * Tres reglas que no se negocian:
 * - **Tonos honestos.** `warn` y `late` solo para lo que rompe o deforma los
 *   números (sin CUIT, sin medios, una comisión sin cargar, una app apagada con
 *   su medio prendido, ARCA con error). Lo que puede esperar (el banco, la
 *   contadora, los puntos de venta, conectar ARCA) va en `info`: nunca un ámbar
 *   que no es cierto.
 * - **Un dato que no cargó no es cero.** La oración dice «—» y el estado «No
 *   pudimos cargarlo»; el objeto igual lleva a su habitación.
 * - **Ningún número suelto.** Cada cifra va con su palabra («6 de 18 socios»,
 *   «9 medios prendidos»).
 */

import type { SasRequiredField } from '@/lib/accounting/onboarding'
import type { PartyRates, SalesMethodKind, TreasuryKind } from '@/lib/accounting/types'
import { padPv } from '@/lib/fiscal'
import { hasRates, joinWords } from './cobros'
import type { OwnerRoom } from './rooms'

export type TileTone = 'ok' | 'warn' | 'late' | 'info' | 'muted'

export type TileState = {
  /** UNA oración con el dato. «—» si no se pudo leer. */
  sentence: string
  pill: { tone: TileTone; text: string }
}

/** Lo que dice un objeto cuya lectura falló. */
export const TILE_UNKNOWN: TileState = {
  sentence: '—',
  pill: { tone: 'muted', text: 'No pudimos cargarlo' },
}

const OK: TileState['pill'] = { tone: 'ok', text: 'Al día' }

function count(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`
}

// ─── 1 · Accesos ─────────────────────────────────────────────────────────────

export type AccessFacts = {
  /** Personas con acceso vigente. */
  active: ReadonlyArray<{ isAdmin: boolean }>
  /** Socios sin acceso (solo lo sabe un dueño; para la contadora viene vacío). */
  ownersWithoutAccess: ReadonlyArray<unknown>
  accountants: ReadonlyArray<unknown>
  adminCount: number
}

export type AccessCounts = { inCount: number; adminCount: number; outCount: number }

/** Las tres cuentas que dibujan las llaves: entran, dan accesos, todavía no entran. */
export function accessCounts(access: AccessFacts): AccessCounts {
  return {
    inCount: access.active.length,
    adminCount: Math.min(access.adminCount, access.active.length),
    outCount: access.ownersWithoutAccess.length,
  }
}

export function tileAccess(
  access: AccessFacts | null,
  opts: {
    /** Quien mira ve la lista de socios (un dueño). La contadora, no. */
    showMembers: boolean
    /** Se marcó «Ya están todos» en «Cómo arrancar»: lo que puede esperar deja de avisarse. */
    manualDone?: boolean
  },
): TileState {
  if (!access) return TILE_UNKNOWN
  const { inCount, outCount } = accessCounts(access)
  const total = inCount + outCount
  const sentence = !opts.showMembers
    ? `${count(inCount, 'persona entra', 'personas entran')}.`
    : outCount === 0
      ? inCount === 1
        ? 'Entra 1 socio a Administración.'
        : `Los ${inCount} socios entran a Administración.`
      : `${inCount} de ${count(total, 'socio', 'socios')} ${inCount === 1 ? 'entra' : 'entran'} a Administración.`

  if (access.adminCount === 0) return { sentence, pill: { tone: 'late', text: 'Nadie da accesos' } }
  if (opts.manualDone) return { sentence, pill: OK }
  if (access.adminCount === 1 && total > 1) {
    return { sentence, pill: { tone: 'info', text: 'Un solo socio da accesos' } }
  }
  if (opts.showMembers && access.accountants.length === 0) {
    return { sentence, pill: { tone: 'info', text: 'Sin contadora' } }
  }
  return { sentence, pill: OK }
}

// ─── 2 · Cajas y cuentas ─────────────────────────────────────────────────────

export type TreasuryFacts = {
  id: string
  name: string
  kind: TreasuryKind
  active: boolean
  cbuCvu: string | null
}

const NAMES_MAX = 3

/** «Caja» · «Caja y Mercado Pago» · «Caja, Mercado Pago y 2 más». */
function namesText(names: readonly string[], max = NAMES_MAX): string {
  if (names.length <= max) return joinWords(names)
  return joinWords([...names.slice(0, max - 1), `${names.length - (max - 1)} más`])
}

export function tileTreasuries(
  treasuries: readonly TreasuryFacts[] | null,
  opts: { manualDone?: boolean } = {},
): TileState {
  if (!treasuries) return TILE_UNKNOWN
  const live = treasuries.filter((t) => t.active)
  const money = live.filter((t) => t.kind !== 'credit_card')
  const cards = live.length - money.length
  if (live.length === 0) {
    return {
      sentence: 'Todavía no hay ninguna caja en uso.',
      pill: { tone: 'late', text: 'Sin cajas' },
    }
  }
  const places =
    money.length === 0
      ? 'Ningún lugar con plata en uso'
      : `${count(money.length, 'lugar con plata', 'lugares con plata')}: ${namesText(money.map((t) => t.name))}`
  const sentence = `${places}${cards > 0 ? `, y ${count(cards, 'tarjeta de la empresa', 'tarjetas de la empresa')}` : ''}.`

  if (opts.manualDone) return { sentence, pill: OK }
  const banks = money.filter((t) => t.kind === 'bank')
  if (banks.length === 0) return { sentence, pill: { tone: 'info', text: 'Sin banco cargado' } }
  if (banks.some((t) => !t.cbuCvu)) {
    return { sentence, pill: { tone: 'info', text: 'Falta el CBU del banco' } }
  }
  const wallet = money.find((t) => t.kind === 'wallet' && !t.cbuCvu)
  if (wallet) return { sentence, pill: { tone: 'info', text: `Falta el CVU de ${wallet.name}` } }
  return { sentence, pill: OK }
}

// ─── 3 · Medios de cobro ─────────────────────────────────────────────────────

export type MethodFacts = {
  name: string
  kind: SalesMethodKind
  active: boolean
  partyId: string | null
}
export type PartyFacts = { id: string; name: string; active: boolean; rates: PartyRates }

/** Los tipos de medio donde alguien cobra por el bar y descuenta. */
const CHARGING_METHOD_KINDS: ReadonlySet<SalesMethodKind> = new Set(['settled_now', 'receivable'])

/** Los medios prendidos a los que todavía no se les cargó cuánto descuentan. */
export function methodsWithoutCommission(
  methods: readonly MethodFacts[],
  parties: readonly PartyFacts[],
): MethodFacts[] {
  const byId = new Map(parties.map((p) => [p.id, p]))
  return methods.filter((m) => {
    if (!m.active || !CHARGING_METHOD_KINDS.has(m.kind) || !m.partyId) return false
    const party = byId.get(m.partyId)
    return party !== undefined && !hasRates(party.rates)
  })
}

/** Medios prendidos cuya app (quien los paga) está apagada: el cierre falla al guardar. */
export function methodsWithPartyOff(
  methods: readonly MethodFacts[],
  parties: readonly PartyFacts[],
): Array<{ method: MethodFacts; party: PartyFacts }> {
  const byId = new Map(parties.map((p) => [p.id, p]))
  const out: Array<{ method: MethodFacts; party: PartyFacts }> = []
  for (const method of methods) {
    if (!method.active || !CHARGING_METHOD_KINDS.has(method.kind) || !method.partyId) continue
    const party = byId.get(method.partyId)
    if (party && !party.active) out.push({ method, party })
  }
  return out
}

export function tileMethods(
  catalog: { methods: readonly MethodFacts[]; parties: readonly PartyFacts[] } | null,
): TileState {
  if (!catalog) return TILE_UNKNOWN
  const on = catalog.methods.filter((m) => m.active)
  if (on.length === 0) {
    return {
      sentence: 'No hay ningún medio de cobro prendido.',
      pill: { tone: 'late', text: 'Sin medios: no se puede cargar el cierre' },
    }
  }
  const sentence = `${count(on.length, 'medio prendido', 'medios prendidos')}, en el orden de tu cierre del día.`
  const off = methodsWithPartyOff(catalog.methods, catalog.parties)[0]
  if (off) {
    return {
      sentence,
      pill: { tone: 'warn', text: `${off.party.name} está apagada y su medio, prendido` },
    }
  }
  const lacking = methodsWithoutCommission(catalog.methods, catalog.parties).length
  if (lacking > 0) {
    return { sentence, pill: { tone: 'warn', text: `${lacking} sin comisión cargada` } }
  }
  return { sentence, pill: OK }
}

// ─── 4 · Datos de la SAS ─────────────────────────────────────────────────────

export type SasFacts = {
  legalName: string
  cuit: string | null
  iibbNumber: string | null
  activityStartDate: string | null
  fiscalAddress: string | null
}

/** Los cuatro datos de la constancia que la guía pide, en el orden del papel. */
export const SAS_SHEET_FIELDS = [
  'cuit',
  'fiscal_address',
  'activity_start_date',
  'iibb_number',
] as const satisfies readonly SasRequiredField[]

const SAS_FIELD_WORDS: Readonly<Record<SasRequiredField, string>> = {
  cuit: 'la CUIT',
  iibb_number: 'el número de Ingresos Brutos',
  activity_start_date: 'el inicio de actividades',
  fiscal_address: 'el domicilio fiscal',
}

/**
 * Qué falta de la constancia. Manda lo que dice la guía («Cómo arrancar», que
 * lo calcula la base); sin ella, lo que se ve en los datos guardados.
 */
export function sasMissingFields(
  sas: SasFacts,
  fromGuide: readonly SasRequiredField[] | null | undefined,
): SasRequiredField[] {
  if (fromGuide) return SAS_SHEET_FIELDS.filter((f) => fromGuide.includes(f))
  const empty: Record<SasRequiredField, boolean> = {
    cuit: !sas.cuit,
    fiscal_address: !sas.fiscalAddress,
    activity_start_date: !sas.activityStartDate,
    iibb_number: !sas.iibbNumber,
  }
  return SAS_SHEET_FIELDS.filter((f) => empty[f])
}

export function tileSas(
  sas: SasFacts | null,
  fromGuide?: readonly SasRequiredField[] | null,
): TileState & { missing: SasRequiredField[] } {
  if (!sas) return { ...TILE_UNKNOWN, missing: [] }
  const missing = sasMissingFields(sas, fromGuide)
  const sentence = sas.legalName.trim() || 'Sin razón social cargada.'
  // Sin CUIT los libros de IVA, ARCA y los importadores no andan: eso sí es un aviso.
  if (!sas.cuit || missing.includes('cuit')) {
    return { sentence, missing, pill: { tone: 'warn', text: 'Falta la CUIT' } }
  }
  const first = missing[0]
  if (first === undefined) return { sentence, missing, pill: { tone: 'ok', text: 'Completos' } }
  return {
    sentence,
    missing,
    pill: {
      tone: 'info',
      text:
        missing.length === 1 ? `Falta ${SAS_FIELD_WORDS[first]}` : `Faltan ${missing.length} datos`,
    },
  }
}

// ─── 5 · Puntos de venta ─────────────────────────────────────────────────────

export type SalesPointFacts = { number: number; label: string; active: boolean }

export function tileSalesPoints(
  points: readonly SalesPointFacts[] | null,
): TileState & { first: number | null } {
  if (!points) return { ...TILE_UNKNOWN, first: null }
  const live = points.filter((p) => p.active).sort((a, b) => a.number - b.number)
  const first = live[0]?.number ?? null
  if (live.length === 0) {
    return {
      first,
      sentence: 'Sin cargar: en el cierre, todo el día queda como venta sin factura.',
      pill: { tone: 'info', text: 'Sin cargar' },
    }
  }
  const names = live.map((p) => `${padPv(p.number, 4)} ${p.label}`.trim())
  return {
    first,
    sentence: `${count(live.length, 'punto de venta', 'puntos de venta')}: ${namesText(names)}.`,
    pill: OK,
  }
}

// ─── 6 · ARCA ────────────────────────────────────────────────────────────────

/** Los cuatro estados del cable. */
export type ArcaTileState = 'not_started' | 'in_progress' | 'connected' | 'error'

/**
 * El estado de la conexión como lo trae la guía (`arca.status`): sin fila, en
 * borrador o desconectada es «sin conectar»; conectada y con error dicen lo
 * suyo; cualquier otro (pedido generado, certificado subido) es «a medias».
 */
export function arcaTileState(status: string | null | undefined): ArcaTileState {
  if (status === 'connected') return 'connected'
  if (status === 'error') return 'error'
  if (!status || status === 'draft' || status === 'disconnected') return 'not_started'
  return 'in_progress'
}

const ARCA_TILE: Readonly<Record<ArcaTileState, TileState>> = {
  not_started: {
    sentence: 'Sin conectar. Lleva unos 40 minutos, una sola vez.',
    pill: { tone: 'muted', text: 'Sin conectar' },
  },
  in_progress: {
    sentence: 'A medio conectar: seguí con la guía donde la dejaste.',
    pill: { tone: 'info', text: 'A medias' },
  },
  connected: {
    sentence: 'Conectado: la plataforma ya habla con ARCA.',
    pill: { tone: 'ok', text: 'Conectado' },
  },
  error: {
    sentence: 'La última prueba dio error.',
    pill: { tone: 'late', text: 'Con un problema' },
  },
}

/** Las palabras del estado de ARCA para la franja de Puntos de venta. */
export const ARCA_STATE_WORDS: Readonly<Record<ArcaTileState, string>> = {
  not_started: 'ARCA sin conectar',
  in_progress: 'ARCA a medio conectar',
  connected: 'ARCA conectado',
  error: 'ARCA tiene un problema',
}

/**
 * `arca` es `data.arca` de la guía: `undefined` = la guía no cargó (no se sabe);
 * `null` = no hay conexión armada (sin conectar).
 */
export function tileArca(
  arca: { status: string } | null | undefined,
): TileState & { state: ArcaTileState | null } {
  if (arca === undefined) return { ...TILE_UNKNOWN, state: null }
  const state = arcaTileState(arca?.status)
  return { ...ARCA_TILE[state], state }
}

/**
 * El azulejo de ARCA con el estado que ya calculó su habitación (la conexión más los pasos
 * marcados de la guía): así la portada no dice «Sin conectar» mientras la habitación dice
 * «A medio conectar».
 */
export function tileArcaOf(state: ArcaTileState): TileState & { state: ArcaTileState } {
  return { ...ARCA_TILE[state], state }
}

// ─── Los seis juntos ─────────────────────────────────────────────────────────

/** El orden de la portada. */
export const TILE_ORDER: readonly OwnerRoom[] = [
  'accesos',
  'cajas',
  'medios',
  'sas',
  'puntos-de-venta',
  'arca',
]
