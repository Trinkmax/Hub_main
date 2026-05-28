'use client'

import { Minus, Plus, Users } from 'lucide-react'
import { Button } from '@/components/ui/button'

export function PartySizeStepper({
  value,
  onChange,
  min = 1,
  max = 100,
}: {
  value: number
  onChange: (next: number) => void
  min?: number
  max?: number
}) {
  const dec = () => onChange(Math.max(min, value - 1))
  const inc = () => onChange(Math.min(max, value + 1))

  return (
    <div className="flex flex-col items-center gap-2">
      <div className="flex items-center gap-1.5 text-xs uppercase tracking-wider text-muted-foreground">
        <Users className="size-3.5" aria-hidden />
        Comensales
      </div>
      <div className="flex items-center gap-3">
        <Button
          type="button"
          variant="outline"
          size="icon"
          onClick={dec}
          disabled={value <= min}
          aria-label="Restar comensal"
          className="size-12 rounded-full"
        >
          <Minus className="size-5" aria-hidden />
        </Button>
        <span
          className="min-w-[3.5rem] text-center font-serif text-5xl font-semibold tabular-nums"
          aria-live="polite"
        >
          {value}
        </span>
        <Button
          type="button"
          variant="outline"
          size="icon"
          onClick={inc}
          disabled={value >= max}
          aria-label="Sumar comensal"
          className="size-12 rounded-full"
        >
          <Plus className="size-5" aria-hidden />
        </Button>
      </div>
    </div>
  )
}
