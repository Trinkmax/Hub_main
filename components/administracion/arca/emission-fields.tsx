'use client'

import { RefreshCw } from 'lucide-react'
import Link from 'next/link'
import { type ReactNode, useId } from 'react'
import { Callout } from '@/app/(manager)/[tenantSlug]/administracion/ajustes/_components/form-bits'
import { type ChoiceChip, ChoiceChips } from '@/components/administracion/cajas-ventas/choice-chips'
import { describedBy, Field, GroupLabel } from '@/components/administracion/cajas-ventas/field'
import { DateField } from '@/components/administracion/date-input'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { Textarea } from '@/components/ui/textarea'
import {
  ARCA_CONCEPTO_LABELS,
  ARCA_DETAIL_MAX,
  type ArcaConcepto,
  type ArcaLetterChoice,
  type ArcaPlatformVoucher,
  arcaGuideHref,
} from '@/lib/arca/emit-form'
import { CONDICION_IVA_RECEPTOR } from '@/lib/arca/vouchers'
import { formatDayMonth } from '@/lib/dates'
import { formatVoucherNumber } from '@/lib/fiscal'
import { formatCents } from '@/lib/money'
import { cn } from '@/lib/utils'
import type { ArcaNextNumberState } from './use-arca-next-number'

/**
 * Los campos que agrega «La emito ahora con ARCA» a la factura de venta (diseño
 * §3.2.2). Mismas piezas y clases que el resto del formulario: etiqueta, control,
 * ayuda en `text-xs`, error con `role="alert"`, 44 px en el celular.
 */

/** Un dato que no se edita (lo pone la plataforma), con la altura de un campo. */
function FixedValue({
  id,
  children,
  className,
  announce = false,
}: {
  id: string
  children: ReactNode
  className?: string
  /** Anunciar los cambios a lectores de pantalla (el número que llega de ARCA). */
  announce?: boolean
}) {
  // `<output>`: se puede rotular con `<label for>` y no se edita.
  return (
    <output
      id={id}
      aria-live={announce ? 'polite' : 'off'}
      className={cn(
        'flex min-h-11 items-center rounded-md border border-input bg-secondary/40 px-3 text-base tabular-nums md:min-h-10 md:text-sm',
        className,
      )}
    >
      {children}
    </output>
  )
}

// ─── Condición frente al IVA del cliente ─────────────────────────────────────

