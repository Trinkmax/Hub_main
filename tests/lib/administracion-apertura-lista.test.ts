import { describe, expect, it } from 'vitest'
import {
  parseOpeningList,
  resolveOpeningLines,
} from '@/app/(manager)/[tenantSlug]/administracion/configurar/_lib/opening-import'
import { isImplicitSubmit } from '@/app/(manager)/[tenantSlug]/administracion/configurar/_lib/wizard'

const PARTIES = [
  { id: 'p-coca', name: 'Coca Cola', tradeName: null },
  { id: 'p-quilmes', name: 'Cervecería Quilmes SA', tradeName: 'Quilmes' },
]

describe('parseOpeningList — saldos iniciales pegados desde una planilla', () => {
  it('lee proveedor, monto, vencimiento y comprobante, y saltea encabezado, totales y ceros', () => {
    const text = [
      'Proveedor\tSaldo\tVencimiento\tComprobante',
      'Coca Cola\t$ 1.250.000,50\t15/10/2026\tFactura A 0003-00001234',
      'quilmes\t300.000',
      'La Virginia\t0',
      'Total\t1.550.000,50',
    ].join('\n')
    const r = parseOpeningList(text, PARTIES)
    expect(r.lines).toEqual([
      {
        line: 2,
        name: 'Coca Cola',
        amountCents: 125000050,
        dueDate: '2026-10-15',
        reference: 'Factura A 0003-00001234',
        partyId: 'p-coca',
      },
      // Encuentra por el nombre de fantasía, sin mirar mayúsculas.
      {
        line: 3,
        name: 'quilmes',
        amountCents: 30000000,
        dueDate: null,
        reference: '',
        partyId: 'p-quilmes',
      },
    ])
    expect(r.zeros).toBe(1)
    expect(r.skipped).toEqual([])
    expect(r.missing).toEqual([])
    expect(r.totalCents).toBe(155000050)
  })

  it('sin columnas, el monto es lo último del renglón', () => {
    const r = parseOpeningList('Coca Cola 150.000\nDistribuidora 2000: $ 80.500,75', PARTIES)
    expect(r.lines.map((l) => [l.name, l.amountCents, l.partyId])).toEqual([
      ['Coca Cola', 15000000, 'p-coca'],
      ['Distribuidora 2000', 8050075, null],
    ])
    expect(r.missing).toEqual(['Distribuidora 2000'])
  })

  it('«1.500» es mil quinientos; si la lista usa punto decimal, lo respeta', () => {
    expect(parseOpeningList('Coca Cola\t1.500', PARTIES).lines[0]?.amountCents).toBe(150000)
    const dotted = parseOpeningList('Coca Cola\t1500.50\nQuilmes\t200.25', PARTIES)
    expect(dotted.lines.map((l) => l.amountCents)).toEqual([150050, 20025])
  })

  it('el que no está cargado se pide una sola vez aunque tenga varias facturas', () => {
    const r = parseOpeningList('Arcor\t100\nARCOR\t200\nArcor\t300', PARTIES)
    expect(r.lines).toHaveLength(3)
    expect(r.missing).toEqual(['Arcor'])
    const resolved = resolveOpeningLines(r.lines, [
      { id: 'p-arcor', name: 'Arcor', tradeName: null },
    ])
    expect(resolved.every((l) => l.partyId === 'p-arcor')).toBe(true)
  })

  it('avisa lo que no carga: sin monto, saldo a favor y lo que no entra', () => {
    const text = 'Proveedor;Saldo\nCoca Cola;abc\nQuilmes;-500\nArcor;100\nBimbo;200'
    const r = parseOpeningList(text, PARTIES, 1)
    expect(r.skipped).toEqual([
      { line: 2, name: 'Coca Cola', reason: 'no_amount' },
      { line: 3, name: 'Quilmes', reason: 'negative' },
    ])
    expect(r.lines.map((l) => l.name)).toEqual(['Arcor'])
    expect(r.overflow).toBe(1)
    expect(r.missing).toEqual(['Arcor'])
  })
})

describe('isImplicitSubmit — un Enter no cierra la puesta en marcha', () => {
  it('Enter en un campo de texto o de número enviaría el formulario', () => {
    expect(isImplicitSubmit('Enter', 'INPUT', 'text')).toBe(true)
    expect(isImplicitSubmit('Enter', 'INPUT', 'number')).toBe(true)
    expect(isImplicitSubmit('Enter', 'INPUT', 'tel')).toBe(true)
  })

  it('los botones, las áreas de texto y las otras teclas siguen andando', () => {
    expect(isImplicitSubmit('Enter', 'BUTTON', 'submit')).toBe(false)
    expect(isImplicitSubmit('Enter', 'TEXTAREA', 'textarea')).toBe(false)
    expect(isImplicitSubmit('Enter', 'INPUT', 'checkbox')).toBe(false)
    expect(isImplicitSubmit('Tab', 'INPUT', 'text')).toBe(false)
  })
})
