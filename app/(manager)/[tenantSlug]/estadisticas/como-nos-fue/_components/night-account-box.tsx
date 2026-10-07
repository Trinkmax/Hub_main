'use client'

import { Calculator, Pencil } from 'lucide-react'
import { type Ref, useId } from 'react'
import { Button } from '@/components/ui/button'
import {
  type EventMarketingRow,
  NIGHT_ACCOUNT_ACTION_LABELS,
  NIGHT_ACCOUNT_TITLE,
  type NightAccountView,
  nightHowItsCalculated,
} from '@/lib/salon/event-marketing'
import { marketingCopy } from '@/lib/salon/event-marketing-draft'
import { cn } from '@/lib/utils'
import { HowItsCalculated, NightAccountBody } from './marketing-report'

/**
 * «La cuenta de la noche», SIEMPRE, en toda ficha de evento (C2 de los socios,
 * 02/10/2026: «es ideal que siempre tenga la misma info»). Va debajo de la
 * sección «Pauta en Meta», con la misma anatomía en todos los estados:
 *
 *   ┌ LA CUENTA DE LA NOCHE  [estado]                 [botón] ┐
 *   │ frase (sin nada calculado)  ·  o la cuenta de siempre   │
 *   │ ▸ ¿Cómo se calcula?                                     │
 *   └─────────────────────────────────────────────────────────┘
 *
 * El estado, los textos y el botón salen de `nightAccountView` (regla 13 de
 * `event-marketing.ts`); el botón abre el MISMO formulario de la pauta con «la
 * plata de la noche» desplegada (lo maneja `EventMarketingSection`, que dibuja
 * las dos secciones). El indicador copia al de «Pauta en Meta»: «Sin cargar» en
 * ámbar suelto; «Incompleta» y «Por ahora» como chip.
 */

const EYEBROW = 'text-[10px] font-medium uppercase tracking-[0.14em] text-muted-foreground'

function Indicator({ chip }: { chip: NonNullable<NightAccountView['chip']> }) {
  if (chip.text === 'Sin cargar') {
    return <span className="text-xs font-medium text-warning-text">{chip.text}</span>
  }
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full border px-1.5 text-[10px] font-medium leading-4',
        chip.tone === 'warning'
          ? 'border-warning/40 bg-warning/10 text-warning-text'
          : 'border-border bg-muted/60 text-muted-foreground',
      )}
    >
      {chip.text}
    </span>
  )
}

export function NightAccountBox({
  view,
  row,
  eventTitle,
  eventDate,
  onAction,
  actionRef,
  disabled = false,
  className,
}: {
  view: NightAccountView
  /** La fila de pauta tal cual (o `null`): los bullets de «¿Cómo se calcula?» dependen de ella. */
  row: EventMarketingRow | null
  eventTitle: string
  /** `YYYY-MM-DD`. */
  eventDate: string
  /** Abre el formulario de la fecha con la plata desplegada. */
  onAction: () => void
  /** El foco vuelve acá al cerrar el formulario, si se abrió desde esta caja. */
  actionRef?: Ref<HTMLButtonElement>
  /** Mientras la marca «No tuvo pauta» espera al server no hay versión contra la cual editar. */
  disabled?: boolean
  className?: string
}) {
  const headingId = useId()
  const kind = view.action
  const ariaLabel = kind ? marketingCopy(eventTitle, eventDate).nightAria[kind] : undefined

  return (
    <section
      aria-labelledby={headingId}
      className={cn(
        '@container mt-4 rounded-lg border border-border/60 bg-secondary/30 p-3 @md:p-4',
        className,
      )}
    >
      <header className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
        <div className="flex items-baseline gap-2">
          <h4 id={headingId} className={EYEBROW}>
            {NIGHT_ACCOUNT_TITLE}
          </h4>
          {view.chip ? <Indicator chip={view.chip} /> : null}
        </div>
        {kind === 'edit' ? (
          <Button
            ref={actionRef}
            type="button"
            variant="ghost"
            size="sm"
            className="-mr-2 h-10 px-2 text-xs @sm:h-7"
            aria-label={ariaLabel}
            onClick={onAction}
            disabled={disabled}
          >
            <Pencil aria-hidden className="size-3.5" />
            {NIGHT_ACCOUNT_ACTION_LABELS.edit}
          </Button>
        ) : kind ? (
          <Button
            ref={actionRef}
            type="button"
            variant="outline"
            size="sm"
            className="h-10 @sm:h-8"
            aria-label={ariaLabel}
            onClick={onAction}
            disabled={disabled}
          >
            <Calculator aria-hidden />
            {NIGHT_ACCOUNT_ACTION_LABELS[kind]}
          </Button>
        ) : null}
      </header>

      {view.lead ? (
        <p className="mt-1.5 max-w-prose text-sm leading-relaxed text-muted-foreground">
          {view.lead}
        </p>
      ) : null}

      {view.report ? <NightAccountBody night={view.report} /> : null}

      {/* Sin gente no hay nada que explicar: no hay cuenta posible. */}
      {view.status === 'sin-gente' ? null : (
        <HowItsCalculated bullets={nightHowItsCalculated(row)} />
      )}
    </section>
  )
}
