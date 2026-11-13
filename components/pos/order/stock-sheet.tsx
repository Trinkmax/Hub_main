'use client'

import { PackageCheck, PackageX } from 'lucide-react'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetGrabber,
  SheetTitle,
} from '@/components/ui/sheet'
import { formatCentsShort } from '@/lib/money/format'
import { posFont } from '@/lib/pos/font'
import type { MenuItem } from '@/lib/pos/types'
import { cn } from '@/lib/utils'
import { useLast } from './use-last'

/**
 * «Se terminó» / «volvió a haber». Se abre manteniendo apretado un producto de la carta (o con
 * «⋯»). Vale para esta sucursal y por hoy: mañana se levanta solo.
 */
export function StockSheet({
  item,
  onClose,
  onToggle,
}: {
  item: MenuItem | null
  onClose: () => void
  onToggle: (item: MenuItem, soldOut: boolean) => void
}) {
  const shown = useLast(item)
  return (
    <Sheet open={item !== null} onOpenChange={(next) => !next && onClose()}>
      <SheetContent
        side="bottom"
        showClose={false}
        className={cn('pos pos-sheet cmd-sheet', posFont.variable)}
        data-testid="stock-sheet"
      >
        <SheetGrabber />
        {shown ? (
          <div className="pos-sheet-body cmd-sheet-body">
            <div className="cmd-sheet-head">
              <SheetTitle className="pos-sheet-title cmd-sheet-title">{shown.name}</SheetTitle>
              <SheetDescription className="cmd-sheet-sub is-ink">
                {shown.sold_out
                  ? 'Está marcado agotado: hoy nadie lo puede pedir en esta sucursal.'
                  : `${formatCentsShort(shown.price_cents)} · Si se terminó, marcalo: deja de poder pedirse en todos los celulares y mañana vuelve solo.`}
              </SheetDescription>
            </div>
            <div className="cmd-sheet-foot">
              <button
                type="button"
                className="pos-btn pos-btn-primary"
                onClick={() => {
                  onToggle(shown, !shown.sold_out)
                  onClose()
                }}
                data-testid="stock-toggle"
              >
                {shown.sold_out ? (
                  <PackageCheck className="size-5" aria-hidden />
                ) : (
                  <PackageX className="size-5" aria-hidden />
                )}
                {shown.sold_out ? 'Volvió a haber' : 'Marcar agotado hoy'}
              </button>
            </div>
          </div>
        ) : null}
      </SheetContent>
    </Sheet>
  )
}
