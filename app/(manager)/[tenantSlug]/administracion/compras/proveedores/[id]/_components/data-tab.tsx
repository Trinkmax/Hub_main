import type { ReactNode } from 'react'
import {
  type AccountRow,
  listAccounts,
  PARTY_KIND_LABELS,
  type PartyDetail,
  settleQuery,
} from '@/lib/accounting/queries'
import { ivaConditionLabel } from '@/lib/accounting/queries/csv'
import { voucherLabel } from '@/lib/accounting/voucher-types'
import { getArcaLookupStatus } from '@/lib/arca/queries'
import { formatCuit } from '@/lib/fiscal'
import { cn } from '@/lib/utils'
import { isPurchaseImputation } from '../../../_lib/accounts'
import { PURCHASE_VOUCHER_OPTIONS } from '../../../_lib/vouchers'
import { SupplierActiveToggle } from './supplier-active-toggle'
import { SupplierDataForm } from './supplier-data-form'

function Row({ label, children, muted }: { label: string; children: ReactNode; muted?: boolean }) {
  return (
    <div className="grid gap-1 py-3 sm:grid-cols-[200px_minmax(0,1fr)] sm:gap-4">
      <dt className="text-xs font-medium uppercase tracking-[0.12em] text-muted-foreground sm:pt-0.5">
        {label}
      </dt>
      <dd className={cn('text-sm', muted && 'text-muted-foreground')}>{children}</dd>
    </div>
  )
}

function documentText(party: PartyDetail): string {
  if (party.taxIdType === 'none' || !party.taxId) return 'Sin documento cargado'
  if (party.taxIdType === 'dni') return `DNI ${party.taxId}`
  const label = party.taxIdType === 'cuil' ? 'CUIL' : 'CUIT'
  return `${label} ${formatCuit(party.taxId)}`
}

/**
 * «Datos» de un proveedor (H.7): lo que el sistema sabe de él y lo que usa
 * para proponer en cada carga. El dueño lo edita en un diálogo; la contadora
 * lo ve igual, sin botones.
 */
export async function DataTab({
  tenantId,
  tenantSlug,
  party,
  canWrite,
  hasBalance,
}: {
  tenantId: string
  tenantSlug: string
  party: PartyDetail
  canWrite: boolean
  hasBalance: boolean
}) {
  // «Completar con ARCA» en «Editar datos»: si ARCA no se pudo leer (p. ej. la base
  // todavía no tiene sus tablas), el formulario queda como siempre.
  const [accounts, arcaLookup] = canWrite
    ? await Promise.all([
        settleQuery(listAccounts(tenantId)),
        settleQuery(getArcaLookupStatus(tenantId)),
      ])
    : [null, null]
  const options: AccountRow[] = accounts?.ok ? accounts.data : []
  const imputable = new Set(options.filter(isPurchaseImputation).map((a) => a.id))

  return (
    <div className="card-hairline rounded-xl border bg-card">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-border/60 px-5 py-4">
        <div>
          <h2 className="font-serif text-lg font-semibold tracking-tight">Datos del proveedor</h2>
          <p className="text-xs text-muted-foreground">
            Se usan para proponer el comprobante, la cuenta y el vencimiento de cada carga.
          </p>
        </div>
        {canWrite ? (
          <div className="flex flex-wrap items-center gap-2">
            <SupplierActiveToggle
              tenantSlug={tenantSlug}
              id={party.id}
              name={party.name}
              kind={party.kind}
              active={party.active}
              updatedAt={party.updatedAt}
              hasBalance={hasBalance}
            />
            <SupplierDataForm
              tenantSlug={tenantSlug}
              values={{
                id: party.id,
                updatedAt: party.updatedAt,
                kind: party.kind,
                name: party.name,
                tradeName: party.tradeName,
                taxIdType: party.taxIdType,
                taxId: party.taxId
                  ? party.taxIdType === 'cuit' || party.taxIdType === 'cuil'
                    ? formatCuit(party.taxId)
                    : party.taxId
                  : null,
                ivaCondition: party.ivaCondition,
                email: party.email,
                phone: party.phone,
                address: party.address,
                paymentTermDays: party.paymentTermDays,
                defaultAccountId: party.defaultAccountId,
                defaultVoucherType: party.defaultVoucherType,
                notes: party.notes,
              }}
              accounts={options
                .filter(
                  (a) => imputable.has(a.id) || a.id === party.defaultAccountId || !a.postable,
                )
                .map((a) => ({
                  id: a.id,
                  code: a.code,
                  name: a.name,
                  postable: a.postable && imputable.has(a.id),
                  active: a.active,
                  description: a.description,
                }))}
              voucherOptions={PURCHASE_VOUCHER_OPTIONS}
              arcaLookup={arcaLookup?.ok ? arcaLookup.data : null}
            />
          </div>
        ) : null}
      </header>
      <dl className="divide-y divide-border/60 px-5">
        <Row label="Razón social">{party.name}</Row>
        <Row label="Nombre de fantasía" muted={!party.tradeName}>
          {party.tradeName ?? 'No tiene'}
        </Row>
        <Row label="Tipo">{PARTY_KIND_LABELS[party.kind] ?? 'Otro'}</Row>
        <Row label="Documento" muted={!party.taxId}>
          {documentText(party)}
        </Row>
        <Row label="Condición frente al IVA">{ivaConditionLabel(party.ivaCondition)}</Row>
        <Row label="Plazo de pago">
          {party.paymentTermDays === 0
            ? 'De contado'
            : `${party.paymentTermDays} ${party.paymentTermDays === 1 ? 'día' : 'días'}`}
        </Row>
        <Row label="Cuenta habitual" muted={!party.defaultAccountName}>
          {party.defaultAccountName ?? 'Se completa sola con la primera factura'}
        </Row>
        <Row label="Comprobante habitual" muted={!party.defaultVoucherType}>
          {party.defaultVoucherType
            ? voucherLabel(party.defaultVoucherType)
            : 'El del último que cargaste'}
        </Row>
        <Row label="Contacto" muted={!party.email && !party.phone}>
          {[party.email, party.phone].filter(Boolean).join(' · ') || 'Sin datos de contacto'}
        </Row>
        <Row label="Dirección" muted={!party.address}>
          {party.address ?? 'Sin dirección'}
        </Row>
        <Row label="Notas" muted={!party.notes}>
          <span className="whitespace-pre-line">{party.notes ?? 'Sin notas'}</span>
        </Row>
        <Row label="Estado">{party.active ? 'Activo' : 'Desactivado'}</Row>
      </dl>
    </div>
  )
}
