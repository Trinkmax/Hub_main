'use client'

import { Megaphone, Pencil, Plus } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { type ReactNode, useEffect, useId, useRef, useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import {
  type EventMarketingRow,
  hasNightAccount,
  loadedBeforeEventLine,
  loadedByLabel,
  type MarketingActionState,
  type MarketingBlock,
  type MarketingPhase,
  marketingStatusChip,
} from '@/lib/salon/event-marketing'
import { deleteEventMarketing, markEventWithoutAds } from '@/lib/salon/event-marketing-actions'
import {
  type KeptMarketingDraft,
  MARKETING_UNREACHABLE,
  marketingCopy,
  restoreMarkAfterFailedUndo,
} from '@/lib/salon/event-marketing-draft'
import { cn } from '@/lib/utils'
import { MarketingForm } from './marketing-form'
import { MarketingReport, OrganicNightReport } from './marketing-report'

/**
 * «Pauta en Meta» dentro de la ficha de un evento. Una máquina de estados chica:
 *
 * | Estado              | Cuándo                               |
 * |---------------------|--------------------------------------|
 * | Sin cargar (pasada) | sin fila y la fecha ya pasó          |
 * | Sin cargar (en vivo)| sin fila, hoy o futura               |
 * | No tuvo pauta       | fila con gasto 0, sin plata (ofrece «Sumar la plata de la noche») |
 * | Noche orgánica      | fila con gasto 0 y su cuenta: se lee como la pauta, sin lo de Meta |
 * | Editando            | el form abierto                      |
 * | Leyendo             | gasto > 0 (con chip Incompleta / Por ahora, y el aviso de "se cargó antes") |
 *
 * **La fila que se dibuja.** Después de guardar se muestra `res.row` al
 * instante; el `revalidatePath` de la acción trae enseguida la fila nueva por
 * props y la reemplaza. Para no parpadear entre las dos, lo local va atado a la
 * versión de props que había cuando se escribió (`propsAt`): en cuanto llega
 * otra versión, gana la del server. Nada de `useEffect` copiando props a estado.
 *
 * **«No tuvo pauta» es optimista** con Deshacer 6 s (el patrón del tablero
 * operativo): es un click, casi siempre es cierto, y equivocarse se arregla con
 * otro click. Guardar números NO es optimista (ver `marketing-form.tsx`).
 *
 * Solo dueños llegan acá: la page es owner-only y la RLS de la tabla también.
 */

const UNDO_MS = 6000

const EYEBROW = 'text-[10px] font-medium uppercase tracking-[0.14em] text-muted-foreground'

export type EventMarketingSectionProps = {
  tenantSlug: string
  scheduledEventId: string
  eventTitle: string
  /** `YYYY-MM-DD`. */
  eventDate: string
  phase: MarketingPhase
  /** La gente de la fecha. `billableGuests` es la que multiplica la plata. */
  block: MarketingBlock
  row: EventMarketingRow | null
  lastUsdArsRate: { rate: number; loadedAt: string } | null
  className?: string
}

/** Lo que se muestra en lugar de `props.row` mientras props no traiga una versión nueva. */
type LocalRow = { row: EventMarketingRow | null; propsAt: string | null }

function StatusChip({ text, tone }: { text: string; tone: 'warning' | 'muted' }) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full border px-1.5 text-[10px] font-medium leading-4',
        tone === 'warning'
          ? 'border-warning/40 bg-warning/10 text-warning-text'
          : 'border-border bg-muted/60 text-muted-foreground',
      )}
    >
      {text}
    </span>
  )
}

