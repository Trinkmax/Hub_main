'use client'

import { useId, useState } from 'react'
import { toast } from 'sonner'
import { useAccounting } from '@/components/administracion/accounting-provider'
import {
  ArcaLookupPanel,
  ArcaLookupTrigger,
  useArcaLookup,
} from '@/components/administracion/arca-lookup'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { ACC_UNREACHABLE } from '@/lib/accounting/action-state'
import { type SavedParty, saveParty } from '@/lib/accounting/actions/master'
import type { IvaCondition } from '@/lib/accounting/types'
import { formatCuit } from '@/lib/fiscal'
import { cn } from '@/lib/utils'
import {
  conditionNoun,
  gapWords,
  INVOICING_CHOICES,
  type InvoicingGap,
} from '../_lib/purchase-paper'
import type { QuickVoucher } from '../_lib/quick-expense'
import type { SheetParty } from '../_lib/sheet-types'
import { InlineNotice, RadioChips } from './form-feedback'

type AskParty = Pick<
  SheetParty,
  'id' | 'kind' | 'name' | 'tradeName' | 'ivaCondition' | 'taxId' | 'updatedAt'
>

function isChoice(condition: IvaCondition): boolean {
  return INVOICING_CHOICES.some((choice) => choice.value === condition)
}

function digitsOf(text: string): string {
  return text.replace(/\D/g, '')
}

/**
 * «¿Cómo te factura {Proveedor}?», en línea y para un proveedor que YA existe.
 * Aparece cuando el papel que la persona tiene en la mano no entra con lo que
 * sabemos de él:
 *
 * - `unknown`: no sabemos cómo factura (entró por «Agregar de una lista»). El
 *   motor no le acepta Factura A, B ni C hasta saberlo; antes la pantalla no lo
 *   decía y el error aparecía recién al guardar.
 * - `mismatch`: figura como monotributista y trajo una Factura A.
 * - `cuit`: sabemos cómo factura pero falta el CUIT, y el Libro IVA lo necesita
 *   (el aviso de siempre de «Nuevo gasto», con su texto).
 *
 * Es un gesto explícito sobre su ficha: guarda con `saveParty` y solo viajan
 * `ivaCondition`, `taxIdType` y `taxId` (más `id`, `expectedUpdatedAt`, `kind`
 * y `name`, que pide el esquema). Nunca corre solo, y la contadora no lo ve.
 */
