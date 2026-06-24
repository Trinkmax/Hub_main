'use client'

import { X } from 'lucide-react'
import { Sheet, SheetContent, SheetTitle } from '@/components/ui/sheet'
import { useDismissOnBack } from './use-dismiss-on-back'

/**
 * Sheet full-height que muestra la wallet del cliente (pre-renderizada en el
 * server como `children`: el WalletShell). El botón de cerrar vive en una barra
 * superior fija (no scrollea ni queda recortada por la esquina redondeada).
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
        className="force-light h-[96dvh] gap-0 overflow-hidden rounded-t-3xl p-0"
        aria-describedby={undefined}
      >
        <SheetTitle className="sr-only">Mi billetera</SheetTitle>
        <div className="flex h-full flex-col bg-background">
          <div className="flex shrink-0 justify-end px-4 pb-2 pt-[max(env(safe-area-inset-top),28px)]">
            <button
              type="button"
              onClick={onClose}
              aria-label="Cerrar"
              className="flex size-9 items-center justify-center rounded-full bg-foreground/10 text-foreground/70 transition-colors hover:bg-foreground/20 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <X className="size-5" />
            </button>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto">{children}</div>
        </div>
      </SheetContent>
    </Sheet>
  )
}
