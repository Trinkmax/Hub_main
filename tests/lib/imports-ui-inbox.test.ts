/**
 * La bandeja de «Importar» (`lib/imports/ui/inbox.ts`): qué está traído y qué
 * falta por mes (ARCA) y por día (Mercado Pago, banco), que nada anterior al
 * arranque cuente como faltante, que «toca» diga lo mismo que «Hoy te toca» del
 * Resumen, y los dos casos reales: el bar que recién arranca (al 13/10 y al
 * lunes 19/10) y el bar de ejemplo.
 */

import { describe, expect, it } from 'vitest'
import type { ImportBatchCounts } from '@/lib/imports/server/types'
import {
  batchPeriodLabel,
  batchSubject,
  buildInbox,
  displayBatchStatus,
  type InboxBatch,
  type InboxInput,
  periodWords,
  rowsBeforeStart,
  STRIP_DAYS,
  wantedRange,
} from '@/lib/imports/ui/inbox'

const ZERO: ImportBatchCounts = {
  items: 0,
  new: 0,
  duplicate: 0,
  ignored: 0,
  review: 0,
  postedItems: 0,
  cancelled: 0,
  proposals: 0,
  needsInput: 0,
  ready: 0,
  posting: 0,
  posted: 0,
  stale: 0,
  error: 0,
  skipped: 0,
  voided: 0,
}

let seq = 0
type BatchOver = Omit<Partial<InboxBatch>, 'counts'> & {
  counts?: Partial<ImportBatchCounts> | null
}

function batch(over: BatchOver): InboxBatch {
  seq++
  const counts = over.counts === null ? null : { ...ZERO, ...(over.counts ?? {}) }
  return {
    id: `00000000-0000-4000-8000-${String(seq).padStart(12, '0')}`,
    source: 'arca_recibidos',
    status: 'done',
    periodFrom: null,
    periodTo: null,
    pending: 0,
    createdAt: '2026-10-08T15:00:00Z',
    ...over,
    counts,
  }
}

const CAJAS = [
  { id: 'c1', name: 'Caja', kind: 'cash' },
  { id: 'c2', name: 'Mercado Pago', kind: 'wallet' },
  { id: 'c3', name: 'Banco Nación', kind: 'bank' },
]

function input(over: Partial<InboxInput>): InboxInput {
  return {
    today: '2026-10-13',
    batches: [],
    treasuries: CAJAS,
    booksStartDate: '2026-09-01',
    hasCuit: true,
    canWrite: true,
    slug: 'bar',
    ...over,
  }
}

const tray = (inbox: ReturnType<typeof buildInbox>, source: string) => {
  const found = inbox.trays.find((t) => t.source === source)
  if (!found) throw new Error(`sin bandeja ${source}`)
  return found
}

describe('el período de un archivo, en palabras', () => {
  it('un mes entero se llama por su nombre; si no, las dos fechas', () => {
    expect(batchPeriodLabel({ periodFrom: '2026-09-01', periodTo: '2026-09-30' })).toBe(
      'Septiembre',
    )
    expect(batchPeriodLabel({ periodFrom: '2026-10-07', periodTo: '2026-10-08' })).toBe(
      '07/10 – 08/10',
    )
    expect(batchPeriodLabel({ periodFrom: '2026-10-08', periodTo: '2026-10-08' })).toBe('08/10')
    expect(batchPeriodLabel({ periodFrom: null, periodTo: null })).toBe('Sin fechas')
  })

  it('lleva el año solo cuando no es el de hoy', () => {
    expect(
      batchPeriodLabel({ periodFrom: '2025-12-01', periodTo: '2025-12-31' }, '2026-10-13'),
    ).toBe('Diciembre 2025')
    expect(
      batchPeriodLabel({ periodFrom: '2025-12-28', periodTo: '2026-01-03' }, '2026-10-13'),
    ).toBe('28/12/2025 – 03/01/2026')
  })

  it('adentro de una oración concuerda', () => {
    expect(periodWords('2026-09-01', '2026-09-30')).toBe('de septiembre')
    expect(periodWords('2026-10-07', '2026-10-08')).toBe('del 07/10 al 08/10')
    expect(periodWords('2026-10-08', '2026-10-08')).toBe('del 08/10')
    expect(periodWords(null, '2026-10-08')).toBe('')
    expect(
      batchSubject({ source: 'arca_recibidos', periodFrom: '2026-09-01', periodTo: '2026-09-30' }),
    ).toBe('las compras de septiembre')
    expect(
      batchSubject(
        { source: 'bank_statement', periodFrom: '2026-10-01', periodTo: '2026-10-07' },
        'Banco Nación',
      ),
    ).toBe('Banco Nación del 01/10 al 07/10')
    expect(batchSubject({ source: 'mp_release', periodFrom: null, periodTo: null })).toBe(
      'Mercado Pago',
    )
  })
})

