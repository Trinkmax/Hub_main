import { describe, expect, it } from 'vitest'
import {
  BOOKS,
  bookSwitcherItems,
} from '@/app/(manager)/[tenantSlug]/administracion/libros/_lib/book-nav'
import {
  countText,
  downloadablePackage,
  exportParamsFor,
  packageCountText,
  packageFiles,
  packageStatusLine,
} from '@/app/(manager)/[tenantSlug]/administracion/libros/_lib/package'
import {
  groupHistoryByDay,
  historyDayLabel,
  historyText,
  historyTime,
  personInitial,
} from '@/app/(manager)/[tenantSlug]/administracion/libros/historia/_lib/days'
import { subledgerMobileRow } from '@/app/(manager)/[tenantSlug]/administracion/libros/subdiarios/_lib/mobile-row'
import { SUBLEDGER_COLUMNS } from '@/lib/accounting/queries/columns'
import { EXPORT_BOOK_INFO, MONTH_PACKAGE_BOOKS } from '@/lib/accounting/queries/labels'

/**
 * Moverse por los libros sin perder el período, el paquete del mes, el renglón
 * de subdiario del celular y la historia agrupada por día. Todo puro.
 */

/** Los números llevan un espacio duro antes de su unidad: acá se compara contra texto común. */
const plain = (text: string | null | undefined) => (text ?? '').replaceAll('\u00a0', ' ')

const BOOKS_PATH = '/hub/administracion/libros'

function hrefOf(items: ReturnType<typeof bookSwitcherItems>, key: string): URL {
  const item = items.find((i) => i.key === key)
  return new URL(item?.href ?? '', 'http://x')
}

describe('pasar de un libro a otro con el período puesto', () => {
  const september = {
    kind: 'month' as const,
    month: '2026-09',
    from: '2026-09-01',
    to: '2026-09-30',
  }
  const range = { kind: 'range' as const, month: null, from: '2026-08-10', to: '2026-10-13' }

  it('son los ocho libros, con el abierto marcado', () => {
    const items = bookSwitcherItems(BOOKS_PATH, 'mayor', september)
    expect(items.map((i) => i.label)).toEqual([
      'Diario',
      'Mayor',
      'Sumas y saldos',
      'Subdiarios',
      'IVA compras',
      'IVA ventas',
      'Posición de IVA',
      'Historia',
    ])
    expect(items.filter((i) => i.active).map((i) => i.key)).toEqual(['mayor'])
    expect(items.every((i) => i.href.startsWith(`${BOOKS_PATH}/`))).toBe(true)
  })

  it('con un mes: todos reciben `?mes=`', () => {
    const items = bookSwitcherItems(BOOKS_PATH, 'diario', september)
    for (const book of BOOKS) {
      const url = hrefOf(items, book.key)
      expect(url.pathname).toBe(`${BOOKS_PATH}/${book.key}`)
      expect(url.search).toBe('?mes=2026-09')
    }
  })

  it('de un rango a un libro mensual va el mes de «hasta»; a uno de rango, el rango', () => {
    const items = bookSwitcherItems(BOOKS_PATH, 'diario', range)
    expect(hrefOf(items, 'iva-compras').search).toBe('?mes=2026-10')
    expect(hrefOf(items, 'iva-ventas').search).toBe('?mes=2026-10')
    expect(hrefOf(items, 'posicion-iva').search).toBe('?mes=2026-10')
    expect(hrefOf(items, 'mayor').search).toBe('?desde=2026-08-10&hasta=2026-10-13')
    expect(hrefOf(items, 'historia').search).toBe('?desde=2026-08-10&hasta=2026-10-13')
  })

  it('los filtros de cada libro no viajan', () => {
    const items = bookSwitcherItems(BOOKS_PATH, 'mayor', september)
    for (const item of items) {
      const params = new URL(item.href, 'http://x').searchParams
      for (const key of ['cuenta', 'tipo', 'quien', 'caja', 'nivel', 'despues', 'participe']) {
        expect(params.has(key), `${item.key} ${key}`).toBe(false)
      }
    }
  })

  it('sin libro abierto (una pantalla que no es de la fila), ninguno queda marcado', () => {
    expect(bookSwitcherItems(BOOKS_PATH, null, september).some((i) => i.active)).toBe(false)
  })
})

