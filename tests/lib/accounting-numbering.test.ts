import { describe, expect, it } from 'vitest'
import {
  assignEntryNumbers,
  compareEntryOrder,
  entryNumberBase,
  entryNumberBaseFor,
  entryOrderKey,
  freezePeriodNumbers,
  type NumberingEntry,
} from '@/lib/accounting/numbering'

function entry(
  id: string,
  entryDate: string,
  postingSeq: number,
  extra: Partial<NumberingEntry> = {},
): NumberingEntry {
  return { id, entryDate, postingSeq, number: null, status: 'posted', kind: 'standard', ...extra }
}

/** N asientos estándar, uno por día desde `from`, con `posting_seq` desde `seqFrom`. */
function month(prefix: string, from: string, count: number, seqFrom: number): NumberingEntry[] {
  const [y, m] = from.split('-')
  return Array.from({ length: count }, (_, i) =>
    entry(`${prefix}${i + 1}`, `${y}-${m}-${String((i % 28) + 1).padStart(2, '0')}`, seqFrom + i),
  )
}

describe('order_key (columna generada)', () => {
  it('apertura primero, liquidación de IVA después de lo del día, cierre de ejercicio al final', () => {
    expect(entryOrderKey('opening')).toBe(0)
    expect(entryOrderKey('fy_opening')).toBe(0)
    expect(entryOrderKey('standard')).toBe(5)
    expect(entryOrderKey('manual')).toBe(5)
    expect(entryOrderKey('reversal')).toBe(5)
    expect(entryOrderKey('iva_settlement')).toBe(6)
    expect(entryOrderKey('fy_adjustment')).toBe(7)
    expect(entryOrderKey('fy_result')).toBe(8)
    expect(entryOrderKey('fy_closing')).toBe(9)
  })

  it('orden del diario: (fecha, order_key, posting_seq)', () => {
    const settlement = entry('liq', '2026-10-31', 1, { kind: 'iva_settlement' })
    const late = entry('late', '2026-10-31', 2)
    const opening = entry('ap', '2026-10-01', 99, { kind: 'opening' })
    const sameDay = entry('std', '2026-10-01', 5)
    const sorted = [settlement, late, sameDay, opening].sort(compareEntryOrder).map((e) => e.id)
    expect(sorted).toEqual(['ap', 'std', 'late', 'liq'])
  })
})

describe('base de numeración (acc_entry_number_base)', () => {
  it('N° 1 reservado para una apertura que todavía no existe', () => {
    expect(
      entryNumberBase({
        maxFrozenNumber: null,
        openingNumberReserved: true,
        hasPostedOpening: false,
      }),
    ).toBe(1)
  })
  it('con la apertura cargada, ella misma es el N° 1', () => {
    expect(
      entryNumberBase({
        maxFrozenNumber: null,
        openingNumberReserved: true,
        hasPostedOpening: true,
      }),
    ).toBe(0)
  })
  it('«Arrancar en cero»: no se reserva y el primer asiento es el 1', () => {
    expect(
      entryNumberBase({
        maxFrozenNumber: null,
        openingNumberReserved: false,
        hasPostedOpening: false,
      }),
    ).toBe(0)
  })
  it('con números congelados manda el último', () => {
    expect(
      entryNumberBase({
        maxFrozenNumber: 241,
        openingNumberReserved: true,
        hasPostedOpening: false,
      }),
    ).toBe(241)
  })
})

