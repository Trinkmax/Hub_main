'use client'

import { Ellipsis, FilePlus2, Pencil, SkipForward } from 'lucide-react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useTransition } from 'react'
import { toast } from 'sonner'
import { toastUndo } from '@/components/administracion/quick-actions'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { ACC_UNREACHABLE } from '@/lib/accounting/action-state'
import { saveRecurringExpense, skipRecurringDue } from '@/lib/accounting/actions/master'

/**
 * Las acciones de un gasto fijo (H.7): [Cargar factura] · [Saltear este mes]
 * · [Editar]. Saltear no pregunta: avanza al próximo vencimiento y deja
 * «Deshacer» 6 s (vuelve a poner el vencimiento que había).
 */
export function RecurringActions({
  tenantSlug,
  id,
  name,
  nextDueDate,
  pending,
  loadHref,
  editHref,
}: {
  tenantSlug: string
  id: string
  name: string
  nextDueDate: string
  /** Vence este mes (o ya venció) y no se cargó: se puede cargar o saltear. */
  pending: boolean
  /** `null` en un gasto fijo pausado (solo se edita). */
  loadHref: string | null
  editHref: string
}) {
  const router = useRouter()
  const [busy, start] = useTransition()

  const skip = () =>
    start(async () => {
      try {
        const result = await skipRecurringDue(tenantSlug, { id, dueDate: nextDueDate })
        if (!result.ok) {
          toast.error(result.message)
          if (result.code === 'stale') router.refresh()
          return
        }
        const saved = result.data
        router.refresh()
        toastUndo(`«${name}» salteado este mes`, {
          description: result.message,
          onUndo: async () => {
            try {
              const undone = await saveRecurringExpense(tenantSlug, {
                id: saved.id,
                expectedUpdatedAt: saved.updatedAt,
                name: saved.name,
                partyId: saved.partyId,
                accountId: saved.accountId,
                voucherType: saved.voucherType,
                vatRateBp: saved.vatRateBp,
                amountCents: saved.amountCents,
                frequency: saved.frequency,
                dueDay: saved.dueDay,
                nextDueDate,
                remindDaysBefore: saved.remindDaysBefore,
                treasuryAccountId: saved.treasuryAccountId,
                active: saved.active,
                notes: saved.notes,
              })
              if (undone.ok) {
                toast.success('Listo: volvió a quedar pendiente.')
                router.refresh()
              } else {
                toast.error(undone.message)
              }
            } catch {
              toast.error(ACC_UNREACHABLE.offline)
            }
          },
        })
      } catch {
        toast.error(ACC_UNREACHABLE.offline)
      }
    })

  return (
    <div className="flex items-center justify-end gap-2">
      {pending && loadHref ? (
        <Button asChild size="sm" className="h-11 gap-1.5 md:h-8">
          <Link href={loadHref}>
            <FilePlus2 className="size-3.5" aria-hidden />
            Cargar factura
          </Link>
        </Button>
      ) : null}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            type="button"
            variant="outline"
            size="icon"
            className="size-11 md:size-8"
            aria-label={`Más acciones de ${name}`}
            disabled={busy}
          >
            <Ellipsis className="size-4" aria-hidden />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-56">
          {pending ? (
            <DropdownMenuItem className="min-h-11 gap-2 md:min-h-8" onSelect={skip}>
              <SkipForward className="size-4" aria-hidden />
              Saltear este vencimiento
            </DropdownMenuItem>
          ) : loadHref ? (
            <DropdownMenuItem asChild className="min-h-11 gap-2 md:min-h-8">
              <Link href={loadHref}>
                <FilePlus2 className="size-4" aria-hidden />
                Cargar factura
              </Link>
            </DropdownMenuItem>
          ) : null}
          <DropdownMenuItem asChild className="min-h-11 gap-2 md:min-h-8">
            <Link href={editHref}>
              <Pencil className="size-4" aria-hidden />
              Editar
            </Link>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  )
}