describe('el paquete del mes', () => {
  const month = { month: '2026-09', from: '2026-09-01', to: '2026-09-30' }
  const today = '2026-10-13'

  it('son los 15 archivos, en el orden de siempre', () => {
    const files = packageFiles('hub', month, today)
    expect(files).toHaveLength(15)
    expect(files.map((f) => f.libro)).toEqual([...MONTH_PACKAGE_BOOKS])
    expect(files.map((f) => f.title)).toEqual(
      MONTH_PACKAGE_BOOKS.map((libro) => EXPORT_BOOK_INFO[libro].title),
    )
  })

  it('cada uno pide el período con los parámetros de siempre', () => {
    const byBook = new Map(
      packageFiles('hub', month, today).map((f) => [f.libro, new URL(f.href, 'http://x')]),
    )
    const params = (libro: string) =>
      Object.fromEntries(byBook.get(libro as never)?.searchParams ?? [])
    // Un libro mensual: `?mes=`.
    expect(params('iva-compras')).toEqual({ slug: 'hub', libro: 'iva-compras', mes: '2026-09' })
    expect(params('posicion-iva')).toEqual({ slug: 'hub', libro: 'posicion-iva', mes: '2026-09' })
    // Uno de rango: el mes entero.
    expect(params('diario')).toEqual({
      slug: 'hub',
      libro: 'diario',
      desde: '2026-09-01',
      hasta: '2026-09-30',
    })
    expect(params('subdiario-disponibilidades')).toMatchObject({
      desde: '2026-09-01',
      hasta: '2026-09-30',
    })
    // Uno «a una fecha»: el cierre del mes.
    expect(params('saldos-proveedores')).toEqual({
      slug: 'hub',
      libro: 'saldos-proveedores',
      hasta: '2026-09-30',
    })
    for (const url of byBook.values()) {
      expect(url.pathname).toBe('/api/administracion/export')
    }
  })

  it('un saldo «al cierre» de un mes en curso es el de hoy', () => {
    const october = { month: '2026-10', from: '2026-10-01', to: '2026-10-31' }
    expect(exportParamsFor('saldos-clientes', october, today)).toEqual({ hasta: '2026-10-13' })
    expect(exportParamsFor('sumas-y-saldos', october, today)).toEqual({
      desde: '2026-10-01',
      hasta: '2026-10-31',
    })
  })

  it('el nombre del archivo lleva el bar, el libro y el mes', () => {
    const [first] = packageFiles('hub', month, today)
    expect(first?.fileName).toBe('administracion-hub-diario-2026-09.csv')
  })

  it('sin la CUIT quedan 10 de 15: los cinco de IVA no se pueden descargar', () => {
    const files = packageFiles('hub', month, today)
    const withCuit = downloadablePackage(files, true)
    const without = downloadablePackage(files, false)
    expect(withCuit).toHaveLength(15)
    expect(without).toHaveLength(10)
    expect(files.filter((f) => f.needsCuit).map((f) => f.libro)).toEqual([
      'iva-compras',
      'iva-compras-alicuotas',
      'iva-ventas',
      'iva-ventas-alicuotas',
      'posicion-iva',
    ])
    expect(plain(packageCountText(files.length, withCuit.length))).toBe('15 archivos')
    expect(packageCountText(files.length, without.length)).toBe('10 de 15')
    expect(plain(packageCountText(1, 1))).toBe('1 archivo')
  })

  it('el estado del mes y los conteos, en palabras', () => {
    expect(
      packageStatusLine('2026-10', { status: 'open', closedAt: null, closedByName: null }),
    ).toBe('Octubre 2026 · mes abierto: los números pueden cambiar hasta que se cierre')
    expect(
      packageStatusLine('2026-09', {
        status: 'closed',
        closedAt: '2026-10-05T15:00:00Z',
        closedByName: 'Franco',
      }),
    ).toBe('Septiembre 2026 · cerrado el 05/10/2026 por Franco')
    expect(
      packageStatusLine('2026-08', { status: 'missing', closedAt: null, closedByName: null }),
    ).toBe('Agosto 2026')
    expect(plain(countText({ rows: 35, unit: 'asientos' }))).toBe('35 asientos')
    expect(plain(countText({ rows: 1, unit: 'proveedores' }))).toBe('1 proveedor')
    expect(countText({ rows: 0, unit: 'filas' })).toBe('Sin movimientos')
    expect(countText({ rows: null, unit: 'cuentas' })).toBe('Sin contar todavía')
    expect(countText({ rows: 3, unit: null })).toBeNull()
  })
})