describe('el estado de un archivo', () => {
  it('cada estado tiene su palabra, su tono y su explicación', () => {
    const cases: Array<[BatchOver, string]> = [
      [{ status: 'staging' }, 'A medio subir'],
      [{ status: 'review', pending: 3 }, 'Para revisar'],
      [{ status: 'posting', pending: 3 }, 'A medio cargar'],
      [{ status: 'done', counts: { posted: 18 } }, 'Cargado'],
      [{ status: 'posting', pending: 0, counts: { posted: 18 } }, 'Cargado'],
      [{ status: 'cancelled', counts: { posted: 2 } }, 'Descartado'],
    ]
    for (const [over, label] of cases) {
      const shown = displayBatchStatus(batch(over))
      expect(shown.label).toBe(label)
      expect(shown.hint.length).toBeGreaterThan(10)
      expect(shown.hint).not.toMatch(/afuera/i)
    }
  })

  it('el archivo eterno: sin pendientes y sin nada cargado, «Nada para cargar»', () => {
    const eternal = batch({ status: 'review', pending: 0, counts: { skipped: 4, proposals: 4 } })
    expect(displayBatchStatus(eternal)).toMatchObject({ label: 'Nada para cargar', tone: 'muted' })
    // Sin conteos (lote viejo) tampoco se inventa un «Para revisar».
    expect(displayBatchStatus(batch({ status: 'done', counts: null })).label).toBe(
      'Nada para cargar',
    )
  })
})

