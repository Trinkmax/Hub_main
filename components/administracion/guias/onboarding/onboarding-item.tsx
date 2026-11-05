import { AlertTriangle, Check, ChevronDown, Sparkles, Undo2 } from 'lucide-react'
import Link from 'next/link'
import { PRow, PTd } from '@/components/administracion/planilla'
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
import { StatusBadge } from './status'
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
 * Un paso de «Cómo arrancar», en dos filas de la planilla: Estado · Paso · [Ir] y, debajo, plegado,
 * el detalle (qué, dónde, cómo y lo que hace sola), con su mini guía y su «Ya lo hice».
 *
 * Todo arranca plegado: se abre al tocar el nombre, y solo llega abierto el que trae la URL
 * (`#arranque-<paso>`). El detalle queda en la página con `hidden`: marcar o desmarcar no cambia el
 * árbol, así el botón no se desarma bajo el dedo.
 */
export function OnboardingItemRow({
  row,
  isNext,
  open,
  onToggle,
  base,
  canWrite,
  canMark,
  onMark,
  supplier,
  booksStartDate,
}: {
  row: OnboardingRow
  isNext: boolean
  open: boolean
  onToggle: (id: string) => void
  base: string
  canWrite: boolean
  /** Se pueden guardar marcas (la base ya da el estado de la guía). */
  canMark: boolean
  onMark: (row: OnboardingRow, done: boolean) => void
  supplier: SupplierMessageData
  booksStartDate: string | null
}) {
  const anchor = itemAnchor(row.id)
  const titleId = `${anchor}-titulo`
  const panelId = `${anchor}-detalle`
  const statusText = onboardingStatusText(row, isNext)
  return (
    <>
      <PRow className={cn(isNext && 'bg-primary/5')}>
        <PTd className="w-28 whitespace-nowrap">
          {statusText ? (
            <StatusBadge status={row.status} isNext={isNext}>
              {statusText}
            </StatusBadge>
          ) : null}
        </PTd>
        <PTd className="p-0">
          <button
            id={titleId}
            type="button"
            aria-expanded={open}
            aria-controls={panelId}
            onClick={() => onToggle(row.id)}
            className="flex min-h-11 w-full scroll-mt-24 items-center gap-2 px-3 py-[7px] text-left font-medium outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset md:pointer-fine:min-h-9"
          >
            <span className="min-w-0 flex-1 text-pretty">
              {row.title}
              {row.optional ? (
                <span className="ml-2 text-xs font-normal text-muted-foreground">Opcional</span>
              ) : null}
            </span>
            <ChevronDown
              aria-hidden="true"
              className={cn(
                'size-4 shrink-0 text-muted-foreground transition-transform duration-(--duration-fast) motion-reduce:transition-none',
                open && 'rotate-180',
              )}
            />
          </button>
        </PTd>
        <PTd align="right" className="w-20">
          {canWrite ? <ItemGoButton row={row} base={base} /> : null}
        </PTd>
      </PRow>
      <tr id={anchor} hidden={!open} className="scroll-mt-24">
        <td
          id={panelId}
          colSpan={3}
          className="border-b border-border/60 bg-secondary/30 px-3 py-4"
        >
          <ItemBody
            row={row}
            base={base}
            canWrite={canWrite}
            canMark={canMark}
            onMark={onMark}
            supplier={supplier}
            booksStartDate={booksStartDate}
            titleId={titleId}
            open={open}
          />
        </td>
      </tr>
    </>
  )
}

/** La columna [Ir]: lleva a la pantalla donde se hace, o abre su hoja. */
function ItemGoButton({ row, base }: { row: OnboardingRow; base: string }) {
  if (!hasPrimaryAction(row)) return null
  if (row.sheet) {
    return (
      <SheetButton
        sheet={row.sheet}
        variant="outline"
        size="sm"
        aria-label={row.actionLabel ?? undefined}
      >
        Abrir
      </SheetButton>
    )
  }
  if (!row.where.path) return null
  return (
    <Button asChild variant="outline" size="sm">
      <Link href={`${base}${row.where.path}`} aria-label={row.actionLabel ?? undefined}>
        Ir
      </Link>
    </Button>
  )
}

/** Lo de adentro de un paso: qué, dónde, por qué falta, cómo, lo que hace sola y su marca. */
function ItemBody({
  row,
  base,
  canWrite,
  canMark,
  onMark,
  supplier,
  booksStartDate,
  titleId,
  open,
}: {
  row: OnboardingRow
  base: string
  canWrite: boolean
  canMark: boolean
  onMark: (row: OnboardingRow, done: boolean) => void
  supplier: SupplierMessageData
  booksStartDate: string | null
  titleId: string
  /** La mini guía, con sus maquetas, se arma recién al abrir el paso. */
  open: boolean
}) {
  const minutes = minutesText(row.minutes)
  const markable =
    canWrite && canMark && canMarkManually(row) && (row.status === 'todo' || row.manualDone)

  return (
    <div className="max-w-3xl space-y-3 text-sm">
      <dl className="grid gap-1.5">
        <div className="text-pretty">
          <dt className="inline font-medium text-foreground">{row.whatLabel ?? 'Qué cargás'}: </dt>
          <dd className="inline text-muted-foreground">{row.what}</dd>
        </div>
        <div className="text-pretty">
          <dt className="inline font-medium text-foreground">Dónde: </dt>
          <dd className="inline">
            <WhereText row={row} base={base} />
            {minutes ? (
              <span className="text-muted-foreground">
                {/* El punto queda pegado a lo anterior (nbsp) y los minutos enteros: si no
                    entra, «≈ 5 min» baja solo y ningún renglón empieza con «·». */}
                {'\u00a0· '}
                <span className="whitespace-nowrap">{minutes}</span>
              </span>
            ) : null}
          </dd>
        </div>
      </dl>

      {row.pending ? (
        <p className="flex items-start gap-1.5 text-warning-text text-pretty">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
          {row.pending}
        </p>
      ) : null}

      {row.id === 'opening' && booksStartDate && row.status !== 'done' ? (
        <p className="text-muted-foreground text-pretty">
          Los libros arrancan el{' '}
          <span className="font-medium text-foreground">{formatIsoDay(booksStartDate)}</span>: cargá
          lo que había ese día.
        </p>
      ) : null}

      {row.id === 'suppliers_message' ? (
        <SupplierMessage data={supplier} base={base} canWrite={canWrite} />
      ) : null}

      <HowSteps steps={row.how} example={row.example} howTo={row.howTo} showHowTo={open} />

      {row.auto && row.status !== 'done' ? (
        <p className="flex items-start gap-1.5 text-muted-foreground text-pretty">
          <Sparkles className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden="true" />
          <span>
            <span className="font-medium text-foreground">La plataforma lo hace sola: </span>
            {row.auto}
          </span>
        </p>
      ) : null}

      {markable ? (
        <Button
          type="button"
          variant={row.manualDone ? 'ghost' : 'outline'}
          className={cn(GUIDE_BUTTON, row.manualDone && 'text-muted-foreground')}
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
  )
}