export function SupplierInvoicingAsk({
  tenantSlug,
  party,
  gap,
  paper,
  onSaved,
  onCancel,
  className,
}: {
  tenantSlug: string
  party: AskParty
  gap: InvoicingGap
  /** La tarjeta que tocó (para decir «no da Factura A»). */
  paper: QuickVoucher | null
  /** La ficha ya guardada: quien la usa refresca sus datos y marca el papel. */
  onSaved: (saved: SavedParty) => void
  onCancel?: () => void
  className?: string
}) {
  const { readOnly } = useAccounting()
  const uid = useId()
  const shown = party.tradeName ?? party.name
  const [condition, setCondition] = useState<IvaCondition | null>(
    gap.suggest ?? (isChoice(party.ivaCondition) ? party.ivaCondition : null),
  )
  const [cuit, setCuit] = useState<string | null>(gap.kind === 'cuit' ? null : (party.taxId ?? ''))
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const arca = useArcaLookup({
    tenantSlug,
    purpose: 'supplier',
    cuit: cuit ?? '',
    values: { name: party.name, ivaCondition: condition },
    // De ARCA solo se toma cómo factura: el nombre de su ficha no se toca desde acá.
    spec: { ivaOptions: INVOICING_CHOICES.map((c) => c.value), chosen: ['name'] },
    onApply: (patch) => {
      if (patch.ivaCondition !== undefined) setCondition(patch.ivaCondition)
    },
    enabled: gap.kind !== 'cuit',
    connectHint: false,
  })

  if (readOnly) return null

  const typed = digitsOf(cuit ?? '')
  const cuitReady = typed.length === 11

  const save = async (payload: { ivaCondition?: IvaCondition; taxId?: string }) => {
    setSaving(true)
    setError(null)
    try {
      const result = await saveParty(tenantSlug, {
        id: party.id,
        expectedUpdatedAt: party.updatedAt,
        kind: party.kind,
        name: party.name,
        ...(payload.ivaCondition ? { ivaCondition: payload.ivaCondition } : null),
        ...(payload.taxId ? { taxIdType: 'cuit', taxId: payload.taxId } : null),
      })
      if (!result.ok) {
        setError(
          result.code === 'stale'
            ? 'Alguien cambió a este proveedor recién. Recargá y probá de nuevo.'
            : (result.fieldErrors?.taxId ?? result.fieldErrors?.ivaCondition ?? result.message),
        )
        return
      }
      toast.success(
        payload.ivaCondition
          ? `Listo: ${shown} quedó como ${conditionNoun(payload.ivaCondition)}.`
          : `Listo: ${party.name} ya tiene CUIT.`,
      )
      onSaved(result.data)
    } catch {
      setError(ACC_UNREACHABLE.offline)
    } finally {
      setSaving(false)
    }
  }

  // Sabemos cómo factura y solo falta el CUIT: el aviso corto de «Nuevo gasto».
  if (gap.kind === 'cuit') {
    return (
      <InlineNotice
        className={className}
        action={
          cuit === null ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-11 md:h-8"
              onClick={() => setCuit('')}
            >
              Agregar CUIT
            </Button>
          ) : (
            <div className="space-y-2">
              <div className="flex flex-wrap items-center gap-2">
                <input
                  aria-label={`CUIT de ${party.name}`}
                  value={cuit}
                  inputMode="numeric"
                  placeholder="30-71876543-5"
                  onChange={(e) => setCuit(e.target.value)}
                  onBlur={(e) => {
                    const digits = digitsOf(e.target.value)
                    if (digits.length === 11) setCuit(formatCuit(digits))
                  }}
                  className="h-11 w-40 rounded-md border border-input bg-background px-2 text-base tabular-nums outline-none placeholder:text-muted-foreground/50 focus-visible:ring-2 focus-visible:ring-ring md:h-8 md:text-xs"
                />
                <Button
                  type="button"
                  size="sm"
                  className="h-11 md:h-8"
                  disabled={saving || !cuitReady}
                  onClick={() => void save({ taxId: cuit })}
                >
                  {saving ? 'Guardando…' : 'Guardar CUIT'}
                </Button>
              </div>
              {error ? (
                <span role="alert" className="block text-destructive">
                  {error}
                </span>
              ) : null}
            </div>
          )
        }
      >
        {party.name} no tiene CUIT cargado: el Libro IVA lo necesita.
      </InlineNotice>
    )
  }

  const words = gapWords(gap, { name: shown, condition: party.ivaCondition, paper })
  const hint = INVOICING_CHOICES.find((choice) => choice.value === condition)?.hint ?? null
  const canSave = condition !== null && (typed.length === 0 || cuitReady)

  return (
    <section
      aria-labelledby={`${uid}-titulo`}
      className={cn('grid gap-3 rounded-xl bg-secondary/50 p-4', className)}
    >
      <div>
        <h3
          id={`${uid}-titulo`}
          className="font-serif text-base font-semibold leading-snug tracking-tight text-pretty"
        >
          {words.title}
        </h3>
        <p className="mt-1 text-sm leading-relaxed text-muted-foreground text-pretty">
          {words.body}
        </p>
      </div>
      <div className="grid gap-1.5">
        <RadioChips
          labelledBy={`${uid}-titulo`}
          value={condition}
          options={INVOICING_CHOICES.map((choice) => ({
            value: choice.value,
            label: choice.label,
          }))}
          onChange={(next) => {
            setCondition(next)
            setError(null)
          }}
        />
        {hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
      </div>
      <div className="grid gap-1.5">
        <Label htmlFor={`${uid}-cuit`}>
          Su CUIT <span className="text-xs font-normal text-muted-foreground">(si lo tenés)</span>
        </Label>
        <ArcaLookupTrigger lookup={arca}>
          <Input
            id={`${uid}-cuit`}
            value={cuit ?? ''}
            inputMode="numeric"
            autoComplete="off"
            placeholder="30-71876543-5"
            aria-describedby={`${uid}-cuit-ayuda`}
            onChange={(e) => {
              setCuit(e.target.value)
              setError(null)
            }}
            onBlur={(e) => {
              const digits = digitsOf(e.target.value)
              if (digits.length === 11) setCuit(formatCuit(digits))
            }}
            className="h-11 max-w-56 text-base tabular-nums placeholder:text-muted-foreground/50 md:h-10 md:text-sm"
          />
        </ArcaLookupTrigger>
        <p id={`${uid}-cuit-ayuda`} className="text-xs text-muted-foreground text-pretty">
          Está arriba en la factura. El Libro IVA lo necesita.
        </p>
        <ArcaLookupPanel lookup={arca} />
      </div>
      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}
      <div className="flex flex-wrap items-center gap-2">
        <Button
          type="button"
          className="h-11 rounded-full px-5 md:h-10"
          disabled={saving || !canSave}
          onClick={() =>
            condition
              ? void save({ ivaCondition: condition, taxId: cuitReady ? (cuit ?? '') : '' })
              : null
          }
        >
          {saving ? 'Guardando…' : 'Guardar en su ficha'}
        </Button>
        {onCancel ? (
          <Button
            type="button"
            variant="ghost"
            className="h-11 text-muted-foreground md:h-10"
            disabled={saving}
            onClick={onCancel}
          >
            Ahora no
          </Button>
        ) : null}
      </div>
    </section>
  )
}
