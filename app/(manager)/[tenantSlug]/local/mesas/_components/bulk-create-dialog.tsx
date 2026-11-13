'use client'

import { Minus, Plus } from 'lucide-react'
import { useState, useTransition } from 'react'
import { toast } from 'sonner'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { bulkCreateTablesAction } from '@/lib/floor-plan/actions'
import { cn } from '@/lib/utils'
import {
  BanquetteGlyph,
  LongTableGlyph,
  RoundTableGlyph,
  TableGlyph,
  TablesGridGlyph,
} from './glyphs'
import { PAPEL } from './papel'

type Preset = 'round' | 'square' | 'rect' | 'banquette'

const PRESETS: {
  value: Preset
  label: string
  Glyph: (props: { className?: string }) => React.ReactNode
}[] = [
  { value: 'square', label: 'Cuadrada', Glyph: TableGlyph },
  { value: 'round', label: 'Redonda', Glyph: RoundTableGlyph },
  { value: 'rect', label: 'Larga', Glyph: LongTableGlyph },
  { value: 'banquette', label: 'Banquette', Glyph: BanquetteGlyph },
]

const clamp = (n: number, min: number, max: number) => Math.max(min, Math.min(max, n))

function Counter({
  label,
  value,
  unit,
  min,
  max,
  onChange,
}: {
  label: string
  value: number
  unit: string
  min: number
  max: number
  onChange: (next: number) => void
}) {
  return (
    <div className="fpe-field">
      <span className="fpe-label">{label}</span>
      <div className="fpe-stepper">
        <button
          type="button"
          aria-label={`${label}: uno menos`}
          disabled={value <= min}
          onClick={() => onChange(clamp(value - 1, min, max))}
        >
          <Minus aria-hidden />
        </button>
        <output aria-live="polite" aria-label={`${label}: ${value} ${unit}`}>
          {value}
        </output>
        <button
          type="button"
          aria-label={`${label}: uno más`}
          disabled={value >= max}
          onClick={() => onChange(clamp(value + 1, min, max))}
        >
          <Plus aria-hidden />
        </button>
      </div>
    </div>
  )
}

/**
 * «Varias mesas»: arma una tanda de mesas iguales, numeradas, debajo de lo que
 * ya está dibujado. Es una ventanita pegada a su pieza de la paleta (no un
 * diálogo): son tres datos y no hace falta frenar al dueño para pedírselos.
 */
export function BulkCreateDialog({
  slug,
  areaId,
  areaName,
  onCreated,
}: {
  slug: string
  areaId: string
  areaName: string
  onCreated: () => void
}) {
  const [open, setOpen] = useState(false)
  const [count, setCount] = useState(6)
  const [capacity, setCapacity] = useState(4)
  const [preset, setPreset] = useState<Preset>('square')
  const [pending, start] = useTransition()

  const submit = () => {
    start(async () => {
      const r = await bulkCreateTablesAction(slug, {
        area_id: areaId,
        count,
        capacity,
        preset,
      })
      if (r.ok) {
        toast.success(
          r.data.created === 1
            ? `Listo: 1 mesa nueva en ${areaName}.`
            : `Listo: ${r.data.created} mesas nuevas en ${areaName}.`,
        )
        setOpen(false)
        onCreated()
      } else {
        toast.error(r.message)
      }
    })
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="fpe-tool"
          title="Varias mesas iguales de una vez"
          aria-label="Agregar varias mesas"
        >
          <TablesGridGlyph />
          Varias
        </button>
      </PopoverTrigger>
      <PopoverContent side="right" align="start" sideOffset={10} className={cn(PAPEL, 'fpe-pop')}>
        <form
          className="fpe-form"
          onSubmit={(e) => {
            e.preventDefault()
            submit()
          }}
        >
          <div className="fpe-field">
            <h2 className="fpe-pop-title">Varias mesas de una</h2>
            <p className="fpe-hint">
              Quedan en fila debajo de lo que ya dibujaste, numeradas. Después las acomodás
              arrastrando.
            </p>
          </div>

          <div className="fpe-row fpe-row-split">
            <Counter
              label="Cuántas"
              unit="mesas"
              value={count}
              min={1}
              max={50}
              onChange={setCount}
            />
            <Counter
              label="Lugares en cada una"
              unit="lugares"
              value={capacity}
              min={1}
              max={50}
              onChange={setCapacity}
            />
          </div>

          <fieldset className="fpe-field" style={{ border: 0, margin: 0, padding: 0 }}>
            <legend className="fpe-label" style={{ padding: 0, marginBottom: '0.3rem' }}>
              Forma
            </legend>
            <div className="fpe-shapes" data-cols="4">
              {PRESETS.map(({ value, label, Glyph }) => (
                <button
                  key={value}
                  type="button"
                  className="fpe-shape"
                  aria-pressed={preset === value}
                  onClick={() => setPreset(value)}
                >
                  <Glyph />
                  {label}
                </button>
              ))}
            </div>
          </fieldset>

          <button
            type="submit"
            className="fpe-btn fpe-btn-primary fpe-btn-block"
            disabled={pending}
          >
            {pending ? 'Creando…' : count === 1 ? 'Crear 1 mesa' : `Crear ${count} mesas`}
          </button>
        </form>
      </PopoverContent>
    </Popover>
  )
}
