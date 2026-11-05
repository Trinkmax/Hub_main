'use client'

import { ChevronDown } from 'lucide-react'
import { useId, useState } from 'react'
import { Checkbox } from '@/components/ui/checkbox'
import { Label } from '@/components/ui/label'
import { cn } from '@/lib/utils'

/**
 * «Tené a mano» (diseño §5.2.1): lo que conviene juntar antes de la puesta en
 * marcha. Las casillas son solo una ayuda para quien la está leyendo: no se
 * guardan. Plegado: es para mirar una vez, no para todos los días.
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
    <details
      className={cn(
        'group/hand overflow-hidden rounded-xl border border-border/70 bg-card',
        className,
      )}
    >
      <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-3 px-3 py-2 text-sm font-semibold outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset md:pointer-fine:min-h-9 [&::-webkit-details-marker]:hidden">
        Tené a mano
        <ChevronDown
          aria-hidden
          className="size-4 text-muted-foreground transition-transform group-open/hand:rotate-180 motion-reduce:transition-none"
        />
      </summary>
      <div className="border-t border-border/70">
        <p id={`${id}-ayuda`} className="px-3 pt-2 text-xs text-muted-foreground text-pretty">
          Tildá lo que ya juntaste: es solo una ayuda, no se guarda.
        </p>
        <ul className="space-y-0.5 px-1 py-1">
          {items.map((text, index) => {
            const boxId = `${id}-${index}`
            const on = checked.has(index)
            return (
              <li
                key={text}
                className="flex items-start gap-3 rounded-md px-2 hover:bg-secondary/40"
              >
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
          className="border-t border-border/60 px-3 py-2 text-xs tabular-nums text-muted-foreground"
        >
          {count === 0
            ? `${items.length} cosas para juntar.`
            : count === items.length
              ? 'Tenés todo a mano.'
              : `${count} de ${items.length} a mano.`}
        </p>
      </div>
    </details>
  )
}
