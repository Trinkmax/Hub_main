// @vitest-environment node
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { AccountPicker } from '@/components/accounting/account-picker'
import type { AccountNode } from '@/components/accounting/account-tree'
import { AmountStack, AmountStackRow } from '@/components/accounting/amount-stack'
import { EntryEditor, type EntryEditorLine } from '@/components/accounting/entry-editor'
import { LineItems } from '@/components/accounting/line-items'
import { PaymentMethodsEditor } from '@/components/accounting/payment-methods-editor'
import { VoucherNumberFields } from '@/components/accounting/voucher-number-fields'
import { Amount } from '@/components/ui/amount'
import { Field } from '@/components/ui/field'
import { MoneyField } from '@/components/ui/money-field'

/**
 * Las piezas contables con campos (kit §3.8) en el HTML del server: lo que ve
 * el formulario al cargar, antes de cualquier tecla.
 *
 * - `AmountStack`: grupo con nombre, etiqueta `for` del campo, calculados en
 *   `<output aria-live="off">` y el total con la raya de la regla contable.
 * - `AccountPicker`: «1.1.01 · Caja» en el disparador, `name` oculto con el id.
 * - `LineItems` / `EntryEditor`: filas como grupos «Línea 2», controles con el
 *   prefijo de su fila, «Quitar» solo por encima de `minLines`, el JSON
 *   canónico en el `hidden`, el pie con el sello y, en solo lectura, la vista
 *   previa sin controles.
 * - `PaymentMethodsEditor`: los medios contra la meta.
 * - `VoucherNumberFields`: punto de venta y número con ceros en sus `hidden`.
 */

const NBSP = ' '

function unescapeHtml(value: string): string {
  return value
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#x27;/g, "'")
    .replace(/&amp;/g, '&')
}

const textOf = (html: string) => unescapeHtml(html.replace(/<[^>]+>/g, ''))

function elementAt(html: string, start: number): string {
  const tag = /^<([a-z0-9]+)/.exec(html.slice(start))?.[1]
  if (!tag) throw new Error('sin elemento')
  if (/^(input|br|img|hr|meta|link|area|col|source|wbr)$/.test(tag)) {
    return html.slice(start, html.indexOf('>', start) + 1)
  }
  const re = new RegExp(`<${tag}[\\s>]|</${tag}>`, 'g')
  re.lastIndex = start
  let depth = 0
  for (let m = re.exec(html); m; m = re.exec(html)) {
    depth += m[0].startsWith('</') ? -1 : 1
    if (depth === 0) return html.slice(start, m.index + m[0].length)
  }
  throw new Error(`<${tag}> sin cerrar`)
}

function elementsWith(html: string, attr: string): string[] {
  const out: string[] = []
  const re = /<[a-z0-9]+[^>]*>/g
  for (let m = re.exec(html); m; m = re.exec(html)) {
    if (m[0].includes(attr)) out.push(elementAt(html, m.index))
  }
  return out
}

function attrsOf(element: string): Record<string, string> {
  const open = element.slice(0, element.indexOf('>'))
  return Object.fromEntries(
    [...open.matchAll(/([\w-]+)="([^"]*)"/g)].map(([, k, v]) => [k ?? '', unescapeHtml(v ?? '')]),
  )
}

const hiddenValue = (html: string, name: string) =>
  attrsOf(elementsWith(html, `name="${name}"`)[0] ?? '').value

const ACCOUNTS: AccountNode[] = [
  { id: 'a1', code: '1', name: 'ACTIVO', postable: false, active: true },
  { id: 'a2', code: '1.1', name: 'Activo corriente', postable: false, active: true },
  { id: 'a3', code: '1.1.01', name: 'Caja y bancos', postable: false, active: true },
  {
    id: 'caja',
    code: '1.1.01.01',
    name: 'Caja',
    postable: true,
    active: true,
    description: 'Efectivo del local',
  },
  { id: 'a5', code: '2', name: 'PASIVO', postable: false, active: true },
  { id: 'a6', code: '2.1', name: 'Pasivo corriente', postable: false, active: true },
  { id: 'a7', code: '2.1.01', name: 'Deudas comerciales', postable: false, active: true },
  {
    id: 'prov',
    code: '2.1.01.01',
    name: 'Proveedores',
    postable: true,
    active: true,
    requiresParty: true,
  },
  { id: 'a9', code: '5', name: 'EGRESOS', postable: false, active: true },
  { id: 'a10', code: '5.3', name: 'Gastos', postable: false, active: true },
  { id: 'a11', code: '5.3.02', name: 'Local y servicios', postable: false, active: true },
  {
    id: 'luz',
    code: '5.3.02.03',
    name: 'Energía eléctrica',
    postable: true,
    active: true,
    description: 'Luz (EPEC)',
  },
  { id: 'vieja', code: '5.3.02.99', name: 'Cuenta vieja', postable: true, active: false },
]

