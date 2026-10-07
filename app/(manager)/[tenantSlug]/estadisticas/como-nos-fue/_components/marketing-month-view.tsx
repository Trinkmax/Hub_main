'use client'

import { ArrowRight, Lock, Megaphone, Pencil } from 'lucide-react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import {
  type CSSProperties,
  Fragment,
  type ReactNode,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react'
import { toast } from 'sonner'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  DataTableBody,
  DataTableCell,
  DataTableHead,
  DataTableHeader,
  DataTableRoot,
  DataTableRow,
} from '@/components/ui/data-table'
import { EmptyState } from '@/components/ui/empty-state'
import { KPI, KPIGroup } from '@/components/ui/kpi'
import { PeriodPicker } from '@/components/ui/period-picker'
import { toastUndo } from '@/components/ui/toast'
import { eventInk } from '@/lib/salon/event-ink'
import {
  buildMonthMarketingReport,
  type EventMarketingRow,
  formatDayMonth,
  type MarketingActionState,
  type MonthCell,
  type MonthEdition,
  type MonthMarketingListRow,
  type MonthMarketingReport,
  type MonthMarketingTile,
  type MonthPendingRow,
  noAdsResultLabel,
} from '@/lib/salon/event-marketing'
import {
  deleteEventMarketing,
  markEventWithoutAds,
  type PrivateGroupActionState,
  setEventPrivateGroup,
} from '@/lib/salon/event-marketing-actions'
import {
  type KeptMarketingDraft,
  MARKETING_UNREACHABLE,
  marketingCopy,
  pinOpenPendingRow,
  restoreMarkAfterFailedUndo,
} from '@/lib/salon/event-marketing-draft'
import { monthMoneyShare } from '@/lib/salon/money-share'
import {
  monthPrivateGroupsNote,
  PRIVATE_GROUP_UNREACHABLE,
  privateGroupPendingCopy,
  type WithPrivateGroups,
} from '@/lib/salon/private-groups'
import { cn } from '@/lib/utils'
import { MarketingForm } from './marketing-form'
import { MoneyShareDonut } from './money-share-donut'

/**
 * La pestaña «Pauta»: un mes de pauta en Meta, contado por fecha de evento.
 *
 * Existe para dos cosas y en ese orden. Primero, ponerse al día: el recuadro de
 * pendientes lista las fechas que ya pasaron sin cargar (o a medias) y abre el
 * MISMO formulario de la ficha debajo de cada una, así Nacho carga un mes entero
 * sin navegar noche por noche. Después, leer el mes: una oración, cuatro números
 * con su base nombrada y la lista cronológica. Sin ranking ni barras: con una a
 * tres ediciones por evento, un ranking invita a sobreleer.
 *
 * Cada fecha de la lista (y cada «Sin pauta») se corrige ahí mismo con
 * «Editar»: pidió el dueño poder arreglar un número mal cargado sin ir a buscar
 * la noche en «Por día». Abre el mismo formulario, debajo de la fila.
 *
 * Todo lo que se lee sale armado de `buildMonthMarketingReport`; acá solo se
 * dibuja. Lo único propio es el estado optimista de «No tuvo pauta», de «Grupo
 * privado» y de lo recién guardado, que se reconstruye con esa MISMA función
 * para que el recuadro, la oración y los totales no se contradigan mientras
 * vuelve el server.
 *
 * Desde el 02/10: los grupos privados del mes no son ediciones (se nombran al
 * pie, `monthPrivateGroupsNote`) y, después de las fichas, va la dona «Cómo se
 * repartió el ingreso» (`monthMoneyShare`), sobre la misma cuenta del mes.
 *
 * Kit (lote D): el mes se elige con el `PeriodPicker`, los números del mes van
 * en un `KPIGroup`, la lista es una tabla del kit (primitivos de `DataTable`) y
 * los «Deshacer» son `toastUndo` (6 s en toda la app).
 */

const NBSP = String.fromCharCode(0xa0)

/** Las tarjetas de la pestaña: cartulina, pelo y radio del kit, sin sombra. */
const CARD = 'rounded-xl border border-border bg-card text-card-foreground'

/**
 * El `md` de Tailwind. La lista es tabla desde acá y tarjetas debajo, y las dos
 * están en el DOM (una escondida por CSS): el formulario de «Editar» se monta en
 * UNA sola, o habría dos forms con el mismo estado peleándose el foco. En el
 * server y en el primer render vale `false`, y no hay desajuste de hidratación
 * porque el form solo existe después de un click.
 */
const MD_QUERY = '(min-width: 48rem)'

function subscribeMd(onChange: () => void): () => void {
  const mql = window.matchMedia(MD_QUERY)
  mql.addEventListener('change', onChange)
  return () => mql.removeEventListener('change', onChange)
}

function useIsMd(): boolean {
  return useSyncExternalStore(
    subscribeMd,
    () => window.matchMedia(MD_QUERY).matches,
    () => false,
  )
}

/**
 * Lo optimista, por `scheduled_event_id`: una fila nueva (guardada o «No tuvo
 * pauta») o `null` (borrada / deshecha). Sin clave = lo que dice el server.
 */
type Overrides = Readonly<Record<string, EventMarketingRow | null>>

/** El mes como lo manda la page: las ediciones y, aparte, los grupos privados. */
type MonthReport = WithPrivateGroups<MonthMarketingReport>

