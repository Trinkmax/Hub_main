'use client'

import { Banknote, Trash2 } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { type ReactNode, useEffect, useRef, useState, useTransition } from 'react'
import { toast } from 'sonner'
import { useBranchScope } from '@/components/branches/branch-scope-provider'
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
import { ACC_UNREACHABLE } from '@/lib/accounting/action-state'
import { dismissPosCash } from '@/lib/accounting/actions/pos-cash'
import { periodWords } from '@/lib/accounting/payroll'
import {
  POS_CASH_PURPOSE_LABELS,
  type PosCashPending,
  posCashCountWords,
  posCashNote,
  posCashTotalCents,
  posCashWho,
} from '@/lib/accounting/pos-cash'
import { formatDayMonth } from '@/lib/dates'
import { formatCentsShort } from '@/lib/money'
import { cn } from '@/lib/utils'

const QUIET_BUTTON =
  'inline-flex min-h-8 cursor-pointer items-center rounded-sm text-sm font-medium text-muted-foreground underline-offset-4 outline-none hover:text-foreground hover:underline focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50 pointer-coarse:min-h-11'

/** Lo que se lee en gris al lado del nombre: qué fue, lo que se escribió en la caja, dónde y quién. */
function detailOf(item: PosCashPending, showBranch: boolean): string {
  return [
    item.purpose === 'supplier' ? null : POS_CASH_PURPOSE_LABELS[item.purpose],
    item.purpose === 'supplier' ? null : periodWords(item.periodFrom, item.periodTo),
    posCashNote(item),
    showBranch ? item.branchName : null,
    item.byName ? `lo anotó ${item.byName}` : null,
  ]
    .filter((part): part is string => Boolean(part))
    .join(' · ')
}

/** «$ 50.000 de adelanto de sueldo a Martina Ríos, del 22/11» */
function sentenceOf(item: PosCashPending): string {
  const what =
    item.purpose === 'supplier'
      ? `para ${posCashWho(item)}`
      : `de ${POS_CASH_PURPOSE_LABELS[item.purpose].toLowerCase()} a ${posCashWho(item)}`
  return `${formatCentsShort(item.amountCents)} ${what}, del ${formatDayMonth(item.date)}`
}

/**
 * La bandeja «De la caja del salón»: los retiros que alguien anotó en la caja diciendo para qué eran y
 * que todavía no tienen comprobante. Va arriba de la planilla del tema (los de proveedores, en Compras;
 * los del personal, en Sueldos) y solo cuando hay alguno.
 *
 * No carga nada sola. Cada renglón abre el formulario de siempre ya completo (`actions`) o se descarta
 * («no va a los libros», con confirmación). Cuando el comprobante queda guardado, el renglón se va.
 */
