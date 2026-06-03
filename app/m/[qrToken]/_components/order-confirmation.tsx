'use client'

import { CheckCircle2 } from 'lucide-react'
import { type ReactNode, useEffect, useRef } from 'react'
import { Button } from '@/components/ui/button'

export function OrderConfirmation({
  children,
  onClose,
}: {
  children?: ReactNode
  onClose: () => void
}) {
  const ref = useRef<HTMLDivElement>(null)
  // Overlay propio (no Radix): movemos el foco al diálogo al montarse para que
  // los lectores de pantalla lo anuncien y el teclado entre al contenido.
  useEffect(() => {
    ref.current?.focus()
  }, [])

  return (
    <div
      ref={ref}
      role="dialog"
      aria-modal="true"
      aria-labelledby="order-confirm-title"
      tabIndex={-1}
      className="fixed inset-0 z-50 overflow-y-auto bg-app-gradient outline-none"
    >
      <div className="mx-auto flex min-h-[100dvh] max-w-md flex-col items-center px-4 py-10">
        <div className="flex size-16 items-center justify-center rounded-full bg-success/15 text-success">
          <CheckCircle2 className="size-8" aria-hidden />
        </div>
        <h1
          id="order-confirm-title"
          className="mt-4 text-center font-serif text-2xl font-semibold tracking-tight"
        >
          ¡Pedido enviado!
        </h1>
        <p className="mt-1 text-center text-sm text-muted-foreground">
          El mozo lo va a confirmar en un momento.
        </p>

        {children && <div className="mt-6 w-full">{children}</div>}

        <Button variant="outline" onClick={onClose} className="mt-6 h-12 w-full rounded-xl">
          Seguir pidiendo
        </Button>
      </div>
    </div>
  )
}
