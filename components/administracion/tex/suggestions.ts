/**
 * Lo primero que le ofrece Tex a quien abre la charla, según en qué pantalla está. Puro. Son cosas que
 * se resuelven con un toque, con las palabras del bar.
 */

const OWNER_DEFAULT = [
  '¿Cómo venimos este mes?',
  '¿Qué vence esta semana?',
  '¿Cuánta plata hay?',
  'Cargá una compra',
]

const ACCOUNTANT_DEFAULT = [
  'Mostrame sumas y saldos del mes',
  '¿Qué hay mal imputado?',
  '¿Qué falta para cerrar el mes?',
  'Armá un asiento',
]

const BY_SCREEN: ReadonlyArray<{ path: RegExp; items: readonly string[] }> = [
  {
    path: /\/ventas(\?|$)/,
    items: [
      '¿Cómo venimos con el objetivo?',
      '¿Qué días me faltan cerrar?',
      'Copiá los objetivos del mes pasado',
      'Explicame esta pantalla',
    ],
  },
  {
    path: /\/ventas\/cierre/,
    items: [
      'Ayudame a cargar el cierre',
      '¿Cuál es el primer día que me falta?',
      'Explicame esta pantalla',
    ],
  },
  {
    path: /\/compras\/semana/,
    items: ['¿Cuánto hay que pagar esta semana?', '¿Alcanza la plata?', 'Explicame esta pantalla'],
  },
  {
    path: /\/compras/,
    items: ['¿A quién le debo más?', '¿Qué venció?', 'Cargá una compra', 'Pagale a un proveedor'],
  },
  {
    path: /\/gastos-fijos/,
    items: ['¿Qué falta pagar este mes?', '¿Cuánto son los gastos fijos?', 'Agregá un gasto fijo'],
  },
  {
    path: /\/sueldos/,
    items: ['¿Cuánto le debo a cada uno?', 'Cargá un adelanto', 'Explicame esta pantalla'],
  },
  {
    path: /\/cajas/,
    items: [
      '¿Cuánta plata hay?',
      '¿En qué se fue la plata este mes?',
      'Mové plata de una caja a otra',
    ],
  },
  {
    path: /\/libros\/mayor/,
    items: ['¿Por qué da este saldo?', 'Reimputá una línea', '¿Qué hay mal imputado?'],
  },
  {
    path: /\/libros|\/plan-de-cuentas|\/asientos/,
    items: ['¿Qué falta para cerrar el mes?', '¿Qué hay mal imputado?', 'Armá un asiento'],
  },
  {
    path: /\/ajustes/,
    items: ['¿Cómo están los impuestos?', '¿Qué me falta configurar?', 'Explicame esta pantalla'],
  },
]

export function texSuggestions(path: string, isAccountant: boolean): readonly string[] {
  const match = BY_SCREEN.find((entry) => entry.path.test(path))
  if (match) return match.items
  return isAccountant ? ACCOUNTANT_DEFAULT : OWNER_DEFAULT
}