describe('AmountStack', () => {
  const html = renderToStaticMarkup(
    <AmountStack aria-label="Importes del comprobante" data-tour="importes">
      <AmountStackRow
        label="Neto 21 %"
        fieldId="net21"
        valueFor="net21"
        field={<MoneyField id="net21" name="net_21_cents" defaultCents={71074400} />}
        side={{ label: 'IVA 21 %', value: <Amount cents={14925620} /> }}
        hint="Sin el IVA"
      />
      <AmountStackRow label="Percepciones" value={<Amount cents={null} />} />
      <AmountStackRow
        label="Total"
        emphasis="total"
        valueFor="net21"
        value={<Amount cents={86000020} />}
      />
    </AmountStack>,
  )

  it('grupo con nombre y data-tour; filas en subgrid', () => {
    const root = attrsOf(elementsWith(html, 'data-slot="amount-stack"')[0] ?? '')
    expect(root.role).toBe('group')
    expect(root['aria-label']).toBe('Importes del comprobante')
    expect(root['data-tour']).toBe('importes')
    for (const row of elementsWith(html, 'data-slot="amount-stack-row"')) {
      expect(attrsOf(row).class).toContain('md:grid-cols-subgrid')
    }
  })

  it('la etiqueta es el <label for> del campo; el campo lleva centavos en su hidden', () => {
    const label = elementsWith(html, 'data-slot="amount-stack-label"')[0] ?? ''
    expect(label.startsWith('<label')).toBe(true)
    expect(attrsOf(label).for).toBe('net21')
    expect(hiddenValue(html, 'net_21_cents')).toBe('71074400')
  })

  it('calculados en <output aria-live="off">; el faltante es «—» y no $ 0,00', () => {
    const outputs = elementsWith(html, '<output')
    expect(outputs.length).toBe(3)
    for (const output of outputs) expect(attrsOf(output)['aria-live']).toBe('off')
    expect(attrsOf(outputs[0] ?? '').for).toBe('net21')
    expect(textOf(outputs[0] ?? '')).toBe(`$${NBSP}149.256,20`)
    expect(textOf(outputs[1] ?? '')).toBe('—sin dato')
  })

  it('el total cierra con la raya simple de la regla contable y semibold', () => {
    const total = elementsWith(html, 'data-emphasis="total"')[0] ?? ''
    expect(attrsOf(total).class).toContain('border-t border-rule')
    expect(attrsOf(total).class).toContain('font-semibold')
    expect(attrsOf(total).class).not.toContain('double')
  })

  it('con signos (posición de IVA): la columna angosta y la palabra para el lector', () => {
    const signed = renderToStaticMarkup(
      <AmountStack aria-label="Posición de IVA">
        <AmountStackRow label="Débito fiscal" value={<Amount cents={1000} />} />
        <AmountStackRow sign="−" label="Crédito fiscal" value={<Amount cents={400} />} />
        <AmountStackRow sign="=" label="A pagar" emphasis="total" value={<Amount cents={600} />} />
      </AmountStack>,
    )
    const signs = elementsWith(signed, 'data-slot="amount-stack-sign"')
    expect(signs.map((s) => attrsOf(s)['data-stack-sign'])).toEqual([undefined, '−', '='])
    expect(textOf(signs[1] ?? '')).toBe('−menos')
  })
})

