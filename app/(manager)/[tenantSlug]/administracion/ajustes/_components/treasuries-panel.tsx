'use client'

import {
  Banknote,
  CircleDollarSign,
  CreditCard,
  Landmark,
  type LucideIcon,
  Pencil,
  Plus,
  Wallet,
} from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'
import { Amount } from '@/components/administracion/amount'
import { balanceText } from '@/components/administracion/format'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import type { AccFailureState } from '@/lib/accounting/action-state'
import { saveTreasuryAccount } from '@/lib/accounting/actions/master'
import type { TreasuryAccountRow } from '@/lib/accounting/queries/treasury'
import type { TreasuryKind } from '@/lib/accounting/types'
import { cn } from '@/lib/utils'
import { EditDialog } from './edit-dialog'
import { describedBy, Field } from './form-bits'
import { INPUT_CLASS, SwitchRow } from './inputs'
import { useMasterAction } from './use-master-action'

const KIND_ICON: Readonly<Record<TreasuryKind, LucideIcon>> = {
  cash: Banknote,
  bank: Landmark,
  wallet: Wallet,
  credit_card: CreditCard,
  other: CircleDollarSign,
}

const KIND_LABEL: Readonly<Record<TreasuryKind, string>> = {
  cash: 'Efectivo',
  bank: 'Banco',
  wallet: 'Billetera',
  credit_card: 'Tarjeta de la empresa',
  other: 'Otra',
}

const KIND_OPTIONS: ReadonlyArray<{ value: TreasuryKind; label: string }> = [
  { value: 'cash', label: 'Caja (efectivo)' },
  { value: 'bank', label: 'Banco' },
  { value: 'wallet', label: 'Billetera (Mercado Pago, Ualá…)' },
  { value: 'credit_card', label: 'Tarjeta de crédito de la empresa' },
  { value: 'other', label: 'Otra' },
]

type Draft = {
  id: string | null
  updatedAt: string | null
  name: string
  kind: TreasuryKind
  bankName: string
  accountNumber: string
  cbuCvu: string
  alias: string
  allowNegative: boolean
  createBankParty: boolean
}

function draftOf(t: TreasuryAccountRow | null): Draft {
  return t
    ? {
        id: t.id,
        updatedAt: t.updatedAt,
        name: t.name,
        kind: t.kind,
        bankName: t.bankName ?? '',
        accountNumber: t.accountNumber ?? '',
        cbuCvu: t.cbuCvu ?? '',
        alias: t.alias ?? '',
        allowNegative: t.allowNegative,
        createBankParty: false,
      }
    : {
        id: null,
        updatedAt: null,
        name: '',
        kind: 'bank',
        bankName: '',
        accountNumber: '',
        cbuCvu: '',
        alias: '',
        allowNegative: false,
        createBankParty: true,
      }
}

/** El saldo como se lee: «$ X», «Descubierto $ X»; en la tarjeta de la empresa, «Deuda $ X». */
function BalanceText({ kind, cents }: { kind: TreasuryKind; cents: number | undefined }) {
  if (cents === undefined) return <Amount cents={null} />
  if (kind === 'credit_card') {
    return (
      <span className="whitespace-nowrap text-sm tabular-nums">
        {cents > 0 ? `Deuda ${balanceText(cents, 'treasury')}` : balanceText(-cents, 'treasury')}
      </span>
    )
  }
  return <Amount cents={cents} balance="treasury" tone="auto" className="text-sm" />
}

/**
 * Ajustes › Cajas y cuentas (H.17): la lista con su saldo y su cuenta del
 * plan, alta y edición. Una caja nueva arranca en cero: el saldo inicial se
 * carga con «Otro ingreso o egreso».
 */