describe('el bar que recién arranca (los números empiezan el lunes 12/10)', () => {
  const hub = (today: string, canWrite = true) =>
    buildInbox(
      input({
        today,
        canWrite,
        booksStartDate: '2026-10-12',
        hasCuit: false,
        treasuries: [
          { id: 'c1', name: 'Caja', kind: 'cash' },
          { id: 'c2', name: 'Mercado Pago', kind: 'wallet' },
        ],
        batches: [
          batch({
            source: 'arca_recibidos',
            status: 'review',
            periodFrom: '2026-10-08',
            periodTo: '2026-10-10',
            pending: 0,
            counts: { items: 4, proposals: 4, skipped: 4 },
            createdAt: '2026-10-12T16:11:00Z',
          }),
        ],
      }),
    )

  it('al martes 13/10 no le toca nada: no hay botón principal y la agenda dice cuándo', () => {
    const inbox = hub('2026-10-13')
    expect(inbox.next).toBeNull()
    expect(inbox.everLoaded).toBe(false)
    expect(inbox.agenda).toBe(
      'Lo próximo: Mercado Pago, el lunes 19/10; las compras de octubre, desde el 11/11.',
    )
    expect(inbox.startNote).toBe('Tus números arrancan el 12/10: todavía no hay nada atrasado.')
  })

  it('ARCA está al día: lo de antes del arranque no falta ni cuenta como subido', () => {
    const arca = tray(hub('2026-10-13'), 'arca_recibidos')
    expect(arca.state).toBe('ok')
    expect(arca.hero).toMatchObject({
      value: 'Al día',
      upToDate: true,
      sentence: 'Octubre se baja desde el 11/11.',
    })
    expect(arca.last).toBe('Última vez: el 12/10 subiste del 08/10 al 10/10.')
    expect(arca.notes.map((n) => n.text)).toEqual([
      'Eso es de antes del 12/10, cuando arrancan tus números: no entra.',
      'Sin el CUIT del bar no puedo chequear que el archivo sea tuyo.',
    ])
    expect(arca.notes[1]?.link?.href).toBe('/bar/administracion/ajustes?tab=sas')
    const states = arca.strip?.cells.map((c) => `${c.label}:${c.state}`)
    expect(states).toEqual([
      'may:before',
      'jun:before',
      'jul:before',
      'ago:before',
      'sep:before',
      'oct:today',
    ])
    expect(arca.waiting).toEqual([])
    expect(arca.action).toEqual({
      label: 'Subir las compras de ARCA',
      href: '/bar/administracion/importar/arca',
    })
  })

  it('Mercado Pago nunca se usó (enseña) y el banco está trabado hasta cargar la cuenta', () => {
    const inbox = hub('2026-10-13')
    const mp = tray(inbox, 'mp_release')
    expect(mp.state).toBe('never')
    expect(mp.empty?.title).toBe('Todavía no subiste nada')
    expect(mp.action?.label).toBe('Subir el primer reporte')
    const bank = tray(inbox, 'bank_statement')
    expect(bank.state).toBe('blocked')
    expect(bank.blocked).toBe('Primero decime cuál es tu cuenta del banco.')
    expect(bank.action).toEqual({
      label: 'Agregar la cuenta',
      href: '/bar/administracion/ajustes?tab=cajas',
    })
    expect(bank.howHref).toBeNull()
  })

  it('el lunes 19/10 toca Mercado Pago, con los días que hay para traer', () => {
    const inbox = hub('2026-10-19')
    expect(inbox.next).toEqual({
      kind: 'weekly',
      sentence: 'Hoy toca Mercado Pago: ya hay 7 días para traer.',
      action: {
        label: 'Subir el reporte de Mercado Pago',
        href: '/bar/administracion/importar/mercado-pago',
      },
    })
    // El martes 20 ya no: nunca lo subió y no es lunes (la regla de «Hoy te toca»).
    expect(hub('2026-10-20').next).toBeNull()
  })

  it('el 11/11 lo manda a bajar octubre, desde el día en que arrancan sus números', () => {
    const inbox = hub('2026-11-11')
    expect(inbox.next).toMatchObject({
      kind: 'arca_month',
      sentence:
        'Empezá por las compras de octubre de ARCA: son todas las facturas que te hicieron, sin tipear ninguna.',
      action: { label: 'Subir las compras de octubre' },
    })
    expect(tray(inbox, 'arca_recibidos').hero).toMatchObject({
      label: 'Falta bajar',
      value: 'Octubre',
      due: true,
    })
    const wanted = wantedRange('arca_recibidos', [], '2026-11-11', '2026-10-12')
    expect(wanted).toMatchObject({ from: '2026-10-12', to: '2026-10-31' })
    expect(wanted.sentence).toBe(
      'En ARCA poné las fechas a mano, del 12/10 al 31/10: tus números arrancan el 12/10 y lo anterior no se puede cargar.',
    )
  })

  it('quien solo lee no recibe ninguna acción', () => {
    const inbox = hub('2026-10-19', false)
    expect(inbox.next).toBeNull()
    for (const t of inbox.trays) {
      expect(t.action, t.source).toBeNull()
      expect(t.secondary, t.source).toBeNull()
      expect(t.howHref, t.source).toBeNull()
      expect(t.hero?.due ?? false, t.source).toBe(false)
      expect(
        t.notes.every((n) => !n.link),
        t.source,
      ).toBe(true)
    }
  })
})

