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
 * Alta o edición chica (admin-ui §1 «Diálogos»): el `Dialog` del panel con su
 * formulario, «Guardando…» mientras corre y el error del servidor arriba de
 * los botones. No se cierra mientras guarda.
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
      <DialogContent className="max-h-[88vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="font-serif">{title}</DialogTitle>
          {description ? <DialogDescription>{description}</DialogDescription> : null}
        </DialogHeader>
        <form onSubmit={submit} noValidate className="grid gap-4">
          {children}
          {message ? <Callout tone="error">{message}</Callout> : null}
          <DialogFooter>
            <Button
              type="button"
              variant="ghost"
              className="h-11 md:h-9"
              disabled={pending}
              onClick={() => onOpenChange(false)}
            >
              Cancelar
            </Button>
            <Button type="submit" className="h-11 min-w-[140px] md:h-9" disabled={pending}>
              {pending ? 'Guardando…' : submitLabel}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