export function TreasuriesPanel({
  tenantSlug,
  rows,
  balances,
  readOnly,
}: {
  tenantSlug: string
  rows: readonly TreasuryAccountRow[]
  /** Id → saldo en el sentido de la cuenta (en la tarjeta, la deuda). Sin dato: «—». */
  balances: Readonly<Record<string, number>>
  readOnly: boolean
}) {
  const { pending, run } = useMasterAction()
  const [editing, setEditing] = useState<Draft | null>(null)
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [message, setMessage] = useState<string | null>(null)

  const open = (t: TreasuryAccountRow | null) => {
    setEditing(draftOf(t))
    setErrors({})
    setMessage(null)
  }

  const onFailure = (state: AccFailureState) => {
    setErrors(state.fieldErrors ?? {})
    setMessage(
      state.fieldErrors && Object.keys(state.fieldErrors).length > 0 ? null : state.message,
    )
  }

  const save = () => {
    if (!editing) return
    const d = editing
    const bankish = d.kind === 'bank' || d.kind === 'credit_card'
    const transfers = d.kind === 'bank' || d.kind === 'wallet'
    const base = {
      name: d.name,
      kind: d.kind,
      bankName: bankish ? d.bankName.trim() || null : null,
      accountNumber: d.kind === 'bank' ? d.accountNumber.trim() || null : null,
      cbuCvu: transfers ? d.cbuCvu.trim() || null : null,
      alias: transfers ? d.alias.trim() || null : null,
      allowNegative: d.kind === 'cash' ? false : d.allowNegative,
    }
    run(
      () =>
        saveTreasuryAccount(
          tenantSlug,
          d.id
            ? { id: d.id, expectedUpdatedAt: d.updatedAt, ...base }
            : { ...base, createBankParty: d.kind === 'bank' && d.createBankParty },
        ),
      {
        quiet: true,
        onSuccess: (_row, msg) => {
          setEditing(null)
          if (d.id) toast.success(msg)
          else
            toast.success(msg, {
              description:
                'Arranca en cero: el saldo inicial se carga con «Otro ingreso o egreso».',
            })
        },
        onFailure,
      },
    )
  }

  const toggle = (t: TreasuryAccountRow, active: boolean) =>
    run(() =>
      saveTreasuryAccount(tenantSlug, {
        id: t.id,
        expectedUpdatedAt: t.updatedAt,
        name: t.name,
        kind: t.kind,
        active,
      }),
    )

  const err = (k: string) => errors[k] ?? null
  // Una caja no pasa a ser la tarjeta de la empresa (ni al revés): en una edición no se ofrece.
  const kindOptions = editing?.id
    ? KIND_OPTIONS.filter((o) =>
        editing.kind === 'credit_card' ? o.value === 'credit_card' : o.value !== 'credit_card',
      )
    : KIND_OPTIONS

  return (
    <div className="space-y-4">
      <section className="card-hairline overflow-hidden rounded-xl border bg-card">
        <header className="flex flex-wrap items-center justify-between gap-3 border-b border-border/60 px-5 py-4">
          <div className="min-w-0">
            <h3 className="font-serif text-lg font-semibold tracking-tight">Cajas y cuentas</h3>
            <p className="text-xs text-muted-foreground">
              Cada una tiene su cuenta en el plan. Para desactivarla tiene que quedar en cero.
            </p>
          </div>
          {readOnly ? null : (
            <Button type="button" className="h-11 gap-2 md:h-9" onClick={() => open(null)}>
              <Plus className="size-4" aria-hidden />
              Agregar caja o cuenta
            </Button>
          )}
        </header>
        {rows.length === 0 ? (
          <p className="px-5 py-6 text-sm text-muted-foreground">Todavía no hay cajas cargadas.</p>
        ) : (
          <ul className="divide-y divide-border/60">
            {rows.map((t) => {
              const Icon = KIND_ICON[t.kind]
              const details = [
                KIND_LABEL[t.kind],
                t.accountCode ? `Cuenta ${t.accountCode}` : null,
                t.bankName,
                t.alias ? `alias ${t.alias}` : null,
              ]
                .filter(Boolean)
                .join(' · ')
              return (
                <li
                  key={t.id}
                  className="flex flex-col gap-3 px-5 py-3.5 sm:flex-row sm:items-center sm:justify-between"
                >
                  <div className={cn('flex min-w-0 items-center gap-3', !t.active && 'opacity-60')}>
                    <span className="flex size-9 shrink-0 items-center justify-center rounded-lg border border-primary/20 bg-cream-tint text-primary">
                      <Icon className="size-4" aria-hidden />
                    </span>
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium">{t.name}</p>
                      <p className="text-xs text-muted-foreground text-pretty">{details}</p>
                    </div>
                  </div>
                  <div className="flex items-center justify-between gap-3 pl-12 sm:justify-end sm:pl-0">
                    <BalanceText kind={t.kind} cents={balances[t.id]} />
                    {readOnly ? (
                      <Badge variant={t.active ? 'outline' : 'muted'}>
                        {t.active ? 'Activa' : 'Desactivada'}
                      </Badge>
                    ) : (
                      <div className="flex items-center gap-1">
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="size-11 text-muted-foreground hover:text-foreground"
                          aria-label={`Editar ${t.name}`}
                          onClick={() => open(t)}
                        >
                          <Pencil className="size-4" />
                        </Button>
                        <Switch
                          checked={t.active}
                          disabled={pending}
                          onCheckedChange={(checked) => toggle(t, checked)}
                          aria-label={t.active ? `Desactivar ${t.name}` : `Activar ${t.name}`}
                          className="ml-2"
                        />
                      </div>
                    )}
                  </div>
                </li>
              )
            })}
          </ul>
        )}
      </section>

      {readOnly ? null : (
        <EditDialog
          open={editing !== null}
          onOpenChange={(next) => {
            if (!next) setEditing(null)
          }}
          title={editing?.id ? 'Editar caja o cuenta' : 'Nueva caja o cuenta'}
          description={
            editing?.id
              ? 'Cambiar el nombre también renombra su cuenta en el plan.'
              : 'Se crea con su cuenta en el plan de cuentas.'
          }
          pending={pending}
          message={message}
          onSubmit={save}
        >
          {editing ? (
            <>
              <Field id="tr-name" label="Nombre" required error={err('name')}>
                <Input
                  id="tr-name"
                  value={editing.name}
                  maxLength={60}
                  placeholder="Banco Galicia · cuenta corriente"
                  aria-invalid={err('name') ? true : undefined}
                  aria-describedby={describedBy('tr-name', null, err('name'))}
                  onChange={(e) => setEditing({ ...editing, name: e.target.value })}
                  className={INPUT_CLASS}
                />
              </Field>
              <Field id="tr-kind" label="Tipo" error={err('kind')}>
                <Select
                  value={editing.kind}
                  onValueChange={(v) => setEditing({ ...editing, kind: v as TreasuryKind })}
                >
                  <SelectTrigger
                    id="tr-kind"
                    className="w-full data-[size=default]:h-11 md:data-[size=default]:h-10"
                  >
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {kindOptions.map((o) => (
                      <SelectItem key={o.value} value={o.value}>
                        {o.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
              {editing.kind === 'bank' || editing.kind === 'credit_card' ? (
                <div className="grid gap-3 sm:grid-cols-2">
                  <Field
                    id="tr-bank"
                    label={editing.kind === 'bank' ? 'Banco' : 'Banco que la emite'}
                    optional
                    error={err('bankName')}
                  >
                    <Input
                      id="tr-bank"
                      value={editing.bankName}
                      maxLength={80}
                      onChange={(e) => setEditing({ ...editing, bankName: e.target.value })}
                      className={INPUT_CLASS}
                    />
                  </Field>
                  {editing.kind === 'bank' ? (
                    <Field
                      id="tr-number"
                      label="N° de cuenta"
                      optional
                      error={err('accountNumber')}
                    >
                      <Input
                        id="tr-number"
                        value={editing.accountNumber}
                        maxLength={40}
                        onChange={(e) => setEditing({ ...editing, accountNumber: e.target.value })}
                        className={cn(INPUT_CLASS, 'tabular-nums')}
                      />
                    </Field>
                  ) : null}
                </div>
              ) : null}
              {editing.kind === 'bank' || editing.kind === 'wallet' ? (
                <div className="grid gap-3 sm:grid-cols-2">
                  <Field
                    id="tr-cbu"
                    label={editing.kind === 'bank' ? 'CBU' : 'CVU'}
                    optional
                    error={err('cbuCvu')}
                  >
                    <Input
                      id="tr-cbu"
                      value={editing.cbuCvu}
                      maxLength={26}
                      inputMode="numeric"
                      aria-invalid={err('cbuCvu') ? true : undefined}
                      aria-describedby={describedBy('tr-cbu', null, err('cbuCvu'))}
                      onChange={(e) => setEditing({ ...editing, cbuCvu: e.target.value })}
                      className={cn(INPUT_CLASS, 'tabular-nums')}
                    />
                  </Field>
                  <Field id="tr-alias" label="Alias" optional error={err('alias')}>
                    <Input
                      id="tr-alias"
                      value={editing.alias}
                      maxLength={20}
                      autoCapitalize="none"
                      spellCheck={false}
                      aria-invalid={err('alias') ? true : undefined}
                      aria-describedby={describedBy('tr-alias', null, err('alias'))}
                      onChange={(e) => setEditing({ ...editing, alias: e.target.value })}
                      className={INPUT_CLASS}
                    />
                  </Field>
                </div>
              ) : null}
              {editing.kind !== 'cash' && editing.kind !== 'credit_card' ? (
                <SwitchRow
                  id="tr-negative"
                  label="Puede quedar en negativo"
                  description="Para una cuenta con descubierto acordado: el sistema no avisa cuando baja de cero."
                  checked={editing.allowNegative}
                  onCheckedChange={(checked) => setEditing({ ...editing, allowNegative: checked })}
                />
              ) : null}
              {!editing.id && editing.kind === 'bank' ? (
                <SwitchRow
                  id="tr-bank-party"
                  label="Sumar el banco como proveedor"
                  description="Sus comisiones y gastos van al Libro IVA compras."
                  checked={editing.createBankParty}
                  onCheckedChange={(checked) =>
                    setEditing({ ...editing, createBankParty: checked })
                  }
                />
              ) : null}
            </>
          ) : null}
        </EditDialog>
      )}
    </div>
  )
}
