'use client'

import { CircleDot } from 'lucide-react'
import { EmptyState } from '@/components/ui/empty-state'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
import type { SalonTableRow } from '@/lib/sessions-waiter/queries'

export function ManualActivateSheet({
  open,
  onOpenChange,
  freeTables,
  onSelect,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  freeTables: SalonTableRow[]
  onSelect: (physicalTableId: string, label: string) => void
}) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="bottom" className="h-[70vh] gap-0 p-0">
        <SheetHeader className="px-6 pt-6">
          <SheetTitle className="font-serif">Activar mesa</SheetTitle>
          <SheetDescription>Elegí qué mesa querés activar.</SheetDescription>
        </SheetHeader>

        <div className="flex-1 overflow-y-auto px-6 py-4">
          {freeTables.length === 0 ? (
            <EmptyState
              title="No hay mesas libres"
              description="Todas las mesas están ocupadas. Liberá una mesa antes de activar otra."
            />
          ) : (
            <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              {freeTables.map((t) => (
                <li key={t.physical_table_id}>
                  <button
                    type="button"
                    onClick={() => onSelect(t.physical_table_id, t.label)}
                    className="card-hairline flex aspect-square w-full flex-col items-center justify-center rounded-xl border border-border/70 bg-card/85 p-3 text-center transition-[transform,box-shadow,background-color] duration-[var(--duration-base)] ease-[var(--ease-out)] hover:-translate-y-0.5 hover:bg-card hover:shadow-md"
                  >
                    <CircleDot className="mb-2 size-5 text-muted-foreground" aria-hidden />
                    <span className="font-serif text-lg font-semibold">{t.label}</span>
                    {t.capacity ? (
                      <span className="mt-1 text-xs text-muted-foreground">~{t.capacity} pax</span>
                    ) : null}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </SheetContent>
    </Sheet>
  )
}
