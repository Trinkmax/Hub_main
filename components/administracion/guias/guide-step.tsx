'use client'

import { ArrowRight, ChevronDown, CircleCheck, CircleHelp } from 'lucide-react'
import { type ReactNode, useState } from 'react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import type { GuideStepStatus } from './arca-guide-model'
import { stepToggleId, useGuideNav } from './guide-nav'
import { GUIDE_STATUS_TEXT_CLASS, GuideStatusDot } from './guide-status'

/**
 * Un paso de una guía, en acordeón (diseño §5.1.1, «Anatomía de un paso»):
 *
 * - encabezado: el número con el color del estado, el título, el estado en texto («Te toca»,
 *   «Hecho el 08/10 por Ana»…) y las etiquetas de dónde se hace y cuánto lleva;
 * - cuerpo: los bloques «Para qué · Qué vas a ver · Qué tocás · Qué te traés · Chequeá que… ·
 *   Si algo sale mal» (los arma quien lo usa con `GuideBlock`, `StepScreens`, `GuideChecklist`
 *   y `GuideTroubles`);
 * - pie: cómo se decide el estado, el botón «Ya lo hice» si corresponde y «Siguiente paso».
 *
 * Accesibilidad: `section` con `aria-labelledby`, el encabezado es un `button` con
 * `aria-expanded`, el estado se dice con texto y todo anda con el teclado.
 *
 * Lo usan también las recetas del día a día, que no son pasos numerados ni se marcan: por eso
 * `kicker` (en lugar de «Paso N»), `lead` (un ícono en lugar del número), `statusLine` (el estado
 * ya armado, con su píldora) y un pie con otro rótulo (`footerLabel`) o sin texto. Sin esas props
 * se ve igual que siempre.
 */
export function GuideStep({
  id,
  anchor,
  n,
  title,
  status,
  statusText,
  note,
  chips,
  problem,
  footerHow,
  footerLabel = 'Cómo se marca:',
  footerAction,
  next,
  kicker,
  lead,
  statusLine,
  className,
  defaultOpen = false,
  children,
}: {
  id: string
  /** `paso-6`: el `id` de la sección (y el `#` de los links). */
  anchor: string
  n: number
  title: string
  status: GuideStepStatus
  /** El estado en palabras, con el color de `status`. Hace falta si no hay `statusLine`. */
  statusText?: string
  /** «Hecho el 08/10 por Ana», «Lo confirmamos al probar»… */
  note?: string | null
  /** Las etiquetas de la derecha: dónde se hace y cuánto lleva. */
  chips?: ReactNode
  /** El aviso de «Revisar» o «No anduvo», arriba del cuerpo. */
  problem?: ReactNode
  /** «Se marca solo cuando…». Sin texto, el pie lleva solo los botones (si hay). */
  footerHow?: ReactNode
  /** El rótulo en negrita del pie. */
  footerLabel?: string
  /** «Ya lo hice», si el paso se marca a mano. */
  footerAction?: ReactNode
  next?: { readonly id: string; readonly anchor: string; readonly label: string } | null
  /** La línea chica de arriba del título. Por defecto, «Paso N». */
  kicker?: ReactNode
  /** Lo que va a la izquierda en lugar del número con su estado (un ícono, por ejemplo). */
  lead?: ReactNode
  /** El estado ya armado (una píldora y su detalle), en lugar de `statusText` con su color. */
  statusLine?: ReactNode
  /** Para la sección: otro margen de salto, otro borde. */
  className?: string
  /** Sin `GuideNavProvider`: si arranca abierto. */
  defaultOpen?: boolean
  children: ReactNode
}) {
  const nav = useGuideNav()
  const [localOpen, setLocalOpen] = useState(defaultOpen)
  const open = nav ? nav.isOpen(id) : localOpen
  const toggle = () => (nav ? nav.setOpen(id, !open) : setLocalOpen(!open))
  const titleId = `${anchor}-nombre`
  const bodyId = `${anchor}-contenido`

  return (
    <section
      id={anchor}
      aria-labelledby={titleId}
      className={cn(
        'card-hairline scroll-mt-36 rounded-xl border bg-card lg:scroll-mt-20',
        status === 'todo' && 'border-primary/40',
        status === 'failed' && 'border-destructive/40',
        status === 'check' && 'border-warning/50',
        className,
      )}
    >
      <h2 className="m-0">
        <button
          id={stepToggleId(anchor)}
          type="button"
          aria-expanded={open}
          aria-controls={bodyId}
          onClick={toggle}
          className="flex w-full items-start gap-3 rounded-xl px-4 py-4 text-left outline-none transition-colors hover:bg-cream-tint/60 focus-visible:ring-2 focus-visible:ring-ring sm:px-5"
        >
          {lead ?? <GuideStatusDot status={status} n={n} />}
          <span className="min-w-0 flex-1">
            <span className="flex flex-wrap items-baseline gap-x-2">
              <span className="text-xs font-medium tabular-nums text-muted-foreground">
                {kicker ?? `Paso ${n}`}
              </span>
            </span>
            <span
              id={titleId}
              className="block font-serif text-lg font-semibold leading-snug tracking-tight text-pretty"
            >
              {title}
            </span>
            <span className="mt-1 flex flex-wrap items-center gap-x-1.5 gap-y-1 text-xs">
              {statusLine ?? (
                <span className={cn('font-medium', GUIDE_STATUS_TEXT_CLASS[status])}>
                  {statusText}
                </span>
              )}
              {note ? <span className="text-muted-foreground">· {note}</span> : null}
            </span>
            {chips ? (
              <span className="mt-2 flex flex-wrap items-center gap-1.5 md:hidden">{chips}</span>
            ) : null}
          </span>
          {chips ? (
            <span className="hidden shrink-0 flex-wrap items-center justify-end gap-1.5 md:flex md:max-w-[15rem]">
              {chips}
            </span>
          ) : null}
          <ChevronDown
            className={cn(
              'mt-2 size-4 shrink-0 text-muted-foreground transition-transform duration-200 motion-reduce:transition-none',
              open && 'rotate-180',
            )}
            aria-hidden
          />
        </button>
      </h2>
      <div id={bodyId} hidden={!open} className="border-t border-border/60">
        <div className="space-y-6 px-4 py-5 sm:px-5">
          {problem}
          {children}
        </div>
        {footerHow || footerAction || next ? (
          <footer className="flex flex-col gap-3 border-t border-border/60 px-4 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-5">
            {footerHow ? (
              <p className="text-xs text-muted-foreground text-pretty">
                <span className="font-medium text-foreground">{footerLabel}</span> {footerHow}
              </p>
            ) : (
              <span aria-hidden="true" />
            )}
            <div className="flex flex-col gap-2 sm:shrink-0 sm:flex-row sm:items-center">
              {footerAction}
              {next ? (
                <Button asChild variant="outline" className="h-11 gap-2 md:h-9">
                  <a
                    href={`#${next.anchor}`}
                    onClick={(event) => {
                      if (!nav) return
                      event.preventDefault()
                      nav.reveal(next.id)
                    }}
                  >
                    {next.label}
                    <ArrowRight className="size-4" aria-hidden />
                  </a>
                </Button>
              ) : null}
            </div>
          </footer>
        ) : null}
      </div>
    </section>
  )
}