export function ArcaConditionField({
  slug,
  value,
  onChange,
  letterChoice,
  error,
  locked = false,
}: {
  slug: string
  value: number | null
  onChange: (id: number) => void
  letterChoice: ArcaLetterChoice
  error: string | null
  /** «Consumidor final (sin identificar)»: siempre consumidor final. */
  locked?: boolean
}) {
  const id = useId()
  const hint = locked
    ? 'Sin datos del cliente va siempre como consumidor final.'
    : letterChoice.ok
      ? `Le corresponde Factura ${letterChoice.letter}: la letra sale sola de esta condición.`
      : 'Es cómo está inscripto el cliente en ARCA. Define la letra: A a inscriptos y monotributistas; B al resto.'
  return (
    <div className="grid gap-3">
      <Field
        id={`${id}-cond`}
        label="Condición frente al IVA del cliente"
        required
        hint={hint}
        error={error}
      >
        <Select
          value={value === null ? '' : String(value)}
          onValueChange={(v) => onChange(Number(v))}
          disabled={locked}
        >
          <SelectTrigger
            id={`${id}-cond`}
            className="w-full data-[size=default]:h-11 md:data-[size=default]:h-10"
            aria-invalid={error ? true : undefined}
            aria-describedby={describedBy(`${id}-cond`, { hint, error })}
          >
            <SelectValue placeholder="Elegí cómo está inscripto" />
          </SelectTrigger>
          <SelectContent>
            {CONDICION_IVA_RECEPTOR.map((c) => (
              <SelectItem key={c.id} value={String(c.id)} className="min-h-11 md:min-h-8">
                {c.short}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Field>
      {!letterChoice.ok && letterChoice.reason === 'class_a_not_enabled' ? (
        <Callout
          tone="warning"
          title="A este cliente le corresponde Factura A"
          action={
            <Button asChild variant="outline" size="sm" className="h-11 md:h-8">
              <Link href={arcaGuideHref(slug, 3)}>Cómo se habilita</Link>
            </Button>
          }
        >
          Por ley, a un responsable inscripto o a un monotributista se le hace Factura A, y ARCA
          todavía no se la habilitó a la SAS (o falta marcarlo en Ajustes › ARCA). Mientras tanto,
          esta factura hacela en el sistema que usás hoy y cargala con «Ya la emití en otro
          sistema».
        </Callout>
      ) : null}
    </div>
  )
}

// ─── Comprobante, punto de venta y número ────────────────────────────────────

export function ArcaNumberRow({
  voucherLabel,
  pointOfSale,
  pointOfSaleLabel,
  next,
  onRetry,
  error,
}: {
  /** «Factura B», o `null` si todavía no se sabe la letra. */
  voucherLabel: string | null
  pointOfSale: number | null
  pointOfSaleLabel: string | null
  next: ArcaNextNumberState
  onRetry: () => void
  error: string | null
}) {
  const id = useId()
  return (
    <div className="grid gap-5 sm:grid-cols-3">
      <div className="grid content-start gap-1.5">
        <Label htmlFor={`${id}-type`}>Comprobante</Label>
        <FixedValue id={`${id}-type`}>
          {voucherLabel ?? <span className="text-muted-foreground">Elegí la condición</span>}
        </FixedValue>
      </div>
      <div className="grid content-start gap-1.5">
        <Label htmlFor={`${id}-pos`}>Punto de venta</Label>
        <FixedValue id={`${id}-pos`}>
          {pointOfSale === null
            ? '—'
            : `${String(pointOfSale).padStart(4, '0')} · ${pointOfSaleLabel ?? 'Plataforma (ARCA)'}`}
        </FixedValue>
      </div>
      <div className="grid content-start gap-1.5">
        <Label htmlFor={`${id}-number`}>Número</Label>
        <FixedValue id={`${id}-number`} className="justify-between gap-2" announce>
          {next.status === 'ready' && pointOfSale !== null ? (
            <span>
              <span className="text-muted-foreground">Próximo </span>
              {formatVoucherNumber(pointOfSale, next.data.nextNumber)}
            </span>
          ) : next.status === 'loading' ? (
            <span className="flex w-full items-center" aria-busy="true">
              <span className="sr-only">Consultando el número en ARCA…</span>
              <Skeleton className="h-4 w-32" />
            </span>
          ) : next.status === 'error' ? (
            <span className="text-destructive">No pudimos consultarlo</span>
          ) : (
            <span className="text-muted-foreground">Lo asigna ARCA</span>
          )}
        </FixedValue>
        <div aria-live="polite">
          {next.status === 'error' ? (
            <div className="flex flex-wrap items-center gap-2">
              <p role="alert" className="text-xs text-destructive text-pretty">
                {next.error.message}
              </p>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-11 gap-1.5 md:h-8"
                onClick={onRetry}
              >
                <RefreshCw className="size-4" aria-hidden />
                Reintentar
              </Button>
            </div>
          ) : error ? (
            <p role="alert" className="text-xs text-destructive">
              {error}
            </p>
          ) : (
            <p className="text-xs text-muted-foreground">
              Lo asigna ARCA al emitir: es correlativo y no se puede elegir.
            </p>
          )}
        </div>
      </div>
    </div>
  )
}

// ─── Concepto y período del servicio ─────────────────────────────────────────

const CONCEPTO_OPTIONS: ChoiceChip<'1' | '2' | '3'>[] = [
  { value: '1', label: ARCA_CONCEPTO_LABELS[1] },
  { value: '2', label: ARCA_CONCEPTO_LABELS[2] },
  { value: '3', label: ARCA_CONCEPTO_LABELS[3] },
]

export function ArcaConceptoField({
  value,
  onChange,
  serviceFrom,
  serviceTo,
  onServiceFrom,
  onServiceTo,
  today,
  fromError,
  toError,
  children,
}: {
  value: ArcaConcepto
  onChange: (value: ArcaConcepto) => void
  serviceFrom: string | null
  serviceTo: string | null
  onServiceFrom: (value: string | null) => void
  onServiceTo: (value: string | null) => void
  today: string
  fromError: string | null
  toError: string | null
  /** «Vence el pago» (de la factura o de la nota), al lado del período. */
  children?: ReactNode
}) {
  const id = useId()
  return (
    <div className="grid gap-4">
      <div className="grid gap-2">
        <GroupLabel id={`${id}-concepto`}>¿Qué facturás?</GroupLabel>
        <ChoiceChips<'1' | '2' | '3'>
          labelledBy={`${id}-concepto`}
          value={String(value) as '1' | '2' | '3'}
          onChange={(next) => onChange(Number(next) as ArcaConcepto)}
          options={CONCEPTO_OPTIONS}
        />
        <p className="text-xs text-muted-foreground text-pretty">
          {value === 1
            ? 'Productos: comida, bebida, mercadería. Si es un servicio (catering, alquiler del lugar, un show), elegí «Servicios»: ARCA pide además el período.'
            : 'Con servicios, ARCA pide desde y hasta cuándo se prestó y cuándo vence el pago.'}
        </p>
      </div>
      {value === 1 ? null : (
        <div className="grid gap-5 sm:grid-cols-3">
          <DateField
            label="Servicio desde"
            required
            value={serviceFrom}
            onValueChange={onServiceFrom}
            today={today}
            shortcuts={false}
            error={fromError}
          />
          <DateField
            label="Servicio hasta"
            required
            value={serviceTo}
            onValueChange={onServiceTo}
            min={serviceFrom ?? undefined}
            today={today}
            shortcuts={false}
            error={toError}
          />
          {children}
        </div>
      )}
    </div>
  )
}

// ─── Detalle impreso ─────────────────────────────────────────────────────────

export function ArcaDetailField({
  value,
  onChange,
  error,
}: {
  value: string
  onChange: (value: string) => void
  error: string | null
}) {
  const id = useId()
  const count = value.trim().length
  const hint = `Va impreso en la factura tal cual. ${count}/${ARCA_DETAIL_MAX}`
  return (
    <Field id={`${id}-detail`} label="Detalle para la factura" required hint={hint} error={error}>
      <Textarea
        id={`${id}-detail`}
        value={value}
        rows={3}
        maxLength={ARCA_DETAIL_MAX}
        placeholder="Por ejemplo: Servicio de catering para 40 personas, evento del 12/10."
        className="text-base md:text-sm"
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy(`${id}-detail`, { hint, error })}
        onChange={(event) => onChange(event.target.value)}
      />
    </Field>
  )
}

// ─── La factura que corrige una NC o una ND ──────────────────────────────────

export function ArcaRelatedField({
  isCredit,
  options,
  value,
  onChange,
  error,
}: {
  isCredit: boolean
  options: readonly ArcaPlatformVoucher[]
  value: string | null
  onChange: (id: string) => void
  error: string | null
}) {
  const id = useId()
  const hint =
    options.length === 0
      ? 'Este cliente no tiene facturas emitidas desde acá con esta letra. Una factura hecha en otro sistema se corrige desde ese sistema.'
      : isCredit
        ? 'ARCA la asocia a la factura y se descuenta sola de lo que te debe.'
        : 'ARCA la asocia a esa factura.'
  return (
    <Field
      id={`${id}-related`}
      label={isCredit ? '¿Qué factura corrige?' : '¿Sobre qué factura?'}
      required
      hint={hint}
      error={error}
    >
      <Select value={value ?? ''} onValueChange={onChange} disabled={options.length === 0}>
        <SelectTrigger
          id={`${id}-related`}
          className="w-full data-[size=default]:h-11 md:data-[size=default]:h-10"
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy(`${id}-related`, { hint, error })}
        >
          <SelectValue placeholder="Elegí la factura" />
        </SelectTrigger>
        <SelectContent>
          {options.map((v) => (
            <SelectItem key={v.id} value={v.id} className="min-h-11 md:min-h-8">
              {v.label}
              {v.issueDate ? ` · ${formatDayMonth(v.issueDate)}` : ''} · {formatCents(v.totalCents)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </Field>
  )
}
