'use client'

import { ArrowRight, Check } from 'lucide-react'
import Link from 'next/link'
import { type ReactNode, useId, useMemo, useState } from 'react'
import { IIBB_JURISDICTIONS } from '@/app/(manager)/[tenantSlug]/administracion/compras/_lib/jurisdictions'
import { supplierHref } from '@/app/(manager)/[tenantSlug]/administracion/compras/_lib/links'
import { AccountCombobox } from '@/components/administracion/account-combobox'
import { ChoiceChips } from '@/components/administracion/cajas-ventas/choice-chips'
import { PartyCombobox } from '@/components/administracion/party-combobox'
import { TreasurySelect } from '@/components/administracion/treasury-select'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { WARNING_COPY } from '@/lib/accounting/errors'
import type { IvaCondition } from '@/lib/accounting/types'
import { formatCuit } from '@/lib/fiscal'
import {
  type ImportNeed,
  MANUAL_REASON_TEXT,
  NEED_TEXT,
  type OtherTaxesAs,
} from '@/lib/imports/server/types'
import {
  IVA_CONDITION_TEXT,
  MP_CHANNEL_TEXT,
  OTHER_TAXES_TEXT,
  PARTY_ROLE_TEXT,
  partyKindsForRole,
  SUPPLIER_IVA_CONDITIONS,
} from '@/lib/imports/ui/labels'
import { formatCents } from '@/lib/money'
import { cn } from '@/lib/utils'
import { useReview } from './review-context'
import type { ProposalView } from './types'
import { useRowActions } from './use-row-actions'

const SELECT_CLASS = 'w-full data-[size=default]:h-11 md:data-[size=default]:h-10'
const BUTTON = 'h-11 w-full sm:w-auto md:h-9'

/** El recuadro de algo que falta: qué pasa, en palabras, y cómo se arregla. */
function Frame({
  text,
  children,
  tone = 'warning',
}: {
  text: ReactNode
  children?: ReactNode
  tone?: 'warning' | 'muted'
}) {
  return (
    <div
      className={cn(
        'space-y-3 rounded-lg border p-3 text-sm',
        tone === 'warning' ? 'border-warning/40 bg-warning/5' : 'border-border/70 bg-muted/30',
      )}
    >
      <p className="text-pretty">{text}</p>
      {children ? <div className="space-y-3">{children}</div> : null}
    </div>
  )
}

function Actions({ children }: { children: ReactNode }) {
  return (
    <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">{children}</div>
  )
}

/**
 * Lo que le falta a una propuesta, con su arreglo en el lugar (diseño §4.1 y
 * §4.2: «Otros tributos», cuenta del proveedor, a quién corresponde, confirmar
 * una conversión…). Cada botón manda UN cambio (`resolveImportNeeds`) y la
 * página se vuelve a armar sola. Quien solo lee ve el texto sin botones.
 */