describe('AccountPicker (cerrado, en el HTML del server)', () => {
  it('la elegida se ve «código · nombre» y el id viaja en el hidden del Field', () => {
    const html = renderToStaticMarkup(
      <Field label="Cuenta" name="account_id">
        <AccountPicker accounts={ACCOUNTS} defaultValue="luz" data-tour="cuenta" />
      </Field>,
    )
    const trigger = elementsWith(html, 'role="combobox"')[0] ?? ''
    expect(textOf(trigger)).toBe('5.3.02.03 · Energía eléctrica')
    expect(attrsOf(trigger)['data-tour']).toBe('cuenta')
    expect(attrsOf(trigger)['aria-labelledby']?.split(' ')).toHaveLength(2)
    expect(hiddenValue(html, 'account_id')).toBe('luz')
  })

  it('sin valor: «Elegí una cuenta…» y el hidden vacío', () => {
    const html = renderToStaticMarkup(
      <AccountPicker accounts={ACCOUNTS} name="cuenta" aria-label="Cuenta" />,
    )
    expect(textOf(elementsWith(html, 'role="combobox"')[0] ?? '')).toBe('Elegí una cuenta…')
    expect(hiddenValue(html, 'cuenta')).toBe('')
  })

  it('la elegida inactiva se sigue viendo con su nombre (no el id)', () => {
    const html = renderToStaticMarkup(
      <AccountPicker accounts={ACCOUNTS} defaultValue="vieja" aria-label="Cuenta" />,
    )
    expect(textOf(elementsWith(html, 'role="combobox"')[0] ?? '')).toBe('5.3.02.99 · Cuenta vieja')
  })
})

describe('LineItems', () => {
  type Row = { key: string; text: string }
  it('filas como grupos con nombre, JSON canónico sin keys y «Agregar línea»', () => {
    const html = renderToStaticMarkup(
      <LineItems<Row>
        name="filas"
        defaultLines={[
          { key: 'r0', text: 'uno' },
          { key: 'r1', text: 'dos' },
        ]}
        newLine={() => ({ key: 'nuevo', text: '' })}
        renderLine={(line, _index, api) => (
          <span data-can-remove={api.canRemove ? 'si' : 'no'}>
            {api.controlLabel('Texto')}: {line.text}
          </span>
        )}
        data-tour="filas"
      />,
    )
    const groups = elementsWith(html, 'data-slot="line-item"').map(attrsOf)
    expect(groups.map((g) => [g.role, g['aria-label'], g['data-line-key']])).toEqual([
      ['group', 'Línea 1', 'r0'],
      ['group', 'Línea 2', 'r1'],
    ])
    expect(html).toContain('Texto, línea 2: dos')
    expect(html).toContain('data-can-remove="si"')
    expect(hiddenValue(html, 'filas')).toBe('[{"text":"uno"},{"text":"dos"}]')
    expect(textOf(elementsWith(html, 'data-slot="line-items-add"')[0] ?? '')).toBe('Agregar línea')
    expect(attrsOf(elementsWith(html, 'data-slot="line-items"')[0] ?? '')['data-tour']).toBe(
      'filas',
    )
  })

  it('por debajo de minLines no se quita; en solo lectura o en el tope no se agrega', () => {
    const one = renderToStaticMarkup(
      <LineItems<Row>
        defaultLines={[{ key: 'r0', text: 'uno' }]}
        newLine={() => ({ key: 'n', text: '' })}
        renderLine={(_line, _index, api) => <span data-can-remove={api.canRemove ? 'si' : 'no'} />}
        maxLines={1}
      />,
    )
    expect(one).toContain('data-can-remove="no"')
    expect(one).not.toContain('data-slot="line-items-add"')
    const readOnly = renderToStaticMarkup(
      <LineItems<Row>
        readOnly
        defaultLines={[
          { key: 'r0', text: 'uno' },
          { key: 'r1', text: 'dos' },
        ]}
        newLine={() => ({ key: 'n', text: '' })}
        renderLine={(_line, _index, api) => <span data-can-remove={api.canRemove ? 'si' : 'no'} />}
      />,
    )
    expect(readOnly).not.toContain('data-can-remove="si"')
    expect(readOnly).not.toContain('data-slot="line-items-add"')
  })
})

