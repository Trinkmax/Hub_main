'use client'

import {
  CalendarPlus,
  ChevronRight,
  CircleCheck,
  FileText,
  MoreHorizontal,
  Plus,
  Receipt,
  Wallet,
} from 'lucide-react'
import Link from 'next/link'
import * as React from 'react'
import { toast } from 'sonner'
import { AccountPicker } from '@/components/accounting/account-picker'
import { AgingBar } from '@/components/accounting/aging-bar'
import { AmountStack, AmountStackRow } from '@/components/accounting/amount-stack'
import { closedMonthGuard } from '@/components/accounting/closed-periods'
import { EntryEditor } from '@/components/accounting/entry-editor'
import { type EntryLine, EntryPreview } from '@/components/accounting/entry-preview'
import { LedgerTable } from '@/components/accounting/ledger-table'
import { VoucherNumberFields } from '@/components/accounting/voucher-number-fields'
import { Amount } from '@/components/ui/amount'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Combobox, type EntityOption } from '@/components/ui/combobox'
import { useConfirm } from '@/components/ui/confirm-dialog'
import {
  DataTable,
  DataTableBody,
  DataTableCell,
  type DataTableColumn,
  DataTableGroupRow,
  DataTableHead,
  DataTableHeader,
  DataTableRoot,
  DataTableRow,
  DataTableScroll,
  DataTableShell,
  DataTableToolbar,
  ExportButton,
} from '@/components/ui/data-table'
import { DatePicker } from '@/components/ui/date-picker'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { DueStatus } from '@/components/ui/due-status'
import { Field, FieldRow, FormSection } from '@/components/ui/field'
import { FormActions } from '@/components/ui/form-actions'
import { Input, SearchField } from '@/components/ui/input'
import { KPI, KPIGroup } from '@/components/ui/kpi'
import { MoneyField } from '@/components/ui/money-field'
import { PageHeader } from '@/components/ui/page-header'
import {
  ClosedPeriodCallout,
  DetailTemplate,
  FormTemplate,
  ListEmptyState,
  ListTemplate,
  ReadOnlyCallout,
  ReportTemplate,
  StatementTemplate,
  SummaryTemplate,
} from '@/components/ui/page-templates'
import { Pagination } from '@/components/ui/pagination'
import { type Period, PeriodPicker } from '@/components/ui/period-picker'
import { Section } from '@/components/ui/section'
import { SegmentedControl } from '@/components/ui/segmented-control'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { SubmitButton } from '@/components/ui/submit-button'
import { TabsNav } from '@/components/ui/tabs-nav'
import { vatFromNet } from '@/lib/accounting/iva'
import { addDays, addMonthsToYearMonth, monthOf } from '@/lib/dates/civil'
import { formatIsoDay } from '@/lib/dates/format'
import { CatalogBlock, CatalogFamily, DemoRow, DemoStack } from './catalog-block'
import { useCatalog } from './catalog-provider'
import { wait } from './demo-utils'
import { tourId } from './registry'
import {
  SAMPLE_ACCOUNTS,
  SAMPLE_AGING,
  SAMPLE_SUPPLIERS,
  type SampleSupplier,
  sampleAccount,
  sampleStatement,
  sampleSuppliersCsv,
  supplierDueDate,
} from './sample-data'

/**
 * Las plantillas son páginas enteras: adentro del panel van sin el relleno
 * del `PageShell` (el panel ya tiene el suyo).
 */
const IN_PANEL = 'py-0 sm:py-0'

/** Las filas-link de «Pide atención» y de «Accesos»: el link estirado, sin escala (§2.10). */
const LINK_ROW =
  'relative flex min-h-11 items-center gap-3 px-1 py-2 hover:bg-hover active:bg-active outline-(--ring) -outline-offset-2 focus-visible:outline-2 rounded-md'

// ─── Resumen ─────────────────────────────────────────────────────────────────

function SummaryDemo() {
  const { basePath, today } = useCatalog()
  return (
    <SummaryTemplate
      flush
      className={IN_PANEL}
      data-tour={tourId('summary-template')}
      header={
        <PageHeader
          title="Resumen"
          context="Buenas tardes, Bar de ejemplo"
          actions={
            <Button type="button">
              <CalendarPlus aria-hidden="true" />
              Nueva reserva
            </Button>
          }
        />
      }
      kpis={
        <KPIGroup>
          <KPI
            label="Reservas 30 d"
            value="412"
            delta={{ value: '+12 %', direction: 'up', tone: 'positive' }}
          />
          <KPI label="Personas" value="1.386" />
          <KPI label="Clientes activos" value="902" />
          <KPI label="Facturación" value={<Amount cents={1_842_000_000} decimals={0} />} />
        </KPIGroup>
      }
      attention={
        <Section title="Pide atención" headingLevel={3}>
          <ul className="flex flex-col divide-y divide-border">
            <li>
              <Link href={`${basePath}#summary-template`} className={LINK_ROW}>
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="type-body text-foreground">3 facturas vencen esta semana</span>
                  <DueStatus dueDate={addDays(today, 3)} today={today} className="type-small" />
                </span>
                <Amount cents={86_000_000} decimals={0} className="type-body font-medium" />
                <ChevronRight aria-hidden="true" className="size-4 text-muted-foreground" />
              </Link>
            </li>
            <li>
              <Link href={`${basePath}#summary-template`} className={LINK_ROW}>
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="type-body text-foreground">Cupo de la cena del sábado</span>
                  <span className="type-small text-muted-foreground">110 de 120 lugares</span>
                </span>
                <Badge tone="warning" dot>
                  92 %
                </Badge>
                <ChevronRight aria-hidden="true" className="size-4 text-muted-foreground" />
              </Link>
            </li>
          </ul>
        </Section>
      }
      shortcuts={
        <Section title="Accesos" headingLevel={3}>
          <ul className="flex flex-col">
            {['Nueva reserva', 'Nuevo gasto', 'Cierre del día'].map((label) => (
              <li key={label}>
                <Link href={`${basePath}#summary-template`} className={LINK_ROW}>
                  <span className="flex-1 type-body text-foreground">{label}</span>
                  <ChevronRight aria-hidden="true" className="size-4 text-muted-foreground" />
                </Link>
              </li>
            ))}
          </ul>
        </Section>
      }
    />
  )
}

