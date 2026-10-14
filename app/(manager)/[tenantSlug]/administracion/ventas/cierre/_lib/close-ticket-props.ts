/**
 * El ticket de un cierre del día YA guardado: arma, desde el comprobante, las
 * mismas props que `CloseTicket` recibe mientras se carga, para que lo que se
 * cerró ayer se encuentre igual hoy (la noche elegida en Ventas, la ficha del
 * comprobante). Puro: lo prueba `administracion-cierre-ticket-guardado.test.ts`,
 * que cierra días con el motor y compara al centavo.
 *
 * Sale de los renglones que escribe `lib/accounting/posting/sales-close.ts`:
 * - los medios son los renglones del Debe con rol `treasury`, `receivable` o
 *   `advance`, sumados por medio de cobro;
 * - si se contó el efectivo y no coincidió, el asiento guarda lo CONTADO en el
 *   renglón de la caja y la diferencia aparte (`cash_diff`): lo vendido en
 *   efectivo es lo contado más lo que faltó (o menos lo que sobró);
 * - con factura = ventas facturadas + IVA (Haber suma, Debe resta); sin
 *   factura es el resto, repartido con el mismo `invoiceSplit` de la pantalla.
 *
 * Lo que el cierre NO guarda, el ticket no lo inventa: si el efectivo coincidió
 * (o no se contó) no queda conteo y no hay bloque de efectivo; el objetivo del
 * día y el desglose por canal los pone quien muestra la noche, no el papel.
 *
 * «Cuándo entra» (con `arrivals: true`) cuenta lo que pasó después, un renglón
 * por medio: el nombre y, debajo y en chico, su estado. «Entró a Caja» ·
 * «Mercado Pago — ya entró» · «En camino a Mercado Pago» · «Débito — ya
 * llegó» · «Crédito — llega el vie 16/10» (o «llega hoy») · «PedidosYa —
 * tendría que haber llegado el 07/10» · «Rappi — llegó una parte: faltan
 * $ 12.000» · «A cobrarle a clientes» · «Ya cobrado como seña». Lo cobrado
 * con QR o transferencia no «vence»: está en camino hasta que se lo cuenta en
 * la billetera.
 *
 * Con varios turnos el arqueo es el del día: «contado» es lo que el asiento
 * dejó en la caja del efectivo en todos los turnos (en el que no hubo
 * diferencia, lo vendido), así contado y diferencia cierran contra el renglón
 * «Efectivo» de arriba.
 *
 * Límite conocido: un cierre con el efectivo contado en $ 0 (todo lo vendido
 * en efectivo figura como faltante) no guarda el renglón de la caja; el motor
 * solo lo deja guardar si el bar tiene otro medio que entra directo a una caja.
 * Ahí el efectivo se muestra con el nombre «Efectivo», salvo que ese otro
 * medio esté justo antes en Ajustes: entonces la diferencia se suma a su
 * renglón (el papel no puede saber cuál era el efectivo). El total, el reparto
 * y la diferencia siguen siendo los guardados.
 *
 * Cuándo NO: para un cierre que se está cargando (esas props las arma el
 * formulario con su estado), ni para otro comprobante que no sea un cierre.
 */

import type { DocumentDetail } from '@/lib/accounting/queries/documents'
import { formatDayMonth, formatWeekdayDayMonth, weekdayName } from '@/lib/dates'
import { formatCents, formatCentsShort } from '@/lib/money'
import type { CloseTicketArrival, CloseTicketProps } from '../_components/close-ticket'
import { invoiceSplit } from './close-view'

type DocLine = DocumentDetail['lines'][number]
type EntryLine = NonNullable<DocumentDetail['entry']>['lines'][number]

/**
 * Lo que se lee de un cierre guardado. Un `DocumentDetail` (lo que devuelve
 * `getDocument`) lo cumple: se pasa tal cual.
 */
