// @vitest-environment node
import { createElement as h, type ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { type LedgerRow, LedgerTable } from '@/components/accounting/ledger-table'

/**
 * `LedgerTable` (kit §3.8): el mayor, los movimientos de una caja y el estado
 * de cuenta, en el HTML del server.
 *
 * Lo que se fija:
 * 1. El saldo con sufijo D/A en el mayor (la letra en un `abbr` oculto y la
 *    palabra para el lector) y con signo en el estado de cuenta.
 * 2. El saldo acumulado y los totales se muestran como vienen de SQL: nunca se
 *    suman en el cliente (tampoco el cierre: con `truncated` no se dibuja).
 * 3. Filas compactas de 36 px, «Saldo anterior» primero y el cierre con la
 *    regla doble; fecha `dd/MM` (con año si cruza años); aviso de tope.
 * 4. En el celular, `cards`: el movimiento con signo y el saldo abajo.
 */

vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children?: ReactNode }) =>
    h('a', { href, ...rest }, children),
}))

const NBSP = ' '
const MINUS = '−'

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

/** Las celdas (`th`/`td`) de una fila, con su texto. */
function cellsOf(row: string): string[] {
  const inner = row.slice(row.indexOf('>') + 1)
  const out: string[] = []
  const re = /<(td|th)[\s>]/g
  for (let m = re.exec(inner); m; m = re.exec(inner)) {
    const cell = elementAt(inner, m.index)
    out.push(textOf(cell))
    re.lastIndex = m.index + cell.length
  }
  return out
}

/**
 * Mayor de «Proveedores» (2.1.01.01): el saldo acumulado viene de la consulta
 * (función de ventana sobre TODO el período, con lo anterior a esta página),
 * por eso no es la suma de lo que se ve.
 */
const LEDGER: LedgerRow[] = [
  {
    id: 'r1',
    date: '2026-09-03',
    description: 'Factura A 0003-00001234',
    reference: 'Distribuidora del Centro SA',
    href: '/hub/administracion/comprobantes/1',
    debitCents: null,
    creditCents: 38000000,
    balanceCents: -158000000,
  },
  {
    id: 'r2',
    date: '2026-09-15',
    description: 'Pago #125',
    href: '/hub/administracion/comprobantes/2',
    debitCents: 50000000,
    creditCents: null,
    balanceCents: -108000000,
  },
  {
    id: 'r3',
    date: '2026-09-30',
    description: 'Nota de crédito A 0003-00000077',
    debitCents: 108000000,
    creditCents: null,
    balanceCents: 0,
  },
]