// ─── Lista ───────────────────────────────────────────────────────────────────

type SupplierRow = SampleSupplier & { dueDate: string | null }

function ListDemo() {
  const { basePath, today } = useCatalog()
  const rows = React.useMemo<SupplierRow[]>(
    () =>
      SAMPLE_SUPPLIERS.slice(0, 5).map((supplier) => ({
        ...supplier,
        dueDate: supplierDueDate(supplier, today),
      })),
    [today],
  )
  const csvHref = React.useMemo(() => sampleSuppliersCsv(), [])
  const columns: DataTableColumn<SupplierRow>[] = [
    { id: 'nombre', header: 'Proveedor', cell: (row) => row.name },
    { id: 'condicion', header: 'Condición', cell: (row) => row.condition, hideBelow: 'lg' },
    {
      id: 'vence',
      header: 'Vence',
      cell: (row) => <DueStatus dueDate={row.dueDate} settled={row.settled} today={today} />,
    },
    {
      id: 'saldo',
      header: 'Saldo $',
      numeric: true,
      cell: (row) => <Amount cents={row.balanceCents} currency={false} />,
    },
  ]
  return (
    <DemoStack>
      <ListTemplate
        flush
        className={IN_PANEL}
        data-tour={tourId('list-template')}
        header={
          <PageHeader
            title="Proveedores"
            description="A quién le comprás y cuánto le debés."
            actions={
              <>
                <ExportButton href={csvHref} download="proveedores-de-ejemplo.csv" />
                <Button type="button">
                  <Plus aria-hidden="true" />
                  Nuevo proveedor
                </Button>
              </>
            }
          />
        }
        toolbar={
          <DataTableToolbar>
            <SearchField aria-label="Buscar proveedor" placeholder="Buscar por nombre o CUIT" />
            <SegmentedControl
              aria-label="Proveedores a la vista"
              defaultValue="todos"
              items={[
                { value: 'todos', label: 'Todos' },
                { value: 'deuda', label: 'Con deuda' },
                { value: 'vencidos', label: 'Vencidos' },
              ]}
            />
          </DataTableToolbar>
        }
        pagination={
          <Pagination
            page={1}
            pageSize={25}
            total={140}
            hrefFor={(page) => `${basePath}#pagina-${page.toString()}`}
            label="Paginación de proveedores"
          />
        }
      >
        <DataTable
          caption="Proveedores"
          columns={columns}
          rows={rows}
          getRowId={(row) => row.id}
          rowHref={() => `${basePath}#list-template`}
          rowLabel={(row) => row.name}
        />
      </ListTemplate>
      <DemoRow label="ListEmptyState: «sin datos todavía» y «sin resultados para el filtro»" stack>
        <div className="grid gap-4 rounded-xl border border-border bg-card lg:grid-cols-2">
          <ListEmptyState
            filtered={false}
            clearHref={`${basePath}#list-template`}
            icon={Wallet}
            title="Todavía no cargaste proveedores"
            description="Cargá el primero para llevar su cuenta corriente."
            action={
              <Button type="button" size="sm">
                Nuevo proveedor
              </Button>
            }
            data-tour={tourId('list-empty-state')}
          />
          <ListEmptyState
            filtered
            clearHref={`${basePath}#list-template`}
            title="Todavía no cargaste proveedores"
          />
        </div>
      </DemoRow>
    </DemoStack>
  )
}

// ─── Ficha ───────────────────────────────────────────────────────────────────

function DetailDemo() {
  const { basePath, today } = useCatalog()
  const statement = React.useMemo(() => sampleStatement(today, basePath), [today, basePath])
  return (
    <DetailTemplate
      flush
      className={IN_PANEL}
      data-tour={tourId('detail-template')}
      header={
        <PageHeader
          title="Distribuidora del Centro SA"
          back={{ href: `${basePath}#detail-template`, label: 'Proveedores' }}
          meta={['CUIT 20-12345678-6', 'Responsable inscripto', 'Paga a 21 días']}
          actions={
            <>
              <Button type="button" variant="secondary">
                Nuevo pago
              </Button>
              <Button type="button">Nuevo comprobante</Button>
            </>
          }
        />
      }
      summary={
        <KPIGroup columns={3}>
          <KPI label="Saldo" value={<Amount cents={124_000_000} decimals={0} />} />
          <KPI
            label="Vencido"
            value={<Amount cents={38_000_000} decimals={0} />}
            status={<DueStatus dueDate={addDays(today, -3)} today={today} />}
          />
          <KPI label="Vence en 7 días" value={<Amount cents={18_000_000} decimals={0} />} />
        </KPIGroup>
      }
      tabs={
        <TabsNav
          aria-label="Secciones del proveedor"
          items={[
            { href: basePath, label: 'Movimientos', exact: true },
            { href: `${basePath}#detail-template-comprobantes`, label: 'Comprobantes' },
            { href: `${basePath}#detail-template-pagos`, label: 'Pagos' },
            { href: `${basePath}#detail-template-datos`, label: 'Datos' },
          ]}
        />
      }
      aside={
        <Section title="Datos" headingLevel={3}>
          <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1 type-small">
            <dt className="text-muted-foreground">Rubro</dt>
            <dd>Bebidas</dd>
            <dt className="text-muted-foreground">Entrega</dt>
            <dd>Martes y jueves</dd>
            <dt className="text-muted-foreground">Contacto</dt>
            <dd>Ventas, por WhatsApp</dd>
          </dl>
        </Section>
      }
    >
      <LedgerTable
        caption="Movimientos de Distribuidora del Centro SA"
        rows={statement.rows.slice(-3)}
        columnLabels={{ debit: 'Facturas', credit: 'Pagos' }}
        balanceMode="signed"
        mobile="cards"
      />
    </DetailTemplate>
  )
}