export type SavedClose = Pick<DocumentDetail, 'kind' | 'accountingDate' | 'shift'> & {
  lines: ReadonlyArray<
    Pick<
      DocLine,
      | 'id'
      | 'lineNo'
      | 'role'
      | 'side'
      | 'amountCents'
      | 'partyId'
      | 'partyName'
      | 'dueDate'
      | 'treasuryAccountId'
      | 'treasuryName'
      | 'salesMethodId'
      | 'salesMethodName'
      | 'memo'
    >
  >
  /** El asiento: de ahí sale cuánto falta cobrar de cada partida. Solo hace falta con `arrivals`. */
  entry: { lines: ReadonlyArray<Pick<EntryLine, 'lineNo' | 'dueDate' | 'openCents'>> } | null
}

type SavedLine = SavedClose['lines'][number]

export type CloseTicketOptions = {
  /** Hoy (`yyyy-MM-dd`): contra esto se dice si algo «llega» o «tendría que haber llegado». */
  today: string
  /**
   * `true`: arma «Cuándo entra» con lo que pasó después (qué ya llegó, qué
   * falta). `false`: sin ese bloque (la ficha del comprobante lo cuenta en sus
   * vínculos, con sus botones).
   */
  arrivals: boolean
}

/** Los renglones del Debe que son un medio de cobro. */
const MEDIA_ROLES: ReadonlySet<string> = new Set(['treasury', 'receivable', 'advance'])
/** El medio de un cierre con el efectivo contado en cero (su renglón de caja no se guarda). */
const CASH_FALLBACK = { key: 'cash', name: 'Efectivo' }
/** Así separa el motor el medio del cliente en la leyenda de una cuenta corriente. */
const CUSTOMER_MEMO_MARK = ' · '

function signedCredit(line: Pick<SavedLine, 'side' | 'amountCents'>): number {
  return line.side === 'credit' ? line.amountCents : -line.amountCents
}

function isMedia(line: SavedLine): boolean {
  return line.side === 'debit' && MEDIA_ROLES.has(line.role)
}

function mediaKey(line: SavedLine): string {
  return line.salesMethodId ?? `renglon:${line.id}`
}

/** El nombre del medio; si ya no existe, lo que dejó escrito el cierre en su leyenda. */
function mediaName(line: SavedLine): string {
  const fromMemo = line.memo?.split(CUSTOMER_MEMO_MARK)[0]?.trim()
  return line.salesMethodName || fromMemo || line.treasuryName || line.partyName || 'Otro medio'
}

/**
 * Lo vendido en cuenta corriente: un renglón por cliente, y el motor le pone
 * «Cuenta corriente · Cliente» de leyenda (los demás medios llevan solo su
 * nombre). Es plata que debe un cliente, no una tarjeta ni una app.
 */
function isCustomerLine(line: SavedLine): boolean {
  if (line.role !== 'receivable' || !line.memo) return false
  return line.memo !== line.salesMethodName && line.memo.includes(CUSTOMER_MEMO_MARK)
}

/** Un importe dentro de un rótulo: sin centavos si es redondo, como en el botón de «Nuevo gasto». */
function moneyWords(cents: number): string {
  return cents % 100 === 0 ? formatCentsShort(cents) : formatCents(cents)
}

/** Lo que el turno guardó del arqueo: solo existe si lo contado no coincidió con lo vendido. */
type CashDiff = {
  /** Vendido − contado: positivo = faltó. */
  diffCents: number
  /** El renglón de la caja (lo contado). `null`: se contó $ 0 y el renglón no se guardó. */
  cashLine: SavedLine | null
}

function cashDiffOf(lines: readonly SavedLine[]): CashDiff | null {
  const index = lines.findIndex((line) => line.role === 'cash_diff')
  const diffLine = lines[index]
  if (!diffLine) return null
  // El motor escribe la diferencia justo después del renglón del efectivo.
  const before = lines[index - 1]
  const cashLine = before && before.role === 'treasury' && before.side === 'debit' ? before : null
  return { diffCents: -signedCredit(diffLine), cashLine }
}

/**
 * Un renglón de «Cuándo entra» mientras se arma: a quién o qué nombra
 * (`label`) y, en chico, qué pasó con esa plata (`hint`, que recibe lo que
 * todavía falta cobrar del renglón).
 */
type ArrivalGroup = {
  key: string
  /** Para ordenar: lo que ya está, lo que está en camino, lo que llega por fecha y el resto. */
  order: string
  cents: number
  label: string
  hint?: (openCents: number) => string
}

