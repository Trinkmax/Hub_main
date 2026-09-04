'use client'

import { Cake, Check, Settings2 } from 'lucide-react'
import { AnimatePresence, motion } from 'motion/react'
import Link from 'next/link'
import { useId } from 'react'
import type { CakeOptionSummary } from '@/lib/salon/types'
import { cn } from '@/lib/utils'

/**
 * El desplegable de tortas: se abre cuando la reserva dice que lleva torta.
 *
 * Por qué tarjetas y no un `<select>`: la torta la hace el bar, y quien carga la
 * reserva la está eligiendo POR TELÉFONO con el cliente del otro lado. Tiene que
 * poder leerle los tres bizcochuelos con sus rellenos de un vistazo. Un combo
 * esconde justo lo que hay que dictar.
 *
 * "Todavía no saben" es una opción de verdad, no la ausencia de una: la reserva
 * entra hoy y el sabor se decide la semana que viene. Sin ese botón, "no elegí"
 * y "eligieron y se borró" se ven igual.
 */
export function CakeOptionPicker({
  options,
  value,
  onChange,
  cakeCount,
  manageHref,
  className,
}: {
  /** El menú del bar, ya filtrado a las activas (más la elegida, si está de baja). */
  options: CakeOptionSummary[]
  value: string | null
  onChange: (id: string | null) => void
  /** Cuántas tortas trae la mesa: cambia el copy, no la elección. */
  cakeCount: number
  /** Config del catálogo. Solo se muestra si quien mira puede editarlo (dueño). */
  manageHref?: string
  className?: string
}) {
  // El hook va ANTES del early return: si no, React rompe el orden.
  const groupName = `cake-option-${useId()}`

  if (options.length === 0) {
    return (
      <div
        className={cn(
          'rounded-xl border border-dashed border-border/70 bg-card/30 p-4 text-sm',
          className,
        )}
      >
        <p className="font-medium">Todavía no cargaste el menú de tortas.</p>
        <p className="mt-0.5 text-[13px] text-muted-foreground">
          Cargá los bizcochuelos y rellenos que hace el bar y van a aparecer acá para elegir.
        </p>
        {manageHref ? (
          <Link
            href={manageHref}
            className="mt-2 inline-flex items-center gap-1.5 text-[13px] font-medium text-primary underline-offset-4 hover:underline"
          >
            <Settings2 className="size-3.5" />
            Cargar tortas
          </Link>
        ) : null}
      </div>
    )
  }

  return (
    <div className={cn('space-y-2', className)}>
      <div className="flex items-baseline justify-between gap-2">
        <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
          Qué torta va
          {/* Se elige UNA opción para la mesa. Si las dos tortas fueran de
              sabores distintos, va en el comentario de la reserva — decirlo acá
              evita que alguien crea que eligió dos y se guardó una. */}
          {cakeCount > 1 ? (
            <span className="ml-1.5 font-normal normal-case tracking-normal text-muted-foreground/80">
              · las {cakeCount} del mismo sabor
            </span>
          ) : null}
        </p>
        {manageHref ? (
          <Link
            href={manageHref}
            className="inline-flex items-center gap-1 text-[11px] text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
          >
            <Settings2 className="size-3" />
            Editar menú
          </Link>
        ) : null}
      </div>

      {/* Radios de verdad (visualmente ocultos): dan navegación con flechas y
          agrupación nativa sin reimplementar el roving tabindex a mano. */}
      <fieldset className="grid gap-2 border-0 p-0">
        <legend className="sr-only">Torta de cumpleaños</legend>
        {options.map((opt, index) => {
          const selected = value === opt.id
          return (
            <label
              key={opt.id}
              className={cn(
                'group relative flex w-full cursor-pointer items-start gap-3 rounded-xl border p-3 text-left',
                'transition-[background-color,border-color,box-shadow] duration-[var(--duration-fast)] ease-[var(--ease-out)]',
                'has-[:focus-visible]:ring-[3px] has-[:focus-visible]:ring-ring/40',
                selected
                  ? 'border-primary/60 bg-primary/[0.07] shadow-xs'
                  : 'border-border/70 bg-card/50 hover:border-border hover:bg-secondary/60',
              )}
            >
              <input
                type="radio"
                name={groupName}
                className="sr-only"
                checked={selected}
                onChange={() => onChange(opt.id)}
              />
              {/* El número es cómo la nombra el bar en la cocina: "la 2". */}
              <span
                aria-hidden
                className={cn(
                  'mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-lg font-mono text-[13px] font-semibold tabular-nums',
                  'transition-colors duration-[var(--duration-fast)]',
                  selected
                    ? 'bg-primary text-primary-foreground'
                    : 'bg-secondary text-muted-foreground group-hover:text-foreground',
                )}
              >
                {index + 1}
              </span>

              <span className="min-w-0 flex-1">
                <span className="flex flex-wrap items-baseline gap-x-2">
                  <span className="font-medium leading-snug">{opt.base}</span>
                  <span className="text-[11px] text-muted-foreground">{opt.name}</span>
                </span>
                {opt.fillings.length > 0 ? (
                  <span className="mt-1.5 flex flex-wrap gap-1">
                    {opt.fillings.map((f) => (
                      <span
                        key={f}
                        className={cn(
                          'rounded-full border px-2 py-0.5 text-[11px] leading-tight',
                          selected
                            ? 'border-primary/25 bg-background/70 text-foreground'
                            : 'border-border/60 bg-background/50 text-muted-foreground',
                        )}
                      >
                        {f}
                      </span>
                    ))}
                  </span>
                ) : null}
              </span>

              <AnimatePresence initial={false}>
                {selected ? (
                  <motion.span
                    initial={{ scale: 0.6, opacity: 0 }}
                    animate={{ scale: 1, opacity: 1 }}
                    exit={{ scale: 0.6, opacity: 0 }}
                    transition={{ duration: 0.14, ease: [0.22, 1, 0.36, 1] }}
                    className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground"
                  >
                    <Check className="size-3" aria-hidden />
                  </motion.span>
                ) : null}
              </AnimatePresence>
            </label>
          )
        })}

        <label
          className={cn(
            'flex cursor-pointer items-center gap-2 rounded-xl border border-dashed px-3 py-2 text-left text-[13px]',
            'transition-colors duration-[var(--duration-fast)] has-[:focus-visible]:ring-[3px] has-[:focus-visible]:ring-ring/40',
            value === null
              ? 'border-warning/60 bg-warning/10 text-foreground'
              : 'border-border/70 text-muted-foreground hover:bg-secondary/60 hover:text-foreground',
          )}
        >
          <input
            type="radio"
            name={groupName}
            className="sr-only"
            checked={value === null}
            onChange={() => onChange(null)}
          />
          <Cake className="size-3.5 shrink-0" aria-hidden />
          Todavía no saben cuál — lo definimos después
        </label>
      </fieldset>
    </div>
  )
}
