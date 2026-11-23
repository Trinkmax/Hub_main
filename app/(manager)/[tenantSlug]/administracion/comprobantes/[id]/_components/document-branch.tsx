'use client'

import { Loader2 } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useState, useTransition } from 'react'
import { toast } from 'sonner'
import { AccBranchTag } from '@/components/administracion/branch-bits'
import { BranchField } from '@/components/branches/branch-field'
import { useBranchScope } from '@/components/branches/branch-scope-provider'
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import { setDocumentBranch } from '@/lib/accounting/actions/documents'

const OFFLINE = 'Sin conexión: no se cambió. Probá de nuevo.'

/**
 * De qué sucursal es un comprobante, al lado de su título, y «Cambiar de sucursal» para quien carga (un
 * comprobante vigente de un mes abierto). Los de todo el bar (la liquidación de IVA, el ejercicio, un asiento
 * manual) lo dicen y no se mueven. Con una sola sucursal no se muestra nada.
 *
 * Cambia solo la sucursal: los montos, las partidas y el libro quedan igual (`acc_set_document_branch`).
 */
export function DocumentBranch({
  tenantSlug,
  documentId,
  branchId,
  canMove,
}: {
  tenantSlug: string
  documentId: string
  /** `null` = de todo el bar. */
  branchId: string | null
  /** Quien carga, con el comprobante vigente y su mes abierto. */
  canMove: boolean
}) {
  const router = useRouter()
  const context = useBranchScope()
  const [open, setOpen] = useState(false)
  const [target, setTarget] = useState<string | null>(branchId)
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  if (!context?.scope.multi) return null
  const movable = canMove && branchId !== null
  const current = branchId ? context.byId.get(branchId) : undefined

  function reset() {
    setTarget(branchId)
    setError(null)
  }

  function run() {
    if (!target || target === branchId) {
      setError('Elegí otra sucursal.')
      return
    }
    setError(null)
    startTransition(async () => {
      try {
        const result = await setDocumentBranch(tenantSlug, { documentId, branchId: target })
        if (result.ok) {
          setOpen(false)
          toast.success(result.message)
          router.refresh()
          return
        }
        setError(result.fieldErrors?.branchId ?? result.message)
      } catch {
        setError(OFFLINE)
      }
    })
  }

  return (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
      <AccBranchTag branchId={branchId} when="always" label="De todo el bar" />
      {movable ? (
        <AlertDialog
          open={open}
          onOpenChange={(next) => {
            if (pending) return
            setOpen(next)
            if (!next) reset()
          }}
        >
          <button
            type="button"
            onClick={() => setOpen(true)}
            className="inline-flex min-h-11 items-center rounded-sm text-xs font-medium text-muted-foreground underline-offset-4 outline-none hover:text-foreground hover:underline focus-visible:ring-2 focus-visible:ring-ring md:min-h-0"
          >
            Cambiar de sucursal
          </button>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>¿A qué sucursal pasa?</AlertDialogTitle>
              <AlertDialogDescription className="text-pretty">
                {current ? `Hoy es de ${current.name}. ` : null}
                Cambia solo la sucursal: los montos y los libros quedan igual.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <BranchField
              value={target}
              onChange={(next) => {
                setTarget(next)
                setError(null)
              }}
              label="Sucursal"
              disabled={pending}
            />
            {error ? (
              <p role="alert" className="text-sm text-destructive text-pretty">
                {error}
              </p>
            ) : null}
            <AlertDialogFooter>
              <AlertDialogCancel disabled={pending} className="h-11 md:h-9">
                Cancelar
              </AlertDialogCancel>
              <Button
                type="button"
                disabled={pending || !target || target === branchId}
                onClick={run}
                className="h-11 gap-2 md:h-9"
              >
                {pending ? <Loader2 className="size-4 animate-spin" aria-hidden /> : null}
                {pending ? 'Cambiando…' : 'Cambiar'}
              </Button>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      ) : null}
    </div>
  )
}
