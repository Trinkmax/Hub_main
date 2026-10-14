'use client'

import type { FormEvent, ReactNode } from 'react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Callout } from './form-bits'

/**
 * Alta o edición chica de Ajustes: el `Dialog` del panel con su formulario,
 * «Guardando…» mientras corre y el error del servidor arriba de los botones.
 * No se cierra mientras guarda.
 *
 * Habla el idioma de las hojas de carga: el título en Fraunces, las preguntas
 * del cuerpo separadas por aire, y un solo botón primario (48 px y a todo el
 * ancho en el celular). El cuerpo se desliza adentro; el pie queda a la vista.
 */
export function EditDialog({
  open,
  onOpenChange,
  title,
  description,
  pending,
  submitLabel = 'Guardar',
  message,
  onSubmit,
  children,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  description?: ReactNode
  pending: boolean
  submitLabel?: string
  /** Error general (el de cada campo va en su campo). */
  message?: string | null
  onSubmit: () => void
  children: ReactNode
}) {
  const submit = (event: FormEvent) => {
    event.preventDefault()
    event.stopPropagation()
    if (!pending) onSubmit()
  }
  return (
    <Dialog open={open} onOpenChange={(next) => (pending ? undefined : onOpenChange(next))}>
      <DialogContent
        className="flex max-h-[88vh] flex-col gap-0 overflow-hidden p-0 sm:max-w-lg"
        // Si lo primero es un grupo de opciones, el foco va a la elegida: si no, quedan dos
        // tarjetas resaltadas (la enfocada y la marcada) y no se entiende cuál vale.
        onOpenAutoFocus={(event) => {
          const root = event.currentTarget
          if (!(root instanceof HTMLElement)) return
          const first = root.querySelector('form input, form textarea, form select, form button')
          if (!(first instanceof HTMLInputElement) || first.type !== 'radio' || first.checked)
            return
          const checked = [
            ...root.querySelectorAll<HTMLInputElement>('form input[type="radio"]'),
          ].find((radio) => radio.name === first.name && radio.checked)
          if (!checked) return
          event.preventDefault()
          checked.focus()
        }}
      >
        <DialogHeader className="shrink-0 px-5 pt-5 pb-3 pr-12 sm:px-6 sm:pt-6">
          <DialogTitle className="font-serif text-xl leading-snug font-semibold tracking-tight text-balance">
            {title}
          </DialogTitle>
          {description ? (
            <DialogDescription className="text-pretty">{description}</DialogDescription>
          ) : null}
        </DialogHeader>
        <form onSubmit={submit} noValidate className="flex min-h-0 flex-1 flex-col">
          <div className="grid min-h-0 flex-1 content-start gap-5 overflow-y-auto px-5 pt-1 pb-5 sm:px-6">
            {children}
            {message ? <Callout tone="error">{message}</Callout> : null}
          </div>
          <DialogFooter className="shrink-0 gap-2 border-t border-border/60 bg-card/80 px-5 pt-3 pb-[calc(env(safe-area-inset-bottom)+0.75rem)] sm:px-6 sm:pb-4">
            <Button
              type="button"
              variant="ghost"
              className="h-11"
              disabled={pending}
              onClick={() => onOpenChange(false)}
            >
              Cancelar
            </Button>
            <Button
              type="submit"
              className="h-12 min-w-[160px] text-base sm:h-11 sm:text-sm"
              disabled={pending}
            >
              {pending ? 'Guardando…' : submitLabel}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
