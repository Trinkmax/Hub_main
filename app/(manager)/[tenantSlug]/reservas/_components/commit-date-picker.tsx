'use client'

import { useRef } from 'react'
import { DatePicker, type DatePickerProps } from '@/components/ui/date-picker'

/**
 * El `DatePicker` del kit para los filtros que NAVEGAN al cambiar la fecha (el
 * día de la lista, el «Desde / Hasta» de los filtros).
 *
 * El `onValueChange` del kit avisa apenas el texto es una fecha válida, y
 * tipeando «15/10» pasa por «1/1» (el 1 de enero): si eso navegara, la lista
 * saltaba de mes en mitad del tipeo. Acá:
 * - **tipeando**, la fecha queda pendiente y se aplica al salir del campo o
 *   con Enter;
 * - **eligiendo en el calendario** (o con «Hoy»), se aplica en el momento.
 *
 * Se distinguen por el foco: mientras se tipea, el foco está en el campo;
 * al elegir en el calendario, está en la grilla.
 *
 * TODO(kit): si el `DatePicker` suma un `onCommit`, este envoltorio sobra.
 */
export function CommitDatePicker({
  onCommit,
  onBlur,
  onKeyDown,
  inputRef: externalInputRef,
  ...props
}: Omit<DatePickerProps, 'onValueChange'> & {
  /** La fecha que eligió la persona (`yyyy-MM-dd`), o `null` si borró el campo. */
  onCommit: (iso: string | null) => void
}) {
  const inputRef = useRef<HTMLInputElement | null>(null)
  // `undefined`: nada pendiente. `null`: borró el campo y todavía no salió.
  const pending = useRef<string | null | undefined>(undefined)

  function flush() {
    if (pending.current === undefined) return
    const next = pending.current
    pending.current = undefined
    onCommit(next)
  }

  return (
    <DatePicker
      {...props}
      inputRef={(node) => {
        inputRef.current = node
        if (typeof externalInputRef === 'function') externalInputRef(node)
        else if (externalInputRef) externalInputRef.current = node
      }}
      onValueChange={(iso) => {
        const typing =
          typeof document !== 'undefined' && document.activeElement === inputRef.current
        if (typing) pending.current = iso
        else {
          pending.current = undefined
          onCommit(iso)
        }
      }}
      onBlur={(event) => {
        onBlur?.(event)
        flush()
      }}
      onKeyDown={(event) => {
        onKeyDown?.(event)
        if (event.defaultPrevented || event.key !== 'Enter' || pending.current === undefined) return
        event.preventDefault()
        flush()
      }}
    />
  )
}
