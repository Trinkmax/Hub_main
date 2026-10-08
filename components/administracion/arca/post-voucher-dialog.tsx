'use client'

import { useRouter } from 'next/navigation'
import { useEffect, useState, useTransition } from 'react'
import { toast } from 'sonner'
import { Callout } from '@/app/(manager)/[tenantSlug]/administracion/ajustes/_components/form-bits'
import { EntryPreview } from '@/components/administracion/entry-preview'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Skeleton } from '@/components/ui/skeleton'
import { ACC_UNREACHABLE, type AccFailureState } from '@/lib/accounting/action-state'
import type { WarningCopy } from '@/lib/accounting/errors'
import { postAuthorizedArcaVoucher, previewArcaVoucherPosting } from '@/lib/arca/emit-actions'
import type { ArcaVoucherPostingPreview } from '@/lib/arca/emit-form'
import { formatIsoDay } from '@/lib/dates'

/**
 * «Cargarla ahora» (diseño §3.2.5): una factura que ARCA autorizó pero que no
 * llegó a los libros. Muestra el asiento armado en el servidor con lo que se cargó
 * al emitirla y lo guarda con la misma referencia (si ya estaba guardado, solo lo
 * vincula: nunca queda dos veces). Si su mes ya se cerró, avisa que el asiento va
 * al primer día abierto.
 */
export function PostVoucherDialog({
  slug,
  voucherId,
  label,
  open,
  onOpenChange,
  onPosted,
}: {
  slug: string
  voucherId: string
  label: string
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Después de guardar: el comprobante de los libros (si se conoce). */
  onPosted?: (documentId: string | null) => void
}) {
  const router = useRouter()
  const [preview, setPreview] = useState<ArcaVoucherPostingPreview | null>(null)
  const [loadError, setLoadError] = useState<AccFailureState | null>(null)
  const [failure, setFailure] = useState<AccFailureState | null>(null)
  const [warnings, setWarnings] = useState<WarningCopy[]>([])
  const [loading, startLoading] = useTransition()
  const [saving, startSaving] = useTransition()
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    if (!open) return
    void attempt
    setPreview(null)
    setLoadError(null)
    setFailure(null)
    startLoading(async () => {
      try {
        const res = await previewArcaVoucherPosting(slug, { voucherId })
        if (res.ok) {
          setPreview(res.data)
          setWarnings(res.data.warnings)
        } else setLoadError(res)
      } catch {
        setLoadError({ ok: false, code: 'error', message: ACC_UNREACHABLE.offline })
      }
    })
  }, [open, slug, voucherId, attempt])

  function save() {
    if (!preview) return
    setFailure(null)
    startSaving(async () => {
      try {
        const res = await postAuthorizedArcaVoucher(slug, {
          voucherId,
          previewHash: preview.hash,
          warningsAck: warnings.map((w) => w.key),
        })
        if (res.ok) {
          toast.success(res.message)
          onOpenChange(false)
          onPosted?.(res.data.documentId)
          router.refresh()
          return
        }
        if (res.code === 'preview_stale' && res.preview && res.hash) {
          setPreview({ ...preview, preview: res.preview, hash: res.hash })
          setFailure({ ...res, message: `${res.message} Revisalo y tocá de nuevo.` })
          return
        }
        if (res.code === 'needs_confirmation' && res.warnings) {
          setWarnings(res.warnings)
          setFailure({
            ok: false,
            code: 'needs_confirmation',
            message: 'Revisá estos avisos: si están bien, tocá de nuevo para cargarla igual.',
          })
          return
        }
        setFailure(res)
      } catch {
        setFailure({ ok: false, code: 'error', message: ACC_UNREACHABLE.offline })
      }
    })
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!saving) onOpenChange(next)
      }}
    >
      <DialogContent className="max-h-[88vh] overflow-y-auto sm:max-w-xl" showCloseButton={!saving}>
        <DialogHeader>
          <DialogTitle className="font-serif text-pretty">Cargar {label} en los libros</DialogTitle>
          <DialogDescription className="text-pretty">
            ARCA ya la autorizó: falta el asiento. Se guarda con los mismos datos con que la
            emitiste y no se puede cargar dos veces.
          </DialogDescription>
        </DialogHeader>

        <div aria-live="polite" aria-busy={loading} className="grid gap-4">
          {loading && !preview ? (
            <div className="grid gap-3">
              <span className="sr-only">Armando el asiento…</span>
              <Skeleton className="h-4 w-48" />
              <Skeleton className="h-28 w-full rounded-xl" />
            </div>
          ) : null}
          {loadError ? (
            <Callout
              tone="error"
              action={
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-11 md:h-8"
                  onClick={() => setAttempt((n) => n + 1)}
                >
                  Reintentar
                </Button>
              }
            >
              {loadError.message}
            </Callout>
          ) : null}
          {preview ? (
            <>
              {preview.movedTo ? (
                <Callout tone="warning" title="Su mes ya está cerrado">
                  La factura conserva su fecha, pero el asiento va al{' '}
                  {formatIsoDay(preview.movedTo)}, el primer día abierto.
                </Callout>
              ) : null}
              <EntryPreview entries={preview.preview} alwaysOpen />
              {warnings.length > 0 ? (
                <Callout tone="warning" title="Antes de cargarla, mirá esto">
                  <ul className="list-disc space-y-1 pl-4">
                    {warnings.map((w) => (
                      <li key={w.key} className="text-pretty">
                        {w.message}
                      </li>
                    ))}
                  </ul>
                </Callout>
              ) : null}
            </>
          ) : null}
          {failure ? (
            <Callout tone={failure.code === 'needs_confirmation' ? 'warning' : 'error'}>
              {failure.message}
            </Callout>
          ) : null}
        </div>

        <DialogFooter>
          <Button
            type="button"
            variant="ghost"
            className="h-11 md:h-9"
            disabled={saving}
            onClick={() => onOpenChange(false)}
          >
            Cancelar
          </Button>
          <Button
            type="button"
            className="h-11 min-w-[180px] md:h-9"
            disabled={saving || !preview}
            onClick={save}
          >
            {saving ? 'Cargando…' : warnings.length > 0 ? 'Cargarla igual' : 'Cargarla ahora'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
