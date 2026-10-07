'use client'

import { Eye, EyeOff, Lock } from 'lucide-react'
import { useState } from 'react'
import { Input, InputAddon, InputGroup, type InputProps } from '@/components/ui/input'

/**
 * Campo de contraseña de las pantallas de acceso: candado, el `Input` del kit
 * (toma id, name, aria-* y required del `Field` que lo envuelve) y un botón
 * para ver lo tipeado.
 *
 * El botón es enfocable (antes tenía `tabIndex={-1}` y con teclado no se podía
 * usar) y es un interruptor: etiqueta fija y `aria-pressed`, así el lector no
 * dice «Ocultar contraseña, presionado». Pegar y el gestor de contraseñas
 * siguen andando (WCAG 3.3.8): el tipo cambia, el autocompletado no.
 */
export function PasswordInput({
  size = 'lg',
  revealLabel = 'Mostrar contraseña',
  ...props
}: Omit<InputProps, 'type'> & {
  /** Nombre del botón de ver: «Mostrar contraseña», «Mostrar confirmación». */
  revealLabel?: string
}) {
  const [visible, setVisible] = useState(false)
  return (
    <InputGroup size={size}>
      <InputAddon>
        <Lock aria-hidden="true" />
      </InputAddon>
      <Input {...props} type={visible ? 'text' : 'password'} />
      <InputAddon side="end">
        <button
          type="button"
          onClick={() => setVisible((v) => !v)}
          aria-label={revealLabel}
          aria-pressed={visible}
          className="relative hit-area -me-1.5 flex size-8 items-center justify-center rounded-sm text-muted-foreground outline-offset-2 outline-(--ring) hover:bg-hover hover:text-foreground focus-visible:outline-2"
        >
          {visible ? (
            <EyeOff className="size-4" aria-hidden="true" />
          ) : (
            <Eye className="size-4" aria-hidden="true" />
          )}
        </button>
      </InputAddon>
    </InputGroup>
  )
}
