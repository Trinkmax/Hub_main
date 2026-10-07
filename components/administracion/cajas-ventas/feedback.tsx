'use client'

import { AlertTriangle, Info, RotateCcw, TriangleAlert } from 'lucide-react'
import { useId, useState } from 'react'
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
import { Label } from '@/components/ui/label'
import { Skeleton } from '@/components/ui/skeleton'
import { Textarea } from '@/components/ui/textarea'
import type { WarningCopy } from '@/lib/accounting/errors'
import { cn } from '@/lib/utils'
import type { PostingBanner } from './use-posting'

const TONE = {
  error: 'border-destructive/30 bg-destructive/10 text-destructive',
  warning: 'border-warning/40 bg-warning/10',
  info: 'border-info/30 bg-info/10',
} as const

/**
 * El aviso del servidor arriba de los botones (H.2): qué pasó y, si hay, la
 * acción que corresponde («Reintentar», «Cargarlo el 01/10»).
 */
export function FormBanner({
  banner,
  className,
}: {
  banner: PostingBanner | null
  className?: string
}) {
  if (!banner) return null
  const Icon =
    banner.tone === 'error' ? TriangleAlert : banner.tone === 'warning' ? AlertTriangle : Info
  return (
    <div
      role={banner.tone === 'info' ? 'status' : 'alert'}
      className={cn(
        'flex items-start gap-3 rounded-xl border p-4 text-sm',
        TONE[banner.tone],
        className,
      )}
    >
      <Icon
        aria-hidden="true"
        className={cn(
          'mt-0.5 size-4 shrink-0',
          banner.tone === 'warning' && 'text-warning',
          banner.tone === 'info' && 'text-info',
        )}
      />
      <div className="min-w-0 flex-1 space-y-2">
        <p className={cn('text-pretty', banner.tone === 'warning' && 'text-warning-text')}>
          {banner.message}
        </p>
        {banner.action ? (
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-11 gap-1.5 md:h-8"
            onClick={banner.action.run}
          >
            {banner.action.label}
          </Button>
        ) : null}
      </div>
    </div>
  )
}

/**
 * Los avisos que hay que confirmar antes de guardar (G.4, `needs_confirmation`):
 * todos juntos, con sus botones. Lo que se acepta viaja en `warningsAck`.
 * Con «Facturaste más de lo que vendiste» pide el motivo (5 a 300 letras).
 */
export function WarningsDialog({
  warnings,
  onConfirm,
  onCancel,
  pending = false,
}: {
  warnings: readonly WarningCopy[] | null
  onConfirm: (extra: { reason: string | null }) => void
  onCancel: () => void
  pending?: boolean
}) {
  const reasonId = useId()
  const [reason, setReason] = useState('')
  const [reasonError, setReasonError] = useState<string | null>(null)
  const list = warnings ?? []
  const needsReason = list.some((w) => w.key === 'invoiced_exceeds_sold')
  const single = list.length === 1 ? list[0] : undefined
  const confirmLabel = single ? single.confirmLabel : 'Guardar igual'
  const cancelLabel = list.find((w) => w.cancelLabel)?.cancelLabel ?? null
  const onlyInfo = cancelLabel === null

  return (
    <AlertDialog
      open={list.length > 0}
      onOpenChange={(open) => {
        if (!open) {
          setReasonError(null)
          onCancel()
        }
      }}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Revisá antes de guardar</AlertDialogTitle>
          <AlertDialogDescription asChild>
            <div className="space-y-2 text-sm text-muted-foreground">
              {list.map((w) => (
                <p key={w.key} className="text-pretty">
                  {w.message}
                </p>
              ))}
            </div>
          </AlertDialogDescription>
        </AlertDialogHeader>
        {needsReason ? (
          <div className="grid gap-1.5">
            <Label htmlFor={reasonId}>
              ¿Por qué?
              <span aria-hidden="true" className="ml-0.5 text-destructive">
                *
              </span>
            </Label>
            <Textarea
              id={reasonId}
              value={reason}
              maxLength={300}
              rows={2}
              placeholder="Por ejemplo: la factura es de una venta del sábado."
              aria-invalid={reasonError ? true : undefined}
              aria-describedby={reasonError ? `${reasonId}-error` : undefined}
              onChange={(e) => {
                setReason(e.target.value)
                if (reasonError) setReasonError(null)
              }}
            />
            {reasonError ? (
              <p id={`${reasonId}-error`} role="alert" className="text-xs text-destructive">
                {reasonError}
              </p>
            ) : null}
          </div>
        ) : null}
        <AlertDialogFooter>
          {onlyInfo ? null : (
            <AlertDialogCancel className="h-11 md:h-9">{cancelLabel}</AlertDialogCancel>
          )}
          <AlertDialogAction
            className="h-11 md:h-9"
            disabled={pending}
            onClick={(event) => {
              if (needsReason && reason.trim().length < 5) {
                event.preventDefault()
                setReasonError('Contá brevemente el motivo (al menos 5 letras).')
                return
              }
              onConfirm({ reason: needsReason ? reason.trim() : null })
            }}
          >
            {confirmLabel}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}

/** Mientras la hoja trae sus datos: la forma real, sin spinner. */
export function SheetBodySkeleton() {
  return (
    <div className="space-y-5" aria-busy="true">
      <span className="sr-only">Cargando…</span>
      <Skeleton className="h-4 w-40" />
      <Skeleton className="h-11 w-full" />
      <Skeleton className="h-4 w-32" />
      <Skeleton className="h-11 w-full" />
      <Skeleton className="h-24 w-full rounded-xl" />
    </div>
  )
}

/** No se pudieron traer los datos de la hoja: el motivo y «Reintentar». */
export function SheetLoadError({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-border/80 bg-card/50 px-6 py-10 text-center">
      <p className="font-serif text-lg font-semibold tracking-tight">No pudimos cargar esto.</p>
      <p className="mt-2 max-w-xs text-sm text-muted-foreground text-pretty">{message}</p>
      <Button type="button" variant="outline" className="mt-5 h-11 gap-2 md:h-9" onClick={onRetry}>
        <RotateCcw className="size-4" aria-hidden />
        Reintentar
      </Button>
    </div>
  )
}