export function PosCashTray({
  tenantSlug,
  items,
  note,
  highlightId = null,
  actions,
}: {
  tenantSlug: string
  items: readonly PosCashPending[]
  /** Al lado del título: qué falta hacer con esto. */
  /** Al lado del título: qué falta hacer con esto (en singular o plural, según cuántos son). */
  note: string
  /** El retiro al que se llegó por un link (desde la caja del salón): se marca y se trae a la vista. */
  highlightId?: string | null
  /** Lo que se hace con cada retiro, además de descartarlo. */
  actions: (item: PosCashPending) => ReactNode
}) {
  const router = useRouter()
  const multi = useBranchScope()?.scope.multi ?? false
  const [dismissing, setDismissing] = useState<PosCashPending | null>(null)
  const [pending, start] = useTransition()
  const highlightRef = useRef<HTMLLIElement>(null)

  useEffect(() => {
    if (!highlightId) return
    highlightRef.current?.scrollIntoView({ block: 'center' })
  }, [highlightId])

  if (items.length === 0) return null

  const dismiss = (item: PosCashPending) =>
    start(async () => {
      try {
        const result = await dismissPosCash(tenantSlug, { movementId: item.id })
        if (!result.ok) {
          toast.error(result.message)
          return
        }
        toast.success(result.message)
        setDismissing(null)
        router.refresh()
      } catch {
        toast.error(ACC_UNREACHABLE.offline)
      }
    })

  return (
    <section
      aria-label="De la caja del salón"
      className="overflow-hidden rounded-xl border border-warning/40 bg-warning/[0.07] shadow-xs"
    >
      <header className="flex flex-wrap items-baseline gap-x-2.5 gap-y-0.5 px-3 pt-2.5 pb-1.5">
        <h2 className="inline-flex items-center gap-1.5 text-sm font-semibold">
          <Banknote aria-hidden className="size-4 self-center text-warning-text" />
          De la caja del salón
        </h2>
        <p className="text-sm text-muted-foreground">
          {posCashCountWords(items.length)} ·{' '}
          <span className="font-medium text-foreground tabular-nums">
            {formatCentsShort(posCashTotalCents(items))}
          </span>{' '}
          · {note}
        </p>
      </header>
      <ul className="divide-y divide-dashed divide-warning/40 border-t border-dashed border-warning/40">
        {items.map((item) => {
          const highlighted = item.id === highlightId
          const detail = detailOf(item, multi)
          return (
            <li
              key={item.id}
              ref={highlighted ? highlightRef : undefined}
              data-highlight={highlighted ? 'true' : undefined}
              className={cn(
                'grid grid-cols-[2.75rem_minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1 px-3 py-2 text-sm sm:grid-cols-[2.75rem_minmax(0,1fr)_auto_auto] sm:py-1.5',
                highlighted && 'bg-warning/15 ring-2 ring-warning/60 ring-inset',
              )}
            >
              <span className="text-muted-foreground tabular-nums">
                {formatDayMonth(item.date)}
              </span>
              {/* En la compu, nombre y detalle en un renglón; en el celular, uno abajo del otro. */}
              <span className="min-w-0 sm:flex sm:items-baseline sm:gap-2">
                <span className="block truncate font-medium sm:shrink-0">{posCashWho(item)}</span>
                {detail ? (
                  <span className="block truncate text-xs text-muted-foreground sm:min-w-0">
                    {detail}
                  </span>
                ) : null}
              </span>
              <span className="text-right font-semibold tabular-nums">
                {formatCentsShort(item.amountCents)}
              </span>
              <span className="col-span-3 flex flex-wrap items-center justify-end gap-2 sm:col-span-1 sm:gap-x-3">
                {actions(item)}
                {/* En el celular, un ícono: así entra en la misma fila que las acciones. */}
                <button
                  type="button"
                  className={cn(
                    QUIET_BUTTON,
                    'max-sm:size-11 max-sm:justify-center max-sm:rounded-md max-sm:border max-sm:border-border/70 max-sm:bg-card',
                  )}
                  aria-label={`Descartar: ${sentenceOf(item)}`}
                  title="Descartar"
                  onClick={() => setDismissing(item)}
                >
                  <Trash2 aria-hidden className="size-4 sm:hidden" />
                  <span className="max-sm:hidden">Descartar</span>
                </button>
              </span>
            </li>
          )
        })}
      </ul>

      <AlertDialog
        open={dismissing !== null}
        onOpenChange={(open) => {
          if (!open && !pending) setDismissing(null)
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Descartás este retiro?</AlertDialogTitle>
            <AlertDialogDescription>
              {dismissing ? `Son ${sentenceOf(dismissing)}. ` : null}
              No va a los libros y sale de esta lista. En la caja del salón queda anotado igual.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={pending}>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              disabled={pending}
              onClick={(event) => {
                // Se cierra cuando la base confirmó, no antes.
                event.preventDefault()
                if (dismissing) dismiss(dismissing)
              }}
            >
              {pending ? 'Descartando…' : 'Descartar'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  )
}