export function EventMarketingSection({
  tenantSlug,
  scheduledEventId,
  eventTitle,
  eventDate,
  phase,
  block,
  row: propsRow,
  lastUsdArsRate,
  className,
}: EventMarketingSectionProps) {
  const router = useRouter()
  const headingId = useId()
  const copy = marketingCopy(eventTitle, eventDate)

  const propsAt = propsRow?.updatedAt ?? null
  const [local, setLocal] = useState<LocalRow | null>(null)
  const row = local && local.propsAt === propsAt ? local.row : propsRow

  const [editing, setEditing] = useState(false)
  // Se abrió desde «Sumar la plata de la noche»: el form arranca con esa
  // sección desplegada y el foco adentro.
  const [withMoney, setWithMoney] = useState(false)
  // Lo tipeado antes de cancelar, con la versión contra la que se escribió:
  // vive mientras la ficha esté montada.
  const [draft, setDraft] = useState<KeptMarketingDraft | null>(null)
  const [busy, setBusy] = useState(false)

  // La versión de props más reciente, para lo que se resuelve DESPUÉS de un
  // await o desde un toast (sus closures ven la versión de cuando se crearon).
  const propsAtRef = useRef(propsAt)
  useEffect(() => {
    propsAtRef.current = propsAt
  }, [propsAt])

  // El botón que abre el form en el estado actual (Editar, Cargar pauta o
  // Cambiar). Al cerrar el form, o cuando el botón que se tocó desaparece, el
  // foco vuelve acá y no se pierde en el <body>.
  const actionRef = useRef<HTMLButtonElement>(null)
  const refocus = useRef(false)
  useEffect(() => {
    if (!refocus.current) return
    refocus.current = false
    actionRef.current?.focus()
  })

  const showLocal = (next: EventMarketingRow | null) =>
    setLocal({ row: next, propsAt: propsAtRef.current })

  const openForm = () => {
    setWithMoney(false)
    setEditing(true)
  }

  const openFormWithMoney = () => {
    setWithMoney(true)
    setEditing(true)
  }

  const closeForm = () => {
    refocus.current = true
    setEditing(false)
    setWithMoney(false)
  }

  const undoNoAds = async (marked: EventMarketingRow) => {
    showLocal(null)
    let res: MarketingActionState
    try {
      res = await deleteEventMarketing(tenantSlug, scheduledEventId, marked.updatedAt)
    } catch (error) {
      console.error(
        '[como-nos-fue.pauta.undoNoAds]',
        error instanceof Error ? error.message : 'sin respuesta',
      )
      res = { ok: false, code: 'error', message: MARKETING_UNREACHABLE.delete }
    }
    if (res.ok) {
      toast.success(copy.undoneToast)
      return
    }
    toast.error(res.message)
    if (restoreMarkAfterFailedUndo(res.code, propsAtRef.current, marked.updatedAt)) {
      showLocal(marked)
      return
    }
    // La marca ya no es la verdad: gana la del server, y «Cambiar» edita contra
    // la versión que de verdad está guardada.
    setLocal(null)
    if (res.code === 'stale') router.refresh()
  }

  const markNoAds = async () => {
    if (busy) return
    setBusy(true)
    // Sin refocus acá: «Cambiar» nace apagado hasta que vuelve el server y un
    // `focus()` sobre un botón apagado no hace nada. Se pide al volver.
    setLocal({
      row: {
        scheduledEventId,
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
      },
      propsAt,
    })

    let res: MarketingActionState
    try {
      res = await markEventWithoutAds(tenantSlug, scheduledEventId)
    } catch (error) {
      console.error(
        '[como-nos-fue.pauta.noAds]',
        error instanceof Error ? error.message : 'sin respuesta',
      )
      res = { ok: false, code: 'error', message: MARKETING_UNREACHABLE.noAds }
    }
    setBusy(false)

    if (!res.ok || !res.row) {
      refocus.current = true
      setLocal(null)
      toast.error(res.ok ? MARKETING_UNREACHABLE.noAds : res.message)
      if (!res.ok && res.code === 'stale') router.refresh()
      return
    }

    const marked = res.row
    // Mismo render que apaga `busy` y trae la versión: «Cambiar» ya está
    // prendido cuando corre el efecto. Solo si el foco quedó en el <body> (el
    // botón tocado se desmontó); si el dueño se fue a otro lado, no se lo roba.
    const active = document.activeElement
    if (active === null || active === document.body) refocus.current = true
    showLocal(marked)
    toast(copy.noAdsToast, {
      id: `pauta-${scheduledEventId}`,
      duration: UNDO_MS,
      action: {
        label: 'Deshacer',
        onClick: () => {
          void undoNoAds(marked)
        },
      },
    })
  }

  const shell = (children: ReactNode, labelled = true) => (
    <section
      aria-labelledby={labelled ? headingId : undefined}
      className={cn('@container mt-5 border-t border-border/50 pt-4', className)}
    >
      {children}
    </section>
  )

  const heading = (
    <h4 id={headingId} className={EYEBROW}>
      Pauta en Meta
    </h4>
  )

  // ─── Editando ───────────────────────────────────────────────────────────────
  if (editing) {
    return shell(
      <MarketingForm
        tenantSlug={tenantSlug}
        scheduledEventId={scheduledEventId}
        eventTitle={eventTitle}
        eventDate={eventDate}
        phase={phase}
        block={block}
        row={row}
        lastUsdArsRate={lastUsdArsRate}
        initialDraft={draft}
        onKeepDraft={setDraft}
        openMoney={withMoney}
        onCancel={closeForm}
        onSaved={(saved) => {
          showLocal(saved)
          setDraft(null)
          closeForm()
        }}
        onDeleted={() => {
          showLocal(null)
          setDraft(null)
          closeForm()
        }}
      />,
      false,
    )
  }

  // ─── Sin cargar ─────────────────────────────────────────────────────────────
  if (row === null) {
    if (phase === 'past') {
      return shell(
        <>
          <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
            {heading}
            <span className="text-xs font-medium text-warning-text">Sin cargar</span>
          </div>
          <div className="mt-3 grid grid-cols-2 gap-2 @sm:flex @sm:flex-wrap">
            <Button
              ref={actionRef}
              variant="outline"
              size="sm"
              className="h-10 @sm:h-8"
              aria-label={copy.loadAria}
              onClick={openForm}
              disabled={busy}
            >
              <Megaphone aria-hidden />
              Cargar pauta
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="h-10 text-muted-foreground @sm:h-8"
              aria-label={copy.noAdsAria}
              onClick={() => void markNoAds()}
              disabled={busy}
            >
              No tuvo pauta
            </Button>
          </div>
        </>,
      )
    }

    // Hoy o futura: nada está "pendiente" todavía, así que nada va en ámbar ni
    // se ofrece «No tuvo pauta» (la campaña puede arrancar mañana).
    return shell(
      <>
        {heading}
        <p className="mt-1.5 max-w-prose text-xs leading-relaxed text-muted-foreground">
          Todavía no se cargó. Si la campaña ya está corriendo, cargala y la vas actualizando.
        </p>
        <div className="mt-3 flex">
          <Button
            ref={actionRef}
            variant="outline"
            size="sm"
            className="h-10 @sm:h-8"
            aria-label={copy.loadAria}
            onClick={openForm}
          >
            <Megaphone aria-hidden />
            Cargar pauta
          </Button>
        </div>
      </>,
    )
  }

  // ─── No tuvo pauta ──────────────────────────────────────────────────────────
  if (row.adSpendUsdCents <= 0) {
    // Una fecha que todavía no pasó no "tuvo" nada: va sin pauta, por ahora.
    const noAdsLabel = phase === 'past' ? 'No tuvo pauta' : 'Sin pauta'
    // Mientras la marca optimista no vuelve del server no hay versión contra la
    // cual editar: el form haría un alta y rebotaría como stale.
    const unsaved = busy || row.updatedAt === ''

    // La noche orgánica, con su plata: se lee como una pauta cargada (firma y
    // «Editar» arriba), pero sin nada de Meta.
    if (hasNightAccount(row)) {
      return shell(
        <>
          <header className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
            <div className="flex items-baseline gap-2">
              {heading}
              <span className="text-xs text-muted-foreground">{noAdsLabel}</span>
            </div>
            <div className="flex items-baseline gap-1">
              <span className="text-[11px] tabular-nums text-muted-foreground">
                {loadedByLabel(row)}
              </span>
              <Button
                ref={actionRef}
                variant="ghost"
                size="sm"
                className="-mr-2 h-10 px-2 text-xs @sm:h-7"
                aria-label={copy.editAria}
                onClick={openForm}
                disabled={unsaved}
              >
                <Pencil aria-hidden className="size-3.5" />
                Editar
              </Button>
            </div>
          </header>
          <OrganicNightReport block={block} row={row} phase={phase} />
        </>,
      )
    }

    return shell(
      <>
        <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
          <div className="flex items-baseline gap-2">
            {heading}
            <span className="text-xs text-muted-foreground">{noAdsLabel}</span>
          </div>
          <Button
            ref={actionRef}
            variant="ghost"
            size="sm"
            className="-mr-2 h-10 px-2 text-xs @sm:h-7"
            aria-label={copy.changeAria}
            onClick={openForm}
            disabled={unsaved}
          >
            Cambiar
          </Button>
        </div>
        {/* Sin pauta la noche igual pudo dejar plata: una noche que se llenó
            sola es justo la que más interesa saber cuánto dejó. */}
        <Button
          variant="ghost"
          size="sm"
          className="-ml-2 mt-1 h-10 px-2 text-xs @sm:h-8"
          aria-label={copy.addMoneyAria}
          onClick={openFormWithMoney}
          disabled={unsaved}
        >
          <Plus aria-hidden className="size-3.5" />
          Sumar la plata de la noche
        </Button>
        {row.notes ? <OrganicNightReport block={block} row={row} phase={phase} /> : null}
      </>,
    )
  }

  // ─── Leyendo ────────────────────────────────────────────────────────────────
  const chip = marketingStatusChip(row, phase)
  const beforeLine = loadedBeforeEventLine(row, eventDate, phase)

  return shell(
    <>
      <header className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <div className="flex items-baseline gap-2">
          {heading}
          {chip ? <StatusChip text={chip.text} tone={chip.tone} /> : null}
        </div>
        <div className="flex items-baseline gap-1">
          <span className="text-[11px] tabular-nums text-muted-foreground">
            {loadedByLabel(row)}
          </span>
          <Button
            ref={actionRef}
            variant="ghost"
            size="sm"
            className="-mr-2 h-10 px-2 text-xs @sm:h-7"
            aria-label={copy.editAria}
            onClick={openForm}
          >
            <Pencil aria-hidden className="size-3.5" />
            Editar
          </Button>
        </div>
      </header>

      {beforeLine ? (
        <p className="mt-2 max-w-prose text-xs leading-relaxed text-muted-foreground">
          {beforeLine}{' '}
          <Button
            variant="link"
            className="h-auto p-0 text-xs"
            aria-label={copy.updateAria}
            onClick={openForm}
          >
            Actualizar
          </Button>
        </p>
      ) : null}

      <MarketingReport block={block} row={row} phase={phase} />
    </>,
  )
}