// ─── Formulario ──────────────────────────────────────────────────────────────

const SUPPLIER_OPTIONS: EntityOption[] = SAMPLE_SUPPLIERS.map((supplier) => ({
  value: supplier.id,
  label: supplier.name,
  description: supplier.condition,
}))

function FormDemo() {
  const { basePath, today } = useCatalog()
  const [net, setNet] = React.useState<number | null>(71_074_380)
  const [accountId, setAccountId] = React.useState<string | null>('5.1.01.02')
  const vat = net === null ? null : vatFromNet(net, 2100)
  const total = net === null ? null : net + (vat ?? 0)
  const account = accountId ? SAMPLE_ACCOUNTS.find((item) => item.id === accountId) : undefined
  const vatCredit = sampleAccount('1.1.03.01')
  const suppliers = sampleAccount('2.1.01.01')
  const amountsId = React.useId()

  const lines: EntryLine[] = account
    ? [
        { id: 'neto', accountCode: account.code, accountName: account.name, debitCents: net },
        { id: 'iva', accountCode: vatCredit.code, accountName: vatCredit.name, debitCents: vat },
        {
          id: 'prov',
          accountCode: suppliers.code,
          accountName: suppliers.name,
          creditCents: total,
          partyName: 'Distribuidora del Centro SA',
        },
      ]
    : []

  async function save(formData: FormData) {
    await wait(900)
    toast.success(
      formData.get('intent') === 'pagar'
        ? 'Comprobante guardado; seguís con el pago (de mentira)'
        : 'Comprobante guardado (de mentira)',
    )
  }

  return (
    <FormTemplate
      flush
      className={IN_PANEL}
      data-tour={tourId('form-template')}
      header={
        <PageHeader
          title="Nuevo comprobante de compra"
          back={{ href: `${basePath}#form-template`, label: 'Comprobantes' }}
        />
      }
      aside={<EntryPreview lines={lines} titleAs="h3" />}
    >
      <form action={save} className="flex flex-col gap-6">
        <FormSection title="Proveedor y comprobante">
          <Field label="Proveedor" name="supplier_id" hint="Responsable inscripto">
            <Combobox options={SUPPLIER_OPTIONS} defaultValue="prov-1" />
          </Field>
          <Field label="Tipo" name="voucher_type">
            <Select defaultValue="fa">
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="fa">Factura A</SelectItem>
                <SelectItem value="fb">Factura B</SelectItem>
                <SelectItem value="nca">Nota de crédito A</SelectItem>
              </SelectContent>
            </Select>
          </Field>
          <VoucherNumberFields defaultPointOfSale={3} defaultNumber={1290} />
          <FieldRow columns={2}>
            <Field label="Fecha" name="date">
              <DatePicker defaultValue={today} today={today} />
            </Field>
            <Field label="Vence" name="due_date" hint="Plazo del proveedor: 21 días">
              <DatePicker defaultValue={addDays(today, 21)} today={today} />
            </Field>
          </FieldRow>
        </FormSection>
        <FormSection title="Importes">
          <AmountStack aria-label="Importes del comprobante">
            <AmountStackRow
              label="Neto 21 %"
              fieldId={amountsId}
              field={
                <MoneyField id={amountsId} name="net_21_cents" cents={net} onCentsChange={setNet} />
              }
              side={{ label: 'IVA 21 %', value: <Amount cents={vat} /> }}
            />
            <AmountStackRow
              label="Total"
              emphasis="total"
              valueFor={amountsId}
              value={<Amount cents={total} />}
            />
          </AmountStack>
        </FormSection>
        <FormSection title="Imputación">
          <Field label="¿En qué?" name="account_id">
            <AccountPicker
              accounts={SAMPLE_ACCOUNTS}
              value={accountId}
              onValueChange={(value) => setAccountId(typeof value === 'string' ? value : null)}
            />
          </Field>
        </FormSection>
        <FormActions sticky={false}>
          <Button asChild variant="secondary" className="max-sm:hidden">
            <Link href={`${basePath}#form-template`}>Cancelar</Link>
          </Button>
          <SubmitButton variant="secondary" name="intent" value="pagar" pendingText="Guardando…">
            Guardar y pagar
          </SubmitButton>
          <SubmitButton name="intent" value="guardar" pendingText="Guardando…">
            Guardar
          </SubmitButton>
        </FormActions>
      </form>
    </FormTemplate>
  )
}

// ─── Libro o reporte (sumas y saldos) ────────────────────────────────────────

type TrialRow = {
  code: string
  name: string
  group: string
  debit: number
  credit: number
}

