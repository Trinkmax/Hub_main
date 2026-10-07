'use client'

import { X } from 'lucide-react'
import * as React from 'react'
import { toast } from 'sonner'
import { AccountPicker } from '@/components/accounting/account-picker'
import { type AccountNode, accountLabel } from '@/components/accounting/account-tree'
import { AgingBar } from '@/components/accounting/aging-bar'
import { AmountStack, AmountStackRow } from '@/components/accounting/amount-stack'
import { BalanceSeal } from '@/components/accounting/balance-seal'
import { EntryEditor, type EntryEditorLine } from '@/components/accounting/entry-editor'
import { type EntryLine, EntryPreview } from '@/components/accounting/entry-preview'
import { LedgerTable } from '@/components/accounting/ledger-table'
import { LineItems } from '@/components/accounting/line-items'
import { createKeyFactory } from '@/components/accounting/line-items-model'
import { PaymentMethodsEditor } from '@/components/accounting/payment-methods-editor'
import {
  VoucherNumberFields,
  type VoucherNumberValue,
} from '@/components/accounting/voucher-number-fields'
import { Amount } from '@/components/ui/amount'
import { Button } from '@/components/ui/button'
import { Combobox, type EntityOption } from '@/components/ui/combobox'
import { CopyButton } from '@/components/ui/copy-button'
import { Field, FieldRow } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { MoneyField } from '@/components/ui/money-field'
import { NumberField } from '@/components/ui/number-field'
import { Switch } from '@/components/ui/switch'
import { vatFromNet } from '@/lib/accounting/iva'
import { addDays } from '@/lib/dates/civil'
import { formatIsoDay } from '@/lib/dates/format'
import { CatalogBlock, CatalogFamily, DemoRow, DemoStack, Readout } from './catalog-block'
import { useCatalog } from './catalog-provider'
import { tourId } from './registry'
import {
  SAMPLE_ACCOUNTS,
  SAMPLE_AGING,
  SAMPLE_SUPPLIERS,
  SAMPLE_TREASURIES,
  sampleAccount,
  sampleLedger,
  sampleStatement,
} from './sample-data'

// ─── EntryPreview ────────────────────────────────────────────────────────────

function EntryPreviewDemo() {
  const { today, density } = useCatalog()
  const [net, setNet] = React.useState<number | null>(10_000_000)
  const [vat, setVat] = React.useState<number | null>(2_100_000)
  const [total, setTotal] = React.useState<number | null>(12_100_000)
  const purchases = sampleAccount('5.1.01.02')
  const vatCredit = sampleAccount('1.1.03.01')
  const suppliers = sampleAccount('2.1.01.01')

  const lines: EntryLine[] = [
    { id: 'neto', accountCode: purchases.code, accountName: purchases.name, debitCents: net },
    { id: 'iva', accountCode: vatCredit.code, accountName: vatCredit.name, debitCents: vat },
    {
      id: 'proveedor',
      accountCode: suppliers.code,
      accountName: suppliers.name,
      creditCents: total,
      partyName: 'Distribuidora del Centro SA',
      dueDate: addDays(today, 21),
    },
  ]

  return (
    <DemoStack>
      <FieldRow columns={3}>
        <Field label="Neto (Debe)">
          <MoneyField cents={net} onCentsChange={setNet} />
        </Field>
        <Field label="IVA (Debe)">
          <MoneyField cents={vat} onCentsChange={setVat} />
        </Field>
        <Field label="Al proveedor (Haber)" hint="Cambialo y mirá el sello">
          <MoneyField cents={total} onCentsChange={setTotal} />
        </Field>
      </FieldRow>
      <EntryPreview
        lines={lines}
        titleAs="h4"
        density={density === 'compact' ? 'compact' : 'comfortable'}
        data-tour={tourId('entry-preview')}
      />
      <DemoRow label="El sello suelto (BalanceSeal): cuadra · no cuadra · sin importes">
        <BalanceSeal status="balanced" data-tour={tourId('balance-seal')} />
        <BalanceSeal status="unbalanced" diffCents={1_240} />
        <BalanceSeal status="empty" />
      </DemoRow>
    </DemoStack>
  )
}

// ─── AccountPicker ───────────────────────────────────────────────────────────

const ONLY_EXPENSES = (account: AccountNode) => account.type === 'expense'