describe('el bar de ejemplo al 13/10 (arranca el 01/09)', () => {
  const demo = () =>
    buildInbox(
      input({
        batches: [
          batch({
            source: 'bank_statement',
            status: 'done',
            periodFrom: '2026-10-01',
            periodTo: '2026-10-07',
            counts: { proposals: 8, posted: 4, skipped: 4 },
          }),
          batch({
            source: 'mp_release',
            status: 'done',
            periodFrom: '2026-10-07',
            periodTo: '2026-10-08',
            counts: { proposals: 6, posted: 5, skipped: 1 },
          }),
          batch({
            id: 'arca-sep',
            source: 'arca_recibidos',
            status: 'posting',
            periodFrom: '2026-09-01',
            periodTo: '2026-09-30',
            pending: 3,
            counts: { proposals: 23, posted: 18, skipped: 2, needsInput: 3 },
          }),
        ],
      }),
    )

  it('lo que toca es terminar de revisar las compras de septiembre', () => {
    const inbox = demo()
    expect(inbox.everLoaded).toBe(true)
    expect(inbox.startNote).toBeNull()
    expect(inbox.next).toEqual({
      kind: 'review',
      sentence: 'Las compras de septiembre tienen 3 comprobantes con una pregunta.',
      action: { label: 'Seguir revisando', href: '/bar/administracion/importar/arca-sep' },
    })
  })

  it('ARCA: septiembre está subido y esperando; la hoja asoma en la bandeja', () => {
    const arca = tray(demo(), 'arca_recibidos')
    expect(arca.hero?.value).toBe('Al día')
    expect(arca.strip?.cells.find((c) => c.label === 'sep')).toMatchObject({
      state: 'review',
      href: '/bar/administracion/importar/arca-sep',
    })
    expect(arca.waiting).toEqual([
      {
        id: 'arca-sep',
        href: '/bar/administracion/importar/arca-sep',
        title: 'Septiembre',
        detail: '3 con una pregunta',
        kind: 'review',
      },
    ])
    expect(arca.action?.label).toBe('Seguir revisando')
    expect(arca.secondary?.label).toBe('Subir otro archivo')
  })

  it('Mercado Pago: cuenta desde el día siguiente a lo último subido, y nombra el hueco de atrás', () => {
    const mp = tray(demo(), 'mp_release')
    expect(mp.hero).toMatchObject({
      label: 'Sin subir',
      value: '4',
      unit: 'días',
      sentence: 'Del 09/10 a ayer. Toca el lunes 19/10.',
      due: false,
    })
    expect(mp.notes.map((n) => n.text)).toEqual(['También falta del 01/09 al 06/10.'])
    expect(mp.strip?.cells).toHaveLength(STRIP_DAYS)
    const byDay = new Map(mp.strip?.cells.map((c) => [c.key, c]))
    expect(byDay.get('2026-10-13')?.state).toBe('today')
    expect(byDay.get('2026-10-12')).toMatchObject({ state: 'missing', tick: 'ayer' })
    expect(byDay.get('2026-10-08')?.state).toBe('loaded')
    expect(byDay.get('2026-10-06')?.state).toBe('missing')
    // Los rótulos nunca quedan pegados.
    const ticks = mp.strip?.cells.flatMap((c, i) => (c.tick ? [i] : [])) ?? []
    for (let i = 1; i < ticks.length; i++) {
      expect((ticks[i] ?? 0) - (ticks[i - 1] ?? 0)).toBeGreaterThanOrEqual(4)
    }
  })

  it('el banco lleva el nombre de la única cuenta', () => {
    expect(tray(demo(), 'bank_statement').name).toBe('Banco Nación')
  })
})

