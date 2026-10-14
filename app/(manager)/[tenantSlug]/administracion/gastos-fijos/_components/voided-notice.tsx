'use client'

import { useAccounting } from '@/components/administracion/accounting-provider'
import { Pill, StatusPill } from '@/components/administracion/kit'
import { formatDayMonth, monthOf } from '@/lib/dates'
import { monthWord, type SheetItem } from '../_lib/planilla-words'
import { useRowActions } from './use-row-actions'

/**
 * El aviso de un pago anulado. Cuando se anula (o se deshace) el último pago de
 * un gasto fijo, la base deja su vencimiento corrido al mes siguiente y nada lo
 * devuelve solo: sin este aviso, el gasto desaparece del mes sin estar pago.
 *
 * Dice qué pasó y ofrece «Volver a dejarlo pendiente», que es la misma edición
 * que ya hacía el «Deshacer» de «Saltear»: pone el vencimiento que cubría ese
 * pago (`loadedDue`) y lo deja activo. A quien solo mira, se le avisa y nada más.
 */
export function VoidedNotice({ items, canWrite }: { items: SheetItem[]; canWrite: boolean }) {
  const { tenantSlug, readOnly } = useAccounting()
  const { busy, restore } = useRowActions(tenantSlug)
  if (items.length === 0) return null

  return (
    <ul className="space-y-2">
      {items.map(({ row }) => {
        const covered = row.loadedDue ?? row.nextDueDate
        const sameMonth = monthOf(covered) === monthOf(row.nextDueDate)
        return (
          <li
            key={row.id}
            className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-xl bg-secondary/50 p-3 text-sm"
          >
            <StatusPill tone="info">Aviso</StatusPill>
            <p className="min-w-0 flex-1 basis-56 text-pretty">
              Anulaste el pago de «{row.name}» de {monthWord(monthOf(covered))} y el vencimiento
              quedó{' '}
              {sameMonth
                ? `para el ${formatDayMonth(row.nextDueDate)}`
                : `en ${monthWord(monthOf(row.nextDueDate))}`}
              .
            </p>
            {canWrite && !readOnly ? (
              <Pill size="touch" disabled={busy} onClick={() => restore(row)}>
                Volver a dejarlo pendiente
              </Pill>
            ) : null}
          </li>
        )
      })}
    </ul>
  )
}