export function NeedBlock({ p, need }: { p: ProposalView; need: ImportNeed }) {
  const { editable, options, slug } = useReview()
  const partyName = (id: string | null | undefined) => {
    if (!id) return null
    const party = options?.parties.find((x) => x.id === id)
    return party ? (party.tradeName ?? party.name) : null
  }

  if (!editable || !options) return <Frame text={readOnlyText(need, partyName)} tone="muted" />

  switch (need.key) {
    case 'new_supplier':
      return (
        <Frame
          text={`${need.name} (CUIT ${formatCuit(need.cuit)}) todavía no está en tus proveedores. Crealo arriba, en «Proveedores nuevos»: con un toque se crean todos.`}
        >
          <Actions>
            <Button asChild variant="outline" className={cn(BUTTON, 'gap-2')}>
              <a href="#proveedores-nuevos">
                Ir a Proveedores nuevos
                <ArrowRight className="size-4" aria-hidden />
              </a>
            </Button>
          </Actions>
        </Frame>
      )
    case 'supplier_account':
      return <SupplierAccount p={p} partyId={need.party_id} partyName={partyName(need.party_id)} />
    case 'supplier_inactive':
      return (
        <Frame
          text={`${partyName(need.party_id) ?? 'El proveedor'} está desactivado. Activalo en su ficha y volvé.`}
        >
          <Actions>
            <Button asChild variant="outline" className={BUTTON}>
              <Link href={supplierHref(slug, need.party_id)}>Abrir la ficha del proveedor</Link>
            </Button>
          </Actions>
        </Frame>
      )
    case 'condition_mismatch':
      return <ConditionMismatch p={p} need={need} partyName={partyName(need.party_id)} />
    case 'other_taxes_as':
      return <OtherTaxes p={p} need={need} partyName={partyName(need.party_id)} />
    case 'foreign_currency':
      return (
        <Confirmable
          p={p}
          need="foreign_currency"
          text={`Está en ${need.currency}: ${formatCents(need.original_total_cents, { currency: false })} ${need.currency} × ${need.fx_rate.replace('.', ',')} = ${formatCents(p.summary.total_cents)}. Lo cargamos en pesos con el tipo de cambio de la factura.`}
          confirmLabel="La conversión está bien"
        />
      )
    case 'possible_duplicate':
      return <PossibleDuplicate p={p} label={need.label} documentId={need.document_id} />
    case 'estimated_deductions':
      return (
        <Confirmable
          p={p}
          need="estimated_deductions"
          text={NEED_TEXT.estimated_deductions}
          confirmLabel="Están bien así"
        />
      )
    case 'mp_invoice':
      return <MpInvoice p={p} />
    case 'channel_method':
      return <ChannelMethod p={p} channel={need.channel} />
    case 'pick_party':
      return <PickParty p={p} role={need.role} suggested={need.suggested_party_id} />
    case 'pick_treasury':
      return <PickTreasury p={p} suggested={need.suggested_treasury_id} />
    case 'counterpart_account':
      return (
        <PickAccount
          p={p}
          tax={null}
          text={
            need.direction === 'in'
              ? 'Entró plata y no sabemos de qué es: elegí la cuenta (por ejemplo, un aporte de un socio o un ingreso extra).'
              : 'Salió plata y no sabemos para qué: elegí la cuenta (por ejemplo, un gasto o un retiro de un socio).'
          }
        />
      )
    case 'unknown_tax':
      return (
        <PickAccount
          p={p}
          tax={need.tax}
          text={`Mercado Pago descontó ${formatCents(Math.abs(need.amount_cents))} de «${need.tax}», un impuesto que no conocemos. ¿A qué cuenta va?`}
        />
      )
    case 'accept_warning':
      return <AcceptWarnings p={p} warnings={need.warnings} />
    case 'receipt':
      return <Receipt p={p} />
    case 'engine_error':
      return <ManualOnly p={p} text={need.message || NEED_TEXT.engine_error} />
    case 'manual':
      return (
        <ManualOnly
          p={p}
          text={MANUAL_REASON_TEXT[need.reason]}
          notOurs={need.reason === 'not_ours'}
        />
      )
    case 'unsupported_voucher':
      return (
        <ManualOnly
          p={p}
          text={`Este tipo de comprobante (código ${need.code} de ARCA) no se importa todavía: cargalo a mano.`}
        />
      )
    default:
      return <ManualOnly p={p} text={NEED_TEXT[need.key]} />
  }
}

/** El texto para quien solo mira (la contadora): qué falta, sin botones. */
function readOnlyText(
  need: ImportNeed,
  partyName: (id: string | null | undefined) => string | null,
): string {
  switch (need.key) {
    case 'new_supplier':
      return `${need.name} (CUIT ${formatCuit(need.cuit)}) todavía no está en los proveedores.`
    case 'manual':
      return MANUAL_REASON_TEXT[need.reason]
    case 'engine_error':
      return need.message || NEED_TEXT.engine_error
    case 'supplier_account':
    case 'supplier_inactive':
    case 'condition_mismatch': {
      const name = partyName(need.party_id)
      return name ? `${name}: ${NEED_TEXT[need.key]}` : NEED_TEXT[need.key]
    }
    default:
      return NEED_TEXT[need.key]
  }
}

// ─── Cada arreglo ────────────────────────────────────────────────────────────

