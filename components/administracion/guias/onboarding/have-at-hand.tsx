'use client'

import { useId, useState } from 'react'
import { Checkbox } from '@/components/ui/checkbox'
import { Label } from '@/components/ui/label'
import { cn } from '@/lib/utils'

/**
 * «Tené a mano» (diseño §5.2.1): lo que conviene juntar antes del Día 1. Las
 * casillas son solo una ayuda para quien la está leyendo: no se guardan.
 */
export function HaveAtHand({ items, className }: { items: readonly string[]; className?: string }) {
  const [checked, setChecked] = useState<ReadonlySet<number>>(() => new Set())
  const id = useId()
  const count = checked.size

  const toggle = (index: number, on: boolean) => {
    setChecked((prev) => {
      const next = new Set(prev)
      if (on) next.add(index)
      else next.delete(index)
      return next
    })
  }

  return (
    <section
      aria-labelledby={`${id}-titulo`}
      className={cn('card-hairline overflow-hidden rounded-xl border bg-card', className)}
    >
      <header className="space-y-0.5 border-b border-border/60 px-5 py-4">
        <h2 id={`${id}-titulo`} className="font-serif text-lg font-semibold tracking-tight">
          Tené a mano
        </h2>
        <p className="text-xs text-muted-foreground text-pretty">
          Para el Día 1. Tildá lo que ya juntaste: es solo una ayuda, no se guarda.
        </p>
      </header>
      <ul className="space-y-0.5 px-3 py-2">
        {items.map((text, index) => {
          const boxId = `${id}-${index}`
          const on = checked.has(index)
          return (
            <li key={text} className="flex items-start gap-3 rounded-md px-2 hover:bg-secondary/40">
              <Checkbox
                id={boxId}
                checked={on}
                onCheckedChange={(value) => toggle(index, value === true)}
                className="mt-3.5"
              />
              <Label
                htmlFor={boxId}
                className={cn(
                  'min-h-11 flex-1 cursor-pointer py-3 font-normal leading-snug text-pretty',
                  on && 'text-muted-foreground line-through',
                )}
              >
                {text}
              </Label>
            </li>
          )
        })}
      </ul>
      <p
        aria-live="polite"
        className="border-t border-border/60 px-5 py-3 text-xs tabular-nums text-muted-foreground"
      >
        {count === 0
          ? `${items.length} cosas para juntar.`
          : count === items.length
            ? 'Tenés todo a mano.'
            : `${count} de ${items.length} a mano.`}
      </p>
    </section>
  )
}
