import { describe, expect, it } from 'vitest'
import {
  CASH_PURPOSES,
  CHOICE_COPY,
  findExactTarget,
  isIsoDay,
  isStaffPurpose,
  MOVE_CHOICES,
  moveProblem,
  NO_TARGETS,
  parseCashTargets,
  periodShortcuts,
  periodWords,
  purposeReason,
  readPeriod,
  searchKey,
  searchTargets,
  targetFields,
  typedSupplierName,
} from '@/lib/pos/cash/targets'

const ID_A = '0b8f3c1e-5d2a-4e7b-9c1f-2a3b4c5d6e7f'
const ID_B = '1c9a4d2f-6e3b-4f8c-8d2a-3b4c5d6e7f80'
const ID_C = '2dab5e30-7f4c-4a9d-9e3b-4c5d6e7f8091'

describe('los destinos', () => {
  it('son los cuatro de la base, y «otro motivo» en la pantalla', () => {
    expect(MOVE_CHOICES).toEqual(['supplier', 'advance', 'overtime', 'salary', 'other'])
    expect(MOVE_CHOICES.slice(0, 4)).toEqual([...CASH_PURPOSES])
  })

  it('cada ficha tiene su nombre y su pregunta', () => {
    for (const choice of MOVE_CHOICES) {
      expect(CHOICE_COPY[choice].label.length).toBeGreaterThan(3)
      expect(CHOICE_COPY[choice].who.startsWith('¿')).toBe(true)
    }
    expect(CHOICE_COPY.overtime.label).toBe('Hora extra')
    expect(CHOICE_COPY.advance.label).toBe('Adelanto de sueldo')
  })

  it('los del equipo piden elegir a la persona; el proveedor no', () => {
    expect(isStaffPurpose('advance')).toBe(true)
    expect(isStaffPurpose('overtime')).toBe(true)
    expect(isStaffPurpose('salary')).toBe(true)
    expect(isStaffPurpose('supplier')).toBe(false)
  })

  it('el motivo se lee como lo arma la base', () => {
    expect(purposeReason('advance', 'Ana Ríos')).toBe('Adelanto de sueldo · Ana Ríos')
    expect(purposeReason('overtime', 'Ana Ríos', 'sábado')).toBe('Horas extra · Ana Ríos · sábado')
    expect(purposeReason('salary', ' Ana Ríos ', '  ')).toBe('Pago de sueldo · Ana Ríos')
    expect(purposeReason('supplier', 'Hielo Sur', 'Remito 12')).toBe(
      'Proveedor · Hielo Sur · Remito 12',
    )
  })
})

describe('las listas que manda la base', () => {
  it('lee proveedores y empleados', () => {
    expect(
      parseCashTargets({
        suppliers: [{ id: ID_A, name: 'Hielo Sur' }],
        employees: [
          { id: ID_B, name: 'Ana', here: true },
          { id: ID_C, name: 'Beto', here: false },
        ],
      }),
    ).toEqual({
      suppliers: [{ id: ID_A, name: 'Hielo Sur' }],
      employees: [
        { id: ID_B, name: 'Ana', here: true },
        { id: ID_C, name: 'Beto', here: false },
      ],
    })
  })

  it('un renglón raro se saltea sin dejar a la caja sin lista', () => {
    const parsed = parseCashTargets({
      suppliers: [
        { id: 'no-es-un-id', name: 'X' },
        { id: ID_A, name: '  ' },
        null,
        { id: ID_A, name: 'Hielo Sur' },
      ],
      employees: [{ id: ID_B, name: 'Ana' }, 'cualquiera'],
    })
    expect(parsed.suppliers).toEqual([{ id: ID_A, name: 'Hielo Sur' }])
    // Sin `here`, no es de esta sucursal.
    expect(parsed.employees).toEqual([{ id: ID_B, name: 'Ana', here: false }])
  })

  it('lo que no se entiende son listas vacías', () => {
    expect(parseCashTargets(null)).toEqual(NO_TARGETS)
    expect(parseCashTargets('roto')).toEqual(NO_TARGETS)
    expect(parseCashTargets({ suppliers: 'no' })).toEqual(NO_TARGETS)
    expect(parseCashTargets({})).toEqual(NO_TARGETS)
  })
})

