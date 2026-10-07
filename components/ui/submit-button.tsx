'use client'

import type * as React from 'react'
import { useFormStatus } from 'react-dom'
import { Button, type ButtonProps } from '@/components/ui/button'

export type SubmitButtonProps = Omit<ButtonProps, 'type' | 'loading' | 'loadingText'> & {
  /** Reemplaza la etiqueta mientras se envía («Guardando…»). */
  pendingText?: string
}

/** Mientras el formulario se envía por el OTRO botón, este no reacciona. */
function preventClick(event: React.MouseEvent<HTMLButtonElement>) {
  event.preventDefault()
}

/**
 * El «Guardar» de un formulario con Server Action (§3.1): `useFormStatus()`
 * pone el spinner solo, sin cablear `pending` a mano en cada formulario.
 *
 * **Dos botones de guardar** («Guardar» y «Guardar y pagar»): cada uno lleva
 * `name="intent"` y su `value`. El spinner aparece solo en el que se tocó
 * (React arma el FormData con el botón que envió) y el otro queda
 * `aria-disabled` y sin reaccionar mientras dura el envío. La acción lee
 * `intent` del FormData.
 */
function SubmitButton({ pendingText, name, value, onClick, ...props }: SubmitButtonProps) {
  const { pending, data } = useFormStatus()
  const isIntent = name !== undefined && value !== undefined
  // Sin name/value, cualquier envío del formulario es «el mío».
  const mine = pending && (!isIntent || data?.get(name) === String(value))
  const otherBusy = pending && !mine

  return (
    <Button
      {...props}
      type="submit"
      name={name}
      value={value}
      loading={mine}
      loadingText={pendingText}
      aria-disabled={otherBusy ? true : props['aria-disabled']}
      onClick={otherBusy ? preventClick : onClick}
    />
  )
}

export { SubmitButton }
