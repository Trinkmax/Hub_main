'use client'

import { CheckCircle2 } from 'lucide-react'
import type { ReactNode } from 'react'
import { Button } from '@/components/ui/button'

export function OrderConfirmation({
  children,
  onClose,
}: {
  children?: ReactNode
  onClose: () => void
}) {
  return (
    <div className="fixed inset-0 z-50 overflow-y-auto bg-app-gradient">
      <div className="mx-auto flex min-h-[100dvh] max-w-md flex-col items-center px-4 py-10">
        <div className="flex size-16 items-center justify-center rounded-full bg-success/15 text-success">
          <CheckCircle2 className="size-8" />
        </div>
        <h1 className="mt-4 text-center font-serif text-2xl font-semibold tracking-tight">
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