describe('el buscador', () => {
  const list = [
    { id: '1', name: 'Coca-Cola Andina' },
    { id: '2', name: 'Distribuidora La Única' },
    { id: '3', name: 'Hielo Sur' },
    { id: '4', name: 'Panadería Unión' },
    { id: '5', name: 'Sur Bebidas' },
  ]
  const names = (query: string) => searchTargets(list, query).map((item) => item.name)

  it('sin escribir nada, la lista entera en su orden', () => {
    expect(names('')).toEqual(list.map((item) => item.name))
    expect(names('   ')).toEqual(list.map((item) => item.name))
  })

  it('no le importan las tildes ni las mayúsculas', () => {
    expect(searchKey('  Panadería   La ÚNICA ')).toBe('panaderia la unica')
    expect(names('panaderia')).toEqual(['Panadería Unión'])
    expect(names('UNICA')).toEqual(['Distribuidora La Única'])
  })

  it('primero los que empiezan así, después los que tienen una palabra que empieza así', () => {
    expect(names('sur')).toEqual(['Sur Bebidas', 'Hielo Sur'])
    expect(names('un')).toEqual(['Distribuidora La Única', 'Panadería Unión'])
  })

  it('después, los que lo tienen en el medio de una palabra', () => {
    expect(names('ola')).toEqual(['Coca-Cola Andina'])
    expect(names('a')).toEqual([
      // Ninguno empieza con «a»; «Andina» sí es una palabra que empieza así.
      'Coca-Cola Andina',
      'Distribuidora La Única',
      'Panadería Unión',
      'Sur Bebidas',
    ])
  })

  it('con varias palabras tienen que estar todas', () => {
    expect(names('la dist')).toEqual(['Distribuidora La Única'])
    expect(names('hielo norte')).toEqual([])
  })

  it('sabe si lo escrito ya es uno de la lista', () => {
    expect(findExactTarget(list, 'hielo sur')?.id).toBe('3')
    expect(findExactTarget(list, 'HIELO  SUR ')?.id).toBe('3')
    expect(findExactTarget(list, 'hielo')).toBeNull()
    expect(findExactTarget(list, '')).toBeNull()
  })

  it('un proveedor escrito a mano necesita al menos dos letras', () => {
    expect(typedSupplierName('  Verdulero   de la esquina ')).toBe('Verdulero de la esquina')
    expect(typedSupplierName('a')).toBeNull()
    expect(typedSupplierName('   ')).toBeNull()
    expect(typedSupplierName('x'.repeat(200))?.length).toBe(80)
  })
})

describe('las fechas del pago de un sueldo', () => {
  it('pasado el 10, los atajos son del mes que corre', () => {
    // 23/11/2026 es lunes.
    expect(periodShortcuts('2026-11-23')).toEqual([
      {
        id: 'first-half',
        label: '1.ª quincena',
        from: '2026-11-01',
        to: '2026-11-15',
      },
      {
        id: 'second-half',
        label: '2.ª quincena',
        from: '2026-11-16',
        to: '2026-11-30',
      },
      { id: 'month', label: 'Todo noviembre', from: '2026-11-01', to: '2026-11-30' },
      { id: 'week', label: 'Esta semana', from: '2026-11-23', to: '2026-11-29' },
    ])
  })

  it('hasta el 10 se está pagando el mes anterior', () => {
    const early = periodShortcuts('2026-12-04')
    expect(early[0]).toMatchObject({ label: '1.ª quincena', from: '2026-11-01' })
    expect(early[1]).toMatchObject({ from: '2026-11-16', to: '2026-11-30' })
    expect(early[2]).toMatchObject({ label: 'Todo noviembre', to: '2026-11-30' })
    // La semana siempre es la de hoy (lunes 30/11 a domingo 6/12).
    expect(early[3]).toMatchObject({ from: '2026-11-30', to: '2026-12-06' })
    expect(periodShortcuts('2026-12-10')[2]?.label).toBe('Todo noviembre')
    expect(periodShortcuts('2026-12-11')[2]?.label).toBe('Todo diciembre')
  })

  it('en enero, el mes anterior es diciembre del año pasado', () => {
    const january = periodShortcuts('2027-01-05')
    expect(january[1]).toMatchObject({
      label: '2.ª quincena',
      from: '2026-12-16',
      to: '2026-12-31',
    })
  })

  it('febrero termina cuando termina', () => {
    expect(periodShortcuts('2027-02-20')[1]).toMatchObject({ to: '2027-02-28' })
    expect(periodShortcuts('2028-02-20')[1]).toMatchObject({ to: '2028-02-29' })
  })

  it('un domingo sigue siendo de la semana que empezó el lunes', () => {
    expect(periodShortcuts('2026-11-29')[3]).toMatchObject({ from: '2026-11-23', to: '2026-11-29' })
  })

  it('sin un día que se entienda no hay atajos', () => {
    expect(periodShortcuts('hoy')).toEqual([])
    expect(periodShortcuts('2026-02-31')).toEqual([])
  })

  it('reconoce un día de verdad', () => {
    expect(isIsoDay('2026-11-23')).toBe(true)
    expect(isIsoDay('2026-02-30')).toBe(false)
    expect(isIsoDay('23/11/2026')).toBe(false)
    expect(isIsoDay(null)).toBe(false)
  })

  it('un rango a mano: en orden, y con un solo día vale por ese día', () => {
    expect(readPeriod('2026-11-16', '2026-11-22')).toEqual({ from: '2026-11-16', to: '2026-11-22' })
    expect(readPeriod('2026-11-16', '')).toEqual({ from: '2026-11-16', to: '2026-11-16' })
    expect(readPeriod('', '2026-11-22')).toEqual({ from: '2026-11-22', to: '2026-11-22' })
    expect(readPeriod('2026-11-22', '2026-11-16')).toBeNull()
    expect(readPeriod('', '')).toBeNull()
    expect(readPeriod('ayer', 'hoy')).toBeNull()
  })

  it('se dice en palabras', () => {
    expect(periodWords({ from: '2026-11-01', to: '2026-11-15' })).toBe('Del 1 al 15 de noviembre')
    expect(periodWords({ from: '2026-10-28', to: '2026-11-03' })).toBe(
      'Del 28 de octubre al 3 de noviembre',
    )
    expect(periodWords({ from: '2026-12-28', to: '2027-01-03' })).toBe(
      'Del 28 de diciembre de 2026 al 3 de enero',
    )
    expect(periodWords({ from: '2026-11-05', to: '2026-11-05' })).toBe('El 5 de noviembre')
    expect(periodWords({ from: 'x', to: 'y' })).toBe('')
  })
})

