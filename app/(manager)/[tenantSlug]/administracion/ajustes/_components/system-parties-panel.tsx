'use client'

import { Pencil } from 'lucide-react'
import { useState } from 'react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import type { AccFailureState } from '@/lib/accounting/action-state'
import { saveParty } from '@/lib/accounting/actions/master'
import type { CommissionVatMode, PartyKind, PartyRates } from '@/lib/accounting/types'
import { formatCuit, normalizeCuit } from '@/lib/fiscal'
import { cn } from '@/lib/utils'
import { COMMISSION_VAT_MODE_LABELS } from '../_lib/labels'
import { bpToPercentInput, formatBp, parsePercentToBp } from '../_lib/percent'
import { EditDialog } from './edit-dialog'
import { describedBy, Field } from './form-bits'
import { CuitInput, cuitIssue, PercentInput, SwitchRow } from './inputs'
import { useMasterAction } from './use-master-action'

export type SystemPartyRow = {
  id: string
  name: string
  kind: PartyKind
  systemKey: string | null
  taxId: string | null
  active: boolean
  commissionVatMode: CommissionVatMode
  rates: PartyRates
  updatedAt: string | null
}

const KIND_LABEL: Readonly<Record<PartyKind, string>> = {
  supplier: 'Proveedor',
  customer: 'Clientes',
  card_processor: 'Tarjetas',
  payment_wallet: 'Billetera',
  delivery_platform: 'Plataforma',
  bank: 'Banco',
  tax_agency: 'Organismo',
  payroll: 'Sueldos',
  partner: 'Socio',
  other: 'Otro',
}

/** Los que cobran por nosotros y descuentan comisiones y retenciones. */
const CHARGES: ReadonlySet<PartyKind> = new Set([
  'card_processor',
  'payment_wallet',
  'delivery_platform',
  'bank',
])

type RateKey = keyof PartyRates

const RATE_FIELDS: ReadonlyArray<{ key: RateKey; label: string; only?: PartyKind }> = [
  { key: 'commissionBp', label: 'Comisión' },
  { key: 'iibbWithholdingBp', label: 'Retención de IIBB' },
  { key: 'vatWithholdingBp', label: 'Retención de IVA' },
  { key: 'incomeTaxWithholdingBp', label: 'Retención de Ganancias' },
  { key: 'sircupaBp', label: 'SIRCUPA (IIBB de Mercado Pago)', only: 'payment_wallet' },
]

const SHORT: Readonly<Record<RateKey, string>> = {
  commissionBp: 'Comisión',
  iibbWithholdingBp: 'IIBB',
  vatWithholdingBp: 'IVA',
  incomeTaxWithholdingBp: 'Ganancias',
  sircupaBp: 'SIRCUPA',
}

function ratesLine(p: SystemPartyRow): string | null {
  const parts = (Object.keys(SHORT) as RateKey[])
    .filter((k) => p.rates[k] !== null && p.rates[k] !== undefined)
    .map((k) => `${SHORT[k]} ${formatBp(p.rates[k])}`)
  return parts.length > 0 ? parts.join(' · ') : null
}

type Draft = {
  party: SystemPartyRow
  cuit: string
  rates: Record<RateKey, string>
  vatMode: CommissionVatMode
  active: boolean
}

/**
 * Ajustes › Plataformas y organismos (H.17, «partícipes del sistema»): el CUIT
 * de cada uno (los libros de IVA lo piden), las tasas que se precargan en las
 * acreditaciones y cómo factura las comisiones. El tipo y sus cuentas los fija
 * el sistema.
 */