describe('un renglón de subdiario en el celular', () => {
  const plain = (text: string | null | undefined) => (text ?? '').replaceAll(' ', ' ')

  it('compras: fecha, referencia, el proveedor, su comprobante y el Total', () => {
    const row = subledgerMobileRow(
      {
        values: {
          date: '2026-10-03',
          seq: 125,
          kind_label: 'Factura',
          document_label: 'Factura A 0003-00001290',
          party_name: 'Distribuidora del Centro',
          tax_id: '30712345678',
          net_cents: 100_000_00,
          vat_cents: 21_000_00,
          total_cents: 121_000_00,
          open_cents: 50_000_00,
        },
      },
      SUBLEDGER_COLUMNS.purchases,
    )
    expect(row).toEqual({
      date: '03/10/2026',
      ref: '#125',
      // El proveedor nombra el renglón; «Factura» (el tipo) es igual en todos y no va.
      title: 'Distribuidora del Centro',
      detail: 'Factura A 0003-00001290',
      amountCents: 121_000_00,
      amountLabel: 'Total',
      direction: 0,
    })
    // El CUIT no es «lo que lo nombra».
    expect(plain(row.title + (row.detail ?? ''))).not.toContain('30-71234567-8')
  })

  it('compras sin proveedor (un tique): lo nombra lo primero que haya', () => {
    const row = subledgerMobileRow(
      {
        values: {
          date: '2026-10-03',
          seq: 126,
          kind_label: 'Compra',
          document_label: 'Tique 0001-00000045',
          total_cents: 9_000_00,
        },
      },
      SUBLEDGER_COLUMNS.purchases,
    )
    expect(row).toMatchObject({ title: 'Compra', detail: 'Tique 0001-00000045' })
  })

  it('cobranzas: sin «Total», va lo que entró («Neto recibido»), no la última columna', () => {
    const row = subledgerMobileRow(
      {
        values: {
          date: '2026-10-05',
          seq: 40,
          party_name: 'Mercado Pago',
          gross_cents: 100_000_00,
          commission_cents: 3_000_00,
          net_received_cents: 96_000_00,
          on_account_cents: 0,
        },
      },
      SUBLEDGER_COLUMNS.collections,
    )
    expect(row).toMatchObject({
      title: 'Mercado Pago',
      amountCents: 96_000_00,
      amountLabel: 'Neto recibido',
    })
  })

  it('cajas: lo que entró o lo que salió, con su sentido (nunca el saldo)', () => {
    const entered = subledgerMobileRow(
      {
        values: {
          date: '2026-10-05',
          treasury_name: 'Caja',
          document_label: 'Cierre del día',
          in_cents: 50_000_00,
          out_cents: 0,
          balance_cents: 900_000_00,
        },
      },
      SUBLEDGER_COLUMNS.treasury,
    )
    expect(entered).toMatchObject({
      title: 'Caja',
      detail: 'Cierre del día',
      amountCents: 50_000_00,
      amountLabel: 'Entró',
      direction: 1,
      ref: null,
    })
    const left = subledgerMobileRow(
      { values: { date: '2026-10-05', treasury_name: 'Caja', in_cents: 0, out_cents: 12_000_00 } },
      SUBLEDGER_COLUMNS.treasury,
    )
    expect(left).toMatchObject({ amountCents: 12_000_00, amountLabel: 'Salió', direction: -1 })
  })

  it('ventas por medio: «Importe»; un renglón sin datos no inventa nada', () => {
    const row = subledgerMobileRow(
      { values: { date: '2026-10-05', method_name: 'Débito', amount_cents: 7_000_00 } },
      SUBLEDGER_COLUMNS.sales_by_method,
    )
    expect(row).toMatchObject({ title: 'Débito', amountCents: 7_000_00, amountLabel: 'Importe' })
    const empty = subledgerMobileRow({ values: {} }, SUBLEDGER_COLUMNS.payments)
    expect(empty).toEqual({
      date: '',
      ref: null,
      title: '',
      detail: null,
      amountCents: null,
      amountLabel: 'Total',
      direction: 0,
    })
  })
})