describe('cuándo «toca» (la misma regla que «Hoy te toca» del Resumen)', () => {
  const mp = (createdAt: string, today: string) =>
    buildInbox(
      input({
        today,
        batches: [
          batch({
            source: 'mp_release',
            periodFrom: '2026-09-20',
            periodTo: '2026-09-30',
            createdAt,
            counts: { posted: 5 },
          }),
          // ARCA al día, para que no tape lo semanal.
          batch({
            source: 'arca_recibidos',
            periodFrom: '2026-09-01',
            periodTo: '2026-09-30',
            counts: { posted: 9 },
          }),
        ],
        treasuries: [{ id: 'c2', name: 'Mercado Pago', kind: 'wallet' }],
      }),
    )

  it('si ya se venía subiendo, toca cualquier día cuando pasaron más de 8', () => {
    const inbox = mp('2026-10-01T12:00:00Z', '2026-10-13')
    expect(inbox.next?.kind).toBe('weekly')
    expect(inbox.next?.sentence).toBe('Hace 12 días que no subís Mercado Pago.')
    expect(tray(inbox, 'mp_release').hero?.due).toBe(true)
    expect(tray(inbox, 'mp_release').hero?.sentence).toBe('Del 01/10 a ayer.')
  })

  it('con una subida de los últimos 8 días no toca, aunque falten días', () => {
    const inbox = mp('2026-10-06T12:00:00Z', '2026-10-13')
    expect(inbox.next).toBeNull()
    expect(tray(inbox, 'mp_release').hero).toMatchObject({ label: 'Sin subir', due: false })
    expect(inbox.agenda).toMatch(/^Lo próximo: Mercado Pago, el lunes 19\/10/)
  })

  it('subido hasta ayer: al día', () => {
    const inbox = buildInbox(
      input({
        batches: [
          batch({
            source: 'mp_release',
            periodFrom: '2026-09-01',
            periodTo: '2026-10-12',
            counts: { posted: 30 },
          }),
        ],
      }),
    )
    expect(tray(inbox, 'mp_release').hero).toMatchObject({
      value: 'Al día',
      sentence: 'Subiste hasta ayer.',
      upToDate: true,
    })
  })

  it('ARCA: antes del 11 no toca; del 11 en adelante, sí', () => {
    const noArca = (today: string) => buildInbox(input({ today, booksStartDate: '2026-08-01' }))
    expect(noArca('2026-10-10').next?.kind ?? null).not.toBe('arca_month')
    const due = noArca('2026-10-13')
    expect(due.next).toMatchObject({
      kind: 'arca_month',
      action: { label: 'Subir las compras de ARCA' },
    })
    expect(due.next?.sentence).toMatch(/agosto y septiembre/)
  })

  it('lo primero es terminar un archivo a medio subir', () => {
    const inbox = buildInbox(
      input({
        batches: [
          batch({ source: 'bank_statement', status: 'staging', createdAt: '2026-10-12T10:00:00Z' }),
          batch({
            source: 'arca_recibidos',
            status: 'review',
            pending: 2,
            periodFrom: '2026-09-01',
            periodTo: '2026-09-30',
          }),
        ],
      }),
    )
    expect(inbox.next).toEqual({
      kind: 'resume',
      sentence: 'Quedó un archivo del banco a medio subir.',
      action: { label: 'Terminar de subirlo', href: '/bar/administracion/importar/banco' },
    })
    const bank = tray(inbox, 'bank_statement')
    expect(bank.waiting[0]).toMatchObject({ title: 'A medio subir', kind: 'staging' })
    expect(bank.action?.label).toBe('Terminar de subirlo')
  })

  it('con varios archivos a medio revisar, manda al más viejo', () => {
    const inbox = buildInbox(
      input({
        batches: [
          batch({
            id: 'nuevo',
            source: 'mp_release',
            status: 'review',
            pending: 1,
            periodFrom: '2026-10-07',
            periodTo: '2026-10-08',
            createdAt: '2026-10-09T10:00:00Z',
            counts: { ready: 1 },
          }),
          batch({
            id: 'viejo',
            source: 'arca_recibidos',
            status: 'review',
            pending: 21,
            periodFrom: '2026-09-01',
            periodTo: '2026-09-30',
            createdAt: '2026-10-08T10:00:00Z',
            counts: { needsInput: 3, ready: 18 },
          }),
        ],
      }),
    )
    expect(inbox.next?.sentence).toBe(
      'Tenés 2 archivos a medio revisar. Empezá por las compras de septiembre.',
    )
    expect(inbox.next?.action.href).toBe('/bar/administracion/importar/viejo')
    // `count()` une el número y la palabra con un espacio duro.
    expect(tray(inbox, 'arca_recibidos').waiting[0]?.detail).toBe(
      '3 con una pregunta · 18\u00a0listos',
    )
  })

  it('un archivo solo, sin preguntas: dice cuántos están listos', () => {
    const inbox = buildInbox(
      input({
        batches: [
          batch({
            source: 'mp_release',
            status: 'review',
            pending: 1,
            periodFrom: '2026-10-07',
            periodTo: '2026-10-08',
            counts: { ready: 1 },
          }),
        ],
      }),
    )
    expect(inbox.next?.sentence).toBe(
      'Mercado Pago del 07/10 al 08/10 tiene 1 movimiento listo para cargar.',
    )
  })
})