describe('LedgerTable · saldo con D/A (mayor)', () => {
  const html = renderToStaticMarkup(
    <LedgerTable
      caption="Mayor de Proveedores"
      rows={LEDGER}
      opening={{ balanceCents: -120000000 }}
      closingLabel="Saldo al 30/09/2026"
      totals={{ debitCents: 158000000, creditCents: 38000000 }}
      data-tour="mayor"
    />,
  )
  const bodyRows = elementsWith(html, '<tr').filter((row) => row.includes('data-ledger-row'))

  it('acreedor: absoluto con «A» en un abbr oculto y «acreedor» para el lector', () => {
    const saldo = cellsOf(bodyRows[0] ?? '')
    expect(saldo.at(-1)).toBe(`1.580.000,00${NBSP}A acreedor`)
    expect(bodyRows[0]).toContain('<abbr title="saldo acreedor" aria-hidden="true">A</abbr>')
    expect(bodyRows[0]).toContain('<span class="sr-only"> acreedor</span>')
    expect(bodyRows[0]).not.toContain(MINUS)
  })

  it('deudor: «D» y «deudor»; el cero va sin lado', () => {
    const html2 = renderToStaticMarkup(
      <LedgerTable
        caption="Mayor de Caja"
        rows={[
          {
            id: 'c1',
            date: '2026-09-01',
            description: 'Cierre del día',
            debitCents: 35000000,
            creditCents: null,
            balanceCents: 35000000,
          },
          {
            id: 'c2',
            date: '2026-09-02',
            description: 'Depósito',
            debitCents: null,
            creditCents: 35000000,
            balanceCents: 0,
          },
        ]}
      />,
    )
    const rows = elementsWith(html2, '<tr').filter((row) => row.includes('data-ledger-row'))
    expect(rows[0]).toContain('<abbr title="saldo deudor" aria-hidden="true">D</abbr>')
    expect(cellsOf(rows[0] ?? '').at(-1)).toBe(`350.000,00${NBSP}D deudor`)
    expect(rows[1]).not.toContain('<abbr')
    expect(cellsOf(rows[1] ?? '').at(-1)).toBe('0,00')
  })

  it('el saldo de cada fila es el de SQL, tal cual (no se suma en el cliente)', () => {
    expect(bodyRows.map((row) => cellsOf(row).at(-1))).toEqual([
      `1.580.000,00${NBSP}A acreedor`,
      `1.080.000,00${NBSP}A acreedor`,
      '0,00',
    ])
  })

  it('columnas Fecha · Comprobante · Debe · Haber · Saldo y filas compactas de 36 px', () => {
    const headers = elementsWith(html, 'data-slot="data-table-header"').map(textOf)
    expect(headers).toEqual(['Fecha', 'Comprobante', 'Debe', 'Haber', 'Saldo'])
    const table = attrsOf(elementsWith(html, 'data-slot="data-table-root"')[0] ?? '')
    expect(table['data-density']).toBe('compact')
    expect(table.class).toContain('data-[density=compact]:[--row-h:var(--row-compact)]')
  })

  it('fecha dd/MM dentro del mismo año, comprobante con su referencia y la fila como link', () => {
    const cells = cellsOf(bodyRows[0] ?? '')
    expect(cells[0]).toBe('03/09')
    expect(cells[1]).toBe('Factura A 0003-00001234Distribuidora del Centro SA')
    expect(cells[2]).toBe('')
    expect(cells[3]).toBe('380.000,00')
    const link = elementsWith(bodyRows[0] ?? '', 'data-slot="data-table-row-link"')[0] ?? ''
    expect(attrsOf(link).href).toBe('/hub/administracion/comprobantes/1')
    // Sin link, la fila no tiene link estirado.
    expect(bodyRows[2]).not.toContain('data-slot="data-table-row-link"')
  })

  it('«Saldo anterior» primero, apagado y solo en la columna Saldo', () => {
    const opening = elementsWith(html, 'data-slot="ledger-opening"')[0] ?? ''
    expect(cellsOf(opening)).toEqual(['Saldo anterior', `1.200.000,00${NBSP}A acreedor`])
    expect(attrsOf(elementsWith(opening, '<th')[0] ?? '').colSpan).toBe('4')
    expect(opening).toContain('text-muted-foreground')
    expect(html.indexOf('data-slot="ledger-opening"')).toBeLessThan(html.indexOf('data-ledger-row'))
  })

  it('pie: totales de SQL y el cierre (el saldo de la última fila) con la regla doble', () => {
    const foot = elementsWith(html, 'data-slot="data-table-foot"')[0] ?? ''
    const footClass = attrsOf(foot).class ?? ''
    expect(footClass).toContain('[&>tr:last-child>*]:[border-bottom-style:double]')
    expect(cellsOf(elementsWith(foot, 'data-slot="ledger-totals"')[0] ?? '')).toEqual([
      'Totales',
      '1.580.000,00',
      '380.000,00',
      '',
    ])
    expect(cellsOf(elementsWith(foot, 'data-slot="ledger-closing"')[0] ?? '')).toEqual([
      'Saldo al 30/09/2026',
      '0,00',
    ])
  })

  it('pasa data-tour a la raíz', () => {
    expect(attrsOf(elementsWith(html, 'data-slot="ledger-table"')[0] ?? '')['data-tour']).toBe(
      'mayor',
    )
  })
})

