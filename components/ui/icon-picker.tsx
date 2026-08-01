'use client'

import { Ban } from 'lucide-react'
import { CURATED_ICONS, ICON_LABELS, ICON_NAMES } from '@/components/icons/curated-lucide'
import { Label } from '@/components/ui/label'
import { cn } from '@/lib/utils'

/**
 * Selector de ícono sobre el catálogo curado.
 *
 * Reemplaza al input de texto libre que pedía "nombre de un ícono de Lucide":
 * el dueño de un bar no tiene por qué conocer la nomenclatura de una librería de
 * íconos, y si escribía cualquier otra cosa el ícono simplemente no aparecía —
 * sin error, sin aviso. Acá sólo se puede elegir lo que el renderer sabe dibujar,
 * y se ve antes de guardar.
 */
export function IconPicker({
  value,
  onChange,
  label = 'Ícono (opcional)',
  hint,
  id,
}: {
  value: string | null
  onChange: (name: string | null) => void
  label?: string
  hint?: string
  id?: string
}): React.JSX.Element {
  const groupId = id ?? 'icon-picker'

  return (
    <div className="grid gap-1.5">
      <Label htmlFor={groupId} className="text-xs text-muted-foreground">
        {label}
      </Label>
      {hint ? <p className="text-[11px] leading-snug text-muted-foreground/80">{hint}</p> : null}
      <div
        id={groupId}
        role="radiogroup"
        aria-label={label}
        className="flex flex-wrap gap-1.5 rounded-xl border border-border/70 bg-card/60 p-2"
      >
        <IconOption
          selected={!value}
          onSelect={() => onChange(null)}
          label="Sin ícono"
          glyph={<Ban className="size-4" aria-hidden />}
        />
        {ICON_NAMES.map((name) => {
          const Icon = CURATED_ICONS[name]
          if (!Icon) return null
          return (
            <IconOption
              key={name}
              selected={value === name}
              onSelect={() => onChange(name)}
              label={ICON_LABELS[name] ?? name}
              glyph={<Icon className="size-4" aria-hidden />}
            />
          )
        })}
      </div>
    </div>
  )
}

/** Target de 44px: el dueño edita el club desde la tablet, de parado. */
function IconOption({
  selected,
  onSelect,
  label,
  glyph,
}: {
  selected: boolean
  onSelect: () => void
  label: string
  glyph: React.ReactNode
}): React.JSX.Element {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      aria-label={label}
      title={label}
      onClick={onSelect}
      className={cn(
        'flex size-11 shrink-0 items-center justify-center rounded-lg border outline-none transition-colors',
        'focus-visible:ring-2 focus-visible:ring-ring',
        selected
          ? 'border-primary bg-primary text-primary-foreground shadow-sm'
          : 'border-transparent bg-secondary/50 text-muted-foreground hover:bg-secondary hover:text-foreground',
      )}
    >
      {glyph}
    </button>
  )
}