/** Un bloque del cuerpo de un paso («Para qué», «Qué tocás»…). */
export function GuideBlock({
  label,
  children,
  className,
}: {
  label: string
  children: ReactNode
  className?: string
}) {
  return (
    <div className={cn('space-y-2', className)}>
      <h3 className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
        {label}
      </h3>
      <div className="space-y-3 text-sm leading-relaxed text-pretty">{children}</div>
    </div>
  )
}

/** «Chequeá que…»: lo que tiene que verse en ARCA antes de seguir. */
export function GuideChecklist({ items }: { items: readonly ReactNode[] }) {
  return (
    <GuideBlock label="Chequeá que…">
      <ul className="space-y-2">
        {items.map((item, i) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: lista fija de textos de un paso
          <li key={i} className="flex items-start gap-2.5">
            <CircleCheck className="mt-0.5 size-4 shrink-0 text-success" aria-hidden />
            <span className="min-w-0">{item}</span>
          </li>
        ))}
      </ul>
    </GuideBlock>
  )
}

/** «Si algo sale mal»: cada problema se abre con su arreglo. */
export function GuideTroubles({
  items,
  label = 'Si algo sale mal',
}: {
  items: ReadonlyArray<{ readonly problem: string; readonly fix: ReactNode }>
  label?: string
}) {
  return (
    <GuideBlock label={label}>
      <ul className="divide-y divide-border/60 rounded-lg border border-border/80">
        {items.map((item) => (
          <li key={item.problem}>
            <details className="group/trouble">
              <summary className="flex min-h-11 cursor-pointer list-none items-center gap-2.5 rounded-lg px-3 py-2.5 text-sm font-medium outline-none hover:bg-cream-tint/60 focus-visible:ring-2 focus-visible:ring-ring [&::-webkit-details-marker]:hidden">
                <CircleHelp className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                <span className="min-w-0 flex-1 text-pretty">{item.problem}</span>
                <ChevronDown
                  className="size-4 shrink-0 text-muted-foreground transition-transform group-open/trouble:rotate-180 motion-reduce:transition-none"
                  aria-hidden
                />
              </summary>
              <div className="px-3 pb-3 pl-[2.375rem] text-sm text-muted-foreground text-pretty">
                {item.fix}
              </div>
            </details>
          </li>
        ))}
      </ul>
    </GuideBlock>
  )
}

/** Una etiqueta chica del encabezado («En ARCA», «≈ 3 min»). */
export function GuideChip({ icon, children }: { icon?: ReactNode; children: ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1 whitespace-nowrap rounded-full border border-border bg-background/60 px-2 py-0.5 text-[11px] font-medium text-muted-foreground [&_svg]:size-3">
      {icon}
      {children}
    </span>
  )
}