/**
 * El mes con lo optimista aplicado, contado por la misma función que el server.
 *
 * `startsAtLocal` viaja como el índice ya ordenado: las ediciones llegan en el
 * orden bueno (fecha y hora) pero sin la hora, y sin esto dos eventos de la
 * misma noche se reordenaban por nombre durante el instante optimista.
 *
 * «Grupo privado» optimista (`privateIds`): la fecha deja de ser una edición
 * (sale de los pendientes, de los totales y de la lista) y pasa al pie, igual
 * que la va a mandar el server. Con la MISMA función: si no, el pie y los
 * números parpadearían hasta que vuelva.
 */
function withOverrides(
  report: MonthReport,
  today: string,
  overrides: Overrides,
  privateIds: ReadonlySet<string>,
): MonthReport {
  const touched = Object.entries(overrides)
  if (touched.length === 0 && privateIds.size === 0) return report
  const rows = new Map<string, EventMarketingRow>()
  for (const e of report.editions) if (e.row) rows.set(e.eventId, e.row)
  for (const [id, row] of touched) {
    if (row) rows.set(id, row)
    else rows.delete(id)
  }
  const moved = report.editions.filter((e) => privateIds.has(e.eventId))
  const rebuilt = buildMonthMarketingReport({
    ym: report.ym,
    today,
    truncated: report.truncated,
    marketing: Object.fromEntries(rows),
    editions: report.editions.flatMap((e, i) =>
      privateIds.has(e.eventId)
        ? []
        : [
            {
              key: e.eventId,
              eventId: e.eventId,
              date: e.date,
              title: e.title,
              colorHex: e.colorHex,
              reservations: e.reservations,
              guests: e.guests,
              // La gente de la plata viaja igual que la reservada: sin esto, el
              // instante optimista recalcularía el resultado de la noche con cero
              // personas y la cuenta parpadearía a «—».
              billableGuests: e.billableGuests,
              attendedGuests: e.attendedGuests,
              startsAtLocal: String(i).padStart(5, '0'),
            },
          ],
    ),
  })
  return {
    ...rebuilt,
    privateGroups: [
      ...report.privateGroups,
      ...moved.map((e) => ({ eventId: e.eventId, date: e.date, title: e.title })),
    ],
  }
}

/** Las variables de tinta del evento para un `.ev-ink`. Sin color, cae al verde de la casa. */
function inkStyle(hex: string | null): CSSProperties | undefined {
  const ink = eventInk(hex)
  return ink ? ({ '--ev-l': ink.light, '--ev-d': ink.dark } as CSSProperties) : undefined
}

function InkDot() {
  return <span aria-hidden className="size-2 shrink-0 rounded-full bg-(--ev)" />
}

/** `US$ 15,93` con el `US$` chico y gris: el número es lo que se lee. */
function MoneyValue({ value }: { value: string }) {
  const prefix = `US$${NBSP}`
  if (!value.startsWith(prefix)) return <>{value}</>
  return (
    <>
      <span className="mr-1 font-sans text-xs font-normal tracking-normal text-muted-foreground">
        US$
      </span>
      {value.slice(prefix.length)}
    </>
  )
}

function toneClass(tone: MonthCell['tone']): string | undefined {
  if (tone === 'warning') return 'text-warning-text'
  if (tone === 'muted') return 'text-muted-foreground'
  return undefined
}

/** Una celda del mes: `''` no aplica, `—` lleva el motivo en `sr-only` y en `title`. */
function CellText({ cell }: { cell: MonthCell }) {
  if (cell.text === '') return null
  if (cell.text === '—') {
    const reason = cell.srText ?? 'No se puede calcular'
    return (
      <>
        <span className="sr-only">{reason}</span>
        <span aria-hidden title={reason}>
          —
        </span>
      </>
    )
  }
  return <span title={cell.srText ?? undefined}>{cell.text}</span>
}

/** Lo que la lista necesita para ofrecer «Editar» sin saber de estado. */
type EditControls = {
  editingId: string | null
  onEdit: (eventId: string) => void
  /** Registra el botón para devolverle el foco al cerrar el form. */
  buttonRef: (key: string) => (el: HTMLButtonElement | null) => void
  renderEditor: (eventId: string) => ReactNode
}

