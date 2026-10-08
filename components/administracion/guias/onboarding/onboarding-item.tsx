import { AlertTriangle, ArrowRight, Check, Sparkles, Undo2 } from 'lucide-react'
import Link from 'next/link'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  canMarkManually,
  minutesText,
  type OnboardingRow,
  onboardingStatusText,
} from '@/lib/accounting/onboarding'
import { formatIsoDay } from '@/lib/dates'
import { cn } from '@/lib/utils'
import { HowSteps } from './how-steps'
import { SheetButton } from './sheet-button'
import { StatusBadge, StepMarker } from './status'
import { SupplierMessage, type SupplierMessageData } from './supplier-message'

/** Botones a lo ancho en el celular (44 px) y a su medida desde `sm`. */
export const GUIDE_BUTTON = 'h-11 w-full gap-2 sm:w-auto md:h-9'

/** El ancla de un ítem en la página («Ver cómo se hace»). */
export function itemAnchor(id: string): string {
  return `arranque-${id}`
}

/**
 * El ítem tiene botón principal: la pantalla exacta donde se carga, o la hoja
 * de acción rápida sobre la guía. «Pedíselo a tus proveedores» no tiene: su
 * acción es copiar el mensaje.
 */
export function hasPrimaryAction(row: OnboardingRow): boolean {
  if (!row.actionLabel || row.id === 'suppliers_message') return false
  return Boolean(row.sheet || row.where.path)
}

/** El botón principal de un ítem (ver `hasPrimaryAction`). */
export function ItemPrimaryAction({
  row,
  base,
  variant,
}: {
  row: OnboardingRow
  base: string
  variant: 'default' | 'outline'
}) {
  if (!hasPrimaryAction(row) || !row.actionLabel) return null
  if (row.sheet) {
    return (
      <SheetButton sheet={row.sheet} variant={variant} className={GUIDE_BUTTON}>
        {row.actionLabel}
      </SheetButton>
    )
  }
  if (!row.where.path) return null
  return (
    <Button asChild variant={variant} className={GUIDE_BUTTON}>
      <Link href={`${base}${row.where.path}`}>
        {row.actionLabel}
        <ArrowRight className="size-4" aria-hidden="true" />
      </Link>
    </Button>
  )
}

/** «Dónde»: el link a la pantalla exacta, o el texto si es afuera de la plataforma. */
export function WhereText({ row, base }: { row: OnboardingRow; base: string }) {
  if (!row.where.path) return <span className="text-muted-foreground">{row.where.label}</span>
  return (
    <Link
      href={`${base}${row.where.path}`}
      className="font-medium text-foreground underline decoration-border underline-offset-4 hover:decoration-foreground"
    >
      {row.where.label}
    </Link>
  )
}

/**
 * Un ítem de «Cómo arrancar» (diseño §5.2.1): estado (con palabras), qué
 * cargás, dónde (link a la pantalla exacta), cómo (pasos y ejemplo), lo que
 * hace la plataforma sola y la acción. Los que solo pasan afuera se marcan con
 * «Ya lo hice»; el mismo botón pasa a «Desmarcar» (el foco no se pierde).
 */
export function OnboardingItemRow({
  row,
  n,
  isNext,
  base,
  canWrite,
  canMark,
  onMark,
  supplier,
  booksStartDate,
}: {
  row: OnboardingRow
  /** El número del paso dentro de su sección. */
  n: number
  isNext: boolean
  base: string
  canWrite: boolean
  /** Se pueden guardar marcas (la base ya da el estado de la guía). */
  canMark: boolean
  onMark: (row: OnboardingRow, done: boolean) => void
  supplier: SupplierMessageData
  booksStartDate: string | null
}) {
  const titleId = `${itemAnchor(row.id)}-titulo`
  const statusText = onboardingStatusText(row, isNext)
  const minutes = minutesText(row.minutes)
  const markable =
    canWrite && canMark && canMarkManually(row) && (row.status === 'todo' || row.manualDone)
  const primary =
    canWrite && hasPrimaryAction(row) ? (
      <ItemPrimaryAction
        row={row}
        base={base}
        variant={isNext && row.kind !== 'manual' ? 'default' : 'outline'}
      />
    ) : null
  const markVariant = row.manualDone
    ? 'ghost'
    : row.kind === 'manual'
      ? isNext
        ? 'default'
        : 'outline'
      : 'ghost'

  return (
    <li id={itemAnchor(row.id)} className="scroll-mt-24">
      <article
        aria-labelledby={titleId}
        className={cn('flex gap-3 px-4 py-5 sm:gap-4 sm:px-5', isNext && 'bg-primary/5')}
      >
        <StepMarker n={n} status={row.status} isNext={isNext} className="mt-px" />
        <div className="min-w-0 flex-1 space-y-3">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <h3 id={titleId} className="text-base font-semibold leading-snug tracking-tight">
              {row.title}
            </h3>
            {statusText ? (
              <StatusBadge status={row.status} isNext={isNext}>
                {statusText}
              </StatusBadge>
            ) : null}
            {row.optional ? <Badge variant="muted">Opcional</Badge> : null}
          </div>

          <dl className="grid gap-1.5 text-sm">
            <div className="text-pretty">
              <dt className="inline font-medium text-foreground">
                {row.whatLabel ?? 'Qué cargás'}:{' '}
              </dt>
              <dd className="inline text-muted-foreground">{row.what}</dd>
            </div>
            <div className="text-pretty">
              <dt className="inline font-medium text-foreground">Dónde: </dt>
              <dd className="inline">
                <WhereText row={row} base={base} />
                {minutes ? <span className="text-muted-foreground"> · {minutes}</span> : null}
              </dd>
            </div>
          </dl>

          {row.pending ? (
            <p className="flex items-start gap-1.5 text-sm text-warning-text text-pretty">
              <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
              {row.pending}
            </p>
          ) : null}

          {row.id === 'opening' && booksStartDate && row.status !== 'done' ? (
            <p className="text-sm text-muted-foreground text-pretty">
              Los libros arrancan el{' '}
              <span className="font-medium text-foreground">{formatIsoDay(booksStartDate)}</span>:
              cargá lo que había ese día.
            </p>
          ) : null}

          {row.id === 'suppliers_message' ? (
            <SupplierMessage data={supplier} base={base} canWrite={canWrite} />
          ) : null}

          <HowSteps
            key={isNext ? 'abierto' : 'cerrado'}
            steps={row.how}
            example={row.example}
            howTo={row.howTo}
            defaultOpen={isNext}
          />

          {row.auto && row.status !== 'done' ? (
            <p className="flex items-start gap-1.5 text-sm text-muted-foreground text-pretty">
              <Sparkles className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden="true" />
              <span>
                <span className="font-medium text-foreground">La plataforma lo hace sola: </span>
                {row.auto}
              </span>
            </p>
          ) : null}

          {primary || markable ? (
            <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
              {primary}
              {markable ? (
                <Button
                  type="button"
                  variant={markVariant}
                  className={cn(GUIDE_BUTTON, markVariant === 'ghost' && 'text-muted-foreground')}
                  aria-describedby={titleId}
                  onClick={() => onMark(row, !row.manualDone)}
                >
                  {row.manualDone ? (
                    <Undo2 className="size-4" aria-hidden="true" />
                  ) : (
                    <Check className="size-4" aria-hidden="true" />
                  )}
                  {row.manualDone ? 'Desmarcar' : (row.manualLabel ?? 'Ya lo hice')}
                </Button>
              ) : null}
            </div>
          ) : null}
        </div>
      </article>
    </li>
  )
}