describe('EntryEditor (asiento manual)', () => {
  it('dos líneas vacías: grupos «Línea N», controles con el prefijo de su fila y sin «Quitar»', () => {
    const html = renderToStaticMarkup(
      <EntryEditor name="lines" accounts={ACCOUNTS} data-tour="asiento-manual" />,
    )
    const root = attrsOf(elementsWith(html, 'data-slot="entry-editor"')[0] ?? '')
    expect(root['data-tour']).toBe('asiento-manual')
    expect(
      elementsWith(html, 'data-slot="line-item"').map((g) => attrsOf(g)['aria-label']),
    ).toEqual(['Línea 1', 'Línea 2'])
    const labels = elementsWith(html, '<label').map(textOf)
    expect(labels).toEqual([
      'Cuenta, línea 1',
      'Debe, línea 1',
      'Haber, línea 1',
      'Nota, línea 1',
      'Cuenta, línea 2',
      'Debe, línea 2',
      'Haber, línea 2',
      'Nota, línea 2',
    ])
    expect(html).not.toContain('aria-label="Quitar')
    // Encabezados de columna solo para la vista.
    const header = elementsWith(html, 'data-slot="entry-editor-header"')[0] ?? ''
    expect(attrsOf(header)['aria-hidden']).toBe('true')
    expect(textOf(header)).toBe('CuentaDebeHaberNota')
    // Sin nada cargado, el hidden va vacío (las líneas en blanco no viajan).
    expect(hiddenValue(html, 'lines')).toBe('[]')
    expect(textOf(elementsWith(html, 'role="status"')[0] ?? '')).toBe('Sin importes')
    expect(html).toContain('data-slot="entry-editor-validity"')
  })

  it('con importes que no cuadran: el pie dice cuánto falta y el sello «No cuadra»', () => {
    const lines: EntryEditorLine[] = [
      { key: 'a', accountId: 'luz', debitCents: 100000, creditCents: null, note: 'Factura EPEC' },
      { key: 'b', accountId: 'caja', debitCents: null, creditCents: 98760 },
      { key: 'c', accountId: null, debitCents: null, creditCents: null },
    ]
    const html = renderToStaticMarkup(
      <EntryEditor name="lines" accounts={ACCOUNTS} defaultLines={lines} />,
    )
    const footer = elementsWith(html, 'data-slot="entry-editor-footer"')[0] ?? ''
    expect(attrsOf(footer)['data-status']).toBe('unbalanced')
    expect(attrsOf(footer).class).toContain('[border-bottom-style:double]')
    expect(textOf(elementsWith(footer, 'data-slot="balance-seal"')[0] ?? '')).toBe(
      `No cuadra · diferencia $${NBSP}12,40`,
    )
    expect(textOf(footer)).toContain(`Falta $${NBSP}12,40 en el Haber`)
    expect(textOf(footer)).toContain(`$${NBSP}1.000,00`)
    // Tres líneas con minLines 2: las tres se pueden quitar.
    expect(elementsWith(html, 'aria-label="Quitar').map((b) => attrsOf(b)['aria-label'])).toEqual([
      'Quitar línea 1',
      'Quitar línea 2',
      'Quitar línea 3',
    ])
    expect(JSON.parse(hiddenValue(html, 'lines') ?? '[]')).toEqual([
      {
        accountId: 'luz',
        debitCents: 100000,
        creditCents: null,
        partyId: null,
        dueDate: null,
        memo: 'Factura EPEC',
      },
      {
        accountId: 'caja',
        debitCents: null,
        creditCents: 98760,
        partyId: null,
        dueDate: null,
        memo: null,
      },
    ])
    // Los importes llegan a los campos (pesos prolijos en el visible).
    expect(html).toContain('value="1.000,00"')
    expect(html).toContain('value="987,60"')
  })

  it('el partícipe aparece solo en las cuentas de control', () => {
    const html = renderToStaticMarkup(
      <EntryEditor
        accounts={ACCOUNTS}
        defaultLines={[
          { key: 'a', accountId: 'prov', debitCents: 5000, creditCents: null, partyId: 'p1' },
          { key: 'b', accountId: 'caja', debitCents: null, creditCents: 5000 },
        ]}
        renderParty={({ label, line }) => <span data-party={line.partyId}>{label}</span>}
      />,
    )
    const parties = elementsWith(html, 'data-slot="entry-editor-party"')
    expect(parties).toHaveLength(1)
    expect(textOf(parties[0] ?? '')).toContain('Proveedor o cliente, línea 1')
  })

  it('solo lectura: se dibuja como EntryPreview, sin controles', () => {
    const html = renderToStaticMarkup(
      <EntryEditor
        readOnly
        accounts={ACCOUNTS}
        defaultLines={[
          { key: 'a', accountId: 'luz', debitCents: 100000, creditCents: null },
          { key: 'b', accountId: 'caja', debitCents: null, creditCents: 100000 },
        ]}
      />,
    )
    expect(html).toContain('data-slot="entry-preview"')
    expect(html).toContain('Líneas del asiento')
    expect(html).not.toContain('<input')
    expect(html).not.toContain('role="combobox"')
    expect(textOf(elementsWith(html, 'role="status"')[0] ?? '')).toBe('Cuadra')
  })
})