describe('LedgerTable · estado de cuenta, tope y celular', () => {
  it('con signo (estado de cuenta), etiquetas propias y la columna Vence', () => {
    const html = renderToStaticMarkup(
      <LedgerTable
        caption="Estado de cuenta"
        balanceMode="signed"
        showDue
        columnLabels={{ debit: 'Facturas', credit: 'Pagos' }}
        rows={[
          {
            id: 's1',
            date: '2026-09-03',
            dueDate: '2026-09-24',
            description: 'Factura A 0003-00001234',
            debitCents: 38000000,
            creditCents: null,
            balanceCents: 38000000,
          },
          {
            id: 's2',
            date: '2026-09-15',
            description: 'Pago #125',
            debitCents: null,
            creditCents: 50000000,
            balanceCents: -12000000,
          },
        ]}
      />,
    )
    expect(elementsWith(html, 'data-slot="data-table-header"').map(textOf)).toEqual([
      'Fecha',
      'Comprobante',
      'Vence',
      'Facturas',
      'Pagos',
      'Saldo',
    ])
    const rows = elementsWith(html, '<tr').filter((row) => row.includes('data-ledger-row'))
    expect(cellsOf(rows[0] ?? '')[2]).toBe('24/09')
    expect(cellsOf(rows[1] ?? '').at(-1)).toBe(`${MINUS}120.000,00`)
    expect(html).not.toContain('<abbr')
  })

  it('si el período cruza de año, la fecha lleva el año', () => {
    const html = renderToStaticMarkup(
      <LedgerTable
        caption="Mayor"
        rows={[
          {
            id: 'y1',
            date: '2026-12-30',
            description: 'Factura',
            debitCents: 100,
            creditCents: null,
            balanceCents: 100,
          },
          {
            id: 'y2',
            date: '2027-01-02',
            description: 'Pago',
            debitCents: null,
            creditCents: 100,
            balanceCents: 0,
          },
        ]}
      />,
    )
    const rows = elementsWith(html, '<tr').filter((row) => row.includes('data-ledger-row'))
    expect(rows.map((row) => cellsOf(row)[0])).toEqual(['30/12/2026', '02/01/2027'])
  })

  it('con tope: el aviso arriba y sin cierre (la última fila no es el final del período)', () => {
    const html = renderToStaticMarkup(
      <LedgerTable caption="Mayor" rows={LEDGER} closingLabel="Saldo al 30/09/2026" truncated />,
    )
    const callout = elementsWith(html, 'data-slot="data-table-truncated"')[0] ?? ''
    expect(textOf(callout)).toBe(
      'Mostramos los primeros 1.000 movimientos. Acotá el período para ver todo.',
    )
    expect(attrsOf(callout)['data-tone']).toBe('warning')
    expect(html).not.toContain('data-slot="ledger-closing"')
    // Con el cierre de la consulta, sí.
    const withClosing = renderToStaticMarkup(
      <LedgerTable
        caption="Mayor"
        rows={LEDGER}
        truncated
        closing={{ label: 'Saldo al 30/09/2026', balanceCents: -98000000 }}
      />,
    )
    const closing = elementsWith(withClosing, 'data-slot="ledger-closing"')[0] ?? ''
    expect(cellsOf(closing)).toEqual(['Saldo al 30/09/2026', `980.000,00${NBSP}A acreedor`])
  })

  it('celular en tarjetas: el movimiento con signo a la derecha y el saldo abajo', () => {
    const html = renderToStaticMarkup(
      <LedgerTable
        caption="Estado de cuenta"
        balanceMode="signed"
        mobile="cards"
        columnLabels={{ debit: 'Facturas', credit: 'Pagos' }}
        rows={[
          {
            id: 's1',
            date: '2026-09-03',
            description: 'Factura A 0003-00001234',
            href: '/f/1',
            debitCents: 38000000,
            creditCents: null,
            balanceCents: 38000000,
          },
          {
            id: 's2',
            date: '2026-09-15',
            description: 'Pago #125',
            debitCents: null,
            creditCents: 50000000,
            balanceCents: -12000000,
          },
        ]}
        closingLabel="Saldo al 30/09/2026"
      />,
    )
    expect(attrsOf(elementsWith(html, 'data-slot="data-table-root"')[0] ?? '').class).toContain(
      'hidden md:table',
    )
    const list = elementsWith(html, 'data-slot="ledger-cards"')[0] ?? ''
    expect(attrsOf(list).class).toContain('md:hidden')
    const cards = elementsWith(list, 'data-slot="ledger-card"').map(textOf)
    expect(cards[0]).toBe(
      `03/09Factura A 0003-00001234Facturas: +$${NBSP}380.000,00Saldo $${NBSP}380.000,00`,
    )
    expect(cards[1]).toBe(
      `15/09Pago #125Pagos: ${MINUS}$${NBSP}500.000,00Saldo ${MINUS}$${NBSP}120.000,00`,
    )
    const closing = elementsWith(list, 'data-slot="ledger-card-closing"')[0] ?? ''
    expect(textOf(closing)).toBe(`Saldo al 30/09/2026${MINUS}$${NBSP}120.000,00`)
    expect(attrsOf(closing).class).toContain('[border-bottom-style:double]')
  })

  it('sin movimientos: el vacío, con el saldo anterior arriba', () => {
    const html = renderToStaticMarkup(
      <LedgerTable
        caption="Mayor"
        rows={[]}
        opening={{ balanceCents: 5000 }}
        closingLabel="Saldo al 30/09/2026"
      />,
    )
    expect(textOf(elementsWith(html, 'data-slot="data-table-empty"')[0] ?? '')).toContain(
      'Sin movimientos en el período',
    )
    expect(cellsOf(elementsWith(html, 'data-slot="ledger-closing"')[0] ?? '')).toEqual([
      'Saldo al 30/09/2026',
      `50,00${NBSP}D deudor`,
    ])
  })
})
