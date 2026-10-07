'use client'

import { Ban } from 'lucide-react'
import { RadioGroup as RadioGroupPrimitive } from 'radix-ui'
import type * as React from 'react'
import { CURATED_ICONS, ICON_LABELS, ICON_NAMES } from '@/components/icons/curated-lucide'
import { useField, useFieldControl } from '@/components/ui/field'
import { Label } from '@/components/ui/label'
import { cn } from '@/lib/utils'

/** «Sin ícono» necesita un valor de radio: Radix no admite `null`. Nunca sale del componente. */
const NONE = '__none__'

export type IconPickerProps = Omit<
  React.ComponentProps<typeof RadioGroupPrimitive.Root>,
  | 'value'
  | 'defaultValue'
  | 'onValueChange'
  | 'onChange'
  | 'children'
  | 'name'
  | 'id'
  | 'disabled'
  | 'orientation'
  | 'dir'
  | 'loop'
> & {
  value: string | null
  onChange: (name: string | null) => void
  /** Suelto lo dibuja el picker; adentro de un `Field`, la etiqueta la pone el Field. */
  label?: string
  /** Idem: suelto lo dibuja el picker, adentro de un `Field` va como `hint` del Field. */
  hint?: string
  id?: string
  /** Con `name`, el valor viaja en un `<input type="hidden">` (vacío = sin ícono). */
  name?: string
  disabled?: boolean
  className?: string
}

/**
 * Selector de ícono sobre el catálogo curado (§3.2).
 *
 * Reemplaza al input de texto libre que pedía "nombre de un ícono de Lucide":
 * el dueño de un bar no tiene por qué conocer la nomenclatura de una librería
 * de íconos, y si escribía cualquier otra cosa el ícono simplemente no
 * aparecía, sin error ni aviso. Acá solo se puede elegir lo que el renderer
 * sabe dibujar, y se ve antes de guardar.
 *
 * Es un RadioGroup de Radix (antes tenía `role="radio"` pero no respondía a
 * las flechas): Tab entra al elegido y las flechas recorren la grilla.
 * Opciones de 44 px (el dueño edita el club desde la tablet, de parado); la
 * elegida, en verde lleno.
 */
export function IconPicker({
  value,
  onChange,
  label = 'Ícono (opcional)',
  hint,
  id,
  name,
  disabled,
  className,
  ...props
}: IconPickerProps): React.JSX.Element {
  const field = useField()
  const control = useFieldControl({
    id,
    name,
    disabled,
    'aria-describedby': props['aria-describedby'],
  })
  const groupLabelId = `${control.id}-label`
  const hintId = hint && !field ? `${control.id}-hint` : undefined

  const group = (
    <RadioGroupPrimitive.Root
      data-slot="icon-picker"
      // data-tour, aria-* y compañía van al grupo: es el control, con o sin Field.
      {...props}
      id={control.id}
      value={value ?? NONE}
      onValueChange={(next) => onChange(next === NONE ? null : next)}
      disabled={control.disabled}
      aria-labelledby={props['aria-labelledby'] ?? (field ? field.labelId : groupLabelId)}
      // Suelto: su ayuda + lo propio. En un Field, control ya trae ayuda y error del Field.
      aria-describedby={
        [hintId, control['aria-describedby']].filter(Boolean).join(' ') || undefined
      }
      aria-invalid={control['aria-invalid']}
      className={cn(
        'flex flex-wrap gap-1.5 rounded-lg border border-border bg-card p-2',
        'aria-invalid:border-destructive',
        className,
      )}
    >
      <IconOption value={NONE} label="Sin ícono" glyph={<Ban className="size-4" aria-hidden />} />
      {ICON_NAMES.map((iconName) => {
        const Icon = CURATED_ICONS[iconName]
        if (!Icon) return null
        return (
          <IconOption
            key={iconName}
            value={iconName}
            label={ICON_LABELS[iconName] ?? iconName}
            glyph={<Icon className="size-4" aria-hidden />}
          />
        )
      })}
    </RadioGroupPrimitive.Root>
  )

  const hidden = control.name ? (
    <input type="hidden" name={control.name} value={value ?? ''} disabled={control.disabled} />
  ) : null

  // Adentro de un Field: etiqueta, ayuda y error los dibuja el Field.
  if (field) {
    return (
      <>
        {group}
        {hidden}
      </>
    )
  }

  return (
    <div className="grid gap-2">
      <Label id={groupLabelId} htmlFor={control.id}>
        {label}
      </Label>
      {hint ? (
        <p id={hintId} className="-mt-1 type-caption text-pretty text-subtle-foreground">
          {hint}
        </p>
      ) : null}
      {group}
      {hidden}
    </div>
  )
}

/** 44 px, `rounded-md`; la elegida en `bg-primary text-primary-foreground`. */
function IconOption({
  value,
  label,
  glyph,
}: {
  value: string
  label: string
  glyph: React.ReactNode
}): React.JSX.Element {
  return (
    <RadioGroupPrimitive.Item
      value={value}
      aria-label={label}
      title={label}
      className={cn(
        'flex size-11 shrink-0 items-center justify-center rounded-md text-muted-foreground',
        'transition-colors duration-(--duration-quick) hover:bg-hover hover:text-foreground',
        'outline-offset-2 outline-(--ring) focus-visible:outline-2',
        'data-[state=checked]:bg-primary data-[state=checked]:text-primary-foreground',
        'disabled:cursor-not-allowed disabled:opacity-50',
      )}
    >
      {glyph}
    </RadioGroupPrimitive.Item>
  )
}