export function MarketingMonthView({
  tenantSlug,
  today,
  report: serverReport,
  lastUsdArsRate,
  onNavigate,
}: {
  tenantSlug: string
  /** Hoy en el calendario del bar: el mismo con el que la page armó el mes. */
  today: string
  report: MonthReport
  lastUsdArsRate: { rate: number; loadedAt: string } | null
  /** Mergea en la URL, con la transición del tablero. */
  onNavigate: (next: Record<string, string>) => void
}) {
  const router = useRouter()
  const isMd = useIsMd()
  const headingId = useId()
  const calloutTitleId = useId()
  const listTitleId = useId()

  const [overrides, setOverrides] = useState<Overrides>({})
  // La fila tal como estaba al tocar «Cargar»: si un refresh la saca de
  // pendientes (otro dueño la completó), el form sigue abierto con lo tipeado.
  const [openRow, setOpenRow] = useState<MonthPendingRow | null>(null)
  // La edición que se está corrigiendo desde la lista o desde «Sin pauta». Es
  // una foto al tocar «Editar»: si un refresh la mueve de lugar (otro dueño la
  // borró), el form no desaparece con lo escrito.
  const [editing, setEditing] = useState<MonthEdition | null>(null)
  // Lo tipeado antes de un Esc, por edición, como en la ficha.
  const [drafts, setDrafts] = useState<Readonly<Record<string, KeptMarketingDraft>>>({})
  const [focusTarget, setFocusTarget] = useState<string | null>(null)
  // Fechas recién marcadas «Grupo privado» desde los pendientes: dejan de ser
  // ediciones al toque (optimista) hasta que el server traiga el mes sin ellas.
  const [privateIds, setPrivateIds] = useState<ReadonlySet<string>>(() => new Set())

  // Cuando llega un mes nuevo del server (revalidatePath después de guardar, un
  // refresh, o cambiar de mes) lo optimista se tira: el server ya lo sabe, y
  // guardarlo taparía un cambio posterior de otro dueño. Ajuste en render, no
  // en un efecto, para no pintar un cuadro con los dos estados mezclados.
  const [seenReport, setSeenReport] = useState(serverReport)
  if (seenReport !== serverReport) {
    if (seenReport.ym !== serverReport.ym) {
      setOpenRow(null)
      setEditing(null)
      setDrafts({})
    }
    setSeenReport(serverReport)
    setOverrides({})
    setPrivateIds(new Set())
  }

  const report = useMemo(
    () => withOverrides(serverReport, today, overrides, privateIds),
    [serverReport, today, overrides, privateIds],
  )
  const ym = report.ym

  // Lo último que se sabe, para lo que se resuelve DESPUÉS de un await o desde
  // un toast (sus closures ven el mes de cuando se crearon): `effective` con lo
  // optimista, `server` tal como lo mandó la page.
  const latestReports = useRef({ effective: report, server: serverReport })
  useEffect(() => {
    latestReports.current = { effective: report, server: serverReport }
  }, [report, serverReport])
  const rowAt = (source: MonthMarketingReport, eventId: string): string | null =>
    source.editions.find((e) => e.eventId === eventId)?.row?.updatedAt ?? null

  // El selector de mes: el último lugar para el foco cuando ya no queda nada en
  // el mes (su disparador se busca por el `data-slot` del kit).
  const monthNavRef = useRef<HTMLDivElement>(null)
  const calloutTitleRef = useRef<HTMLHeadingElement>(null)
  const cargarRefs = useRef(new Map<string, HTMLButtonElement>())
  // `table:<id>`, `card:<id>` y `sin-pauta:<id>`: la tabla y las tarjetas están
  // las dos en el DOM, así que el foco va al botón que se VE.
  const editRefs = useRef(new Map<string, HTMLButtonElement>())

  // El foco vuelve a donde tiene sentido DESPUÉS de que se pinta: el «Editar»
  // de la fila, el «Cargar» si la fecha quedó pendiente, el recuadro si la fila
  // se fue, o el mes si ya no queda nada.
  useEffect(() => {
    if (focusTarget === null) return
    const visibleEdit = ['table', 'card', 'sin-pauta']
      .map((where) => editRefs.current.get(`${where}:${focusTarget}`))
      // Apagado no toma foco (una «Sin pauta» que espera al server): se sigue de largo.
      .find((el) => el !== undefined && !el.disabled && el.getClientRects().length > 0)
    const target =
      visibleEdit ??
      cargarRefs.current.get(focusTarget) ??
      calloutTitleRef.current ??
      monthNavRef.current?.querySelector<HTMLElement>('[data-slot="period-picker-trigger"]')
    target?.focus()
    setFocusTarget(null)
  }, [focusTarget])

  function setOverride(eventId: string, row: EventMarketingRow | null) {
    setOverrides((prev) => ({ ...prev, [eventId]: row }))
  }

  function clearOverride(eventId: string) {
    setOverrides((prev) =>
      Object.fromEntries(Object.entries(prev).filter(([id]) => id !== eventId)),
    )
  }

  function keepDraft(eventId: string, kept: KeptMarketingDraft | null) {
    setDrafts((prev) => {
      const next = Object.fromEntries(Object.entries(prev).filter(([id]) => id !== eventId))
      return kept ? { ...next, [eventId]: kept } : next
    })
  }

  function label(p: Pick<MonthPendingRow, 'title' | 'date'>): string {
    return `${p.title} ${formatDayMonth(p.date)}`
  }

  // El aviso de «guardada» / «borrada» lo da el formulario, con las mismas
  // palabras que en la ficha. Repetirlo acá apilaba dos toasts iguales (uno con
  // id y otro sin), así que el recuadro solo mueve la fila y el foco.
  function handleSaved(eventId: string, row: EventMarketingRow) {
    setOverride(eventId, row)
    keepDraft(eventId, null)
    setOpenRow(null)
    setEditing(null)
    setFocusTarget(eventId)
  }

  function handleDeleted(eventId: string) {
    setOverride(eventId, null)
    keepDraft(eventId, null)
    setOpenRow(null)
    setEditing(null)
    setFocusTarget(eventId)
  }

  function handleCancel(eventId: string) {
    setOpenRow(null)
    setEditing(null)
    setFocusTarget(eventId)
  }

  /** Un solo formulario abierto a la vez en toda la pestaña. */
  function toggleEdit(eventId: string) {
    const edition = report.editions.find((e) => e.eventId === eventId) ?? null
    // «No tuvo pauta» todavía sin respuesta del server: sin versión no hay contra
    // qué guardar (el botón ya está apagado; esto cubre el teclado rápido).
    if (edition?.row?.updatedAt === '') return
    setOpenRow(null)
    setEditing((current) => (current?.eventId === eventId ? null : edition))
  }

  /**
   * «No tuvo pauta», un click: optimista, y con «Deshacer» 6 s en vez de
   * confirmación (el patrón del operativo). La fila sale del recuadro al toque.
   */
  async function markNoAds(p: MonthPendingRow) {
    const previous = p.row
    setOpenRow((o) => (o?.eventId === p.eventId ? null : o))
    setOverride(p.eventId, {
      scheduledEventId: p.eventId,
      adSpendUsdCents: 0,
      messages: null,
      reach: null,
      revenueArsCents: null,
      usdArsRate: null,
      revenuePerGuestArsCents: null,
      costPerGuestArsCents: null,
      drinkRevenuePerGuestArsCents: null,
      drinkCostPerGuestArsCents: null,
      notes: null,
      updatedAt: '',
      updatedByName: null,
    })
    setFocusTarget(p.eventId)

    let res: MarketingActionState
    try {
      res = await markEventWithoutAds(tenantSlug, p.eventId)
    } catch (error) {
      // Sin respuesta (red caída, deploy en el medio): lo optimista no puede
      // quedar colgado como si se hubiera guardado. Mismo trato que la ficha.
      console.error(
        '[como-nos-fue.pauta.month.noAds]',
        error instanceof Error ? error.message : 'sin respuesta',
      )
      res = { ok: false, code: 'error', message: MARKETING_UNREACHABLE.noAds }
    }
    if (!res.ok || !res.row) {
      if (previous === null) clearOverride(p.eventId)
      else setOverride(p.eventId, previous)
      toast.error(res.ok ? MARKETING_UNREACHABLE.noAds : res.message, {
        id: `pauta-${p.eventId}`,
      })
      // «Ya tiene pauta cargada»: se trae la de verdad en vez de pedir que recargue.
      if (!res.ok && res.code === 'stale') router.refresh()
      return
    }

    const saved = res.row
    setOverride(p.eventId, saved)
    toastUndo(`${label(p)} quedó sin pauta.`, {
      id: `pauta-${p.eventId}`,
      onUndo: () => undoNoAds(p, saved),
    })
  }

  async function undoNoAds(p: MonthPendingRow, saved: EventMarketingRow) {
    // Si en los 6 s del toast se cargó pauta encima (desde «Sin pauta»), la marca
    // ya no es lo guardado: deshacerla borraría esos números o, al rebotar,
    // volvería a pintar «Sin pauta» sobre ellos.
    if (rowAt(latestReports.current.effective, p.eventId) !== saved.updatedAt) {
      toast.error('Esa fecha ya tiene otra pauta cargada: no hay nada que deshacer.', {
        id: `pauta-${p.eventId}`,
      })
      return
    }
    setOverride(p.eventId, null)
    let res: MarketingActionState
    try {
      res = await deleteEventMarketing(tenantSlug, p.eventId, saved.updatedAt)
    } catch (error) {
      console.error(
        '[como-nos-fue.pauta.month.undoNoAds]',
        error instanceof Error ? error.message : 'sin respuesta',
      )
      res = { ok: false, code: 'error', message: MARKETING_UNREACHABLE.delete }
    }
    if (!res.ok) {
      toast.error(res.message, { id: `pauta-${p.eventId}` })
      // Mismo criterio que la ficha: la marca vuelve solo si sigue siendo la
      // verdad; si no, gana lo que diga el server.
      if (
        restoreMarkAfterFailedUndo(
          res.code,
          rowAt(latestReports.current.server, p.eventId),
          saved.updatedAt,
        )
      ) {
        setOverride(p.eventId, saved)
      } else {
        clearOverride(p.eventId)
        if (res.code === 'stale') router.refresh()
      }
      return
    }
    toast.success('Listo: volvió a «Sin cargar».', { id: `pauta-${p.eventId}` })
    setFocusTarget(p.eventId)
  }

  function unmarkPrivate(eventId: string) {
    setPrivateIds((prev) => {
      const next = new Set(prev)
      next.delete(eventId)
      return next
    })
  }

  /**
   * «Grupo privado» (C1, 02/10): la fecha deja de ser un evento y sale de toda
   * la pestaña (pendientes, totales, lista) para ir al pie. Optimista con
   * Deshacer 6 s, como «No tuvo pauta». Solo se ofrece sin fila de pauta: una
   * con pauta es un evento, y la base la frena igual (`has_money`).
   */
  async function markPrivateGroup(p: MonthPendingRow) {
    const copy = privateGroupPendingCopy(p.title, p.date)
    setOpenRow((o) => (o?.eventId === p.eventId ? null : o))
    setPrivateIds((prev) => new Set(prev).add(p.eventId))
    setFocusTarget(p.eventId)
    let res: PrivateGroupActionState
    try {
      res = await setEventPrivateGroup(tenantSlug, p.eventId, true)
    } catch (error) {
      console.error(
        '[como-nos-fue.pauta.month.privateGroup]',
        error instanceof Error ? error.message : 'sin respuesta',
      )
      res = { ok: false, code: 'error', message: PRIVATE_GROUP_UNREACHABLE }
    }
    if (!res.ok) {
      unmarkPrivate(p.eventId)
      toast.error(res.message, { id: `privado-${p.eventId}` })
      // Con plata cargada mientras tanto: se trae la de verdad.
      if (res.code === 'has_money') router.refresh()
      return
    }
    toastUndo(copy.toast, {
      id: `privado-${p.eventId}`,
      onUndo: () => undoPrivateGroup(p),
    })
  }

  async function undoPrivateGroup(p: MonthPendingRow) {
    const copy = privateGroupPendingCopy(p.title, p.date)
    let res: PrivateGroupActionState
    try {
      res = await setEventPrivateGroup(tenantSlug, p.eventId, false)
    } catch (error) {
      console.error(
        '[como-nos-fue.pauta.month.undoPrivateGroup]',
        error instanceof Error ? error.message : 'sin respuesta',
      )
      res = { ok: false, code: 'error', message: PRIVATE_GROUP_UNREACHABLE }
    }
    if (!res.ok) {
      toast.error(res.message, { id: `privado-${p.eventId}` })
      return
    }
    // Si el server ya trajo el mes con la fecha en el pie, el `revalidatePath`
    // de la acción la devuelve como edición; si no, se saca lo optimista acá.
    unmarkPrivate(p.eventId)
    toast.success(copy.undoneToast, { id: `privado-${p.eventId}` })
    setFocusTarget(p.eventId)
  }

  const monthNav = (
    <div ref={monthNavRef}>
      {/* El título de la pestaña es para el lector: a la vista ya lo dice el
          selector. `Septiembre de 2026`: `capitalize` de CSS subía el «De». */}
      <h2 id={headingId} className="sr-only">
        Pauta de {report.monthLabel}
      </h2>
      <PeriodPicker
        aria-label="Mes"
        kinds={['month']}
        value={{ kind: 'month', month: ym }}
        onValueChange={(next) => {
          if (next.kind === 'month') onNavigate({ vista: 'pauta', mes: next.month })
        }}
      />
    </div>
  )

  if (report.emptyState) {
    const note = monthPrivateGroupsNote(report.privateGroups)
    return (
      <div className="space-y-4">
        {monthNav}
        <EmptyState
          icon={Megaphone}
          title={report.emptyState.title}
          description={report.emptyState.description}
        />
        {note ? <p className="type-caption text-muted-foreground">{note}</p> : null}
      </div>
    )
  }

  const dayHref = (date: string) => `/${tenantSlug}/estadisticas/como-nos-fue?vista=dia&dia=${date}`
  // Sale del mes con lo optimista aplicado: lo que se ve arriba y la dona no se contradicen.
  const share = monthMoneyShare(report)

  const calloutRows = pinOpenPendingRow(report.pending?.rows ?? [], openRow, report.editions)
  const privateNote = monthPrivateGroupsNote(report.privateGroups)

  // La edición abierta, con la fila de AHORA (un refresh trae lo que guardó otro
  // dueño y el form lo muestra); la foto solo si ya no está en el mes.
  const editingEdition = editing
    ? (report.editions.find((e) => e.eventId === editing.eventId) ?? editing)
    : null
  const noAdsEditions = report.editions.filter((e) => e.status === 'sin-pauta')
  // Dónde se dibuja el form: en su fila, en «Sin pauta», o aparte si la fecha
  // salió de las dos listas mientras se editaba (otro dueño la borró).
  const editingPlace: 'rows' | 'sin-pauta' | 'aparte' | null = editingEdition
    ? report.rows.some((r) => r.eventId === editingEdition.eventId)
      ? 'rows'
      : noAdsEditions.some((e) => e.eventId === editingEdition.eventId)
        ? 'sin-pauta'
        : 'aparte'
    : null

  function renderEditor(eventId: string, className?: string): ReactNode {
    const e = editingEdition
    if (!e || e.eventId !== eventId) return null
    return (
      <MarketingForm
        key={e.eventId}
        tenantSlug={tenantSlug}
        scheduledEventId={e.eventId}
        eventTitle={e.title}
        eventDate={e.date}
        phase={e.phase}
        block={{
          reservations: e.reservations,
          guests: e.guests,
          billableGuests: e.billableGuests,
          attendedGuests: e.attendedGuests,
        }}
        row={e.row}
        lastUsdArsRate={lastUsdArsRate}
        initialDraft={drafts[e.eventId] ?? null}
        onKeepDraft={(kept) => keepDraft(e.eventId, kept)}
        onSaved={(row: EventMarketingRow) => handleSaved(e.eventId, row)}
        onCancel={() => handleCancel(e.eventId)}
        onDeleted={() => handleDeleted(e.eventId)}
        className={cn('rounded-lg bg-card p-4 text-left', className)}
      />
    )
  }

  const buttonRef = (key: string) => (el: HTMLButtonElement | null) => {
    if (el) editRefs.current.set(key, el)
    else editRefs.current.delete(key)
  }

  const listControls: EditControls = {
    editingId: editingPlace === 'rows' ? (editingEdition?.eventId ?? null) : null,
    onEdit: toggleEdit,
    buttonRef,
    renderEditor: (eventId) => renderEditor(eventId),
  }

  const noAdsBlock =
    noAdsEditions.length > 0 ? (
      <div className="space-y-2">
        <p className="flex flex-wrap items-center gap-x-1 gap-y-0.5 type-caption text-muted-foreground">
          <span>Sin pauta:</span>
          {noAdsEditions.map((e, i) => {
            const open = editingPlace === 'sin-pauta' && editingEdition?.eventId === e.eventId
            // Una noche orgánica con su cuenta cerrada dice cuánto dejó: no
            // suma en los totales de arriba (son de las fechas CON pauta), así
            // que es el único lugar del mes donde se ve.
            const result = noAdsResultLabel(e)
            return (
              <span key={e.eventId} className="inline-flex items-center">
                {i > 0 ? (
                  <span aria-hidden className="mr-1">
                    ·
                  </span>
                ) : null}
                {/* El nombre accesible contiene lo que se ve («Pizza libre 10/09»). */}
                <button
                  ref={buttonRef(`sin-pauta:${e.eventId}`)}
                  type="button"
                  // Recién marcada, sin respuesta del server todavía: igual que
                  // «Cambiar» en la ficha, se habilita cuando hay versión.
                  disabled={e.row?.updatedAt === ''}
                  aria-expanded={open}
                  onClick={() => toggleEdit(e.eventId)}
                  className="inline-flex min-h-8 items-center gap-1 rounded-sm underline decoration-dotted underline-offset-4 outline-offset-2 outline-(--ring) hover:text-foreground focus-visible:outline-2 disabled:pointer-events-none disabled:opacity-50 pointer-coarse:min-h-11"
                >
                  <span className="sr-only">Editar la pauta de </span>
                  {e.title} {formatDayMonth(e.date)}
                  <Pencil className="size-3" aria-hidden />
                </button>
                {result ? (
                  <span
                    className={cn(
                      'ml-1 tabular-nums',
                      result.negative ? 'text-warning-text' : 'text-foreground',
                    )}
                  >
                    ({result.text})
                  </span>
                ) : null}
              </span>
            )
          })}
        </p>
        {editingPlace === 'sin-pauta' && editingEdition
          ? renderEditor(editingEdition.eventId)
          : null}
      </div>
    ) : null

  return (
    <div className="space-y-5">
      {monthNav}

      {/* Pendientes: lo primero, porque hasta que estén los totales mienten por corto. */}
      {calloutRows.length > 0 ? (
        // Un aviso del kit (fondo suave, sin borde de color) que además trae
        // la lista: lo primero de la pestaña.
        <section aria-labelledby={calloutTitleId} className="rounded-xl bg-warning-soft p-4">
          <h3
            id={calloutTitleId}
            ref={calloutTitleRef}
            tabIndex={-1}
            className="type-subtitle text-foreground outline-none"
          >
            {report.pending?.title ?? 'La pauta que estabas cargando'}
          </h3>
          {report.pending ? (
            <p className="mt-0.5 text-xs text-muted-foreground">{report.pending.subtitle}</p>
          ) : null}

          <ul className="mt-3 divide-y divide-warning/25">
            {calloutRows.map((p) => {
              const open = openRow?.eventId === p.eventId
              // Con fila ya cargada (incompleta, o la clavada que otro dueño
              // completó) «No tuvo pauta» no aplica: el server lo rebota.
              const canMarkNoAds = p.row === null
              const privateCopy = privateGroupPendingCopy(p.title, p.date)
              return (
                <li key={p.eventId} className="ev-ink py-3 last:pb-0" style={inkStyle(p.colorHex)}>
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
                    <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-2 gap-y-0.5">
                      <InkDot />
                      <span className="min-w-0 truncate type-body font-medium">{p.title}</span>
                      <span className="type-caption type-amount text-muted-foreground">
                        {p.weekdayLabel}
                      </span>
                      <span className="type-caption text-muted-foreground">
                        {p.reservationsLabel}
                      </span>
                      {p.incomplete ? <Badge tone="warning">Incompleta</Badge> : null}
                    </div>
                    {/* En el teléfono los botones van en su propia línea: «Cargar»
                        a lo ancho y abajo «No tuvo pauta» y «Grupo privado» de a
                        dos (blancos de 40 px, no links chicos). Desde `sm`, en
                        línea. */}
                    <div className="grid w-full grid-cols-2 gap-2 sm:flex sm:w-auto">
                      <Button
                        ref={(el) => {
                          if (el) cargarRefs.current.set(p.eventId, el)
                          else cargarRefs.current.delete(p.eventId)
                        }}
                        type="button"
                        variant="secondary"
                        size="sm"
                        className="col-span-2"
                        aria-label={p.cargarAriaLabel}
                        aria-expanded={open}
                        onClick={() => {
                          setEditing(null)
                          setOpenRow(open ? null : p)
                        }}
                      >
                        <Megaphone aria-hidden />
                        Cargar
                      </Button>
                      {!canMarkNoAds ? null : (
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          aria-label={p.noAdsAriaLabel}
                          onClick={() => {
                            void markNoAds(p)
                          }}
                        >
                          No tuvo pauta
                        </Button>
                      )}
                      {/* Solo sin fila de pauta: una fecha con pauta gastada es un
                          evento, y la base lo frena igual. */}
                      {!canMarkNoAds ? null : (
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          aria-label={privateCopy.ariaLabel}
                          onClick={() => {
                            void markPrivateGroup(p)
                          }}
                        >
                          <Lock aria-hidden />
                          {privateCopy.label}
                        </Button>
                      )}
                    </div>
                  </div>

                  {open ? (
                    <MarketingForm
                      tenantSlug={tenantSlug}
                      scheduledEventId={p.eventId}
                      eventTitle={p.title}
                      eventDate={p.date}
                      // Solo entran al recuadro fechas que ya pasaron.
                      phase="past"
                      block={{
                        reservations: p.reservations,
                        guests: p.guests,
                        billableGuests: p.billableGuests,
                        attendedGuests: p.attendedGuests,
                      }}
                      row={p.row}
                      lastUsdArsRate={lastUsdArsRate}
                      initialDraft={drafts[p.eventId] ?? null}
                      onKeepDraft={(kept) => keepDraft(p.eventId, kept)}
                      onSaved={(row: EventMarketingRow) => handleSaved(p.eventId, row)}
                      onCancel={() => handleCancel(p.eventId)}
                      onDeleted={() => handleDeleted(p.eventId)}
                      className="mt-2 rounded-lg bg-card p-4"
                    />
                  ) : null}
                </li>
              )
            })}
          </ul>
        </section>
      ) : null}

      {/* La fecha que se estaba editando salió de la lista (otro dueño la
          borró): el form sigue acá, con lo escrito, hasta guardar o cancelar. */}
      {editingPlace === 'aparte' && editingEdition ? (
        <section className="ev-ink space-y-2" style={inkStyle(editingEdition.colorHex)}>
          <p className="type-caption text-muted-foreground">
            {editingEdition.title} {formatDayMonth(editingEdition.date)} ya no tiene pauta cargada.
            Si guardás, se carga de nuevo.
          </p>
          {renderEditor(editingEdition.eventId)}
        </section>
      ) : null}

      {report.notice ? <p className="type-body text-muted-foreground">{report.notice}</p> : null}

      {report.summary.length > 0 ? (
        <p className="max-w-prose text-pretty type-body">{report.summary.join(' ')}</p>
      ) : null}

      {/* La cuenta del mes, paso a paso, debajo de su propia oración (que ya
          viene en `summary`). La aclaración de que no es la ganancia del bar
          está en la pista de la ficha «Resultado» y en las notas al pie: acá
          sería la tercera vez en la misma pantalla. */}
      {report.result ? (
        <p className="max-w-prose text-xs leading-relaxed text-muted-foreground tabular-nums">
          <span
            className={cn(
              'font-medium',
              report.result.negative ? 'text-warning-text' : 'text-foreground',
            )}
          >
            {report.result.math}
          </span>{' '}
          · {report.result.base}.
        </p>
      ) : null}

      {report.tiles.length > 0 ? <MonthTiles tiles={report.tiles} /> : null}

      {/* La dona del mes (C6): la misma cuenta del resultado del mes (fechas
          CON pauta, con ingreso, costo y dólar), repartida. Sin esa cuenta no
          hay dona ni nada en su lugar. */}
      {share ? <MoneyShareDonut data={share} headingLevel="h3" /> : null}

      {report.rows.length > 0 ? (
        <section aria-labelledby={listTitleId} className={cn(CARD, 'overflow-clip')}>
          <header className="border-b border-border px-4 py-3">
            <h3 id={listTitleId} className="type-subtitle text-foreground">
              Fechas con pauta
              <span className="ml-2 type-caption font-normal tabular-nums text-muted-foreground">
                {report.rows.length}
              </span>
            </h3>
          </header>

          <div className="hidden overflow-x-auto md:block">
            <MonthTable
              rows={report.rows}
              showReturnColumn={report.showReturnColumn}
              showResultColumn={report.showResultColumn}
              dayHref={dayHref}
              edit={isMd ? listControls : { ...listControls, editingId: null }}
            />
          </div>

          <ul className="divide-y divide-border md:hidden">
            {report.rows.map((r) => (
              <MonthCard
                key={r.eventId}
                row={r}
                href={dayHref(r.date)}
                edit={isMd ? { ...listControls, editingId: null } : listControls}
              />
            ))}
          </ul>

          {noAdsBlock ? (
            <div className="border-t border-border px-4 py-2.5">{noAdsBlock}</div>
          ) : null}
        </section>
      ) : (
        noAdsBlock
      )}

      <ul className="space-y-0.5 type-caption text-muted-foreground">
        {report.footnotes.map((f) => (
          <li key={f}>{f}</li>
        ))}
        {/* Los grupos privados del mes no son ediciones (C1): se nombran para
            que nadie los busque en la lista. */}
        {privateNote ? <li>{privateNote}</li> : null}
      </ul>
    </div>
  )
}

