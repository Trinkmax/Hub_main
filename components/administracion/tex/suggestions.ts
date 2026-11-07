/**
 * Lo primero que le ofrece Tex a quien abre la charla, según en qué pantalla está. Puro. Son cosas que
 * se resuelven con un toque, con las palabras del bar.
 */

import type { TenantRole } from '@/lib/tenant/types'

const OWNER_DEFAULT = [
  '¿Cómo venimos este mes?',
  '¿Qué hay hoy en el bar?',
  '¿Cuánta plata hay?',
  '¿Quiénes son los mejores clientes?',
]

const EDITOR_DEFAULT = [
  '¿Qué productos no tienen foto?',
  'Cambiá un precio',
  '¿Qué está sin stock?',
  'Explicame esta pantalla',
]

const HOST_DEFAULT = [
  '¿Cuántas reservas hay hoy?',
  'Armá una reserva',
  '¿Qué eventos vienen esta semana?',
  '¿Cuánta comisión llevo?',
]

const ACCOUNTANT_DEFAULT = [
  'Mostrame sumas y saldos del mes',
  '¿Qué hay mal imputado?',
  '¿Qué falta para cerrar el mes?',
  'Armá un asiento',
]

const BY_SCREEN: ReadonlyArray<{ path: RegExp; items: readonly string[] }> = [
  {
    path: /\/clientes/,
    items: [
      '¿Quiénes son los mejores clientes?',
      '¿Quién cumple esta semana?',
      'Sumá un cliente',
      'Explicame esta pantalla',
    ],
  },
  {
    path: /\/club|\/puntos|\/punch-cards/,
    items: ['¿Cómo funciona el club?', '¿Cuántos socios hay por nivel?', 'Explicame esta pantalla'],
  },
  {
    path: /\/mensajeria\/difusiones/,
    items: [
      '¿Cómo le fue a la última difusión?',
      'Prepará una difusión',
      'Explicame esta pantalla',
    ],
  },
  {
    path: /\/mensajeria\/flows/,
    items: [
      '¿Qué automatizaciones están prendidas?',
      '¿Cómo funciona esto?',
      'Explicame esta pantalla',
    ],
  },
  {
    path: /\/mensajeria/,
    items: [
      '¿Qué mensajes faltan responder?',
      '¿Cómo le fue a la última difusión?',
      'Prepará una difusión',
    ],
  },
  {
    path: /\/tareas/,
    items: ['¿Qué tareas faltan esta semana?', 'Sumá una tarea', 'Explicame esta pantalla'],
  },
  {
    path: /\/reservas|\/operativo/,
    items: [
      '¿Cuántas reservas hay hoy?',
      'Armá una reserva',
      '¿Quién falta llegar?',
      'Explicame esta pantalla',
    ],
  },
  {
    path: /\/eventos/,
    items: [
      '¿Qué eventos vienen esta semana?',
      '¿Cuánto cupo queda el sábado?',
      'Armá un evento',
      'Explicame esta pantalla',
    ],
  },
  {
    path: /\/entradas/,
    items: [
      '¿Cuántas entradas se vendieron?',
      '¿Qué función está por agotarse?',
      'Explicame esta pantalla',
    ],
  },
  {
    path: /\/menu/,
    items: [
      'Cambiá un precio',
      '¿Qué productos no tienen foto?',
      'Sacá algo de la carta',
      'Explicame esta pantalla',
    ],
  },
  {
    path: /\/estadisticas/,
    items: ['¿Cómo nos fue este mes?', '¿Qué evento funcionó mejor?', 'Explicame esta pantalla'],
  },
  {
    path: /\/configuracion|\/local|\/enlaces|\/paginas/,
    items: ['¿Qué me falta configurar?', 'Explicame esta pantalla'],
  },
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
    // Los pedidos a proveedores (/<bar>/compras), no «Compras y pagos» de Administración.
    path: /^\/[^/]+\/compras(?:\/|$)/,
    items: [
      '¿Qué pedidos hay para mandar?',
      'Mandá los pedidos de hoy',
      '¿Qué está por llegar?',
      '¿A qué proveedores les falta el WhatsApp?',
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

const BY_ROLE: Readonly<Partial<Record<TenantRole, readonly string[]>>> = {
  accountant: ACCOUNTANT_DEFAULT,
  editor: EDITOR_DEFAULT,
  host: HOST_DEFAULT,
}

export function texSuggestions(path: string, role: TenantRole): readonly string[] {
  const match = BY_SCREEN.find((entry) => entry.path.test(path))
  if (match) return match.items
  return BY_ROLE[role] ?? OWNER_DEFAULT
}
