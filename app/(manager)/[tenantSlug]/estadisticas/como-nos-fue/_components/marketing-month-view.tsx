'use client'

import { ArrowRight, ChevronLeft, ChevronRight, Megaphone, Pencil } from 'lucide-react'
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
import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/ui/empty-state'
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
import { deleteEventMarketing, markEventWithoutAds } from '@/lib/salon/event-marketing-actions'
import {
  type KeptMarketingDraft,
  MARKETING_UNREACHABLE,
  marketingCopy,
  pinOpenPendingRow,
  restoreMarkAfterFailedUndo,
} from '@/lib/salon/event-marketing-draft'
import { cn } from '@/lib/utils'
import { MarketingForm } from './marketing-form'

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
 * dibuja. Lo único propio es el estado optimista de «No tuvo pauta» y de lo
 * recién guardado, que se reconstruye con esa MISMA función para que el
 * recuadro, la oración y los totales no se contradigan mientras vuelve el
 * server.
 */

/** `2026-09` + 1 → `2026-10`. Aritmética en UTC: en local, un runtime en
 *  UTC-3 se corre de mes en el borde. Copiado de `deposits-dashboard.tsx`. */
function shiftYM(ym: string, months: number): string {
  const [y, m] = ym.split('-').map(Number)
  if (!y || !m) return ym
  const d = new Date(Date.UTC(y, m - 1 + months, 1))
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`
}

const NBSP = String.fromCharCode(0xa0)
/** Mismo tiempo que el «Deshacer» del operativo. */
const UNDO_MS = 6000

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

/**
 * El mes con lo optimista aplicado, contado por la misma función que el server.
 *
 * `startsAtLocal` viaja como el índice ya ordenado: las ediciones llegan en el
 * orden bueno (fecha y hora) pero sin la hora, y sin esto dos eventos de la
 * misma noche se reordenaban por nombre durante el instante optimista.
 */
function withOverrides(
  report: MonthMarketingReport,
  today: string,
  overrides: Overrides,
): MonthMarketingReport {
  const touched = Object.entries(overrides)
  if (touched.length === 0) return report
  const rows = new Map<string, EventMarketingRow>()
  for (const e of report.editions) if (e.row) rows.set(e.eventId, e.row)
  for (const [id, row] of touched) {
    if (row) rows.set(id, row)
    else rows.delete(id)
  }
  return buildMonthMarketingReport({
    ym: report.ym,
    today,
    truncated: report.truncated,
    marketing: Object.fromEntries(rows),
    editions: report.editions.map((e, i) => ({
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
    })),
  })
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
      <span className="mr-1 font-sans text-xs font-normal text-muted-foreground">US$</span>
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
  report: MonthMarketingReport
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
  }

  const report = useMemo(
    () => withOverrides(serverReport, today, overrides),
    [serverReport, today, overrides],
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

  const headingRef = useRef<HTMLHeadingElement>(null)
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
      headingRef.current
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
    toast(`${label(p)} quedó sin pauta.`, {
      id: `pauta-${p.eventId}`,
      duration: UNDO_MS,
      action: {
        label: 'Deshacer',
        onClick: () => {
          void undoNoAds(p, saved)
        },
      },
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

  const monthNav = (
    <div className="flex items-center gap-2">
      <Button
        variant="outline"
        size="icon"
        aria-label="Mes anterior"
        onClick={() => onNavigate({ vista: 'pauta', mes: shiftYM(ym, -1) })}
      >
        <ChevronLeft className="size-4" />
      </Button>
      <h2
        id={headingId}
        ref={headingRef}
        tabIndex={-1}
        className="min-w-0 truncate font-serif text-xl font-semibold leading-tight tracking-tight outline-none sm:text-2xl"
      >
        {/* `Septiembre de 2026`: `capitalize` de CSS subía también el «De». */}
        {report.monthLabel}
      </h2>
      <Button
        variant="outline"
        size="icon"
        aria-label="Mes siguiente"
        onClick={() => onNavigate({ vista: 'pauta', mes: shiftYM(ym, 1) })}
      >
        <ChevronRight className="size-4" />
      </Button>
    </div>
  )

  if (report.emptyState) {
    return (
      <div className="space-y-4">
        {monthNav}
        <EmptyState
          icon={Megaphone}
          title={report.emptyState.title}
          description={report.emptyState.description}
        />
      </div>
    )
  }

  const dayHref = (date: string) => `/${tenantSlug}/estadisticas/como-nos-fue?vista=dia&dia=${date}`

  const calloutRows = pinOpenPendingRow(report.pending?.rows ?? [], openRow, report.editions)

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
        className={cn('rounded-lg border border-border/60 bg-card p-4 text-left', className)}
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
        <p className="flex flex-wrap items-center gap-x-1 gap-y-0.5 text-[11px] text-muted-foreground">
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
                  className="inline-flex min-h-8 items-center gap-1 rounded-sm underline decoration-dotted underline-offset-4 outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-60"
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
        <section
          aria-labelledby={calloutTitleId}
          className="rounded-xl border border-warning/40 bg-warning/10 p-4"
        >
          <h3
            id={calloutTitleId}
            ref={calloutTitleRef}
            tabIndex={-1}
            className="font-serif text-base font-semibold tracking-tight outline-none"
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
              return (
                <li key={p.eventId} className="ev-ink py-3 last:pb-0" style={inkStyle(p.colorHex)}>
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
                    <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-2 gap-y-0.5">
                      <InkDot />
                      <span className="min-w-0 truncate text-sm font-medium">{p.title}</span>
                      <span className="font-mono text-xs tabular-nums text-muted-foreground">
                        {p.weekdayLabel}
                      </span>
                      <span className="text-xs text-muted-foreground">{p.reservationsLabel}</span>
                      {p.incomplete ? (
                        <span className="rounded-full border border-warning/50 bg-warning/15 px-2 py-0.5 text-[10px] font-medium text-warning-text">
                          Incompleta
                        </span>
                      ) : null}
                    </div>
                    {/* En el teléfono los botones van en su propia línea y a lo
                        ancho: dos blancos de 40px en vez de dos links chicos. */}
                    <div className="grid w-full grid-cols-2 gap-2 sm:flex sm:w-auto">
                      <Button
                        ref={(el) => {
                          if (el) cargarRefs.current.set(p.eventId, el)
                          else cargarRefs.current.delete(p.eventId)
                        }}
                        type="button"
                        variant="outline"
                        size="sm"
                        className={cn('h-10 gap-1.5 sm:h-8', !canMarkNoAds && 'col-span-2')}
                        aria-label={p.cargarAriaLabel}
                        aria-expanded={open}
                        onClick={() => {
                          setEditing(null)
                          setOpenRow(open ? null : p)
                        }}
                      >
                        <Megaphone className="size-3.5" aria-hidden />
                        Cargar
                      </Button>
                      {!canMarkNoAds ? null : (
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="h-10 sm:h-8"
                          aria-label={p.noAdsAriaLabel}
                          onClick={() => {
                            void markNoAds(p)
                          }}
                        >
                          No tuvo pauta
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
          <p className="text-xs text-muted-foreground">
            {editingEdition.title} {formatDayMonth(editingEdition.date)} ya no tiene pauta cargada.
            Si guardás, se carga de nuevo.
          </p>
          {renderEditor(editingEdition.eventId)}
        </section>
      ) : null}

      {report.notice ? <p className="text-sm text-muted-foreground">{report.notice}</p> : null}

      {report.summary.length > 0 ? (
        <p className="max-w-prose text-sm leading-relaxed">{report.summary.join(' ')}</p>
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

      {report.rows.length > 0 ? (
        <section aria-labelledby={listTitleId} className="card-hairline rounded-xl border bg-card">
          <header className="border-b border-border/60 px-4 py-3">
            <h3 id={listTitleId} className="font-serif text-base font-semibold tracking-tight">
              Fechas con pauta
              <span className="ml-2 text-xs font-normal text-muted-foreground">
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

          <ul className="divide-y divide-border/60 md:hidden">
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
            <div className="border-t border-border/60 px-4 py-2.5">{noAdsBlock}</div>
          ) : null}
        </section>
      ) : (
        noAdsBlock
      )}

      <ul className="space-y-0.5 text-[11px] text-muted-foreground">
        {report.footnotes.map((f) => (
          <li key={f}>{f}</li>
        ))}
      </ul>
    </div>
  )
}

/**
 * Los números del mes. Cada ficha nombra su base en la pista, porque cada una
 * sale de un conjunto distinto (todo lo invertido, lo que ya pasó, lo que tiene
 * mensajes, lo que tiene facturación). `dl`: el lector de pantalla oye rótulo,
 * valor y pista; a la vista el valor va primero con `order`.
 */
function MonthTiles({ tiles }: { tiles: ReadonlyArray<MonthMarketingTile> }) {
  return (
    <dl
      className={cn(
        'grid grid-cols-2 gap-3',
        // Con las cinco (se sumó «Resultado») en md entran de a tres y las dos
        // que sobran quedan abajo: cinco columnas en 768px parten los números.
        tiles.length >= 5
          ? 'md:grid-cols-3 xl:grid-cols-5'
          : tiles.length === 4
            ? 'md:grid-cols-4'
            : 'md:grid-cols-3',
      )}
    >
      {tiles.map((t) => (
        <div
          key={t.key}
          className="card-hairline flex min-w-0 flex-col rounded-xl border bg-card p-4"
        >
          <dt className="order-2 mt-2 text-[10px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
            {t.label}
          </dt>
          <dd
            className={cn(
              'order-1 font-serif text-2xl font-semibold leading-none tracking-tight tabular-nums',
              t.value === null && 'text-muted-foreground',
              t.value !== null && t.tone === 'warning' && 'text-warning-text',
            )}
          >
            {t.value === null ? (
              <>
                <span className="sr-only">No se puede calcular:</span>
                <span aria-hidden>—</span>
              </>
            ) : (
              <MoneyValue value={t.value} />
            )}
          </dd>
          <dd className="order-3 mt-1 text-[11px] leading-snug text-muted-foreground">{t.hint}</dd>
        </div>
      ))}
    </dl>
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
  const th = 'px-3 py-2 font-medium'
  const num = 'px-3 py-2.5 text-right align-top tabular-nums'
  // Fecha, Evento, Pauta, Mensajes, Cierre, Por reserva, Personas (+ Retorno,
  // + Resultado) + Editar.
  const columns = 8 + (showReturnColumn ? 1 : 0) + (showResultColumn ? 1 : 0)
  return (
    <table className="w-full text-sm">
      <thead>
        <tr className="border-b border-border/60 text-left text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
          <th scope="col" className={cn(th, 'pl-4')}>
            Fecha
          </th>
          <th scope="col" className={th}>
            Evento
          </th>
          <th scope="col" className={cn(th, 'text-right')}>
            Pauta
          </th>
          <th scope="col" className={cn(th, 'text-right')}>
            Mensajes
          </th>
          <th scope="col" className={cn(th, 'text-right')}>
            Cierre
          </th>
          <th scope="col" className={cn(th, 'text-right')}>
            Por reserva
          </th>
          <th scope="col" className={cn(th, 'text-right')}>
            Personas
          </th>
          {showReturnColumn ? (
            <th scope="col" className={cn(th, 'text-right')}>
              Retorno
            </th>
          ) : null}
          {showResultColumn ? (
            <th scope="col" className={cn(th, 'text-right')}>
              Resultado
            </th>
          ) : null}
          <th scope="col" className={cn(th, 'pr-4')}>
            <span className="sr-only">Editar</span>
          </th>
        </tr>
      </thead>
      <tbody className="divide-y divide-border/60">
        {rows.map((r) => {
          const open = edit.editingId === r.eventId
          return (
            <Fragment key={r.eventId}>
              <tr
                className={cn('ev-ink transition-colors', open && 'bg-secondary/40')}
                style={inkStyle(r.colorHex)}
              >
                <td className="px-3 py-2.5 pl-4 align-top">
                  <Link
                    href={dayHref(r.date)}
                    title="Ver la noche"
                    className="whitespace-nowrap font-mono text-xs tabular-nums underline-offset-4 hover:underline"
                  >
                    {r.weekdayLabel}
                  </Link>
                  {r.phaseLabel ? (
                    <div className="text-[11px] text-muted-foreground">{r.phaseLabel}</div>
                  ) : null}
                </td>
                <td className="px-3 py-2.5 align-top">
                  <span className="flex min-w-0 items-center gap-2">
                    <InkDot />
                    <span className="truncate">{r.title}</span>
                  </span>
                </td>
                <td className={cn(num, toneClass(r.cells.spend.tone))}>
                  <CellText cell={r.cells.spend} />
                </td>
                <td className={cn(num, toneClass(r.cells.messages.tone))}>
                  <CellText cell={r.cells.messages} />
                </td>
                <td className={cn(num, toneClass(r.cells.closingRate.tone))}>
                  <CellText cell={r.cells.closingRate} />
                </td>
                <td className={cn(num, toneClass(r.cells.costPerReservation.tone))}>
                  <CellText cell={r.cells.costPerReservation} />
                </td>
                <td className={cn(num, toneClass(r.cells.guests.tone))}>
                  <CellText cell={r.cells.guests} />
                </td>
                {showReturnColumn ? (
                  <td className={cn(num, toneClass(r.cells.returnPerDollar.tone))}>
                    <CellText cell={r.cells.returnPerDollar} />
                  </td>
                ) : null}
                {/* En negativo la celda dice «$ X abajo», nunca un número
                    suelto en ámbar: lo arma `buildMonthMarketingReport`. */}
                {showResultColumn ? (
                  <td className={cn(num, 'whitespace-nowrap', toneClass(r.cells.nightResult.tone))}>
                    <CellText cell={r.cells.nightResult} />
                  </td>
                ) : null}
                <td className="py-1.5 pr-3 pl-1 text-right align-top">
                  <Button
                    ref={edit.buttonRef(`table:${r.eventId}`)}
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-7 gap-1.5 text-muted-foreground hover:text-foreground aria-expanded:text-foreground"
                    aria-label={marketingCopy(r.title, r.date).editAria}
                    aria-expanded={open}
                    onClick={() => edit.onEdit(r.eventId)}
                  >
                    <Pencil className="size-3.5" aria-hidden />
                    Editar
                  </Button>
                </td>
              </tr>
              {open ? (
                <tr className="bg-secondary/40">
                  <td colSpan={columns} className="px-4 pt-1 pb-4">
                    {edit.renderEditor(r.eventId)}
                  </td>
                </tr>
              ) : null}
            </Fragment>
          )
        })}
      </tbody>
    </table>
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
    <li className={cn('ev-ink px-4 py-3', open && 'bg-secondary/40')} style={inkStyle(r.colorHex)}>
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5">
          <InkDot />
          <span className="min-w-0 truncate text-sm font-medium">{r.title}</span>
          <span className="font-mono text-xs tabular-nums text-muted-foreground">
            {r.weekdayLabel}
          </span>
          {r.phaseLabel ? (
            <span className="text-[11px] text-muted-foreground">{r.phaseLabel}</span>
          ) : null}
        </div>
        {r.cardHeadline ? (
          <div className="shrink-0 text-right">
            <div className="font-serif text-xl font-semibold leading-none tracking-tight tabular-nums">
              <MoneyValue value={r.cardHeadline} />
            </div>
            <div className="mt-1 text-[10px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
              por reserva
            </div>
          </div>
        ) : null}
      </div>
      <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">{r.cardLine}</p>
      <div className="mt-1 flex items-center justify-between gap-2">
        <Link
          href={href}
          aria-label={`Ver la noche del ${r.dayMonth}`}
          className="inline-flex min-h-10 items-center gap-1 text-xs font-medium text-muted-foreground hover:text-foreground"
        >
          Ver la noche
          <ArrowRight className="size-3.5" aria-hidden />
        </Link>
        <Button
          ref={edit.buttonRef(`card:${r.eventId}`)}
          type="button"
          variant="ghost"
          size="sm"
          className="h-10 gap-1.5 text-muted-foreground hover:text-foreground aria-expanded:text-foreground"
          aria-label={marketingCopy(r.title, r.date).editAria}
          aria-expanded={open}
          onClick={() => edit.onEdit(r.eventId)}
        >
          <Pencil className="size-3.5" aria-hidden />
          Editar
        </Button>
      </div>
      {open ? <div className="mt-2">{edit.renderEditor(r.eventId)}</div> : null}
    </li>
  )
}