/**
 * Los números del mes, en el `KPIGroup` del kit (una sola tarjeta con
 * divisores). Cada ficha nombra su base en la pista, porque cada una sale de un
 * conjunto distinto (todo lo invertido, lo que ya pasó, lo que tiene mensajes,
 * lo que tiene facturación). Es un `dl`: el lector oye rótulo, valor y pista.
 *
 * Con cinco (se sumó «Resultado») van de a tres desde `md`: el grupo del kit
 * llega a cuatro columnas, y cinco en 768 px partían los números.
 */
function MonthTiles({ tiles }: { tiles: ReadonlyArray<MonthMarketingTile> }) {
  return (
    <KPIGroup columns={tiles.length === 4 ? 4 : 3}>
      {tiles.map((t) => (
        <KPI
          key={t.key}
          label={t.label}
          hint={t.hint}
          value={
            t.value === null ? (
              <span className="text-muted-foreground">
                <span className="sr-only">No se puede calcular:</span>
                <span aria-hidden>—</span>
              </span>
            ) : (
              <span className={cn(t.tone === 'warning' && 'text-warning-text')}>
                <MoneyValue value={t.value} />
              </span>
            )
          }
        />
      ))}
    </KPIGroup>
  )
}

function MonthTable({
  rows,
  showReturnColumn,
  showResultColumn,
  dayHref,
  edit,
}: {
  rows: ReadonlyArray<MonthMarketingListRow>
  showReturnColumn: boolean
  showResultColumn: boolean
  dayHref: (date: string) => string
  edit: EditControls
}) {
  // Fecha, Evento, Pauta, Mensajes, Cierre, Por reserva, Personas (+ Retorno,
  // + Resultado) + Editar.
  const columns = 8 + (showReturnColumn ? 1 : 0) + (showResultColumn ? 1 : 0)
  return (
    <DataTableRoot caption="Fechas con pauta" density="compact">
      <DataTableHead>
        <tr>
          <DataTableHeader className="ps-4">Fecha</DataTableHeader>
          <DataTableHeader>Evento</DataTableHeader>
          <DataTableHeader numeric>Pauta</DataTableHeader>
          <DataTableHeader numeric>Mensajes</DataTableHeader>
          <DataTableHeader numeric>Cierre</DataTableHeader>
          <DataTableHeader numeric>Por reserva</DataTableHeader>
          <DataTableHeader numeric>Personas</DataTableHeader>
          {showReturnColumn ? <DataTableHeader numeric>Retorno</DataTableHeader> : null}
          {showResultColumn ? <DataTableHeader numeric>Resultado</DataTableHeader> : null}
          <DataTableHeader className="pe-4">
            <span className="sr-only">Editar</span>
          </DataTableHeader>
        </tr>
      </DataTableHead>
      <DataTableBody>
        {rows.map((r) => {
          const open = edit.editingId === r.eventId
          return (
            <Fragment key={r.eventId}>
              <DataTableRow
                className={cn('ev-ink', open && 'bg-muted/40')}
                style={inkStyle(r.colorHex)}
              >
                <DataTableCell className="ps-4 align-top">
                  <Link
                    href={dayHref(r.date)}
                    title="Ver la noche"
                    className="whitespace-nowrap rounded-sm type-small type-amount underline-offset-[3px] outline-offset-2 outline-(--ring) hover:underline focus-visible:outline-2"
                  >
                    {r.weekdayLabel}
                  </Link>
                  {r.phaseLabel ? (
                    <div className="type-caption text-muted-foreground">{r.phaseLabel}</div>
                  ) : null}
                </DataTableCell>
                <DataTableCell className="align-top">
                  <span className="flex min-w-0 items-center gap-2">
                    <InkDot />
                    <span className="truncate">{r.title}</span>
                  </span>
                </DataTableCell>
                <DataTableCell numeric className={cn('align-top', toneClass(r.cells.spend.tone))}>
                  <CellText cell={r.cells.spend} />
                </DataTableCell>
                <DataTableCell
                  numeric
                  className={cn('align-top', toneClass(r.cells.messages.tone))}
                >
                  <CellText cell={r.cells.messages} />
                </DataTableCell>
                <DataTableCell
                  numeric
                  className={cn('align-top', toneClass(r.cells.closingRate.tone))}
                >
                  <CellText cell={r.cells.closingRate} />
                </DataTableCell>
                <DataTableCell
                  numeric
                  className={cn('align-top', toneClass(r.cells.costPerReservation.tone))}
                >
                  <CellText cell={r.cells.costPerReservation} />
                </DataTableCell>
                <DataTableCell numeric className={cn('align-top', toneClass(r.cells.guests.tone))}>
                  <CellText cell={r.cells.guests} />
                </DataTableCell>
                {showReturnColumn ? (
                  <DataTableCell
                    numeric
                    className={cn('align-top', toneClass(r.cells.returnPerDollar.tone))}
                  >
                    <CellText cell={r.cells.returnPerDollar} />
                  </DataTableCell>
                ) : null}
                {/* En negativo la celda dice «$ X abajo», nunca un número
                    suelto en ámbar: lo arma `buildMonthMarketingReport`. */}
                {showResultColumn ? (
                  <DataTableCell
                    numeric
                    className={cn('align-top', toneClass(r.cells.nightResult.tone))}
                  >
                    <CellText cell={r.cells.nightResult} />
                  </DataTableCell>
                ) : null}
                <DataTableCell align="end" className="pe-3 align-top">
                  <Button
                    ref={edit.buttonRef(`table:${r.eventId}`)}
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="aria-expanded:text-foreground"
                    aria-label={marketingCopy(r.title, r.date).editAria}
                    aria-expanded={open}
                    onClick={() => edit.onEdit(r.eventId)}
                  >
                    <Pencil aria-hidden />
                    Editar
                  </Button>
                </DataTableCell>
              </DataTableRow>
              {open ? (
                <DataTableRow className="bg-muted/40">
                  <DataTableCell colSpan={columns} className="px-4 pt-1 pb-4">
                    {edit.renderEditor(r.eventId)}
                  </DataTableCell>
                </DataTableRow>
              ) : null}
            </Fragment>
          )
        })}
      </DataTableBody>
    </DataTableRoot>
  )
}