describe('lo que se manda', () => {
  const range = { from: '2026-11-16', to: '2026-11-22' }

  it('un proveedor de la lista: su id, y la nota como texto', () => {
    expect(
      targetFields({ purpose: 'supplier', partyId: ID_A, name: 'Hielo Sur' }, ' Remito  12 ', null),
    ).toEqual({
      purpose: 'supplier',
      partyId: ID_A,
      employeeId: null,
      reason: 'Remito 12',
      periodFrom: null,
      periodTo: null,
    })
    expect(
      targetFields({ purpose: 'supplier', partyId: ID_A, name: 'Hielo Sur' }, '', null).reason,
    ).toBeNull()
  })

  it('un proveedor que no está en la lista: el texto es su nombre y nada más', () => {
    const typed = { purpose: 'supplier', partyId: null, name: ' Verdulero de la esquina ' } as const
    expect(targetFields(typed, '', null)).toMatchObject({
      purpose: 'supplier',
      partyId: null,
      reason: 'Verdulero de la esquina',
    })
    // La base guarda ese texto como nombre del proveedor: una nota pegada lo ensuciaría.
    expect(targetFields(typed, 'Remito 12', null).reason).toBe('Verdulero de la esquina')
    expect(targetFields({ ...typed, name: 'x'.repeat(400) }, '', null).reason?.length).toBe(160)
  })

  it('alguien del equipo: su id; las fechas solo con el pago de sueldo, y también en palabras', () => {
    expect(targetFields({ purpose: 'salary', employeeId: ID_B, name: 'Ana' }, '', range)).toEqual({
      purpose: 'salary',
      partyId: null,
      employeeId: ID_B,
      // Las fechas también van dichas en el motivo: así se leen en la cinta y en el mail del cierre.
      reason: 'Del 16 al 22 de noviembre',
      periodFrom: '2026-11-16',
      periodTo: '2026-11-22',
    })
    expect(
      targetFields({ purpose: 'salary', employeeId: ID_B, name: 'Ana' }, '', null).reason,
    ).toBeNull()
    const advance = targetFields({ purpose: 'advance', employeeId: ID_B, name: 'Ana' }, '', range)
    expect(advance.periodFrom).toBeNull()
    expect(advance.periodTo).toBeNull()
    expect(advance.reason).toBeNull()
  })

  it('las mismas reglas que la base, antes de hacer el viaje', () => {
    // Sin destino: lo de siempre, con su motivo.
    expect(moveProblem({ kind: 'out', reason: 'Hielo' })).toBeNull()
    expect(moveProblem({ kind: 'in', reason: 'Cambio' })).toBeNull()
    expect(moveProblem({ kind: 'out', reason: '  ' })).toBe('reason_required')
    expect(moveProblem({ kind: 'out', reason: 'x', employeeId: ID_B })).toBe('purpose_invalid')
    // Con destino solo sale plata.
    expect(moveProblem({ kind: 'in', purpose: 'supplier', partyId: ID_A })).toBe('purpose_invalid')
    // Proveedor: de la lista, o su nombre en el texto.
    expect(moveProblem({ kind: 'out', purpose: 'supplier', partyId: ID_A })).toBeNull()
    expect(moveProblem({ kind: 'out', purpose: 'supplier', reason: 'Verdulero' })).toBeNull()
    expect(moveProblem({ kind: 'out', purpose: 'supplier' })).toBe('reason_required')
    expect(moveProblem({ kind: 'out', purpose: 'supplier', partyId: ID_A, employeeId: ID_B })).toBe(
      'purpose_invalid',
    )
    // Del equipo: siempre con la persona, nunca con un proveedor.
    expect(moveProblem({ kind: 'out', purpose: 'advance', employeeId: ID_B })).toBeNull()
    expect(moveProblem({ kind: 'out', purpose: 'overtime' })).toBe('employee_required')
    expect(moveProblem({ kind: 'out', purpose: 'salary', employeeId: ID_B, partyId: ID_A })).toBe(
      'purpose_invalid',
    )
    // Las fechas, en orden.
    expect(
      moveProblem({
        kind: 'out',
        purpose: 'salary',
        employeeId: ID_B,
        periodFrom: '2026-11-22',
        periodTo: '2026-11-16',
      }),
    ).toBe('period_invalid')
    expect(
      moveProblem({
        kind: 'out',
        purpose: 'salary',
        employeeId: ID_B,
        periodFrom: '2026-11-16',
        periodTo: '2026-11-22',
      }),
    ).toBeNull()
  })
})