function AccountPickerDemo() {
  const [chosen, setChosen] = React.useState<AccountNode | null>(sampleAccount('5.1.01.02'))
  return (
    <DemoStack>
      <Field
        label="Cuenta"
        name="account_id"
        hint="Buscá por código («1.1» trae el subárbol, «1101» encuentra 1.1.01), por nombre o por lo que hace."
      >
        <AccountPicker
          accounts={SAMPLE_ACCOUNTS}
          defaultValue="5.1.01.02"
          onAccountChange={setChosen}
          onCreate={(query, { parent }) => {
            toast.info(
              parent
                ? `Abriríamos «Nueva cuenta» adentro de ${accountLabel(parent)}`
                : `Abriríamos «Nueva cuenta» con «${query}»`,
            )
          }}
          data-tour={tourId('account-picker')}
        />
      </Field>
      <Readout
        items={[
          { label: 'Elegida', value: chosen ? accountLabel(chosen) : '—' },
          { label: 'Lado normal', value: chosen?.normalSide === 'credit' ? 'Haber' : 'Debe' },
        ]}
      />
      <FieldRow columns={2}>
        <Field label="Solo egresos" hint="Con un filtro por tipo de cuenta">
          <AccountPicker accounts={SAMPLE_ACCOUNTS} filter={ONLY_EXPENSES} />
        </Field>
        <Field label="También los rubros" hint="Para el mayor de un grupo (suma sus hojas)">
          <AccountPicker accounts={SAMPLE_ACCOUNTS} postableOnly={false} />
        </Field>
        <Field label="Con las inactivas" hint="Llevan la etiqueta «Inactiva»">
          <AccountPicker accounts={SAMPLE_ACCOUNTS} includeInactive defaultValue="1.1.01.09" />
        </Field>
        <Field label="Solo lectura" readOnly>
          <AccountPicker accounts={SAMPLE_ACCOUNTS} defaultValue="1.1.01.01" />
        </Field>
      </FieldRow>
    </DemoStack>
  )
}

// ─── LedgerTable ─────────────────────────────────────────────────────────────

function LedgerTableDemo() {
  const { today, basePath, density } = useCatalog()
  const ledger = React.useMemo(() => sampleLedger(today, basePath), [today, basePath])
  const statement = React.useMemo(() => sampleStatement(today, basePath), [today, basePath])
  const tableDensity = density === 'compact' ? 'compact' : 'comfortable'
  return (
    <DemoStack>
      <DemoRow label="Mayor de 2.1.01.01 Proveedores: saldo con D/A, saldo anterior y cierre" stack>
        <LedgerTable
          caption="Mayor de Proveedores"
          rows={ledger.rows}
          opening={{ balanceCents: ledger.opening }}
          closing={{ balanceCents: ledger.closing }}
          closingLabel={`Saldo al ${formatIsoDay(today)}`}
          totals={ledger.totals}
          balanceMode="side"
          density={tableDensity}
          data-tour={tourId('ledger-table')}
        />
      </DemoRow>
      <DemoRow
        label="Estado de cuenta: Facturas / Pagos con signo y Vence (en el celular, tarjetas)"
        stack
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
          density={tableDensity}
        />
      </DemoRow>
      <DemoRow label="Tope de 1.000 filas y período sin movimientos" stack>
        <LedgerTable
          caption="Mayor truncado"
          rows={ledger.rows.slice(0, 2)}
          opening={{ balanceCents: ledger.opening }}
          balanceMode="side"
          truncated
          density={tableDensity}
        />
        <LedgerTable caption="Mayor de Caja chica" rows={[]} density={tableDensity} />
      </DemoRow>
    </DemoStack>
  )
}

// ─── AgingBar ────────────────────────────────────────────────────────────────

function AgingBarDemo() {
  const { basePath } = useCatalog()
  return (
    <DemoStack>
      <AgingBar
        buckets={SAMPLE_AGING}
        hrefFor={(bucket) => `${basePath}#aging-${bucket}`}
        data-tour={tourId('aging-bar')}
      />
      <DemoRow label="Chica, con la leyenda compacta (celular)" stack>
        <AgingBar buckets={SAMPLE_AGING} size="sm" legend="compact" decimals={0} />
      </DemoRow>
      <DemoRow label="Sin deuda" stack>
        <AgingBar buckets={[]} legend="none" />
      </DemoRow>
    </DemoStack>
  )
}

// ─── AmountStack ─────────────────────────────────────────────────────────────