/** Debajo de `md`: una tarjeta por fecha en vez de una tabla que no entra en 328px. */
function MonthCard({
  row: r,
  href,
  edit,
}: {
  row: MonthMarketingListRow
  href: string
  edit: EditControls
}) {
  const open = edit.editingId === r.eventId
  return (
    <li className={cn('ev-ink px-4 py-3', open && 'bg-muted/40')} style={inkStyle(r.colorHex)}>
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5">
          <InkDot />
          <span className="min-w-0 truncate type-body font-medium">{r.title}</span>
          <span className="type-caption type-amount text-muted-foreground">{r.weekdayLabel}</span>
          {r.phaseLabel ? (
            <span className="type-caption text-muted-foreground">{r.phaseLabel}</span>
          ) : null}
        </div>
        {r.cardHeadline ? (
          <div className="shrink-0 text-right">
            <div className="font-display text-xl leading-none font-[520] tracking-[-0.01em]">
              <MoneyValue value={r.cardHeadline} />
            </div>
            <div className="mt-1 type-caption text-muted-foreground">por reserva</div>
          </div>
        ) : null}
      </div>
      <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">{r.cardLine}</p>
      <div className="mt-1 flex items-center justify-between gap-2">
        <Link
          href={href}
          aria-label={`Ver la noche del ${r.dayMonth}`}
          className="inline-flex min-h-11 items-center gap-1 rounded-sm type-small font-medium text-muted-foreground underline-offset-[3px] outline-offset-2 outline-(--ring) hover:text-foreground hover:underline focus-visible:outline-2"
        >
          Ver la noche
          <ArrowRight className="size-3.5" aria-hidden />
        </Link>
        <Button
          ref={edit.buttonRef(`card:${r.eventId}`)}
          type="button"
          variant="ghost"
          size="sm"
          className="aria-expanded:text-foreground"
          aria-label={marketingCopy(r.title, r.date).editAria}
          aria-expanded={open}
          onClick={() => edit.onEdit(r.eventId)}
        >
          <Pencil aria-hidden />
          Editar
        </Button>
      </div>
      {open ? <div className="mt-2">{edit.renderEditor(r.eventId)}</div> : null}
    </li>
  )
}
