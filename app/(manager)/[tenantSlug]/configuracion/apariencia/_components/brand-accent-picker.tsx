'use client'

import { Check, RotateCcw } from 'lucide-react'
import { useState, useTransition } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { updateBrandAccentAction } from '@/lib/tenant/actions'
import { cn } from '@/lib/utils'

const PRESETS = [
  '#2f5d4a',
  '#b91c1c',
  '#c2410c',
  '#a16207',
  '#7c3aed',
  '#0e7490',
  '#be185d',
  '#1f2937',
]

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
  const [value, setValue] = useState<string>(initial ?? '#2f5d4a')
  const [saved, setSaved] = useState<string | null>(initial)
  const [pending, startTransition] = useTransition()

  const valid = HEX_RE.test(value)
  const dirty = (saved ?? '') !== (valid ? value.toLowerCase() : '')

  function save(next: string | null) {
    startTransition(async () => {
      const res = await updateBrandAccentAction(tenantSlug, next)
      if (res.ok) {
        setSaved(res.brandAccent)
        if (res.brandAccent) setValue(res.brandAccent)
        toast.success(next ? 'Acento guardado' : 'Acento restablecido')
      } else {
        toast.error(res.message)
      }
    })
  }

  return (
    <div className="space-y-4">
      {/* Preview */}
      <div
        className="flex items-center justify-between rounded-xl border border-border/70 px-4 py-3"
        style={valid ? { background: value, color: contrastText(value) } : undefined}
      >
        <span className="text-sm font-medium">Así se ve tu acento</span>
        <span className="rounded-full bg-black/10 px-3 py-1 text-xs font-semibold">Botón</span>
      </div>

      {/* Presets */}
      <div className="flex flex-wrap items-center gap-2">
        {PRESETS.map((preset) => (
          <button
            key={preset}
            type="button"
            aria-label={`Elegir ${preset}`}
            onClick={() => setValue(preset)}
            className={cn(
              'size-8 rounded-full ring-2 ring-offset-2 ring-offset-background transition-transform hover:scale-110',
              value.toLowerCase() === preset ? 'ring-foreground' : 'ring-transparent',
            )}
            style={{ background: preset }}
          />
        ))}
      </div>

      {/* Custom + acciones */}
      <div className="flex flex-wrap items-center gap-2">
        <input
          type="color"
          aria-label="Color personalizado"
          value={valid ? value : '#2f5d4a'}
          onChange={(e) => setValue(e.target.value)}
          className="h-9 w-12 cursor-pointer rounded-md border border-border/70 bg-transparent p-1"
        />
        <Input
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="#2f5d4a"
          aria-invalid={!valid}
          className="w-32 font-mono"
        />
        <Button
          onClick={() => save(value)}
          disabled={!valid || !dirty || pending}
          className="gap-1.5"
        >
          <Check className="size-4" />
          Guardar
        </Button>
        {saved ? (
          <Button
            variant="ghost"
            onClick={() => save(null)}
            disabled={pending}
            className="gap-1.5 text-muted-foreground"
          >
            <RotateCcw className="size-4" />
            Quitar
          </Button>
        ) : null}
      </div>
      {!valid ? <p className="text-xs text-destructive">Usá un color hex tipo #RRGGBB.</p> : null}
    </div>
  )
}