describe('la historia agrupada por día', () => {
  const today = '2026-10-13'

  it('hoy, ayer y los demás días, conservando el orden', () => {
    const groups = groupHistoryByDay(
      [
        { id: 'a', createdAt: '2026-10-13T15:00:00Z' },
        { id: 'b', createdAt: '2026-10-13T12:10:00Z' },
        { id: 'c', createdAt: '2026-10-12T20:00:00Z' },
        { id: 'd', createdAt: '2026-10-09T14:00:00Z' },
      ],
      today,
    )
    expect(groups.map((g) => [g.label, g.rows.map((r) => r.id)])).toEqual([
      ['Hoy · martes 13/10', ['a', 'b']],
      ['Ayer · lunes 12/10', ['c']],
      ['Vie 09/10', ['d']],
    ])
  })

  it('la medianoche es la de Córdoba, no la de UTC', () => {
    // 13/10 02:30 UTC = 12/10 23:30 en Córdoba: es de ayer.
    const [group] = groupHistoryByDay([{ createdAt: '2026-10-13T02:30:00Z' }], today)
    expect(group?.day).toBe('2026-10-12')
    expect(group?.label).toBe('Ayer · lunes 12/10')
    // 13/10 03:00 UTC = 13/10 00:00 en Córdoba: ya es hoy.
    const [next] = groupHistoryByDay([{ createdAt: '2026-10-13T03:00:00Z' }], today)
    expect(next?.day).toBe(today)
    expect(historyTime('2026-10-13T02:30:00Z')).toBe('23:30')
  })

  it('otro año lleva el año; una fecha ilegible no rompe la lista', () => {
    expect(historyDayLabel('2025-12-31', today)).toBe('Mié 31/12/2025')
    const groups = groupHistoryByDay([{ createdAt: 'no es una fecha' }], today)
    expect(groups).toEqual([
      { day: '', label: 'Sin fecha', rows: [{ createdAt: 'no es una fecha' }] },
    ])
    expect(groupHistoryByDay([], today)).toEqual([])
  })

  it('una clave interna nunca llega a la pantalla', () => {
    // Lo que la consulta ya dice en criollo pasa tal cual.
    expect(historyText('cargó Factura A 0003-00004512')).toBe('cargó Factura A 0003-00004512')
    expect(historyText('cambió los datos de Rappi')).toBe('cambió los datos de Rappi')
    // Lo que todavía no sabe decir llega como clave: acá se traduce.
    expect(historyText('acc_import.batch_done')).toBe('terminó una importación')
    expect(historyText('acc_arca.tested')).toBe('probó la conexión con ARCA')
    expect(historyText('acc_mp.connection_saved')).toBe('guardó la conexión con Mercado Pago')
    expect(historyText('acc_settings.saved')).toBe('cambió los ajustes de Administración')
    // Y una que nadie previó no muestra la clave.
    expect(historyText('acc_algo_nuevo.hecho')).toBe('hizo un cambio en Administración')
    for (const key of ['acc_import.rule_saved', 'acc_arca.keypair_generated', 'acc_x.y']) {
      expect(historyText(key)).not.toMatch(/acc_|\./)
    }
  })

  it('la inicial de la persona, para el margen', () => {
    expect(personInitial('franco')).toBe('F')
    expect(personInitial('  Ángela Gómez')).toBe('Á')
    expect(personInitial('')).toBe('·')
    expect(personInitial(null)).toBe('·')
  })
})