const TRIAL_BALANCE: readonly TrialRow[] = [
  {
    code: '1.1.01.01',
    name: 'Caja del local',
    group: '1 ACTIVO',
    debit: 31_250_000,
    credit: 12_000_000,
  },
  {
    code: '1.1.01.02',
    name: 'Banco (cuenta corriente)',
    group: '1 ACTIVO',
    debit: 412_870_000,
    credit: 150_000_000,
  },
  {
    code: '1.1.03.01',
    name: 'IVA crédito fiscal',
    group: '1 ACTIVO',
    debit: 31_250_000,
    credit: 0,
  },
  {
    code: '2.1.01.01',
    name: 'Proveedores',
    group: '2 PASIVO',
    debit: 54_000_000,
    credit: 90_350_000,
  },
  { code: '2.1.02.01', name: 'IVA débito fiscal', group: '2 PASIVO', debit: 0, credit: 48_300_000 },
  {
    code: '3.2.01.04',
    name: 'Saldo de apertura a asignar',
    group: '3 PATRIMONIO NETO',
    debit: 0,
    credit: 320_120_000,
  },
  {
    code: '4.1.01.01',
    name: 'Ventas salón: facturadas',
    group: '4 INGRESOS',
    debit: 0,
    credit: 230_000_000,
  },
  {
    code: '5.1.01.02',
    name: 'Compras: bebidas sin alcohol',
    group: '5 EGRESOS',
    debit: 321_400_000,
    credit: 0,
  },
]

const TRIAL_DEBIT = TRIAL_BALANCE.reduce((acc, row) => acc + row.debit, 0)
const TRIAL_CREDIT = TRIAL_BALANCE.reduce((acc, row) => acc + row.credit, 0)

function ReportDemo() {
  const { today } = useCatalog()
  const [period, setPeriod] = React.useState<Period>({ kind: 'month', month: monthOf(today) })
  const csvHref = React.useMemo(() => sampleSuppliersCsv(), [])
  const columns: DataTableColumn<TrialRow>[] = [
    {
      id: 'cuenta',
      header: 'Cuenta',
      cell: (row) => (
        <span className="flex items-baseline gap-2">
          <span className="type-amount text-subtle-foreground">{row.code}</span>
          {row.name}
        </span>
      ),
    },
    {
      id: 'debe',
      header: 'Debe $',
      numeric: true,
      cell: (row) => <Amount cents={row.debit === 0 ? null : row.debit} currency={false} />,
      footer: <Amount cents={TRIAL_DEBIT} currency={false} />,
    },
    {
      id: 'haber',
      header: 'Haber $',
      numeric: true,
      cell: (row) => <Amount cents={row.credit === 0 ? null : row.credit} currency={false} />,
      footer: <Amount cents={TRIAL_CREDIT} currency={false} />,
    },
    {
      id: 'saldo',
      header: 'Saldo $',
      numeric: true,
      cell: (row) => <Amount cents={row.debit - row.credit} side="auto" currency={false} />,
    },
  ]
  return (
    <ReportTemplate
      flush
      className={IN_PANEL}
      data-tour={tourId('report-template')}
      header={
        <PageHeader
          title="Sumas y saldos"
          actions={
            <>
              <PeriodPicker
                aria-label="Período"
                value={period}
                onValueChange={setPeriod}
                today={today}
              />
              <ExportButton href={csvHref} download="sumas-y-saldos-de-ejemplo.csv" />
            </>
          }
        />
      }
      totals={
        <p className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg bg-muted px-3 py-2 type-small">
          <span>
            Debe <Amount cents={TRIAL_DEBIT} />
          </span>
          <span aria-hidden="true">·</span>
          <span>
            Haber <Amount cents={TRIAL_CREDIT} />
          </span>
          <span aria-hidden="true">·</span>
          <span className="inline-flex items-center gap-1 font-medium text-success-text">
            <CircleCheck aria-hidden="true" className="size-3.5" />
            Debe = Haber
          </span>
        </p>
      }
      notes="D = saldo deudor · A = saldo acreedor. Los grupos son los rubros del plan de cuentas."
    >
      <DataTable
        caption="Sumas y saldos"
        columns={columns}
        rows={[...TRIAL_BALANCE]}
        getRowId={(row) => row.code}
        groupBy={(row) => ({ key: row.group, label: row.group })}
        density="compact"
        mobile="scroll"
      />
    </ReportTemplate>
  )
}

// ─── Estado de cuenta ────────────────────────────────────────────────────────

function StatementDemo() {
  const { basePath, today } = useCatalog()
  const statement = React.useMemo(() => sampleStatement(today, basePath), [today, basePath])
  return (
    <StatementTemplate
      flush
      className={IN_PANEL}
      data-tour={tourId('statement-template')}
      header={
        <PageHeader
          title="Distribuidora del Centro SA"
          back={{ href: `${basePath}#statement-template`, label: 'Proveedores' }}
          actions={<Button type="button">Nuevo pago</Button>}
        />
      }
      balance={
        <>
          <KPIGroup columns={3}>
            <KPI label="Saldo" value={<Amount cents={statement.closing} decimals={0} />} />
            <KPI
              label="Vencido"
              value={<Amount cents={38_000_000} decimals={0} />}
              status={<DueStatus dueDate={addDays(today, -3)} today={today} />}
            />
            <KPI label="Vence en 7 días" value={<Amount cents={18_000_000} decimals={0} />} />
          </KPIGroup>
          <AgingBar buckets={SAMPLE_AGING} legend="compact" decimals={0} />
        </>
      }
      tabs={
        <TabsNav
          aria-label="Secciones del estado de cuenta"
          items={[
            { href: basePath, label: 'Movimientos', exact: true },
            { href: `${basePath}#statement-template-comprobantes`, label: 'Comprobantes' },
            { href: `${basePath}#statement-template-pagos`, label: 'Pagos' },
          ]}
        />
      }
      upcoming={
        <Section title="Próximos vencimientos" headingLevel={3}>
          <ul className="flex flex-col divide-y divide-border">
            {[
              {
                id: 'v1',
                label: 'Factura A 0003-00001290',
                due: addDays(today, 5),
                cents: 18_000_000,
              },
              {
                id: 'v2',
                label: 'Factura A 0003-00001301',
                due: addDays(today, 12),
                cents: 9_412_000,
              },
            ].map((item) => (
              <li key={item.id} className="flex items-center gap-3 py-2">
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="type-body">{item.label}</span>
                  <DueStatus dueDate={item.due} today={today} showDate className="type-small" />
                </span>
                <Amount cents={item.cents} className="type-body" />
              </li>
            ))}
          </ul>
        </Section>
      }
    >
      <LedgerTable
        caption="Estado de cuenta de Distribuidora del Centro SA"
        rows={statement.rows}
        opening={{ balanceCents: statement.opening }}
        closing={{ balanceCents: statement.closing }}
        closingLabel={`Saldo al ${formatIsoDay(today)}`}
        totals={statement.totals}
        columnLabels={{ debit: 'Facturas', credit: 'Pagos' }}
        balanceMode="signed"
        showDue
        mobile="cards"
      />
    </StatementTemplate>
  )
}

