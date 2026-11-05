import { notFound } from 'next/navigation'
import { TaskHeader } from '@/app/(manager)/[tenantSlug]/administracion/gastos-fijos/_components/task-header'
import { categoryOptions, PanelError } from '@/components/administracion/kit'
import { SimplePage } from '@/components/administracion/planilla'
import { ReadOnlyNotice } from '@/components/administracion/read-only'
import { AccountingContextError, loadPostingCatalog } from '@/lib/accounting/context'
import { getRecurringExpense, settleQuery } from '@/lib/accounting/queries'
import { todayInCordoba } from '@/lib/dates'
import { formatCuit } from '@/lib/fiscal'
import { isPurchaseImputation, isQuickExpenseAccount } from '../../_lib/accounts'
import { gastosFijosHref, isUuidLike, recurringHref } from '../../_lib/links'
import { requireComprasAccess } from '../../_lib/page-access'
import { isRecurringFrequency, nextDueFrom } from '../../_lib/recurring'
import { RecurringForm } from './_components/recurring-form'
import type { RecurringFormValues } from './_lib/form-payload'

export const metadata = { title: 'Gasto fijo' }

const PARTY_KINDS = new Set(['supplier', 'other', 'tax_agency'])

/**
 * La ficha de un gasto fijo: alta (`/gastos-fijos/nuevo`) o edición, con todo lo que la planilla no
 * deja cambiar en la fila (el papel de siempre, a quién y con qué se paga, las cuotas, el detalle).
 * Lee lo mismo de siempre: ninguna lectura más.
 *
 * A la contadora se le muestra un aviso con la vuelta a la planilla.
 */
export default async function GastoFijoPage({
  params,
}: {
  params: Promise<{ tenantSlug: string; id: string }>
}) {
  const { tenantSlug, id } = await params
  const creating = id === 'nuevo'
  if (!creating && !isUuidLike(id)) notFound()
  const backHref = gastosFijosHref(tenantSlug)
  const back = { href: backHref, label: 'Gastos fijos' }
  const { access, canWrite } = await requireComprasAccess(
    tenantSlug,
    recurringHref(tenantSlug, creating ? 'nuevo' : id),
  )

  if (!canWrite) {
    return (
      <SimplePage width="narrow">
        <TaskHeader back={back} title="Gasto fijo" />
        <ReadOnlyNotice
          description="Esta pantalla es para cargar gastos fijos. Con Contabilidad podés verlos en Gastos fijos."
          href={backHref}
          linkLabel="Ir a Gastos fijos"
        />
      </SimplePage>
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

  if (!catalogOutcome.ok || (rowOutcome && !rowOutcome.ok)) {
    const message = !catalogOutcome.ok
      ? catalogOutcome.message
      : rowOutcome && !rowOutcome.ok
        ? rowOutcome.message
        : ''
    return (
      <SimplePage width="narrow">
        <TaskHeader back={back} title={title} />
        <PanelError title="La ficha del gasto fijo" message={message} />
      </SimplePage>
    )
  }

  const catalog = catalogOutcome.data
  const imputable = new Set(catalog.accounts.filter(isPurchaseImputation).map((a) => a.id))
  // Los chips de «¿En qué se gasta?»: las categorías pensadas para un gasto. Lo demás que se
  // puede imputar sigue estando en «Ver el plan completo».
  const quick = new Set(catalog.accounts.filter(isQuickExpenseAccount).map((a) => a.id))
  const categories = categoryOptions(catalog.accounts, (accountId) => quick.has(accountId))
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
        installmentsTotal: row.installmentsTotal,
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
        installmentsTotal: null,
        breakdown: [],
      }

  return (
    <SimplePage width="narrow">
      <TaskHeader back={back} title={title} />
      <RecurringForm
        tenantSlug={tenantSlug}
        today={today}
        initial={initial}
        backHref={backHref}
        categories={categories}
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
      />
    </SimplePage>
  )
}