function AmountStackDemo() {
  const id = React.useId()
  const ids = { net21: `${id}-net21`, net105: `${id}-net105`, perception: `${id}-perc` }
  const [net21, setNet21] = React.useState<number | null>(71_074_380)
  const [net105, setNet105] = React.useState<number | null>(null)
  const [perception, setPerception] = React.useState<number | null>(2_132_231)
  const vat21 = net21 === null ? null : vatFromNet(net21, 2100)
  const vat105 = net105 === null ? null : vatFromNet(net105, 1050)
  const parts = [net21, vat21, net105, vat105, perception]
  const total = parts.every((part) => part === null)
    ? null
    : parts.reduce<number>((acc, part) => acc + (part ?? 0), 0)

  return (
    <DemoStack>
      <DemoRow label="Importes de un comprobante de compra (el IVA se calcula al costado)" stack>
        <AmountStack aria-label="Importes del comprobante" data-tour={tourId('amount-stack')}>
          <AmountStackRow
            label="Neto 21 %"
            fieldId={ids.net21}
            field={<MoneyField id={ids.net21} cents={net21} onCentsChange={setNet21} />}
            side={{ label: 'IVA 21 %', value: <Amount cents={vat21} /> }}
            data-tour={tourId('amount-stack-row')}
          />
          <AmountStackRow
            label="Neto 10,5 %"
            fieldId={ids.net105}
            field={<MoneyField id={ids.net105} cents={net105} onCentsChange={setNet105} />}
            side={{ label: 'IVA 10,5 %', value: <Amount cents={vat105} /> }}
          />
          <AmountStackRow
            label="Percepción de IIBB"
            hint="La que te cobró el proveedor en la factura"
            fieldId={ids.perception}
            field={
              <MoneyField id={ids.perception} cents={perception} onCentsChange={setPerception} />
            }
          />
          <AmountStackRow
            label="Total"
            emphasis="total"
            valueFor={`${ids.net21} ${ids.net105} ${ids.perception}`}
            value={<Amount cents={total} />}
          />
        </AmountStack>
      </DemoRow>
      <DemoRow label="Una cuenta con signos: la posición de IVA del mes" stack>
        <AmountStack aria-label="Posición de IVA del mes">
          <AmountStackRow label="IVA débito fiscal" value={<Amount cents={48_300_000} />} />
          <AmountStackRow
            sign="−"
            label="IVA crédito fiscal"
            value={<Amount cents={31_250_000} />}
          />
          <AmountStackRow
            sign="−"
            label="Percepciones sufridas"
            value={<Amount cents={2_132_231} />}
          />
          <AmountStackRow
            sign="="
            label="A pagar"
            emphasis="total"
            value={<Amount cents={14_917_769} />}
          />
        </AmountStack>
      </DemoRow>
    </DemoStack>
  )
}

// ─── LineItems y EntryEditor ─────────────────────────────────────────────────

type ItemLine = { key: string; description: string; quantity: number | null }

const ITEM_LINES: ItemLine[] = [
  { key: 'i0', description: 'Café en grano, 1 kg', quantity: 4 },
  { key: 'i1', description: 'Leche entera, 1 l', quantity: 24 },
]

const SUPPLIER_OPTIONS: EntityOption[] = SAMPLE_SUPPLIERS.map((supplier) => ({
  value: supplier.id,
  label: supplier.name,
}))

const PARTY_NAMES: Readonly<Record<string, string>> = Object.fromEntries(
  SAMPLE_SUPPLIERS.map((supplier) => [supplier.id, supplier.name]),
)

function openingLines(today: string): EntryEditorLine[] {
  return [
    { key: 'a0', accountId: '1.1.01.01', debitCents: 31_250_000, creditCents: null, note: '' },
    { key: 'a1', accountId: '1.1.01.02', debitCents: 412_870_000, creditCents: null, note: '' },
    {
      key: 'a2',
      accountId: '2.1.01.01',
      debitCents: null,
      creditCents: 124_000_000,
      note: 'Factura A 0003-00001234',
      partyId: 'prov-1',
      dueDate: addDays(today, -3),
    },
    {
      key: 'a3',
      accountId: '3.2.01.04',
      debitCents: null,
      creditCents: 320_120_000,
      note: 'Saldo de apertura',
    },
  ]
}

