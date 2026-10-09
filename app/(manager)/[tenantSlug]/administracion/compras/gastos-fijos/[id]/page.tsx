import { ArrowLeft } from 'lucide-react'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { ReadOnlyNotice } from '@/components/administracion/read-only'
import { PageHeader } from '@/components/ui/page-header'
import { PageShell } from '@/components/ui/page-shell'
import { AccountingContextError, loadPostingCatalog } from '@/lib/accounting/context'
import { getRecurringExpense, settleQuery } from '@/lib/accounting/queries'
import { todayInCordoba } from '@/lib/dates'
import { formatCuit } from '@/lib/fiscal'
import { BlockError } from '../../_components/block-error'
import { isPurchaseImputation } from '../../_lib/accounts'
import { comprasHref, isUuidLike, recurringHref } from '../../_lib/links'
import { requireComprasAccess } from '../../_lib/page-access'
import { isRecurringFrequency, nextDueFrom } from '../../_lib/recurring'
import { PURCHASE_VOUCHER_OPTIONS } from '../../_lib/vouchers'
import { RecurringForm, type RecurringFormValues } from './_components/recurring-form'

export const metadata = { title: 'Gasto fijo' }

const PARTY_KINDS = new Set(['supplier', 'other', 'tax_agency'])

/**
 * Alta (`/gastos-fijos/nuevo`) o edición de un gasto fijo (H.7). La contadora
 * ve un aviso con el link a la lista.
 */
export default async function GastoFijoPage({
  params,
}: {
  params: Promise<{ tenantSlug: string; id: string }>
}) {
  const { tenantSlug, id } = await params
  const creating = id === 'nuevo'
  if (!creating && !isUuidLike(id)) notFound()
  const backHref = comprasHref(tenantSlug, 'gastos-fijos')
  const { access, canWrite } = await requireComprasAccess(
    tenantSlug,
    recurringHref(tenantSlug, creating ? 'nuevo' : id),
  )

  const header = (title: string, description: string) => (
    <>
      <Link
        href={backHref}
        className="inline-flex min-h-11 items-center gap-1 text-xs font-medium text-muted-foreground hover:text-foreground md:min-h-0"
      >
        <ArrowLeft className="size-3" aria-hidden />
        Volver a gastos fijos
      </Link>
      <PageHeader eyebrow="Administración" title={title} description={description} />
    </>
  )

  if (!canWrite) {
    return (
      <PageShell width="compact">
        {header('Gasto fijo', 'Los recordatorios de alquiler, luz e internet.')}
        <ReadOnlyNotice
          description="Esta pantalla es para cargar gastos fijos. Con Contabilidad podés verlos en Compras › Gastos fijos."
          href={backHref}
          linkLabel="Ir a Gastos fijos"
        />
      </PageShell>
    )
  }

  const tenantId = access.tenant.id
  const today = todayInCordoba()
  const [catalogOutcome, rowOutcome] = await Promise.all([
    loadPostingCatalog(tenantId).then(
      (data) => ({ ok: true as const, data }),
      (error: unknown) => ({
        ok: false as const,
        message:
          error instanceof AccountingContextError
            ? error.state.message
            : 'No pudimos cargar los datos. Probá de nuevo; si sigue, avisanos.',
      }),
    ),
    creating ? Promise.resolve(null) : settleQuery(getRecurringExpense(tenantId, id)),
  ])

  if (rowOutcome?.ok && rowOutcome.data === null) notFound()
  const row = rowOutcome?.ok ? rowOutcome.data : null
  const title = creating ? 'Nuevo gasto fijo' : (row?.name ?? 'Gasto fijo')
  const description =
    'No es una deuda hasta que cargás la factura: es un recordatorio para que no se te pase.'

  if (!catalogOutcome.ok || (rowOutcome && !rowOutcome.ok)) {
    const message = !catalogOutcome.ok
      ? catalogOutcome.message
      : rowOutcome && !rowOutcome.ok
        ? rowOutcome.message
        : ''
    return (
      <PageShell width="compact">
        {header(title, description)}
        <BlockError message={message} />
      </PageShell>
    )
  }

  const catalog = catalogOutcome.data
  const imputable = new Set(catalog.accounts.filter(isPurchaseImputation).map((a) => a.id))
  const initial: RecurringFormValues = row
    ? {
        id: row.id,
        updatedAt: row.updatedAt,
        name: row.name,
        partyId: row.partyId,
        accountId: row.accountId,
        voucherType: row.voucherType,
        vatRateBp: row.vatRateBp,
        amountCents: row.amountCents,
        frequency: isRecurringFrequency(row.frequency) ? row.frequency : 'monthly',
        dueDay: row.dueDay,
        nextDueDate: row.nextDueDate,
        remindDaysBefore: row.remindDaysBefore,
        treasuryAccountId: row.treasuryAccountId,
        active: row.active,
        notes: row.notes ?? '',
        endsOn: row.endsOn,
        breakdown: row.breakdown,
      }
    : {
        id: null,
        updatedAt: null,
        name: '',
        partyId: null,
        accountId: null,
        voucherType: null,
        vatRateBp: null,
        amountCents: null,
        frequency: 'monthly',
        dueDay: 10,
        nextDueDate: nextDueFrom(today, 10),
        remindDaysBefore: 5,
        treasuryAccountId: null,
        active: true,
        notes: '',
        endsOn: null,
        breakdown: [],
      }

  return (
    <PageShell width="compact">
      {header(title, description)}
      <RecurringForm
        tenantSlug={tenantSlug}
        today={today}
        initial={initial}
        backHref={backHref}
        parties={catalog.parties
          .filter((p) => PARTY_KINDS.has(p.kind) && (p.active || p.id === initial.partyId))
          .map((p) => ({
            id: p.id,
            name: p.name,
            tradeName: p.tradeName,
            taxId: p.taxId,
            active: p.active,
            description: p.taxId ? `CUIT ${formatCuit(p.taxId)}` : null,
          }))}
        accounts={catalog.accounts
          .filter((a) => !a.postable || imputable.has(a.id) || a.id === initial.accountId)
          .map((a) => ({
            id: a.id,
            code: a.code,
            name: a.name,
            postable: a.postable && (imputable.has(a.id) || a.id === initial.accountId),
            active: a.active,
            description: a.description,
          }))}
        treasuries={catalog.treasuries.map((t) => ({
          id: t.id,
          name: t.name,
          kind: t.kind,
          balanceCents: t.balanceCents,
          active: t.active,
        }))}
        voucherOptions={PURCHASE_VOUCHER_OPTIONS}
      />
    </PageShell>
  )
}