// ─── Solo lectura y período cerrado ──────────────────────────────────────────

function ReadOnlyDemo() {
  const { today } = useCatalog()
  return (
    <DemoStack>
      <ReadOnlyCallout data-tour={tourId('read-only-callout')} />
      <FieldRow columns={2}>
        <Field label="Proveedor" readOnly>
          <Input defaultValue="Distribuidora del Centro SA" />
        </Field>
        <Field label="Fecha" readOnly>
          <DatePicker defaultValue={addDays(today, -20)} today={today} />
        </Field>
      </FieldRow>
      <EntryEditor
        accounts={SAMPLE_ACCOUNTS}
        readOnly
        readOnlyTitle="Asiento del comprobante"
        defaultLines={[
          { key: 'r0', accountId: '5.1.01.02', debitCents: 71_074_380, creditCents: null },
          { key: 'r1', accountId: '1.1.03.01', debitCents: 14_925_620, creditCents: null },
          { key: 'r2', accountId: '2.1.01.01', debitCents: null, creditCents: 86_000_000 },
        ]}
      />
      <div className="flex flex-wrap justify-end gap-2">
        <ExportButton href={sampleSuppliersCsv()} download="comprobante-de-ejemplo.csv" />
      </div>
    </DemoStack>
  )
}

function ClosedPeriodDemo() {
  const { basePath, today } = useCatalog()
  const closedMonth = addMonthsToYearMonth(monthOf(today), -1)
  const guard = React.useMemo(() => closedMonthGuard([closedMonth]), [closedMonth])
  const [period, setPeriod] = React.useState<Period>({ kind: 'month', month: closedMonth })
  return (
    <DemoStack>
      <ClosedPeriodCallout
        period="El mes pasado"
        adjustmentHref={`${basePath}#closed-period`}
        data-tour={tourId('closed-period-callout')}
      />
      <FieldRow columns={2}>
        <Field label="Fecha del ajuste" hint="Los días del mes cerrado no se pueden elegir">
          <DatePicker
            defaultValue={today}
            today={today}
            isDateDisabled={guard.isDateDisabled}
            disabledReason={guard.disabledReason}
          />
        </Field>
        {/* PeriodPicker no es un campo de Field: se nombra con su propio aria-label. */}
        <DemoRow label="Período del reporte: el mes cerrado lleva candado" stack>
          <PeriodPicker
            aria-label="Período del reporte"
            value={period}
            onValueChange={setPeriod}
            kinds={['month']}
            closedMonths={[closedMonth]}
            today={today}
          />
        </DemoRow>
      </FieldRow>
    </DemoStack>
  )
}

// ─── Libro diario ────────────────────────────────────────────────────────────

type JournalRow = {
  id: string
  entry: string
  entryLabel: string
  kind: 'line' | 'subtotal'
  code?: string
  name?: string
  debit: number | null
  credit: number | null
}

function journalRows(today: string): JournalRow[] {
  const entry = (
    key: string,
    label: string,
    lines: Array<[code: string, side: 'debit' | 'credit', cents: number]>,
  ): JournalRow[] => {
    const rows = lines.map(([code, side, cents], index): JournalRow => {
      const account = sampleAccount(code)
      return {
        id: `${key}-${index.toString()}`,
        entry: key,
        entryLabel: label,
        kind: 'line',
        code: account.code,
        name: account.name,
        debit: side === 'debit' ? cents : null,
        credit: side === 'credit' ? cents : null,
      }
    })
    const debit = rows.reduce((acc, row) => acc + (row.debit ?? 0), 0)
    const credit = rows.reduce((acc, row) => acc + (row.credit ?? 0), 0)
    return [
      ...rows,
      { id: `${key}-st`, entry: key, entryLabel: label, kind: 'subtotal', debit, credit },
    ]
  }
  return [
    ...entry(
      `a126`,
      `${formatIsoDay(addDays(today, -20))} · Asiento 126 · Compra · Factura A 0003-00001234`,
      [
        ['5.1.01.02', 'debit', 71_074_380],
        ['1.1.03.01', 'debit', 14_925_620],
        ['2.1.01.01', 'credit', 86_000_000],
      ],
    ),
    ...entry(`a127`, `${formatIsoDay(addDays(today, -18))} · Asiento 127 · Pago 0001-00000210`, [
      ['2.1.01.01', 'debit', 50_000_000],
      ['1.1.01.02', 'credit', 50_000_000],
    ]),
    ...entry(`a128`, `${formatIsoDay(addDays(today, -12))} · Asiento 128 · Cierre del día`, [
      ['1.1.01.01', 'debit', 18_150_000],
      ['1.1.02.04', 'debit', 12_100_000],
      ['4.1.01.01', 'credit', 25_000_000],
      ['2.1.02.01', 'credit', 5_250_000],
    ]),
  ]
}