function LineItemsDemo() {
  const [nextKey] = React.useState(() => createKeyFactory('i'))
  return (
    <LineItems<ItemLine>
      name="items"
      defaultLines={ITEM_LINES}
      newLine={() => ({ key: `${nextKey()}-nuevo`, description: '', quantity: 1 })}
      lineLabel={(index) => `Ítem ${(index + 1).toString()}`}
      addLabel="Agregar ítem"
      className="flex flex-col gap-2"
      data-tour={tourId('line-items')}
      renderLine={(line, _index, api) => (
        <div className="grid grid-cols-[minmax(0,1fr)_8rem_2rem] items-start gap-2">
          <Field label={api.controlLabel('Descripción')} labelHidden>
            <Input
              size="sm"
              value={line.description}
              onChange={(event) => api.update({ description: event.target.value })}
            />
          </Field>
          <Field label={api.controlLabel('Cantidad')} labelHidden>
            <NumberField
              size="sm"
              value={line.quantity}
              onValueChange={(quantity) => api.update({ quantity })}
              min={1}
            />
          </Field>
          {api.canRemove ? (
            <Button
              type="button"
              size="icon-sm"
              variant="ghost"
              aria-label={`Quitar ${api.label.toLowerCase()}`}
              onClick={api.remove}
            >
              <X aria-hidden="true" />
            </Button>
          ) : (
            <span aria-hidden="true" />
          )}
        </div>
      )}
    />
  )
}

function EntryEditorDemo() {
  const { today } = useCatalog()
  const [readOnly, setReadOnly] = React.useState(false)
  const [lines] = React.useState(() => openingLines(today))
  const switchId = React.useId()
  return (
    <DemoStack>
      <DemoRow label="LineItems: el primitivo (agregá y quitá: mirá a dónde va el foco)" stack>
        <LineItemsDemo />
      </DemoRow>
      <DemoRow label="EntryEditor: el asiento de apertura" stack>
        <span className="flex items-center gap-2">
          <Switch id={switchId} checked={readOnly} onCheckedChange={setReadOnly} />
          <Label htmlFor={switchId}>Solo lectura (rol Contabilidad o período cerrado)</Label>
        </span>
        <form
          className="flex flex-col gap-4"
          onSubmit={(event) => {
            event.preventDefault()
            toast.success('Asiento cargado (de mentira: no se guardó nada)')
          }}
        >
          <EntryEditor
            name="lines"
            accounts={SAMPLE_ACCOUNTS}
            defaultLines={lines}
            readOnly={readOnly}
            showDueDate
            partyNames={PARTY_NAMES}
            renderParty={({ line, label, update }) => (
              <Combobox
                size="sm"
                aria-label={label}
                options={SUPPLIER_OPTIONS}
                value={line.partyId ?? null}
                placeholder="Elegí un proveedor…"
                onValueChange={(value) =>
                  update({ partyId: typeof value === 'string' ? value : null })
                }
              />
            )}
            data-tour={tourId('entry-editor')}
          />
          {readOnly ? null : (
            <div className="flex justify-end">
              <Button type="submit">Cargar asiento</Button>
            </div>
          )}
        </form>
      </DemoRow>
    </DemoStack>
  )
}

// ─── PaymentMethodsEditor ────────────────────────────────────────────────────

function PaymentMethodsDemo() {
  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(event) => {
        event.preventDefault()
        toast.success('Pago cargado (de mentira)')
      }}
    >
      <p className="type-small text-muted-foreground">
        Hay que pagar <Amount cents={124_000_000} />: repartilo entre la caja y el banco. «Otro
        medio» suma una fila con lo que falta.
      </p>
      <PaymentMethodsEditor
        name="methods"
        treasuries={SAMPLE_TREASURIES}
        targetCents={124_000_000}
        data-tour={tourId('payment-methods')}
      />
      <div className="flex justify-end">
        <Button type="submit">Pagar</Button>
      </div>
    </form>
  )
}

// ─── VoucherNumberFields ─────────────────────────────────────────────────────

function VoucherNumberDemo() {
  const [value, setValue] = React.useState<VoucherNumberValue>({
    pointOfSale: '00003',
    number: '00001234',
  })
  return (
    <DemoStack>
      <VoucherNumberFields
        defaultPointOfSale={3}
        defaultNumber={1234}
        pointOfSaleHint="El habitual de este proveedor: 0003"
        onValueChange={setValue}
        data-tour={tourId('voucher-number')}
      />
      <Readout
        items={[
          { label: 'Punto de venta', value: `«${value.pointOfSale}»` },
          { label: 'Número', value: `«${value.number}»` },
        ]}
      />
      <DemoRow label="Pegá el número entero en cualquiera de los dos">
        <span className="inline-flex items-center gap-1 rounded-md border border-border-strong bg-card ps-2 font-mono type-small">
          Factura A 0003-00001290
          <CopyButton
            value="Factura A 0003-00001290"
            iconOnly
            variant="ghost"
            size="icon-sm"
            label="Copiar «Factura A 0003-00001290»"
          />
        </span>
      </DemoRow>
    </DemoStack>
  )
}