describe('cobertura por mes (ARCA)', () => {
  it('un mes cubierto a medias no está subido: se pide lo que falta', () => {
    const batches = [
      batch({
        source: 'arca_recibidos',
        periodFrom: '2026-09-01',
        periodTo: '2026-09-15',
        counts: { posted: 4 },
      }),
    ]
    const arca = tray(buildInbox(input({ batches })), 'arca_recibidos')
    expect(arca.strip?.cells.find((c) => c.label === 'sep')?.state).toBe('partial')
    expect(arca.hero).toMatchObject({ label: 'Falta bajar', value: 'Septiembre' })
    expect(wantedRange('arca_recibidos', batches, '2026-10-13', '2026-09-01')).toMatchObject({
      from: '2026-09-16',
      to: '2026-09-30',
    })
  })

  it('el mes pasado entero: «Mes Pasado»; con varios, del primero al último', () => {
    expect(wantedRange('arca_recibidos', [], '2026-10-13', '2026-09-01')).toEqual({
      from: '2026-09-01',
      to: '2026-09-30',
      sentence: 'Es septiembre entero. En ARCA elegí «Mes Pasado».',
      extra: null,
    })
    const many = wantedRange('arca_recibidos', [], '2026-10-13', '2026-08-01')
    expect(many).toMatchObject({ from: '2026-08-01', to: '2026-09-30' })
    expect(many.sentence).toBe('Son agosto y septiembre. ARCA deja pedir hasta un año de una vez.')
  })

  it('con todo subido no hay fechas para pedir, y dice cuándo se baja el que sigue', () => {
    const batches = [
      batch({
        source: 'arca_recibidos',
        periodFrom: '2026-09-01',
        periodTo: '2026-09-30',
        counts: { posted: 9 },
      }),
    ]
    const wanted = wantedRange('arca_recibidos', batches, '2026-10-13', '2026-09-01')
    expect(wanted.from).toBeNull()
    expect(wanted.sentence).toBe(
      'Septiembre ya lo subiste. Octubre se baja desde el 11/11. Si querés adelantar, pedí del 01/10 a ayer: lo repetido no se carga dos veces.',
    )
  })

  it('un archivo descartado o a medio subir no cubre nada', () => {
    const batches = [
      batch({
        source: 'arca_recibidos',
        status: 'cancelled',
        periodFrom: '2026-09-01',
        periodTo: '2026-09-30',
      }),
    ]
    expect(wantedRange('arca_recibidos', batches, '2026-10-13', '2026-09-01').from).toBe(
      '2026-09-01',
    )
  })

  it('sin fecha de arranque (no se pudo leer) no se recorta nada y no rompe', () => {
    const inbox = buildInbox(input({ booksStartDate: null, treasuries: null, hasCuit: null }))
    expect(inbox.trays).toHaveLength(3)
    expect(inbox.trays.every((t) => t.state !== 'blocked')).toBe(true)
    expect(inbox.startNote).toBeNull()
  })
})