describe('PaymentMethodsEditor (medios de pago)', () => {
  const TREASURIES = [
    { id: 't-mp', name: 'Mercado Pago de la SAS', balanceCents: 420000000 },
    { id: 't-caja', name: 'Caja', balanceCents: 35000000 },
  ]

  it('contra la meta: «Asignado $ X de $ Y», «Falta asignar» y «Otro medio»', () => {
    const html = renderToStaticMarkup(
      <PaymentMethodsEditor
        name="methods"
        treasuries={TREASURIES}
        targetCents={117950000}
        defaultLines={[
          { key: 'm0', treasuryAccountId: 't-mp', amountCents: 100000000, reference: '' },
        ]}
      />,
    )
    const footer = elementsWith(html, 'data-slot="payment-methods-footer"')[0] ?? ''
    expect(textOf(footer)).toContain(`Asignado $${NBSP}1.000.000,00 de $${NBSP}1.179.500,00`)
    expect(textOf(footer)).toContain(`Falta asignar $${NBSP}179.500,00 a un medio`)
    expect(textOf(elementsWith(footer, 'role="status"')[0] ?? '')).toBe('Falta asignar')
    expect(textOf(elementsWith(html, 'data-slot="line-items-add"')[0] ?? '')).toBe('Otro medio')
    expect(textOf(elementsWith(html, 'role="combobox"')[0] ?? '')).toBe('Mercado Pago de la SAS')
    expect(JSON.parse(hiddenValue(html, 'methods') ?? '[]')).toEqual([
      { type: 'treasury', treasuryAccountId: 't-mp', amountCents: 100000000, reference: null },
    ])
  })

  it('con una sola caja arranca con ella y con la meta: «Completo»', () => {
    const html = renderToStaticMarkup(
      <PaymentMethodsEditor
        name="received"
        shape="collection"
        methodLabel="Entró a"
        treasuries={[{ id: 't-banco', name: 'Banco Nación' }]}
        targetCents={31555260}
      />,
    )
    expect(textOf(elementsWith(html, 'role="status"')[0] ?? '')).toBe('Completo')
    expect(elementsWith(html, '<label').map(textOf)).toContain('Entró a, línea 1')
    expect(JSON.parse(hiddenValue(html, 'received') ?? '[]')).toEqual([
      { treasuryAccountId: 't-banco', amountCents: 31555260, reference: null },
    ])
  })
})

describe('VoucherNumberFields (CodeField: punto de venta y número)', () => {
  it('con ceros a la izquierda en el visible y en los hidden', () => {
    const html = renderToStaticMarkup(
      <VoucherNumberFields defaultPointOfSale={3} defaultNumber={1290} data-tour="numero" />,
    )
    expect(hiddenValue(html, 'point_of_sale')).toBe('00003')
    expect(hiddenValue(html, 'number')).toBe('00001290')
    expect(html).toContain('value="00003"')
    expect(html).toContain('value="00001290"')
    expect(elementsWith(html, '<label').map(textOf)).toEqual(['Punto de venta', 'Número'])
    expect(
      attrsOf(elementsWith(html, 'data-slot="voucher-number-fields"')[0] ?? '')['data-tour'],
    ).toBe('numero')
    // Dígitos tabulares y teclado numérico.
    const inputs = elementsWith(html, 'inputMode="numeric"')
    expect(inputs).toHaveLength(2)
  })
})
