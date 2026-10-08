'use client'

import { ChevronDown } from 'lucide-react'
import { useId, useState } from 'react'
import type { OnboardingHowTo } from '@/lib/accounting/onboarding'
import { cn } from '@/lib/utils'
import { HowToFor } from './how-to-slot'

/**
 * «Cómo se hace» de un ítem de «Cómo arrancar»: los pasos numerados, el
 * ejemplo concreto y, si el ítem es subir un archivo, la mini guía «¿Cómo lo
 * bajo?». Plegable con el mismo botón que «Otros saldos» de la puesta en
 * marcha (`aria-expanded`, 44 px). Los pasos quedan en la página aunque esté
 * cerrado (`hidden`); la mini guía, con sus maquetas, se arma recién la
 * primera vez que se abre (la página tiene cinco y casi nunca se abren todas).
 */
export function HowSteps({
  steps,
  example,
  howTo,
  defaultOpen = false,
}: {
  steps: readonly string[]
  example: string | null
  howTo?: OnboardingHowTo
  defaultOpen?: boolean
}) {
  const [open, setOpen] = useState(defaultOpen)
  const [opened, setOpened] = useState(defaultOpen)
  const panelId = `${useId()}-como`

  return (
    <div className="rounded-lg border border-border/60">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => {
          setOpen((v) => !v)
          setOpened(true)
        }}
        className="flex min-h-11 w-full items-center justify-between gap-3 rounded-lg px-3 py-2 text-left text-sm font-medium outline-none transition-colors hover:bg-secondary/40 focus-visible:ring-2 focus-visible:ring-ring"
      >
        <span>
          Cómo se hace{' '}
          <span className="font-normal text-muted-foreground">
            · {steps.length} {steps.length === 1 ? 'paso' : 'pasos'}
          </span>
        </span>
        <ChevronDown
          aria-hidden="true"
          className={cn(
            'size-4 shrink-0 text-muted-foreground transition-transform',
            open && 'rotate-180',
          )}
        />
      </button>
      <div id={panelId} hidden={!open} className="space-y-3 border-t border-border/60 px-3 py-3">
        <ol className="space-y-2.5">
          {steps.map((step, index) => (
            <li key={step} className="flex items-start gap-2.5">
              <span
                aria-hidden="true"
                className="mt-px flex size-5 shrink-0 items-center justify-center rounded-full bg-secondary text-[11px] font-semibold tabular-nums text-muted-foreground"
              >
                {index + 1}
              </span>
              <span className="min-w-0 text-sm text-foreground text-pretty">{step}</span>
            </li>
          ))}
        </ol>
        {example ? (
          <p className="rounded-md border border-border/50 bg-cream-tint px-3 py-2 text-sm text-foreground text-pretty">
            {example}
          </p>
        ) : null}
        {howTo && opened ? <HowToFor source={howTo} /> : null}
      </div>
    </div>
  )
}