describe('provisoria y definitiva (C.5.3)', () => {
  it('el ejemplo de C.5.3: apertura N° 1, octubre del 2 al 241, noviembre provisorio desde el 242', () => {
    const opening = entry('apertura', '2026-10-01', 1, { kind: 'opening' })
    const october = month('oct', '2026-10-01', 240, 2)
    const fyEntries = [opening, ...october]

    const base = entryNumberBaseFor(fyEntries, true)
    expect(base).toBe(0)
    const provisional = assignEntryNumbers(fyEntries, base)
    expect(provisional.get('apertura')).toEqual({ number: 1, provisional: true })

    // Cierre de octubre: congela base + row_number() de sus asientos.
    const frozen = freezePeriodNumbers(fyEntries, base)
    expect(frozen.numbers.get('apertura')).toBe(1)
    expect(frozen.numberFrom).toBe(1)
    expect(frozen.numberTo).toBe(241)
    const octNumbers = october.map((e) => frozen.numbers.get(e.id) ?? 0)
    expect(Math.min(...octNumbers)).toBe(2)
    expect(Math.max(...octNumbers)).toBe(241)

    // Noviembre, abierto: provisorio desde el 242.
    const closed = fyEntries.map((e) => ({ ...e, number: frozen.numbers.get(e.id) ?? null }))
    const november = month('nov', '2026-11-01', 3, 500)
    const all = [...closed, ...november]
    const novBase = entryNumberBaseFor(all, true)
    expect(novBase).toBe(241)
    const numbers = assignEntryNumbers(all, novBase)
    expect(numbers.get('nov1')).toEqual({ number: 242, provisional: true })
    expect(numbers.get('nov3')).toEqual({ number: 244, provisional: true })
    expect(numbers.get('oct1')).toEqual({ number: 2, provisional: false })
  })

  it('en el ejercicio siguiente, enero arranca en el 2 (el 1 es la apertura espejo)', () => {
    const january = month('ene', '2027-01-01', 2, 900)
    const base = entryNumberBaseFor(january, true)
    expect(base).toBe(1)
    expect(assignEntryNumbers(january, base).get('ene1')?.number).toBe(2)
    // Al cerrar 2026 se escribe la apertura espejo con N° 1: enero sigue en el 2.
    const mirror = entry('espejo', '2027-01-01', 1_000, { kind: 'fy_opening', number: 1 })
    const after = [mirror, ...january]
    expect(entryNumberBaseFor(after, true)).toBe(1)
    expect(assignEntryNumbers(after, 1).get('ene1')?.number).toBe(2)
  })

  it('anular en un período abierto no deja huecos', () => {
    const entries = [
      entry('a', '2026-10-02', 1),
      entry('b', '2026-10-03', 2),
      entry('c', '2026-10-04', 3),
    ]
    const voided = entries.map((e) => (e.id === 'b' ? { ...e, status: 'voided' as const } : e))
    const numbers = assignEntryNumbers(voided, 0)
    expect(numbers.get('a')?.number).toBe(1)
    expect(numbers.has('b')).toBe(false)
    expect(numbers.get('c')?.number).toBe(2)
  })

  it('la provisoria es sobre todo el ejercicio, no sobre el rango filtrado', () => {
    const entries = month('x', '2026-10-01', 10, 1)
    const all = assignEntryNumbers(entries, 0)
    // Filtrar después (lo que hace el reporte) no cambia los números.
    const shown = entries
      .filter((e) => e.entryDate >= '2026-10-06')
      .map((e) => all.get(e.id)?.number)
    expect(shown).toEqual([6, 7, 8, 9, 10])
  })

  it('la liquidación de IVA del 31 va después de los asientos del 31 aunque se haya cargado antes', () => {
    const entries = [
      entry('liq', '2026-10-31', 10, { kind: 'iva_settlement' }),
      entry('ultimo', '2026-10-31', 11),
      entry('primero', '2026-10-01', 12),
    ]
    const n = assignEntryNumbers(entries, 0)
    expect([n.get('primero')?.number, n.get('ultimo')?.number, n.get('liq')?.number]).toEqual([
      1, 2, 3,
    ])
  })

  it('reabrir el último mes vuelve sus números a provisorios (los mismos si nada cambió)', () => {
    const entries = month('oct', '2026-10-01', 4, 1)
    const frozen = freezePeriodNumbers(entries, 0)
    const reopened = entries.map((e) => ({ ...e, number: null }))
    const n = assignEntryNumbers(reopened, entryNumberBaseFor(reopened, false))
    for (const e of entries) {
      expect(n.get(e.id)).toEqual({ number: frozen.numbers.get(e.id), provisional: true })
    }
  })

  it('un período sin asientos congela sin rango', () => {
    expect(freezePeriodNumbers([], 241)).toEqual({
      numbers: new Map(),
      numberFrom: null,
      numberTo: null,
    })
  })
})
