'use client'

import { Minus, Plus, Users } from 'lucide-react'
import { useEffect, useState } from 'react'
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
  // Buffer local para que el usuario pueda borrar el número y tipear otro sin
  // que se clampee mid-edit. Sincronizamos al value externo cuando cambia.
  const [draft, setDraft] = useState(String(value))
  useEffect(() => {
    setDraft(String(value))
  }, [value])

  const clamp = (n: number) => Math.max(min, Math.min(max, n))
  const dec = () => onChange(clamp(value - 1))
  const inc = () => onChange(clamp(value + 1))

  const commit = (raw: string) => {
    const n = Number.parseInt(raw, 10)
    if (Number.isFinite(n)) {
      onChange(clamp(n))
    } else {
      setDraft(String(value))
    }
  }

  return (
    <div className="flex flex-col items-center gap-2">
      <label
        htmlFor="party-size-input"
        className="flex items-center gap-1.5 text-xs uppercase tracking-wider text-muted-foreground"
      >
        <Users className="size-3.5" aria-hidden />
        Comensales
      </label>
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
        <input
          id="party-size-input"
          type="text"
          inputMode="numeric"
          pattern="[0-9]*"
          min={min}
          max={max}
          value={draft}
          onChange={(e) => {
            const next = e.target.value.replace(/[^0-9]/g, '')
            setDraft(next)
          }}
          onBlur={(e) => commit(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              ;(e.target as HTMLInputElement).blur()
            }
          }}
          onFocus={(e) => e.target.select()}
          aria-label="Cantidad de comensales"
          className="w-20 bg-transparent text-center font-serif text-5xl font-semibold tabular-nums outline-none focus-visible:underline focus-visible:decoration-primary/60 focus-visible:decoration-2 focus-visible:underline-offset-8"
        />
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
