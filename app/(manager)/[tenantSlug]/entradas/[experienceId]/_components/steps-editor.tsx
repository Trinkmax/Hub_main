'use client'

import { ArrowDown, ArrowUp, Plus, Trash2 } from 'lucide-react'
import { useFieldArray, useFormContext, useWatch } from 'react-hook-form'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import type { ExperienceFormInput } from '@/lib/ticketing/schemas'
import { MAX_STEPS } from '../../_lib/experience-form'
import { CharCount, describedBy, Field } from './form-bits'

const EMPTY_STEP = { icon: '', title: '', description: '', label: '' }

/** «Paso 03» */
function stepNumber(index: number): string {
  return `Paso ${String(index + 1).padStart(2, '0')}`
}

/**
 * El menú paso a paso: un paso por escena (ícono, nombre, qué se sirve y un
 * rótulo opcional como «Final · Postre»). Se ordena con las flechas; quitar un
 * paso deja «Deshacer» en el aviso, y nada se guarda hasta «Guardar».
 */
export function StepsEditor() {
  const {
    control,
    register,
    getValues,
    formState: { errors },
  } = useFormContext<ExperienceFormInput>()
  const { fields, append, remove, move, insert } = useFieldArray({ control, name: 'steps' })
  const steps = useWatch({ control, name: 'steps' })
  const full = fields.length >= MAX_STEPS
  const listError = errors.steps?.message ?? errors.steps?.root?.message

  function removeStep(index: number) {
    const removed = getValues(`steps.${index}`)
    remove(index)
    toast('Paso quitado.', {
      description: removed.title ? `«${removed.title}»` : undefined,
      action: { label: 'Deshacer', onClick: () => insert(index, removed) },
    })
  }

  return (
    <div className="space-y-3">
      {fields.length === 0 ? (
        <p className="rounded-xl border border-dashed border-border/80 bg-card/50 px-4 py-6 text-center text-sm text-muted-foreground text-pretty">
          Todavía no cargaste el menú. Sumá un paso por cada momento de la película; si todavía se
          está armando, dejá una nota abajo y se muestra eso.
        </p>
      ) : (
        <ol className="space-y-3">
          {fields.map((field, index) => {
            const label = steps?.[index]?.label?.trim()
            const title = steps?.[index]?.title?.trim()
            const stepErrors = errors.steps?.[index]
            const base = `steps-${index}`
            const name = title ? `el paso «${title}»` : `el ${stepNumber(index).toLowerCase()}`
            return (
              <li
                key={field.id}
                className="rounded-xl border border-border/70 bg-background/60 p-3 sm:p-4"
              >
                <div className="mb-3 flex items-center justify-between gap-2">
                  <span className="text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
                    {label || stepNumber(index)}
                  </span>
                  <div className="flex items-center gap-1">
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="size-11 sm:size-9"
                      aria-label={`Subir ${name}`}
                      disabled={index === 0}
                      onClick={() => move(index, index - 1)}
                    >
                      <ArrowUp className="size-4" aria-hidden />
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="size-11 sm:size-9"
                      aria-label={`Bajar ${name}`}
                      disabled={index === fields.length - 1}
                      onClick={() => move(index, index + 1)}
                    >
                      <ArrowDown className="size-4" aria-hidden />
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="size-11 text-muted-foreground hover:text-destructive sm:size-9"
                      aria-label={`Quitar ${name}`}
                      onClick={() => removeStep(index)}
                    >
                      <Trash2 className="size-4" aria-hidden />
                    </Button>
                  </div>
                </div>

                <div className="grid gap-3 sm:grid-cols-[5rem_minmax(0,1fr)]">
                  <Field id={`${base}-icon`} label="Ícono" error={stepErrors?.icon?.message}>
                    <Input
                      id={`${base}-icon`}
                      maxLength={8}
                      placeholder="🍿"
                      autoComplete="off"
                      className="h-11 text-center text-xl md:text-xl"
                      aria-invalid={stepErrors?.icon ? true : undefined}
                      aria-describedby={describedBy(`${base}-icon`, { error: !!stepErrors?.icon })}
                      defaultValue={field.icon ?? ''}
                      {...register(`steps.${index}.icon`)}
                    />
                  </Field>
                  <Field
                    id={`${base}-title`}
                    label="Nombre del paso"
                    required
                    error={stepErrors?.title?.message}
                  >
                    <Input
                      id={`${base}-title`}
                      maxLength={60}
                      placeholder="Cajita medieval"
                      className="h-11"
                      aria-required
                      aria-invalid={stepErrors?.title ? true : undefined}
                      aria-describedby={describedBy(`${base}-title`, {
                        error: !!stepErrors?.title,
                      })}
                      defaultValue={field.title ?? ''}
                      {...register(`steps.${index}.title`)}
                    />
                  </Field>
                </div>

                <Field
                  id={`${base}-description`}
                  label="Qué se sirve"
                  optional
                  className="mt-3"
                  error={stepErrors?.description?.message}
                  counter={<CharCount value={steps?.[index]?.description} max={240} />}
                >
                  <Textarea
                    id={`${base}-description`}
                    rows={2}
                    maxLength={240}
                    placeholder="Papas con cheddar y verdeo, como las del castillo de Lord Farquaad."
                    aria-invalid={stepErrors?.description ? true : undefined}
                    aria-describedby={describedBy(`${base}-description`, {
                      error: !!stepErrors?.description,
                    })}
                    defaultValue={field.description ?? ''}
                    {...register(`steps.${index}.description`)}
                  />
                </Field>

                <Field
                  id={`${base}-label`}
                  label="Rótulo"
                  optional
                  className="mt-3 sm:max-w-xs"
                  hint={`Sin rótulo se lee «${stepNumber(index)}».`}
                  error={stepErrors?.label?.message}
                >
                  <Input
                    id={`${base}-label`}
                    maxLength={24}
                    placeholder="Final · Postre"
                    className="h-11"
                    aria-invalid={stepErrors?.label ? true : undefined}
                    aria-describedby={describedBy(`${base}-label`, {
                      hint: true,
                      error: !!stepErrors?.label,
                    })}
                    defaultValue={field.label ?? ''}
                    {...register(`steps.${index}.label`)}
                  />
                </Field>
              </li>
            )
          })}
        </ol>
      )}

      {listError ? (
        <p role="alert" className="text-xs text-destructive">
          {listError}
        </p>
      ) : null}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <Button
          type="button"
          variant="outline"
          className="h-11 sm:h-9"
          disabled={full}
          onClick={() => append(EMPTY_STEP, { focusName: `steps.${fields.length}.title` })}
        >
          <Plus className="size-4" aria-hidden />
          Agregar paso
        </Button>
        <span className="text-xs text-muted-foreground tabular-nums">
          {full ? `Llegaste al máximo: ${MAX_STEPS} pasos.` : `${fields.length} de ${MAX_STEPS}`}
        </span>
      </div>
    </div>
  )
}
