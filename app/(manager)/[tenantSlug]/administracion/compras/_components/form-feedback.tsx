'use client'

import { AlertTriangle, Info, RotateCcw, TriangleAlert } from 'lucide-react'
import { type KeyboardEvent, type ReactNode, useRef } from 'react'
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
import { Skeleton } from '@/components/ui/skeleton'
import type { WarningCopy } from '@/lib/accounting/errors'
import { cn } from '@/lib/utils'
import type { PostingBanner } from './use-document-posting'

const TONE = {
  error: 'border-destructive/30 bg-destructive/10 text-destructive',
  warning: 'border-warning/40 bg-warning/10',
  info: 'border-info/30 bg-info/10',
} as const

/**
 * Un aviso arriba de los botones (H.2), con el estilo de los avisos del panel:
 * qué pasó y, si hay, la acción que corresponde («Reintentar», «Cargarlo el
 * 01/10»).
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
            className="h-11 md:h-8"
            onClick={banner.action.run}
          >
            {banner.action.label}
          </Button>
        ) : null}
      </div>
    </div>
  )
}

/** Un aviso suave dentro del formulario (no bloquea): «¿Seguro? Con Coca-Cola solés gastar…». */
export function InlineNotice({
  tone = 'warning',
  children,
  action,
  className,
}: {
  tone?: 'warning' | 'info'
  children: ReactNode
  action?: ReactNode
  className?: string
}) {
  return (
    <div
      role="status"
      className={cn(
        'flex items-start gap-2.5 rounded-lg border p-3 text-xs',
        tone === 'warning' ? 'border-warning/40 bg-warning/10' : 'border-info/30 bg-info/10',
        className,
      )}
    >
      {tone === 'warning' ? (
        <AlertTriangle aria-hidden className="mt-px size-3.5 shrink-0 text-warning" />
      ) : (
        <Info aria-hidden className="mt-px size-3.5 shrink-0 text-info" />
      )}
      <div className="min-w-0 flex-1 space-y-2">
        <p className={cn('text-pretty', tone === 'warning' && 'text-warning-text')}>{children}</p>
        {action}
      </div>
    </div>
  )
}

/**
 * Los avisos que hay que confirmar antes de guardar (G.4, `needs_confirmation`):
 * todos juntos, con sus botones. Lo que se acepta viaja en `warningsAck`.
 */
export function WarningsDialog({
  warnings,
  onConfirm,
  onCancel,
  pending = false,
}: {
  warnings: readonly WarningCopy[] | null
  onConfirm: () => void
  onCancel: () => void
  pending?: boolean
}) {
  const list = warnings ?? []
  const single = list.length === 1 ? list[0] : undefined
  const confirmLabel = single ? single.confirmLabel : 'Guardar igual'
  const cancelLabel = list.find((w) => w.cancelLabel)?.cancelLabel ?? null

  return (
    <AlertDialog
      open={list.length > 0}
      onOpenChange={(open) => {
        if (!open) onCancel()
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
        <AlertDialogFooter>
          {cancelLabel ? (
            <AlertDialogCancel className="h-11 md:h-9">{cancelLabel}</AlertDialogCancel>
          ) : null}
          <AlertDialogAction className="h-11 md:h-9" disabled={pending} onClick={onConfirm}>
            {confirmLabel}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}

/** Mientras la hoja trae sus datos: la forma real, sin spinner. */
export function SheetSkeleton() {
  return (
    <div className="space-y-5" aria-busy="true">
      <span className="sr-only">Cargando…</span>
      <Skeleton className="h-4 w-32" />
      <Skeleton className="h-14 w-full" />
      <Skeleton className="h-4 w-24" />
      <div className="flex flex-wrap gap-2">
        {['a', 'b', 'c', 'd'].map((k) => (
          <Skeleton key={k} className="h-9 w-28 rounded-full" />
        ))}
      </div>
      <Skeleton className="h-4 w-36" />
      <Skeleton className="h-11 w-full" />
      <Skeleton className="h-24 w-full rounded-xl" />
    </div>
  )
}

/** No se pudieron traer los datos: el motivo y «Reintentar». */
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

export type ChipOption<T extends string> = {
  value: T
  label: ReactNode
  /** Para lectores, si `label` no alcanza (p. ej. un saldo al lado del nombre). */
  ariaLabel?: string
}

/**
 * Pocas opciones a la vista (comprobante, con qué pagaste): chips como los de
 * período de Reservas con el patrón de radio de WAI-ARIA (flechas para
 * moverse, una sola parada de Tab). 44 px en el celular.
 */
export function RadioChips<T extends string>({
  options,
  value,
  onChange,
  labelledBy,
  invalid,
  className,
}: {
  options: readonly ChipOption<T>[]
  value: T | null
  onChange: (value: T) => void
  labelledBy: string
  invalid?: boolean
  className?: string
}) {
  const refs = useRef<Array<HTMLButtonElement | null>>([])
  const focusable =
    value !== null && options.some((o) => o.value === value) ? value : options[0]?.value

  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    const delta =
      event.key === 'ArrowRight' || event.key === 'ArrowDown'
        ? 1
        : event.key === 'ArrowLeft' || event.key === 'ArrowUp'
          ? -1
          : 0
    if (delta === 0) return
    event.preventDefault()
    const next = (index + delta + options.length) % options.length
    const option = options[next]
    if (!option) return
    onChange(option.value)
    refs.current[next]?.focus()
  }

  return (
    <div
      role="radiogroup"
      aria-labelledby={labelledBy}
      aria-invalid={invalid ? true : undefined}
      className={cn('flex flex-wrap gap-2', className)}
    >
      {options.map((option, index) => {
        const active = option.value === value
        return (
          // biome-ignore lint/a11y/useSemanticElements: radiogroup de WAI-ARIA con botones (chips con flechas y una sola parada de Tab)
          <button
            key={option.value}
            ref={(node) => {
              refs.current[index] = node
            }}
            type="button"
            role="radio"
            aria-checked={active}
            aria-label={option.ariaLabel}
            tabIndex={option.value === focusable ? 0 : -1}
            onClick={() => onChange(option.value)}
            onKeyDown={(event) => onKeyDown(event, index)}
            className={cn(
              'inline-flex h-11 max-w-full items-center gap-1.5 rounded-full border px-4 text-sm font-medium transition-colors md:h-9',
              'outline-none focus-visible:ring-2 focus-visible:ring-ring',
              active
                ? 'border-primary bg-primary text-primary-foreground'
                : 'border-border hover:bg-secondary',
              invalid && !active && 'border-destructive/60',
            )}
          >
            {option.label}
          </button>
        )
      })}
    </div>
  )
}