describe('qué fechas pedir (Mercado Pago y banco)', () => {
  it('nunca se subió: desde el arranque hasta ayer', () => {
    expect(wantedRange('mp_release', [], '2026-10-19', '2026-10-12')).toEqual({
      from: '2026-10-12',
      to: '2026-10-18',
      sentence: 'Desde el 12/10/2026, que es cuando arrancan tus números, hasta ayer.',
      extra: null,
    })
  })

  it('si el tope del origen queda después del arranque, manda el tope', () => {
    const mp = wantedRange('mp_release', [], '2026-10-13', '2026-01-01')
    expect(mp.from).toBe('2026-08-14')
    expect(mp.sentence).toMatch(/60 días/)
    const bank = wantedRange('bank_statement', [], '2026-10-13', '2026-01-01')
    expect(bank.from).toBe('2026-07-15')
    expect(bank.sentence).toMatch(/3 meses/)
  })

  it('ya se subió: desde el día siguiente, con el hueco de atrás como dato aparte', () => {
    const batches = [
      batch({
        source: 'bank_statement',
        periodFrom: '2026-10-01',
        periodTo: '2026-10-07',
        counts: { posted: 4 },
      }),
    ]
    expect(wantedRange('bank_statement', batches, '2026-10-13', '2026-09-01')).toEqual({
      from: '2026-10-08',
      to: '2026-10-12',
      sentence:
        'Desde el día siguiente a lo último que subiste, hasta ayer. Muchos bancos guardan solo 3 meses: no lo dejes pasar.',
      extra: 'Si querés completar lo de antes, pedí también del 01/09 al 30/09.',
    })
  })

  it('el arranque es hoy: todavía no hay nada para bajar', () => {
    const wanted = wantedRange('mp_release', [], '2026-10-13', '2026-10-13')
    expect(wanted.from).toBeNull()
    expect(wanted.sentence).toBe(
      'Tus números arrancan el 13/10/2026: todavía no hay nada para bajar.',
    )
  })
})

describe('lo que un archivo trae de antes del arranque', () => {
  it('cuenta los renglones con fecha anterior, con el campo de cada origen', () => {
    const arca = [
      { data: { issueDate: '2026-10-08' } },
      { data: { issueDate: '2026-10-12' } },
      { data: { issueDate: '2026-10-20' } },
    ]
    expect(rowsBeforeStart('arca_recibidos', arca, '2026-10-12')).toBe(1)
    expect(
      rowsBeforeStart('mp_release', [{ data: { businessDate: '2026-10-01' } }], '2026-10-12'),
    ).toBe(1)
    expect(
      rowsBeforeStart('bank_statement', [{ data: { date: '2026-10-12' } }], '2026-10-12'),
    ).toBe(0)
  })

  it('sin fecha de arranque, sin filas o con datos raros da cero', () => {
    expect(rowsBeforeStart('arca_recibidos', [{ data: { issueDate: '2020-01-01' } }], null)).toBe(0)
    expect(rowsBeforeStart('arca_recibidos', [], '2026-10-12')).toBe(0)
    expect(
      rowsBeforeStart(
        'arca_recibidos',
        [{ data: null }, { data: 'x' }, { data: { issueDate: 20261001 } }, { data: {} }],
        '2026-10-12',
      ),
    ).toBe(0)
  })
})
