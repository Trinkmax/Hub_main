'use client'

import { Check, RotateCcw } from 'lucide-react'
import { useState, useTransition } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Field } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { updateBrandAccentAction } from '@/lib/tenant/actions'
import { cn } from '@/lib/utils'

/**
 * Colores sugeridos. Son datos (el color que elige el bar para su carta y su
 * wallet), no colores de la interfaz: por eso van en hex y con nombre, para
 * que el lector de pantalla diga algo más que el código.
 */
const PRESETS: ReadonlyArray<{ hex: string; name: string }> = [
  { hex: '#2f5d4a', name: 'Verde bosque' },
  { hex: '#b91c1c', name: 'Rojo' },
  { hex: '#c2410c', name: 'Naranja' },
  { hex: '#a16207', name: 'Mostaza' },
  { hex: '#7c3aed', name: 'Violeta' },
  { hex: '#0e7490', name: 'Petróleo' },
  { hex: '#be185d', name: 'Fucsia' },
  { hex: '#1f2937', name: 'Grafito' },
]

const DEFAULT_ACCENT = '#2f5d4a'
const HEX_RE = /^#[0-9a-fA-F]{6}$/

function contrastText(hex: string): string {
  const h = hex.replace('#', '')
  const r = Number.parseInt(h.slice(0, 2), 16)
  const g = Number.parseInt(h.slice(2, 4), 16)
  const b = Number.parseInt(h.slice(4, 6), 16)
  return (r * 299 + g * 587 + b * 114) / 1000 >= 140 ? '#0a0a0a' : '#ffffff'
}

export function BrandAccentPicker({
  tenantSlug,
  initial,
}: {
  tenantSlug: string
  initial: string | null
}) {
  const [value, setValue] = useState<string>(initial ?? DEFAULT_ACCENT)
  const [saved, setSaved] = useState<string | null>(initial)
  // El error del código aparece al salir del campo, nunca mientras se escribe.
  const [touched, setTouched] = useState(false)
  const [action, setAction] = useState<'save' | 'reset' | null>(null)
  const [pending, startTransition] = useTransition()

  const valid = HEX_RE.test(value)
  const dirty = (saved ?? '') !== (valid ? value.toLowerCase() : '')

  function save(next: string | null) {
    setAction(next ? 'save' : 'reset')
    startTransition(async () => {
      const res = await updateBrandAccentAction(tenantSlug, next)
      setAction(null)
      if (res.ok) {
        setSaved(res.brandAccent)
        if (res.brandAccent) setValue(res.brandAccent)
        toast.success(next ? 'Color guardado.' : 'Volvimos al color de HUB.')
      } else {
        toast.error(res.message)
      }
    })
  }

  return (
    <div className="flex flex-col gap-4">
      {/* Vista previa: el color elegido sobre lo que ven los clientes. */}
      <div
        className="flex items-center justify-between gap-3 rounded-lg border border-border bg-secondary px-4 py-3"
        style={valid ? { background: value, color: contrastText(value) } : undefined}
      >
        <span className="type-label">Así se ve tu color</span>
        <span className="rounded-full bg-current/15 px-3 py-1 type-caption font-semibold">
          Botón
        </span>
      </div>

      <fieldset className="min-w-0">
        <legend className="mb-2 type-label text-foreground">Sugeridos</legend>
        <div className="flex flex-wrap items-center gap-2">
          {PRESETS.map((preset) => {
            const selected = value.toLowerCase() === preset.hex
            return (
              <button
                key={preset.hex}
                type="button"
                aria-label={`${preset.name} (${preset.hex})`}
                aria-pressed={selected}
                title={preset.name}
                onClick={() => {
                  setValue(preset.hex)
                  setTouched(false)
                }}
                className={cn(
                  'relative hit-area flex size-8 items-center justify-center rounded-full',
                  'outline-offset-2 outline-(--ring) focus-visible:outline-2',
                  // Elegido: aro de tinta + check (forma, no solo color).
                  selected && 'ring-2 ring-foreground ring-offset-2 ring-offset-background',
                )}
                style={{ background: preset.hex, color: contrastText(preset.hex) }}
              >
                {selected ? <Check aria-hidden className="size-4" /> : null}
              </button>
            )
          })}
        </div>
      </fieldset>

      <Field
        label="Color propio"
        hint="Elegilo con el selector o pegá el código (tipo #2f5d4a)."
        error={touched && !valid ? 'Usá un código de color tipo #RRGGBB.' : undefined}
      >
        <div className="flex flex-wrap items-center gap-2">
          <input
            type="color"
            aria-label="Elegir con el selector de color"
            value={valid ? value : DEFAULT_ACCENT}
            onChange={(e) => {
              setValue(e.target.value)
              setTouched(false)
            }}
            className="h-(--control-md) w-12 cursor-pointer rounded-md border border-input bg-card p-1 outline-offset-2 outline-(--ring) focus-visible:outline-2"
          />
          <Input
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onBlur={() => setTouched(true)}
            placeholder={DEFAULT_ACCENT}
            autoComplete="off"
            spellCheck={false}
            className="w-32 font-mono"
          />
        </div>
      </Field>

      <div className="flex flex-wrap items-center gap-2">
        <Button
          type="button"
          onClick={() => save(value)}
          disabled={(!valid || !dirty) && action !== 'save'}
          loading={pending && action === 'save'}
          loadingText="Guardando…"
        >
          <Check aria-hidden />
          Guardar color
        </Button>
        {saved ? (
          <Button
            type="button"
            variant="ghost"
            onClick={() => save(null)}
            disabled={pending && action !== 'reset'}
            loading={pending && action === 'reset'}
          >
            <RotateCcw aria-hidden />
            Volver al de HUB
          </Button>
        ) : null}
      </div>
    </div>
  )
}