function addArrival(
  groups: Map<string, ArrivalGroup & { openCents: number }>,
  group: ArrivalGroup,
  openCents: number,
): void {
  const found = groups.get(group.key)
  if (found) {
    found.cents += group.cents
    found.openCents += openCents
  } else groups.set(group.key, { ...group, openCents })
}

/**
 * Un renglón por cobrar de un cierre, contra lo que pasó después: ya llegó,
 * está en camino, llega tal día o tendría que haber llegado. Lo que se acredita
 * en el acto (vence el mismo día del cierre: QR, transferencias) no «llega» en
 * una fecha: está en camino hasta que se lo cuenta en la billetera.
 */
function receivableArrival(
  line: SavedLine,
  entryLine: Pick<EntryLine, 'dueDate' | 'openCents'> | undefined,
  close: Pick<SavedClose, 'accountingDate'>,
  today: string,
): { group: ArrivalGroup; openCents: number } {
  const cents = line.amountCents
  const open = Math.min(cents, Math.max(0, entryLine?.openCents ?? cents))
  const state = open === 0 ? 'done' : open < cents ? 'part' : 'open'
  const missing = (rest: number) => `faltan ${moneyWords(rest)}`
  const name = mediaName(line)
  const key = mediaKey(line)

  // Cuenta corriente: es plata que debe un cliente, no algo que «llega» solo.
  if (isCustomerLine(line)) {
    const group: ArrivalGroup =
      state === 'done'
        ? { key: 'cc:ok', order: '1', cents, label: 'Clientes', hint: () => 'ya pagaron' }
        : state === 'part'
          ? {
              key: 'cc:parte',
              order: '8',
              cents,
              label: 'Clientes',
              hint: (rest) => `pagaron una parte: ${missing(rest)}`,
            }
          : { key: 'cc', order: '8', cents, label: 'A cobrarle a clientes' }
    return { group, openCents: open }
  }

  const due = line.dueDate ?? entryLine?.dueDate ?? close.accountingDate

  // Se acreditó en el acto: está en la billetera del pagador hasta que se la cuenta.
  if (due <= close.accountingDate) {
    const payer = line.partyName ?? name
    const payerKey = line.partyId ?? key
    const group: ArrivalGroup =
      state === 'done'
        ? { key: `entro:${payerKey}`, order: '1', cents, label: payer, hint: () => 'ya entró' }
        : state === 'part'
          ? {
              key: `parte:${payerKey}`,
              order: '2',
              cents,
              label: payer,
              hint: (rest) => `entró una parte: ${missing(rest)}`,
            }
          : { key: `camino:${payerKey}`, order: '2', cents, label: `En camino a ${payer}` }
    return { group, openCents: open }
  }

  // Lo paga alguien después (el posnet, una app): llega en una fecha.
  if (state === 'done') {
    return {
      group: { key: `llego:${key}`, order: '1', cents, label: name, hint: () => 'ya llegó' },
      openCents: 0,
    }
  }
  if (state === 'part') {
    return {
      group: {
        key: `parte:${key}:${due}`,
        order: `3:${due}`,
        cents,
        label: name,
        hint: (rest) => `llegó una parte: ${missing(rest)}`,
      },
      openCents: open,
    }
  }
  const when =
    due < today
      ? `tendría que haber llegado el ${formatDayMonth(due)}`
      : due === today
        ? 'llega hoy'
        : `llega el ${formatWeekdayDayMonth(due)}`
  return {
    group: { key: `fecha:${key}:${due}`, order: `3:${due}`, cents, label: name, hint: () => when },
    openCents: open,
  }
}

/**
 * Las props de `CloseTicket` para uno o más cierres guardados del mismo día
 * (varios turnos se suman en un solo papel). Los comprobantes que no son un
 * cierre se ignoran. `channelsText` y `target` van en `null`, y el papel sale
 * quieto (`still`).
 */