function SupplierAccount({
  p,
  partyId,
  partyName,
}: {
  p: ProposalView
  partyId: string
  partyName: string | null
}) {
  const { options, resolve, busyKey } = useReview()
  const id = useId()
  const [accountId, setAccountId] = useState<string | null>(null)
  const purchase = useMemo(
    () => new Set((options?.accounts ?? []).filter((a) => a.purchase).map((a) => a.id)),
    [options],
  )
  return (
    <Frame
      text={`¿En qué gastás con ${partyName ?? 'este proveedor'}? Lo guardamos en el proveedor y la próxima vez va solo.`}
    >
      <div className="grid gap-1.5 sm:max-w-md">
        <Label htmlFor={id} className="sr-only">
          Cuenta habitual de {partyName ?? 'el proveedor'}
        </Label>
        <AccountCombobox
          id={id}
          value={accountId}
          accounts={options?.accounts ?? []}
          filter={(a) => purchase.has(a.id)}
          placeholder="Elegí en qué se gasta"
          onValueChange={(next) => setAccountId(next)}
        />
      </div>
      <Actions>
        <Button
          type="button"
          className={BUTTON}
          disabled={!accountId || busyKey === p.key}
          onClick={() =>
            accountId &&
            void resolve(p.key, [{ kind: 'supplier_account', partyId, accountId }], {
              success: 'Listo: quedó guardado en el proveedor.',
            })
          }
        >
          Guardar
        </Button>
      </Actions>
    </Frame>
  )
}