export function AccountingFamily() {
  return (
    <CatalogFamily id="contables">
      <CatalogBlock
        id="entry-preview"
        sample
        purpose="La vista previa del asiento: exactamente lo que se va a guardar, con el sello «Cuadra / No cuadra»."
        yes="Al costado de todo formulario que genera un asiento (comprobante, pago, cierre del día)."
        no="Para cargar un asiento a mano (`EntryEditor`) o para un libro (`LedgerTable`)."
        usage={`const result = buildPurchase(input, ctx, { clientRef })
{result.ok
  ? result.preview.map((entry) => <EntryPreview key={entry.documentRef} lines={entry.lines} />)
  : <EntryPreview lines={[]} />}`}
        a11y={[
          'El estado vive en una región `role="status"` estable que solo habla cuando se pasa de cuadra a no cuadra (no en cada tecla).',
          'La diferencia va afuera de la región: se lee al recorrer, no se anuncia mientras se tipea.',
          'El sello se anima (160 ms) solo al cambiar, nunca al cargar; con «reducir movimiento», solo fundido.',
          'Las líneas del Haber van con sangría y una «a» delante, como el libro diario.',
        ]}
      >
        <EntryPreviewDemo />
      </CatalogBlock>

      <CatalogBlock
        id="account-picker"
        sample
        purpose="El selector del plan de cuentas, sobre el `Combobox` del kit: busca por código, por nombre y por «para qué se usa»."
        yes="Toda imputación: «¿En qué?» de un gasto, las líneas del asiento manual, el mayor de una cuenta."
        no="Elegir un proveedor o un cliente (`EntityPicker`)."
        usage={`<Field label="Cuenta" name="account_id">
  <AccountPicker accounts={cuentas} filter={(a) => a.type === 'expense'} onCreate={abrirNuevaCuenta} />
</Field>`}
        a11y={[
          'El teclado del Combobox: una letra abre con esa letra, ↑ ↓ Inicio Fin RePág AvPág, Enter elige, Esc y Tab cierran.',
          'Los rubros son encabezados `role="presentation"`: las flechas los saltean y el lector no los anuncia.',
          'Cada opción suma su camino («ACTIVO › Activo corriente») para el lector, así el contexto no se pierde.',
          'La elegida se ve «1.1.01.01 · Caja del local».',
        ]}
      >
        <AccountPickerDemo />
      </CatalogBlock>

      <CatalogBlock
        id="ledger-table"
        wide
        sample
        purpose="El libro: mayor, cajas y estado de cuenta. El saldo acumulado y los totales vienen de SQL y se muestran tal cual."
        yes="Movimientos de una cuenta en un período, con saldo anterior, cierre y la regla contable."
        no="Una lista de registros (`DataTable`). Nunca sumar el saldo en el navegador sobre una página."
        usage={`<LedgerTable
  caption="Mayor de Proveedores"
  rows={rows}                     // balanceCents viene de una función de ventana en SQL
  opening={{ balanceCents: saldoAnterior }}
  closingLabel={\`Saldo al \${formatIsoDay(hasta)}\`}
  totals={totales}
  balanceMode="side"
/>`}
        a11y={[
          '`<table>` real con caption; la fila entera es el link al comprobante (una sola parada de Tab).',
          'D o A se leen «deudor» o «acreedor»; el saldo anterior y el cierre son encabezados de fila.',
          'En el celular: `scroll` con la primera columna fija (libros) o `cards` (estado de cuenta).',
        ]}
      >
        <LedgerTableDemo />
      </CatalogBlock>

      <CatalogBlock
        id="aging-bar"
        sample
        purpose="La antigüedad de la deuda en cinco tramos, con la paleta validada y la leyenda como tabla."
        yes="El estado de cuenta de un proveedor o cliente y el resumen contable."
        no="Sin la leyenda (es obligatoria salvo con una tabla al lado: un tramo baja de 3:1 en cada modo)."
        usage={`const tramos = agingBuckets(partidas, today)
<AgingBar buckets={tramos} hrefFor={(t) => \`?tramo=\${t}\`} />`}
        a11y={[
          'La barra es `role="img"` con un resumen en palabras: «Deuda total $ 1.240.000,00: al día…».',
          'La leyenda dice tramo, importe y cantidad: la identidad nunca depende solo del color.',
          'Con `hrefFor`, cada fila de la leyenda es un link que filtra la lista.',
        ]}
      >
        <AgingBarDemo />
      </CatalogBlock>

      <CatalogBlock
        id="amount-stack"
        purpose="La columna de plata de un formulario: todas las cifras terminan en el mismo borde y el total cierra con raya simple."
        yes="Importes de un comprobante (netos, IVA calculado, percepciones, total), el cierre del día, la posición de IVA."
        no="Un libro o un reporte (la raya doble queda para el total final de `LedgerTable` o `DataTable`)."
        usage={`<AmountStack aria-label="Importes del comprobante">
  <AmountStackRow label="Neto 21 %" fieldId="net21"
    field={<MoneyField id="net21" name="net_21_cents" />}
    side={{ label: 'IVA 21 %', value: <Amount cents={iva21} /> }} />
  <AmountStackRow label="Total" emphasis="total" valueFor="net21" value={<Amount cents={total} />} />
</AmountStack>`}
        a11y={[
          'El grupo tiene nombre; la etiqueta de cada fila es el `<label for>` de su campo.',
          'Los calculados van en `<output aria-live="off">`: no hablan en cada tecla (lo audible lo da `EntryPreview`).',
          'Faltante no es cero: un calculado sin datos muestra «—».',
        ]}
      >
        <AmountStackDemo />
      </CatalogBlock>

      <CatalogBlock
        id="entry-editor"
        wide
        sample
        purpose="Filas que se agregan y se quitan (`LineItems`) y el asiento manual sobre ellas (`EntryEditor`)."
        yes="Asiento de apertura, ajustes, sueldos; los medios de una orden de pago."
        no="Una lista para ver (`DataTable`) o el asiento que arma el sistema (`EntryPreview`)."
        usage={`<form action={formAction}>
  <EntryEditor name="lines" accounts={cuentas} minLines={2}
    renderParty={({ label, line, update }) => <SupplierPicker aria-label={label} … />} />
  <FormActions>…</FormActions>
</form>
// en el server: manualEntrySchema + la RPC vuelve a sumar en BigInt`}
        a11y={[
          'Cada fila es un grupo «Línea 2» y cada control lleva su prefijo: «Cuenta, línea 2», «Debe, línea 2».',
          '«Agregar línea» enfoca el primer control de la fila nueva; «Quitar» enfoca la siguiente (o la anterior). Nunca el `<body>`.',
          'Si no cuadra, el envío se frena con el mensaje del server («Falta $ 12,40 en el Haber») y el foco va al pie.',
          'Enter en la nota de la última línea agrega otra. Solo lectura se dibuja como `EntryPreview`.',
        ]}
      >
        <EntryEditorDemo />
      </CatalogBlock>

      <CatalogBlock
        id="payment-methods"
        sample
        purpose="Los medios de una orden de pago o de un cobro contra lo que hay que cubrir, con el balance en vivo."
        yes="«Pagar» y «Cobrar»: una o varias cajas, bancos y billeteras que suman el total."
        no="Un solo medio fijo: un `Select` alcanza."
        usage={`<PaymentMethodsEditor name="methods" treasuries={cajas} targetCents={aPagar} />`}
        a11y={[
          'El sello «Completo / Falta asignar / Sobra» usa la misma región estable que el asiento: habla solo cuando cambia.',
          'Con meta, el envío se frena hasta que los medios la cubran justo, con el foco en el pie.',
        ]}
      >
        <PaymentMethodsDemo />
      </CatalogBlock>

      <CatalogBlock
        id="voucher-number"
        purpose="Punto de venta y número de un comprobante: dos `CodeField` que se leen «00003-00001290»."
        yes="Todo comprobante: compras, notas de crédito, ventas facturadas."
        no="Un número que no es de comprobante (`NumberField` o `Input`)."
        usage={`<VoucherNumberFields defaultPointOfSale={doc?.pv} defaultNumber={doc?.number}
  pointOfSaleError={state?.fieldErrors?.point_of_sale} numberError={state?.fieldErrors?.number} />`}
        a11y={[
          'Cada campo tiene su etiqueta y su error; los dos viajan en su hidden con solo dígitos.',
          'Pegar «Factura A 0003-00001290» (o los 12 dígitos) en cualquiera de los dos los reparte.',
        ]}
      >
        <VoucherNumberDemo />
      </CatalogBlock>
    </CatalogFamily>
  )
}