export function closeTicketProps(
  docs: readonly SavedClose[],
  opts: CloseTicketOptions,
): CloseTicketProps {
  const closes = docs.filter((doc) => doc.kind === 'sales_close')
  const first = closes[0]

  const media = new Map<string, { id: string; name: string; cents: number }>()
  const addMedia = (key: string, name: string, cents: number) => {
    const found = media.get(key)
    if (found) found.cents += cents
    else media.set(key, { id: key, name, cents })
  }

  const cashKeys = new Set<string>()
  let counted = false
  let diffCents = 0
  let invoicedCents = 0
  const arrivalGroups = new Map<string, ArrivalGroup & { openCents: number }>()

  for (const close of closes) {
    const lines = [...close.lines].sort((a, b) => a.lineNo - b.lineNo)

    for (const line of lines) {
      if (isMedia(line)) addMedia(mediaKey(line), mediaName(line), line.amountCents)
      else if (line.role === 'sales_invoiced' || line.role === 'vat') {
        invoicedCents += signedCredit(line)
      }
    }

    // Lo vendido en efectivo es lo contado más lo que faltó (o menos lo que sobró).
    const cash = cashDiffOf(lines)
    if (cash) {
      counted = true
      diffCents += cash.diffCents
      const key = cash.cashLine ? mediaKey(cash.cashLine) : CASH_FALLBACK.key
      const name = cash.cashLine ? mediaName(cash.cashLine) : CASH_FALLBACK.name
      cashKeys.add(key)
      addMedia(key, name, cash.diffCents)
    }

    if (!opts.arrivals) continue
    const entryLines = new Map((close.entry?.lines ?? []).map((line) => [line.lineNo, line]))
    for (const line of lines) {
      if (!isMedia(line)) continue
      if (line.role === 'treasury') {
        const name = line.treasuryName ?? mediaName(line)
        addArrival(
          arrivalGroups,
          {
            key: `caja:${line.treasuryAccountId ?? mediaKey(line)}`,
            order: '0',
            cents: line.amountCents,
            label: `Entró a ${name}`,
          },
          0,
        )
      } else if (line.role === 'advance') {
        addArrival(
          arrivalGroups,
          { key: 'sena', order: '9', cents: line.amountCents, label: 'Ya cobrado como seña' },
          0,
        )
      } else {
        const arrival = receivableArrival(line, entryLines.get(line.lineNo), close, opts.today)
        addArrival(arrivalGroups, arrival.group, arrival.openCents)
      }
    }
  }

  const soldCents = [...media.values()].reduce((sum, m) => sum + m.cents, 0)

  // Lo contado: lo que el asiento dejó en la caja del efectivo. Con varios
  // turnos entra también el efectivo del turno que no tuvo diferencia, para que
  // «contado» y «diferencia» cierren contra el renglón «Efectivo» de arriba.
  let cash: CloseTicketProps['cash'] = null
  if (counted) {
    let countedCents = 0
    for (const close of closes) {
      for (const line of close.lines) {
        if (line.role === 'treasury' && line.side === 'debit' && cashKeys.has(mediaKey(line))) {
          countedCents += line.amountCents
        }
      }
    }
    cash = { expectedCents: countedCents + diffCents, countedCents, diffCents }
  }

  const arrivals: CloseTicketArrival[] = [...arrivalGroups.values()]
    .map((group, index) => ({ group, index }))
    .sort((a, b) => a.group.order.localeCompare(b.group.order) || a.index - b.index)
    .map(({ group }) => ({
      key: group.key,
      label: group.label,
      cents: group.cents,
      ...(group.hint ? { hint: group.hint(group.openCents) } : {}),
    }))

  return {
    dayTitle: first
      ? `${weekdayName(first.accountingDate)} ${formatDayMonth(first.accountingDate)}`.trim()
      : '',
    shift: closes.length > 1 ? `${closes.length} turnos` : (first?.shift ?? null),
    lines: [...media.values()].filter((m) => m.cents > 0),
    soldCents,
    channelsText: null,
    split: invoiceSplit(soldCents, [{ invoicedTotalCents: invoicedCents }]),
    // Guardado, ya se sabe qué se facturó: el papel lleva su sello.
    invoiceAsked: true,
    cash,
    arrivals,
    target: null,
    still: true,
  }
}
