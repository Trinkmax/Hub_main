'use client'

import { Ellipsis, FilePlus2, Pencil, SkipForward, Trash2 } from 'lucide-react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useState, useTransition } from 'react'
import { toast } from 'sonner'
import { toastUndo } from '@/components/administracion/quick-actions'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { ACC_UNREACHABLE } from '@/lib/accounting/action-state'
import {
  deleteRecurringExpense,
  saveRecurringExpense,
  skipRecurringDue,
} from '@/lib/accounting/actions/master'

/**
 * Las acciones de un gasto fijo (H.7): [Cargar factura] · [Saltear este mes]
 * · [Editar] · [Eliminar]. Saltear no pregunta: avanza al próximo vencimiento
 * y deja «Deshacer» 6 s (vuelve a poner el vencimiento que había). Eliminar
 * se confirma: si ya se cargó alguna vez, sale de la lista y lo cargado queda.
 */
export function RecurringActions({
  tenantSlug,
  id,
  name,
  nextDueDate,
  updatedAt,
  pending,
  loadHref,
  editHref,
}: {
  tenantSlug: string
  id: string
  name: string
  nextDueDate: string
  updatedAt: string
  /** Vence este mes (o ya venció) y no se cargó: se puede cargar o saltear. */
  pending: boolean
  /** `null` en un gasto fijo pausado (solo se edita). */
  loadHref: string | null
  editHref: string
}) {
  const router = useRouter()
  const [busy, start] = useTransition()
  const [confirming, setConfirming] = useState(false)

  const remove = () =>
    start(async () => {
      try {
        const result = await deleteRecurringExpense(tenantSlug, {
          id,
          expectedUpdatedAt: updatedAt,
        })
        setConfirming(false)
        if (!result.ok) {
          toast.error(
            result.code === 'stale'
              ? 'Alguien cambió este gasto fijo recién. Recargá la página y probá de nuevo.'
              : result.message,
          )
          if (result.code === 'stale') router.refresh()
          return
        }
        toast.success(result.message)
        router.refresh()
      } catch {
        toast.error(ACC_UNREACHABLE.offline)
      }
    })

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
                // Si era la última cuota, saltearla lo apagó: deshacer lo vuelve a prender.
                active: true,
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
          <DropdownMenuSeparator />
          <DropdownMenuItem
            className="min-h-11 gap-2 text-destructive focus:text-destructive md:min-h-8"
            onSelect={() => setConfirming(true)}
          >
            <Trash2 className="size-4" aria-hidden />
            Eliminar
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <AlertDialog open={confirming} onOpenChange={(open) => !busy && setConfirming(open)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Eliminás «{name}»?</AlertDialogTitle>
            <AlertDialogDescription>
              Sale de la lista y deja de avisar. Las facturas y gastos que ya cargaste con él quedan
              igual.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              disabled={busy}
              onClick={(event) => {
                event.preventDefault()
                remove()
              }}
            >
              {busy ? 'Eliminando…' : 'Eliminar'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