function ConditionMismatch({
  p,
  need,
  partyName,
}: {
  p: ProposalView
  need: Extract<ImportNeed, { key: 'condition_mismatch' }>
  partyName: string | null
}) {
  const { resolve, busyKey } = useReview()
  const id = useId()
  const [condition, setCondition] = useState<IvaCondition>(
    need.suggested_condition ?? 'responsable_inscripto',
  )
  const now = IVA_CONDITION_TEXT[need.condition].toLowerCase()
  const suggested = need.suggested_condition
    ? IVA_CONDITION_TEXT[need.suggested_condition].toLowerCase()
    : null
  return (
    <Frame
      text={`${partyName ?? 'El proveedor'} figura como ${now}, pero este comprobante es ${suggested ? `de un ${suggested}` : 'de otra condición'}. Revisá su constancia de ARCA y actualizalo.`}
    >
      <div className="grid gap-1.5 sm:max-w-xs">
        <Label htmlFor={id}>Condición frente al IVA</Label>
        <Select value={condition} onValueChange={(v) => setCondition(v as IvaCondition)}>
          <SelectTrigger id={id} className={SELECT_CLASS}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {SUPPLIER_IVA_CONDITIONS.map((c) => (
              <SelectItem key={c} value={c}>
                {IVA_CONDITION_TEXT[c]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <Actions>
        <Button
          type="button"
          className={BUTTON}
          disabled={busyKey === p.key}
          onClick={() =>
            void resolve(
              p.key,
              [{ kind: 'supplier_condition', partyId: need.party_id, ivaCondition: condition }],
              { success: 'Listo: actualizamos el proveedor.' },
            )
          }
        >
          Actualizar el proveedor
        </Button>
      </Actions>
    </Frame>
  )
}

const OTHER_TAXES_CHOICES: readonly OtherTaxesAs[] = [
  'perc_iibb',
  'perc_iva',
  'internal',
  'account',
]

function OtherTaxes({
  p,
  need,
  partyName,
}: {
  p: ProposalView
  need: Extract<ImportNeed, { key: 'other_taxes_as' }>
  partyName: string | null
}) {
  const { options, resolve, busyKey } = useReview()
  const base = useId()
  const [as, setAs] = useState<OtherTaxesAs | null>(null)
  const [jurisdiction, setJurisdiction] = useState<number>(options?.iibbJurisdictionCode ?? 904)
  const [accountId, setAccountId] = useState<string | null>(null)
  const [remember, setRemember] = useState(need.party_id !== null)
  const ready = as !== null && (as !== 'account' || accountId !== null)

  const apply = () => {
    if (!as) return
    const rememberIt = remember && need.party_id !== null
    void resolve(
      p.key,
      [
        {
          kind: 'other_taxes_as',
          proposalKey: rememberIt ? null : p.key,
          partyId: rememberIt ? need.party_id : null,
          as,
          accountId: as === 'account' ? accountId : null,
          jurisdictionCode: as === 'perc_iibb' ? jurisdiction : null,
          remember: rememberIt,
        },
      ],
      {
        success: rememberIt
          ? 'Listo: lo aplicamos a todas sus facturas y lo recordamos para la próxima.'
          : 'Listo, lo tuvimos en cuenta.',
      },
    )
  }

  return (
    <Frame
      text={`La factura trae ${formatCents(need.amount_cents)} de «Otros tributos» y ARCA no dice qué son. ¿Qué son?`}
    >
      <ChoiceChips
        label="Qué son los otros tributos"
        value={as}
        onChange={setAs}
        options={OTHER_TAXES_CHOICES.map((o) => ({ value: o, label: OTHER_TAXES_TEXT[o].label }))}
      />
      {as ? <p className="text-xs text-muted-foreground">{OTHER_TAXES_TEXT[as].hint}</p> : null}
      {as === 'perc_iibb' ? (
        <div className="grid gap-1.5 sm:max-w-xs">
          <Label htmlFor={`${base}-jur`}>¿De qué provincia?</Label>
          <Select value={String(jurisdiction)} onValueChange={(v) => setJurisdiction(Number(v))}>
            <SelectTrigger id={`${base}-jur`} className={SELECT_CLASS}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {IIBB_JURISDICTIONS.map((j) => (
                <SelectItem key={j.code} value={String(j.code)}>
                  {j.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      ) : null}
      {as === 'account' ? (
        <div className="grid gap-1.5 sm:max-w-md">
          <Label htmlFor={`${base}-acc`}>¿A qué cuenta va?</Label>
          <AccountCombobox
            id={`${base}-acc`}
            value={accountId}
            accounts={options?.accounts ?? []}
            onValueChange={(next) => setAccountId(next)}
          />
        </div>
      ) : null}
      {need.party_id ? (
        <div className="flex items-start gap-2">
          <Checkbox
            id={`${base}-rem`}
            checked={remember}
            onCheckedChange={(v) => setRemember(v === true)}
            className="mt-0.5"
          />
          <Label htmlFor={`${base}-rem`} className="font-normal leading-snug">
            Recordarlo para {partyName ?? 'este proveedor'} (se aplica a todas sus facturas, también
            las próximas)
          </Label>
        </div>
      ) : null}
      <Actions>
        <Button
          type="button"
          className={BUTTON}
          disabled={!ready || busyKey === p.key}
          onClick={apply}
        >
          Guardar
        </Button>
      </Actions>
    </Frame>
  )
}

function Confirmable({
  p,
  need,
  text,
  confirmLabel,
}: {
  p: ProposalView
  need: 'foreign_currency' | 'possible_duplicate' | 'estimated_deductions'
  text: string
  confirmLabel: string
}) {
  const { resolve, busyKey } = useReview()
  return (
    <Frame text={text}>
      <Actions>
        <Button
          type="button"
          className={cn(BUTTON, 'gap-2')}
          disabled={busyKey === p.key}
          onClick={() => void resolve(p.key, [{ kind: 'confirm', proposalKey: p.key, need }])}
        >
          <Check className="size-4" aria-hidden />
          {confirmLabel}
        </Button>
      </Actions>
    </Frame>
  )
}

function PossibleDuplicate({
  p,
  label,
  documentId,
}: {
  p: ProposalView
  label: string
  documentId: string
}) {
  const { resolve, busyKey, slug } = useReview()
  const { ignore } = useRowActions()
  return (
    <Frame
      text={
        <>
          Ya cargaste{' '}
          <Link
            href={`/${slug}/administracion/comprobantes/${documentId}`}
            className="font-medium underline underline-offset-2"
          >
            {label}
          </Link>{' '}
          con el mismo proveedor y el mismo total. ¿Es otro comprobante?
        </>
      }
    >
      <Actions>
        <Button
          type="button"
          className={BUTTON}
          disabled={busyKey === p.key}
          onClick={() =>
            void resolve(p.key, [
              { kind: 'confirm', proposalKey: p.key, need: 'possible_duplicate' },
            ])
          }
        >
          Es otro: cargalo
        </Button>
        <Button
          type="button"
          variant="outline"
          className={BUTTON}
          disabled={busyKey === p.key}
          onClick={() => void ignore(p, 'Ya estaba cargado', 'Listo: no se carga dos veces.')}
        >
          Es el mismo: no lo cargues
        </Button>
      </Actions>
    </Frame>
  )
}

function MpInvoice({ p }: { p: ProposalView }) {
  const { resolve, busyKey } = useReview()
  return (
    <Frame text="¿Es la factura mensual de Mercado Pago por las comisiones que ya te descontó? Si es eso, la cargamos sin volver a pagarla y te deja descontar su IVA.">
      <Actions>
        <Button
          type="button"
          className={BUTTON}
          disabled={busyKey === p.key}
          onClick={() =>
            void resolve(p.key, [{ kind: 'settles_commissions', proposalKey: p.key, value: true }])
          }
        >
          Sí, es la de comisiones
        </Button>
        <Button
          type="button"
          variant="outline"
          className={BUTTON}
          disabled={busyKey === p.key}
          onClick={() =>
            void resolve(p.key, [{ kind: 'settles_commissions', proposalKey: p.key, value: false }])
          }
        >
          No, es otra compra
        </Button>
      </Actions>
    </Frame>
  )
}

function ChannelMethod({
  p,
  channel,
}: {
  p: ProposalView
  channel: Extract<ImportNeed, { key: 'channel_method' }>['channel']
}) {
  const { options, resolve, busyKey } = useReview()
  const id = useId()
  const [methodId, setMethodId] = useState<string | null>(null)
  return (
    <Frame
      text={`¿Cómo se llaman los «${MP_CHANNEL_TEXT[channel]}» en tu cierre del día? Lo guardamos para las próximas importaciones.`}
    >
      <div className="grid gap-1.5 sm:max-w-xs">
        <Label htmlFor={id} className="sr-only">
          Medio del cierre del día
        </Label>
        <Select value={methodId ?? undefined} onValueChange={setMethodId}>
          <SelectTrigger id={id} className={SELECT_CLASS}>
            <SelectValue placeholder="Elegí el medio" />
          </SelectTrigger>
          <SelectContent>
            {(options?.methods ?? []).map((m) => (
              <SelectItem key={m.id} value={m.id}>
                {m.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <Actions>
        <Button
          type="button"
          className={BUTTON}
          disabled={!methodId || busyKey === p.key}
          onClick={() =>
            methodId &&
            void resolve(p.key, [{ kind: 'channel_method', channel, salesMethodId: methodId }], {
              success: 'Listo: lo guardamos para las próximas.',
            })
          }
        >
          Guardar
        </Button>
      </Actions>
    </Frame>
  )
}

function PickParty({
  p,
  role,
  suggested,
}: {
  p: ProposalView
  role: Extract<ImportNeed, { key: 'pick_party' }>['role']
  suggested: string | null
}) {
  const { options, resolve, busyKey } = useReview()
  const id = useId()
  const [partyId, setPartyId] = useState<string | null>(suggested)
  const kinds = useMemo(() => partyKindsForRole(role), [role])
  const parties = useMemo(
    () => (options?.parties ?? []).filter((x) => !kinds || kinds.includes(x.kind)),
    [options, kinds],
  )
  return (
    <Frame text={`${PARTY_ROLE_TEXT[role]}.${suggested ? ' Te sugerimos uno: revisalo.' : ''}`}>
      <div className="grid gap-1.5 sm:max-w-md">
        <Label htmlFor={id} className="sr-only">
          {PARTY_ROLE_TEXT[role]}
        </Label>
        <PartyCombobox
          id={id}
          value={partyId}
          parties={parties.length > 0 ? parties : (options?.parties ?? [])}
          placeholder="Elegí a quién"
          onValueChange={(next) => setPartyId(next)}
        />
      </div>
      <Actions>
        <Button
          type="button"
          className={BUTTON}
          disabled={!partyId || busyKey === p.key}
          onClick={() =>
            partyId && void resolve(p.key, [{ kind: 'pick_party', proposalKey: p.key, partyId }])
          }
        >
          Elegir
        </Button>
      </Actions>
    </Frame>
  )
}

function PickTreasury({ p, suggested }: { p: ProposalView; suggested: string | null }) {
  const { options, resolve, busyKey } = useReview()
  const id = useId()
  const [treasuryId, setTreasuryId] = useState<string | null>(suggested)
  return (
    <Frame text="¿De qué cuenta tuya es la otra punta del movimiento (adónde fue o de dónde vino la plata)?">
      <div className="grid gap-1.5 sm:max-w-md">
        <Label htmlFor={id} className="sr-only">
          La otra cuenta
        </Label>
        <TreasurySelect
          id={id}
          value={treasuryId}
          treasuries={options?.treasuries ?? []}
          onValueChange={(next) => setTreasuryId(next)}
        />
      </div>
      <Actions>
        <Button
          type="button"
          className={BUTTON}
          disabled={!treasuryId || busyKey === p.key}
          onClick={() =>
            treasuryId &&
            void resolve(p.key, [
              { kind: 'pick_treasury', proposalKey: p.key, treasuryAccountId: treasuryId },
            ])
          }
        >
          Elegir
        </Button>
      </Actions>
    </Frame>
  )
}

function PickAccount({ p, tax, text }: { p: ProposalView; tax: string | null; text: string }) {
  const { options, resolve, busyKey } = useReview()
  const id = useId()
  const [accountId, setAccountId] = useState<string | null>(null)
  const notTreasury = useMemo(
    () => new Set((options?.accounts ?? []).filter((a) => !a.treasury).map((a) => a.id)),
    [options],
  )
  return (
    <Frame text={text}>
      <div className="grid gap-1.5 sm:max-w-md">
        <Label htmlFor={id} className="sr-only">
          Cuenta
        </Label>
        <AccountCombobox
          id={id}
          value={accountId}
          accounts={options?.accounts ?? []}
          filter={(a) => notTreasury.has(a.id)}
          onValueChange={(next) => setAccountId(next)}
        />
      </div>
      <Actions>
        <Button
          type="button"
          className={BUTTON}
          disabled={!accountId || busyKey === p.key}
          onClick={() =>
            accountId &&
            void resolve(p.key, [{ kind: 'pick_account', proposalKey: p.key, accountId, tax }])
          }
        >
          Elegir
        </Button>
      </Actions>
    </Frame>
  )
}

function AcceptWarnings({
  p,
  warnings,
}: {
  p: ProposalView
  warnings: Extract<ImportNeed, { key: 'accept_warning' }>['warnings']
}) {
  const { resolve, busyKey } = useReview()
  return (
    <div className="space-y-2">
      {warnings.map((w) => (
        <Frame key={w} text={WARNING_COPY[w].fallback}>
          <Actions>
            <Button
              type="button"
              className={BUTTON}
              disabled={busyKey === p.key}
              onClick={() =>
                void resolve(p.key, [{ kind: 'accept_warning', proposalKey: p.key, warning: w }])
              }
            >
              {WARNING_COPY[w].confirmLabel}
            </Button>
          </Actions>
        </Frame>
      ))}
    </div>
  )
}

function Receipt({ p }: { p: ProposalView }) {
  const { busyKey } = useReview()
  const { ignore, loadByHand } = useRowActions()
  return (
    <Frame text="Es un recibo. Si es el comprobante de pago de una factura que ya cargaste, no hace falta cargarlo; si es un gasto que no tiene factura, cargalo a mano.">
      <Actions>
        <Button
          type="button"
          className={BUTTON}
          disabled={busyKey === p.key}
          onClick={() =>
            void ignore(p, 'Recibo de una factura ya cargada', 'Listo: el recibo no se carga.')
          }
        >
          Es el pago de una factura: no lo cargues
        </Button>
        <Button
          type="button"
          variant="outline"
          className={BUTTON}
          disabled={busyKey === p.key}
          onClick={() => void loadByHand(p)}
        >
          Es un gasto: lo cargo a mano
        </Button>
      </Actions>
    </Frame>
  )
}

function ManualOnly({
  p,
  text,
  notOurs = false,
}: {
  p: ProposalView
  text: string
  notOurs?: boolean
}) {
  const { busyKey } = useReview()
  const { ignore, loadByHand } = useRowActions()
  return (
    <Frame text={text}>
      <Actions>
        <Button
          type="button"
          className={BUTTON}
          disabled={busyKey === p.key}
          onClick={() => void loadByHand(p)}
        >
          Cargarla a mano
        </Button>
        {notOurs ? (
          <Button
            type="button"
            variant="outline"
            className={BUTTON}
            disabled={busyKey === p.key}
            onClick={() => void ignore(p, 'No es de la SAS')}
          >
            No es nuestro
          </Button>
        ) : null}
      </Actions>
    </Frame>
  )
}
