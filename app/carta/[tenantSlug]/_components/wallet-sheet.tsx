'use client'

import { X } from 'lucide-react'
import { Sheet, SheetContent, SheetTitle } from '@/components/ui/sheet'
import { useDismissOnBack } from './use-dismiss-on-back'

/**
 * Sheet full-height que muestra la wallet del cliente (pre-renderizada en el
 * server como `children`: el WalletShell). Se abre desde la botonera de la carta
 * cuando el cliente ya está identificado por cookie.
 */
export function WalletSheet({
  open,
  onClose,
  children,
}: {
  open: boolean
  onClose: () => void
  children: React.ReactNode
}): React.JSX.Element {
  useDismissOnBack(open, onClose)

  return (
    <Sheet open={open} onOpenChange={(o) => !o && onClose()}>
      <SheetContent
        side="bottom"
        showClose={false}
        className="h-[96dvh] gap-0 overflow-y-auto rounded-t-3xl p-0"
        aria-describedby={undefined}
      >
        <SheetTitle className="sr-only">Mi billetera</SheetTitle>
        <button
          type="button"
          onClick={onClose}
          aria-label="Cerrar"
          className="fixed right-4 top-[max(env(safe-area-inset-top),16px)] z-50 flex size-9 items-center justify-center rounded-full bg-black/55 text-white shadow-sm backdrop-blur-sm transition-colors hover:bg-black/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/70"
        >
          <X className="size-5" />
        </button>
        {children}
      </SheetContent>
    </Sheet>
  )
}