function JournalDemo() {
  const { today, basePath } = useCatalog()
  const rows = React.useMemo(() => journalRows(today), [today])
  const lineRows = rows.filter((row) => row.kind === 'line')
  const totalDebit = lineRows.reduce((acc, row) => acc + (row.debit ?? 0), 0)
  const totalCredit = lineRows.reduce((acc, row) => acc + (row.credit ?? 0), 0)
  const columns: DataTableColumn<JournalRow>[] = [
    {
      id: 'cuenta',
      header: 'Cuenta',
      cell: (row) =>
        row.kind === 'subtotal' ? (
          <span className="type-label text-muted-foreground">Subtotal del asiento</span>
        ) : (
          <span
            className={
              row.credit !== null ? 'flex items-baseline gap-2 ps-4' : 'flex items-baseline gap-2'
            }
          >
            {row.credit !== null ? <span className="text-subtle-foreground">a</span> : null}
            <span className="type-amount text-subtle-foreground">{row.code}</span>
            {row.name}
          </span>
        ),
    },
    {
      id: 'debe',
      header: 'Debe $',
      numeric: true,
      cell: (row) => (
        <Amount
          cents={row.debit}
          currency={false}
          emptyText=""
          className={row.kind === 'subtotal' ? 'font-medium' : undefined}
        />
      ),
      footer: <Amount cents={totalDebit} currency={false} />,
    },
    {
      id: 'haber',
      header: 'Haber $',
      numeric: true,
      cell: (row) => (
        <Amount
          cents={row.credit}
          currency={false}
          emptyText=""
          className={row.kind === 'subtotal' ? 'font-medium' : undefined}
        />
      ),
      footer: <Amount cents={totalCredit} currency={false} />,
    },
  ]
  return (
    <DataTable
      data-tour={tourId('journal')}
      caption="Libro diario"
      columns={columns}
      rows={rows}
      getRowId={(row) => row.id}
      groupBy={(row) => ({
        key: row.entry,
        label: (
          <Link
            href={`${basePath}#journal`}
            className="underline decoration-1 underline-offset-[3px] hover:decoration-2"
          >
            {row.entryLabel}
          </Link>
        ),
      })}
      density="compact"
      mobile="scroll"
    />
  )
}

// ─── Plan de cuentas ─────────────────────────────────────────────────────────

const CHART_GROUPS: ReadonlyArray<{ code: string; limit: number }> = [
  { code: '1.1.01', limit: 4 },
  { code: '1.1.02', limit: 3 },
  { code: '1.1.03', limit: 4 },
  { code: '2.1.01', limit: 2 },
  { code: '5.1.01', limit: 4 },
]