export function SystemPartiesPanel({
  tenantSlug,
  parties,
  readOnly,
}: {
  tenantSlug: string
  parties: readonly SystemPartyRow[]
  readOnly: boolean
}) {
  const { pending, run } = useMasterAction()
  const [editing, setEditing] = useState<Draft | null>(null)
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [message, setMessage] = useState<string | null>(null)

  const open = (p: SystemPartyRow) => {
    setEditing({
      party: p,
      cuit: p.taxId ? formatCuit(p.taxId) : '',
      rates: {
        commissionBp: bpToPercentInput(p.rates.commissionBp),
        iibbWithholdingBp: bpToPercentInput(p.rates.iibbWithholdingBp),
        vatWithholdingBp: bpToPercentInput(p.rates.vatWithholdingBp),
        incomeTaxWithholdingBp: bpToPercentInput(p.rates.incomeTaxWithholdingBp),
        sircupaBp: bpToPercentInput(p.rates.sircupaBp),
      },
      vatMode: p.commissionVatMode,
      active: p.active,
    })
    setErrors({})
    setMessage(null)
  }

  const onFailure = (state: AccFailureState) => {
    const fields = { ...(state.fieldErrors ?? {}) }
    if (fields.taxIdType && !fields.taxId) fields.taxId = fields.taxIdType
    setErrors(fields)
    setMessage(Object.keys(fields).length > 0 ? null : state.message)
  }

  const save = () => {
    if (!editing) return
    const p = editing.party
    const local: Record<string, string> = {}
    const issue = cuitIssue(editing.cuit)
    if (issue) local.taxId = issue
    const charges = CHARGES.has(p.kind)
    const rates: Partial<Record<RateKey, number | null>> = {}
    if (charges) {
      for (const field of RATE_FIELDS) {
        if (field.only && field.only !== p.kind) continue
        const parsed = parsePercentToBp(editing.rates[field.key])
        if (parsed.ok) rates[field.key] = parsed.bp
        else local[field.key] = parsed.message
      }
    }
    if (Object.keys(local).length > 0) {
      setErrors(local)
      return
    }
    const taxId = editing.cuit.trim() ? normalizeCuit(editing.cuit) : null
    run(
      () =>
        saveParty(tenantSlug, {
          id: p.id,
          expectedUpdatedAt: p.updatedAt,
          kind: p.kind,
          name: p.name,
          taxIdType: taxId ? 'cuit' : 'none',
          taxId,
          ...(charges ? { ...rates, commissionVatMode: editing.vatMode } : {}),
          ...(p.kind === 'delivery_platform' ? { active: editing.active } : {}),
        }),
      { onSuccess: () => setEditing(null), onFailure },
    )
  }

  const err = (k: string) => errors[k] ?? null
  const groups: Array<{ title: string; rows: SystemPartyRow[] }> = [
    { title: 'Cobros, plataformas y bancos', rows: parties.filter((p) => CHARGES.has(p.kind)) },
    { title: 'Organismos y otros', rows: parties.filter((p) => !CHARGES.has(p.kind)) },
  ]

  return (
    <div className="space-y-4">
      {groups.map((group) =>
        group.rows.length === 0 ? null : (
          <section
            key={group.title}
            className="card-hairline overflow-hidden rounded-xl border bg-card"
          >
            <header className="border-b border-border/60 px-5 py-4">
              <h3 className="font-serif text-lg font-semibold tracking-tight">{group.title}</h3>
            </header>
            <ul className="divide-y divide-border/60">
              {group.rows.map((p) => {
                const rates = CHARGES.has(p.kind) ? ratesLine(p) : null
                const missingCuit = !p.taxId && CHARGES.has(p.kind)
                return (
                  <li
                    key={p.id}
                    className="flex flex-col gap-3 px-5 py-3.5 sm:flex-row sm:items-center sm:justify-between"
                  >
                    <div className={cn('min-w-0 space-y-0.5', !p.active && 'opacity-60')}>
                      <p className="flex flex-wrap items-center gap-2 text-sm font-medium">
                        {p.name}
                        {p.active ? null : <Badge variant="muted">Apagado</Badge>}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {KIND_LABEL[p.kind]} ·{' '}
                        {p.taxId ? (
                          <span className="tabular-nums">CUIT {formatCuit(p.taxId)}</span>
                        ) : (
                          <span className={missingCuit ? 'text-warning-text' : undefined}>
                            Sin CUIT
                          </span>
                        )}
                      </p>
                      {rates ? <p className="text-xs text-muted-foreground">{rates}</p> : null}
                      {CHARGES.has(p.kind) && p.commissionVatMode !== 'none' ? (
                        <p className="text-xs text-muted-foreground">
                          Factura las comisiones:{' '}
                          {COMMISSION_VAT_MODE_LABELS[p.commissionVatMode].toLowerCase()}
                        </p>
                      ) : null}
                    </div>
                    {readOnly ? null : (
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="h-11 gap-1.5 self-start sm:self-center md:h-8"
                        onClick={() => open(p)}
                      >
                        <Pencil className="size-3.5" aria-hidden />
                        Editar
                      </Button>
                    )}
                  </li>
                )
              })}
            </ul>
          </section>
        ),
      )}
      {parties.length === 0 ? (
        <p className="card-hairline rounded-xl border bg-card p-6 text-sm text-muted-foreground">
          Todavía no hay plataformas ni organismos cargados.
        </p>
      ) : null}

      {readOnly ? null : (
        <EditDialog
          open={editing !== null}
          onOpenChange={(next) => {
            if (!next) setEditing(null)
          }}
          title={editing ? editing.party.name : ''}
          description="Las tasas sirven para precargar las acreditaciones; nunca se registran solas."
          pending={pending}
          message={message}
          onSubmit={save}
        >
          {editing ? (
            <>
              <Field
                id="sp-cuit"
                label="CUIT"
                optional
                hint={CHARGES.has(editing.party.kind) ? 'Lo piden los libros de IVA.' : undefined}
                error={err('taxId')}
              >
                <CuitInput
                  id="sp-cuit"
                  value={editing.cuit}
                  invalid={Boolean(err('taxId'))}
                  describedBy={describedBy(
                    'sp-cuit',
                    CHARGES.has(editing.party.kind),
                    err('taxId'),
                  )}
                  onChange={(cuit) => setEditing({ ...editing, cuit })}
                  onBlurCheck={(issue) =>
                    setErrors((prev) => {
                      const { taxId: _taxId, ...rest } = prev
                      return issue ? { ...rest, taxId: issue } : rest
                    })
                  }
                />
              </Field>
              {CHARGES.has(editing.party.kind) ? (
                <>
                  <div className="grid gap-3 sm:grid-cols-2">
                    {RATE_FIELDS.filter((f) => !f.only || f.only === editing.party.kind).map(
                      (f) => (
                        <Field
                          key={f.key}
                          id={`sp-${f.key}`}
                          label={f.label}
                          optional
                          error={err(f.key)}
                        >
                          <PercentInput
                            id={`sp-${f.key}`}
                            value={editing.rates[f.key]}
                            invalid={Boolean(err(f.key))}
                            describedBy={describedBy(`sp-${f.key}`, null, err(f.key))}
                            onChange={(text) =>
                              setEditing({ ...editing, rates: { ...editing.rates, [f.key]: text } })
                            }
                          />
                        </Field>
                      ),
                    )}
                  </div>
                  <Field id="sp-vat-mode" label="¿Cómo factura las comisiones?">
                    <Select
                      value={editing.vatMode}
                      onValueChange={(v) =>
                        setEditing({ ...editing, vatMode: v as CommissionVatMode })
                      }
                    >
                      <SelectTrigger
                        id="sp-vat-mode"
                        className="w-full data-[size=default]:h-11 md:data-[size=default]:h-10"
                      >
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {(Object.keys(COMMISSION_VAT_MODE_LABELS) as CommissionVatMode[]).map(
                          (m) => (
                            <SelectItem key={m} value={m}>
                              {COMMISSION_VAT_MODE_LABELS[m]}
                            </SelectItem>
                          ),
                        )}
                      </SelectContent>
                    </Select>
                  </Field>
                </>
              ) : null}
              {editing.party.kind === 'delivery_platform' ? (
                <SwitchRow
                  id="sp-active"
                  label="Trabajamos con esta plataforma"
                  description="Para cobrar con ella, prendé también su medio en Medios de cobro."
                  checked={editing.active}
                  onCheckedChange={(active) => setEditing({ ...editing, active })}
                />
              ) : null}
            </>
          ) : null}
        </EditDialog>
      )}
    </div>
  )
}