function ChartRowActions({ code, name }: { code: string; name: string }) {
  const confirm = useConfirm()
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          size="icon-sm"
          variant="ghost"
          aria-label={`Acciones de ${code} ${name}`}
        >
          <MoreHorizontal aria-hidden="true" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem>
          <FileText aria-hidden="true" />
          Renombrar
        </DropdownMenuItem>
        <DropdownMenuItem>
          <Plus aria-hidden="true" />
          Agregar subcuenta
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          variant="destructive"
          onSelect={async () => {
            const ok = await confirm({
              title: `¿Desactivar «${code} ${name}»?`,
              description: 'Deja de aparecer al imputar. Lo que ya está en los libros no se toca.',
              confirmLabel: 'Desactivar cuenta',
              pendingLabel: 'Desactivando…',
              onConfirm: () => wait(800),
            })
            if (ok) toast.success('Cuenta desactivada (de mentira)')
          }}
        >
          <Receipt aria-hidden="true" />
          Desactivar…
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

function ChartOfAccountsDemo() {
  const groups = CHART_GROUPS.map(({ code, limit }) => ({
    account: sampleAccount(code),
    leaves: SAMPLE_ACCOUNTS.filter(
      (account) => account.postable && account.code.startsWith(`${code}.`),
    ).slice(0, limit),
  }))
  return (
    <DataTableShell data-tour={tourId('chart-of-accounts')}>
      <DataTableScroll>
        <DataTableRoot density="compact" caption="Plan de cuentas">
          <DataTableHead>
            <tr>
              <DataTableHeader>Cuenta</DataTableHeader>
              <DataTableHeader className="max-sm:hidden">Lado normal</DataTableHeader>
              <DataTableHeader className="w-12">
                <span className="sr-only">Acciones</span>
              </DataTableHeader>
            </tr>
          </DataTableHead>
          {groups.map((group) => (
            <DataTableBody key={group.account.code}>
              <DataTableGroupRow
                collapsible
                colSpan={3}
                label={`${group.account.code} ${group.account.name}`}
              />
              {group.leaves.map((leaf) => (
                <DataTableRow key={leaf.code}>
                  <DataTableCell indent={1}>
                    <span className="flex flex-wrap items-baseline gap-x-2">
                      <span className="type-amount text-subtle-foreground">{leaf.code}</span>
                      {leaf.name}
                      {leaf.active ? null : <Badge>Inactiva</Badge>}
                    </span>
                  </DataTableCell>
                  <DataTableCell className="max-sm:hidden text-muted-foreground">
                    {leaf.normalSide === 'credit' ? 'Haber' : 'Debe'}
                  </DataTableCell>
                  <DataTableCell align="end">
                    <ChartRowActions code={leaf.code} name={leaf.name} />
                  </DataTableCell>
                </DataTableRow>
              ))}
            </DataTableBody>
          ))}
        </DataTableRoot>
      </DataTableScroll>
    </DataTableShell>
  )
}

export function TemplatesFamily() {
  return (
    <CatalogFamily id="plantillas">
      <CatalogBlock
        id="summary-template"
        wide
        sample
        purpose="Resumen del dueño y Resumen contable: encabezado, KPIs, «Pide atención» (2/3) y «Accesos» (1/3)."
        yes="La portada de un área: un número, después el trabajo."
        no="Una lista o un libro (`ListTemplate`, `ReportTemplate`)."
        usage={`<SummaryTemplate
  header={<PageHeader title="Resumen" context={saludo} actions={<Button>Nueva reserva</Button>} />}
  kpis={<KPIGroup>…</KPIGroup>}
  attention={<Section title="Pide atención">…</Section>}
  shortcuts={<Section title="Accesos">…</Section>}
/>`}
        a11y={[
          'El orden del DOM es el visual en todos los anchos: en el celular «Pide atención» va primero.',
          '«Pide atención» son filas-link (una parada de Tab cada una), sin una tarjeta por ítem.',
        ]}
      >
        <SummaryDemo />
      </CatalogBlock>

      <CatalogBlock
        id="list-template"
        wide
        sample
        purpose="Proveedores, comprobantes, reservas, personas: encabezado, barra, tabla y paginación."
        yes="Toda lista de registros con filtros por URL (GET) y búsqueda `name=&quot;q&quot;`."
        no="Un libro con saldo acumulado (`ReportTemplate` con `LedgerTable`)."
        usage={`<ListTemplate
  header={<PageHeader title="Proveedores" actions={<><ExportButton href={csv} /><Button>Nuevo proveedor</Button></>} />}
  toolbar={<DataTableToolbar><SearchField /><SegmentedControl … /></DataTableToolbar>}
  pagination={<Pagination … />}
>
  <DataTable … empty={<ListEmptyState filtered={hayFiltros} clearHref={sinFiltros} … />} />
</ListTemplate>`}
        a11y={[
          'El vacío distingue «sin datos todavía» (con su acción) de «sin resultados» (con «Limpiar filtros»).',
          'En solo lectura las acciones que modifican no se dibujan; «Exportar» y los filtros quedan.',
        ]}
      >
        <ListDemo />
      </CatalogBlock>

      <CatalogBlock
        id="detail-template"
        wide
        sample
        purpose="La ficha de un proveedor, cliente o socio: encabezado con volver y datos clave, KPIs, pestañas y contenido."
        yes="Un registro con varias vistas (movimientos, comprobantes, pagos, datos), cada una con su ruta."
        no="Un formulario de alta (`FormTemplate`)."
        usage={`<DetailTemplate
  header={<PageHeader title={nombre} back={{ href, label: 'Proveedores' }} meta={[…]} actions={…} />}
  summary={<KPIGroup columns={3}>…</KPIGroup>}
  tabs={<TabsNav aria-label="Secciones del proveedor" items={…} />}
  aside={<Section title="Datos">…</Section>}
>
  {contenidoDeLaPestaña}
</DetailTemplate>`}
        a11y={[
          'En el celular la acción principal ocupa todo el ancho y los KPIs van 1 × 3.',
          'La columna del costado aparece recién cuando entran las dos (nunca de costado antes de `lg`).',
        ]}
      >
        <DetailDemo />
      </CatalogBlock>

      <CatalogBlock
        id="form-template"
        wide
        sample
        purpose="Comprobante, pago, reserva: el formulario en una columna y, al costado desde `lg`, la vista previa del asiento."
        yes="Un alta o una edición con su `EntryPreview` (o una ayuda) al costado."
        no="Un formulario chico que entra en un `Dialog`."
        usage={`<FormTemplate
  header={<PageHeader title="Nuevo comprobante de compra" back={{ href, label: 'Comprobantes' }} />}
  aside={<EntryPreview lines={preview} />}
>
  <form action={formAction}>
    <FormSection title="Proveedor y comprobante">…</FormSection>
    <FormSection title="Importes"><AmountStack>…</AmountStack></FormSection>
    <FormActions>
      <Button variant="secondary" asChild className="max-sm:hidden"><Link href={volver}>Cancelar</Link></Button>
      <SubmitButton variant="secondary" name="intent" value="pagar">Guardar y pagar</SubmitButton>
      <SubmitButton name="intent" value="guardar">Guardar</SubmitButton>
    </FormActions>
  </form>
</FormTemplate>`}
        a11y={[
          'Una sola principal, última a la derecha: «Guardar». «Guardar y pagar» es secundaria.',
          'En el celular la barra de acciones va fija abajo con dos botones como máximo («Cancelar» sale: el `back` ya cancela). Acá va con `sticky={false}`.',
          'Al volver la respuesta del server, el foco va al primer campo inválido.',
        ]}
      >
        <FormDemo />
      </CatalogBlock>

      <CatalogBlock
        id="report-template"
        wide
        sample
        purpose="Diario, mayor, IVA, sumas y saldos: encabezado con el período y «Exportar», totales, libro y notas."
        yes="Todo reporte por período (el período va en la URL y lo comparten todos los reportes)."
        no="Una lista de registros para trabajar (`ListTemplate`)."
        usage={`<ReportTemplate
  header={<PageHeader title="Sumas y saldos" actions={<><PeriodPicker param="periodo" value={p} /><ExportButton href={csv} /></>} />}
  totals={<p>Debe … · Haber … · Debe = Haber</p>}
  notes="D = saldo deudor · A = saldo acreedor"
>
  <DataTable density="compact" mobile="scroll" groupBy={(r) => ({ key: r.rubro, label: r.rubro })} … />
</ReportTemplate>`}
        a11y={[
          'Las filas de grupo («1 ACTIVO») son `<th scope="rowgroup">`; los totales cierran con la regla contable.',
          'En el celular el libro scrollea de costado con la primera columna fija.',
        ]}
      >
        <ReportDemo />
      </CatalogBlock>

      <CatalogBlock
        id="statement-template"
        wide
        sample
        purpose="El estado de cuenta de un proveedor, un cliente o una caja: saldo y antigüedad, pestañas, libro y próximos vencimientos."
        yes="La cuenta corriente de alguien, con su deuda por tramos."
        no="El mayor de una cuenta del plan (`ReportTemplate` con `LedgerTable`)."
        usage={`<StatementTemplate
  header={<PageHeader title={nombre} back={{ href, label: 'Proveedores' }} actions={<Button>Nuevo pago</Button>} />}
  balance={<><KPIGroup columns={3}>…</KPIGroup><AgingBar buckets={tramos} /></>}
  tabs={<TabsNav … />}
  upcoming={<Section title="Próximos vencimientos">…</Section>}
>
  <LedgerTable … balanceMode="signed" showDue mobile="cards" />
</StatementTemplate>`}
        a11y={[
          'En el celular el libro pasa a tarjetas y la antigüedad va con la leyenda compacta.',
          'Los vencimientos dicen el tramo con palabras («Vence en 5 días · 12/10»), no solo con el punto.',
        ]}
      >
        <StatementDemo />
      </CatalogBlock>

      <CatalogBlock
        id="read-only"
        sample
        purpose="El rol Contabilidad: ve y exporta todo, no modifica. Las acciones que modifican no se dibujan."
        yes="Toda pantalla para la contadora (las plantillas con `readOnly` dibujan el aviso solas)."
        no="Botones deshabilitados sin explicación: son ruido. El permiso real lo controla el server con `requireRole`."
        usage={`<FormTemplate readOnly header={…}>
  <Field label="Proveedor" readOnly><Input defaultValue={…} /></Field>
  <EntryEditor accounts={cuentas} defaultLines={lineas} readOnly />
</FormTemplate>`}
        a11y={[
          'El aviso va una vez por pantalla y sin anuncio: está desde que carga.',
          'Los campos en solo lectura se pueden enfocar y copiar; el asiento se dibuja como `EntryPreview`.',
        ]}
      >
        <ReadOnlyDemo />
      </CatalogBlock>

      <CatalogBlock
        id="closed-period"
        purpose="Una vez cerrado, ese mes no se toca: las correcciones van con un asiento de ajuste."
        yes="Un comprobante de un mes cerrado (se abre en solo lectura con el aviso) y los campos de fecha y período."
        no="Esconder el mes cerrado: se ve con candado y dice por qué no se puede elegir."
        usage={`const cerrado = closedMonthGuard(mesesCerrados)
<ClosedPeriodCallout period="Septiembre" adjustmentHref={nuevoAjuste} />
<DatePicker isDateDisabled={cerrado.isDateDisabled} disabledReason={cerrado.disabledReason} />
<PeriodPicker closedMonths={mesesCerrados} … />`}
        a11y={[
          'Un día de un mes cerrado suma el motivo a su nombre para el lector y al `title` para el mouse.',
          'En la grilla de meses, el cerrado suma «, cerrado» a su nombre.',
        ]}
      >
        <ClosedPeriodDemo />
      </CatalogBlock>

      <CatalogBlock
        id="journal"
        wide
        sample
        purpose="El libro diario: `DataTable` compacta agrupada por asiento, con el Haber en sangría y «a» delante."
        yes="El diario y cualquier listado de asientos."
        no="Un asiento solo (`EntryPreview`)."
        usage={`<DataTable density="compact" mobile="scroll"
  groupBy={(l) => ({ key: l.asientoId, label: <Link href={…}>{l.fecha} · Asiento {l.numero} · {l.concepto}</Link> })}
  columns={[cuenta, debe, haber]} … />`}
        a11y={[
          'Cada asiento es un grupo con su fila de encabezado (link al comprobante) y cierra con su subtotal.',
          'El período cierra con la regla contable en el `<tfoot>`.',
        ]}
      >
        <JournalDemo />
      </CatalogBlock>

      <CatalogBlock
        id="chart-of-accounts"
        wide
        sample
        purpose="El plan de cuentas editable: primitivos de la tabla, rubros que se pliegan y acciones por fila."
        yes="El árbol de cuentas (unas 150): `DataTableGroupRow collapsible` y `DataTableCell indent`."
        no="Un `role=&quot;treegrid&quot;`: unas 150 cuentas no lo justifican y una tabla se recorre con Tab como el resto."
        usage={`<DataTableShell><DataTableScroll><DataTableRoot density="compact" caption="Plan de cuentas">
  <DataTableHead>…</DataTableHead>
  <DataTableBody>
    <DataTableGroupRow collapsible colSpan={3} label="1.1.01 Caja y bancos" />
    <DataTableRow><DataTableCell indent={1}>…</DataTableCell>…</DataTableRow>
  </DataTableBody>
</DataTableRoot></DataTableScroll></DataTableShell>`}
        a11y={[
          'El rubro es un botón con `aria-expanded` que pliega sus cuentas.',
          'Las acciones de cada fila van en un menú con nombre («Acciones de 1.1.01.01 Caja del local»); desactivar pasa por `useConfirm`.',
        ]}
      >
        <ChartOfAccountsDemo />
      </CatalogBlock>
    </CatalogFamily>
  )
}
