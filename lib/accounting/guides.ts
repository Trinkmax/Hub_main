/**
 * «Cómo se usa Administración»: el contenido del instructivo (rediseño de oct 2026), en datos.
 *
 * - El MAPA: cinco estaciones, siempre en el mismo orden, y qué mueve cada una en la plata.
 * - Las RECETAS: una por situación («Cerré la caja de ayer»), de 3 a 5 pasos de una oración.
 * - CON FACTURA Y SIN FACTURA: los cuatro papeles y qué cambia con cada uno.
 * - CÓMO SE VINCULA cada cosa: qué es, dónde se hace, qué pasa si no y cómo se deshace.
 * - La RUTINA (diaria, semanal, mensual) con el estado real del bar, y el glosario.
 *
 * Puro (sin React ni red): lo usan las páginas de `/guias`, sus componentes y los tests, que
 * fijan las reglas de los textos. Tres reglas que no se negocian:
 *
 * 1. Solo se escribe lo que el sistema HACE, incluido lo que hoy no se puede (vincular después
 *    un gasto fijo, decir «es este» en una línea importada).
 * 2. Todo queda en el mismo libro: «sin factura» es el papel que te dieron, no un lugar aparte.
 *    Ningún texto dice que algo queda fuera, ni usa otra palabra para «con y sin factura».
 * 3. La guía es la misma para todos los bares: sin su nombre, su CUIT ni su sistema de caja.
 *
 * El avance NO se guarda: sale de `acc_report_onboarding` (lo que ya hay cargado), así que no
 * hizo falta ninguna tabla nueva.
 */

import {
  ONBOARDING_GLOSSARY,
  type OnboardingData,
  type OnboardingHowTo,
  type OnboardingItemId,
  type OnboardingState,
} from '@/lib/accounting/onboarding'
import { addDays, startOfMonth } from '@/lib/dates/civil'

// ─── A dónde lleva un botón ──────────────────────────────────────────────────

/** Las hojas de acción rápida (`?accion=`). Las mismas claves que `ACCOUNTING_ACTIONS`. */
export type GuideSheet = 'gasto' | 'pagar' | 'cobrar' | 'mover' | 'ajustar' | 'movimiento'

export type GuideTarget =
  /** Una pantalla, después de `/administracion` (con barra inicial). */
  | { kind: 'route'; path: string }
  /** Una hoja que se abre sobre la misma guía. */
  | { kind: 'sheet'; sheet: GuideSheet }

/** «Hacerlo ahora»: solo lo ve quien puede cargar. */
export type GuideAction = { label: string; target: GuideTarget }

/** Las páginas de la guía (relativas a `/<bar>/administracion`). */
export const GUIDE_PATHS = {
  home: '/guias',
  daily: '/guias/dia-a-dia',
  invoice: '/guias/con-y-sin-factura',
  links: '/guias/como-se-vincula',
  start: '/guias/como-arrancar',
  arca: '/ajustes/arca',
} as const

// ─── Las pantallas simuladas ─────────────────────────────────────────────────

/** Las tarjetas del lanzador «¿Qué querés cargar?» (las claves de `LAUNCHER_ITEMS`). */
export type GuideLauncherKey =
  | 'cierre'
  | 'gasto'
  | 'compra'
  | 'pagar'
  | 'cobrar'
  | 'mover'
  | 'ajustar'
  | 'movimiento'

export type PaperId = 'factura_a' | 'factura_bc' | 'tique' | 'sin'

/** Qué dibuja cada pantalla simulada (las arma `guias/uso/mock-scenes.tsx`). */
export type GuideScene =
  | { kind: 'launcher'; pick: GuideLauncherKey }
  | { kind: 'close'; part: 'methods' | 'ticket' }
  | { kind: 'expense'; focus: 'amount' | 'category' | 'paper'; paper: PaperId }
  | { kind: 'expense-ticket'; paper: PaperId }
  | { kind: 'purchase' }
  | { kind: 'pay' }
  | { kind: 'collect' }
  | { kind: 'count' }
  | { kind: 'import'; source: 'mercado_pago' | 'arca'; phase: 'upload' | 'review' }
  | { kind: 'undo' }
  | { kind: 'void' }
  | { kind: 'month-close' }
  | { kind: 'fixed' }

export type GuideScreen = {
  /** Corto, para el contador «Pantalla 2 de 3 · …». */
  title: string
  /** Qué muestra, para quien no ve el dibujo. */
  label: string
  scene: GuideScene
}

// ─── Las recetas ─────────────────────────────────────────────────────────────

export const RECIPE_IDS = [
  'cierre',
  'gasto',
  'compra',
  'sin-factura',
  'pagar-deuda',
  'gasto-fijo',
  'cobro',
  'contar-caja',
  'mercado-pago',
  'arca',
  'corregir',
  'fin-de-mes',
] as const
export type RecipeId = (typeof RECIPE_IDS)[number]

export type RecipeFrequency = 'daily' | 'event' | 'weekly' | 'monthly'

export const RECIPE_FREQUENCY_LABEL: Readonly<Record<RecipeFrequency, string>> = {
  daily: 'Todos los días',
  event: 'Cuando pasa',
  weekly: 'Cada semana',
  monthly: 'Cada mes',
}

/** Un paso no pasa de esto: una oración que se lee de un vistazo. */
export const RECIPE_STEP_MAX_WORDS = 26

export type RecipeTrouble = {
  problem: string
  fix: string
  /** Dónde se arregla, si es otra pantalla (relativa a `/<bar>/administracion`). */
  link?: { label: string; path: string }
}

export type GuideRecipe = {
  id: RecipeId
  /** La situación, en primera persona: «Cerré la caja de ayer». */
  title: string
  /** El ejemplo en gris de la tarjeta. */
  hint: string
  frequency: RecipeFrequency
  minutes: number | null
  /** La tarjeta del lanzador por la que se entra (el paso que la nombra la cita igual). */
  launcher?: GuideLauncherKey
  /** El ítem de «Cómo arrancar» que dice si esta rutina está al día. */
  routine?: OnboardingItemId
  /** De 3 a 5. `screen`: la pantalla (desde 0) que acompaña al paso. */
  steps: ReadonlyArray<{ text: string; screen?: number }>
  screens: readonly GuideScreen[]
  /** La mini guía «¿Cómo lo bajo?» del archivo que se sube. */
  howTo?: OnboardingHowTo
  /** «Chequeá que…». */
  checks: readonly string[]
  /** «Si algo sale mal». */
  troubles: readonly RecipeTrouble[]
  /** Qué queda cuando terminás, en una oración. */
  result: string
  action: GuideAction
}

/** `receta-cierre`: el `id` de la receta en la página (y el `#` de los links). */
export function recipeAnchor(id: RecipeId): string {
  return `receta-${id}`
}

export const GUIDE_RECIPES: readonly GuideRecipe[] = [
  {
    id: 'cierre',
    title: 'Cerré la caja de ayer',
    hint: 'Lo que se vendió y cómo te pagaron',
    frequency: 'daily',
    minutes: 5,
    launcher: 'cierre',
    routine: 'daily_close',
    steps: [
      {
        text: 'Tené a mano el cierre de caja de tu sistema de ventas, con el total de cada medio.',
      },
      {
        text: 'Tocá «+ Cargar» y elegí «Cerrar el día». Se abre en el primer día que te falta.',
        screen: 0,
      },
      {
        text: 'Escribí cuánto se cobró con cada medio: efectivo, Mercado Pago, tarjetas y apps de delivery.',
        screen: 1,
      },
      { text: 'Si contaste el efectivo, anotalo. Si facturaste, cargá los números y el total.' },
      {
        text: 'Revisá el ticket: tiene que dar lo mismo que tu cierre de caja. Guardá.',
        screen: 2,
      },
    ],
    screens: [
      {
        title: 'Elegí «Cerrar el día»',
        label:
          'El lanzador «¿Qué querés cargar?» con ocho opciones. Está marcada la primera, «Cerrar el día».',
        scene: { kind: 'launcher', pick: 'cierre' },
      },
      {
        title: 'Un importe por medio',
        label:
          'El cierre del día: un renglón por medio de cobro con su importe y, debajo, a dónde va esa plata. Al pie, el total.',
        scene: { kind: 'close', part: 'methods' },
      },
      {
        title: 'El ticket y guardar',
        label:
          'El ticket del cierre con cada medio, el total vendido y cuánto fue con factura y sin factura. Debajo, el botón de guardar, marcado.',
        scene: { kind: 'close', part: 'ticket' },
      },
    ],
    checks: [
      'El total del ticket es igual al total de tu cierre de caja.',
      'Cada medio dice a dónde va: entra a la caja o llega otro día.',
      'En el Resumen, ese día figura como cargado.',
    ],
    troubles: [
      {
        problem: 'No me aparece ningún medio de cobro',
        fix: 'Se cargan una sola vez. Ahí también se define a qué caja va cada uno.',
        link: { label: 'Ajustes › Medios de cobro', path: '/ajustes?tab=medios' },
      },
      {
        problem: 'No me deja cargar lo que facturé',
        fix: 'Falta cargar la numeración de tus facturas. Mientras tanto, el día queda entero como venta sin factura.',
        link: { label: 'Ajustes › Puntos de venta', path: '/ajustes?tab=puntos-de-venta' },
      },
      {
        problem: 'Hubo dos turnos',
        fix: 'Cargá el primero. Después aparece «Cargar otro turno» para sumar el segundo.',
      },
      {
        problem: 'Ya lo guardé y está mal',
        fix: 'El cierre no se edita. Abrilo, anulalo y cargalo de nuevo.',
      },
    ],
    result: 'El efectivo entra a la caja. Lo demás queda en camino hasta que te lo acreditan.',
    action: { label: 'Cargar el cierre', target: { kind: 'route', path: '/ventas/cierre' } },
  },
  {
    id: 'gasto',
    title: 'Compré y pagué en el momento',
    hint: 'El hielo, la verdulería, un flete',
    frequency: 'daily',
    minutes: 2,
    launcher: 'gasto',
    steps: [
      { text: 'Tocá «+ Cargar» y elegí «Pagué algo recién».', screen: 0 },
      { text: 'Escribí cuánto pagaste, con el IVA incluido, tal cual dice el papel.', screen: 1 },
      { text: 'Elegí en qué se gastó y con qué caja pagaste.' },
      {
        text: 'Elegí qué papel te dieron: Factura A, Factura B o C, tique, o remito o nada.',
        screen: 1,
      },
      { text: 'Sacale una foto al papel y guardá.', screen: 2 },
    ],
    screens: [
      {
        title: 'Elegí «Pagué algo recién»',
        label: 'El lanzador «¿Qué querés cargar?». Está marcada la opción «Pagué algo recién».',
        scene: { kind: 'launcher', pick: 'gasto' },
      },
      {
        title: 'Cuánto, en qué, con qué y el papel',
        label:
          'La hoja del gasto: el importe, en qué se gastó, con qué caja se pagó y los cuatro papeles para elegir. Está marcado el papel.',
        scene: { kind: 'expense', focus: 'paper', paper: 'factura_a' },
      },
      {
        title: 'El ticket y guardar',
        label:
          'Un ticket chico que dice de qué caja sale la plata, el proveedor, la categoría y el sello «Con factura A». Debajo, el botón de guardar, marcado.',
        scene: { kind: 'expense-ticket', paper: 'factura_a' },
      },
    ],
    checks: [
      'El ticket dice de qué caja sale la plata y cuánto.',
      'El sello dice «Con factura» o «Sin factura», según el papel.',
      'El saldo de esa caja bajó por ese importe.',
    ],
    troubles: [
      {
        problem: 'Siempre me pregunta en qué se gastó',
        fix: 'Tildá «Usar siempre para» ese proveedor. La próxima vez ya viene elegido.',
      },
      {
        problem: 'Me avisa que ya lo cargué',
        fix: 'Tocá «Ver el que ya está». Si es el mismo, no lo guardes dos veces.',
      },
      {
        problem: 'Me pide la CUIT del proveedor',
        fix: 'Con Factura A hace falta. Agregala ahí mismo y seguí.',
      },
      {
        problem: 'Guardé y me equivoqué',
        fix: 'Tocá «Deshacer» en el aviso de abajo. Si ya se fue, mirá «Me equivoqué y quiero corregir».',
      },
    ],
    result: 'Sale la plata de la caja y el gasto queda en su categoría, con su papel.',
    action: { label: 'Cargar un gasto', target: { kind: 'sheet', sheet: 'gasto' } },
  },
  {
    id: 'compra',
    title: 'Me llegó una factura que pago después',
    hint: 'Queda como deuda con el proveedor',
    frequency: 'daily',
    minutes: 3,
    launcher: 'compra',
    steps: [
      {
        text: 'Tocá «+ Cargar» y elegí «Me llegó una factura o un remito y lo pago después».',
        screen: 0,
      },
      { text: 'Elegí el proveedor.', screen: 1 },
      { text: 'Elegí qué papel es. Escribí el número, si tiene, y el total.' },
      { text: 'Revisá cuándo vence y guardá.', screen: 1 },
      { text: 'El día que la pagues, entrá por «Pago algo que debía» y tildala.' },
    ],
    screens: [
      {
        title: 'Elegí «…lo pago después»',
        label:
          'El lanzador «¿Qué querés cargar?». Está marcada la opción «Me llegó una factura o un remito y lo pago después».',
        scene: { kind: 'launcher', pick: 'compra' },
      },
      {
        title: 'Proveedor, papel, total y vencimiento',
        label:
          'La compra que queda a pagar: el proveedor con su categoría, el papel, el número, el total y cuándo vence. Está marcado el botón de guardar.',
        scene: { kind: 'purchase' },
      },
    ],
    checks: [
      'En Compras y pagos, el proveedor muestra lo que le debés.',
      'La compra figura sin pagar, con su vencimiento.',
      'El Resumen la suma en lo que tenés que pagar.',
    ],
    troubles: [
      {
        problem: 'La pagué en el momento',
        fix: 'Usá «Guardar y pagar…»: guarda la compra con su pago, de una.',
      },
      {
        problem: 'Es un gasto fijo, como el alquiler',
        fix: 'Si el proveedor tiene gastos fijos pendientes, te pregunta «¿Es un gasto fijo?». Elegilo y el renglón queda cargado.',
      },
      {
        problem: 'No es una factura, es un remito',
        fix: 'Elegí «Sin factura». La deuda queda igual y no entra al Libro IVA.',
      },
    ],
    result: 'La caja no se mueve. Queda la deuda con el proveedor, con su vencimiento.',
    action: {
      label: 'Cargar una compra que debo',
      target: { kind: 'route', path: '/compras/nueva' },
    },
  },
  {
    id: 'sin-factura',
    title: 'Compré sin factura',
    hint: 'Con un remito o sin ningún papel',
    frequency: 'event',
    minutes: 2,
    steps: [
      { text: '¿Lo pagaste en el momento? Entrá por «Pagué algo recién».' },
      {
        text: '¿Lo pagás después? Entrá por «Me llegó una factura o un remito y lo pago después».',
      },
      { text: 'En «¿Qué papel te dieron?» elegí «Remito o nada».', screen: 0 },
      { text: 'Si el remito tiene número, anotalo. Sacale una foto y guardá.', screen: 1 },
    ],
    screens: [
      {
        title: 'Elegí «Remito o nada»',
        label:
          'La hoja del gasto con los cuatro papeles para elegir. Está elegido y marcado «Remito o nada».',
        scene: { kind: 'expense', focus: 'paper', paper: 'sin' },
      },
      {
        title: 'El ticket con el sello',
        label:
          'Un ticket chico que dice de qué caja sale la plata y lleva el sello «Sin factura». Debajo, el botón de guardar, marcado.',
        scene: { kind: 'expense-ticket', paper: 'sin' },
      },
    ],
    checks: [
      'El ticket lleva el sello «Sin factura».',
      'En Compras y pagos › Comprobantes aparece con la marca «Sin factura».',
      'Queda en tus números igual que cualquier otra compra.',
    ],
    troubles: [
      {
        problem: '¿La contadora lo ve?',
        fix: 'Sí. Todo queda en el mismo libro. Cómo se trata lo define ella.',
      },
      {
        problem: 'Después me dieron la factura',
        fix: 'El papel de algo guardado no se cambia. Anulá esa carga y hacela de nuevo con la factura.',
      },
      {
        problem: 'Ese proveedor siempre me da remito',
        fix: 'En su ficha, dejá «Sin factura» como el papel de siempre. Así ya viene elegido.',
        link: { label: 'Compras y pagos › Proveedores', path: '/compras?tab=proveedores' },
      },
    ],
    result: 'Queda registrado como cualquier compra. No entra al Libro IVA.',
    action: { label: 'Cargar un gasto', target: { kind: 'sheet', sheet: 'gasto' } },
  },
  {
    id: 'pagar-deuda',
    title: 'Pago una deuda',
    hint: 'A un proveedor al que le debés',
    frequency: 'event',
    minutes: 1,
    launcher: 'pagar',
    steps: [
      { text: 'Tocá «+ Cargar» y elegí «Pago algo que debía».', screen: 0 },
      { text: 'Elegí «A un proveedor» y después a quién le pagás.' },
      {
        text: 'Tildá las facturas que pagás. Las vencidas y las de esta semana ya vienen tildadas.',
        screen: 1,
      },
      { text: 'Elegí con qué pagás y revisá el monto.' },
      { text: 'Tocá «Pagar».', screen: 1 },
    ],
    screens: [
      {
        title: 'Elegí «Pago algo que debía»',
        label: 'El lanzador «¿Qué querés cargar?». Está marcada la opción «Pago algo que debía».',
        scene: { kind: 'launcher', pick: 'pagar' },
      },
      {
        title: 'Las facturas tildadas y con qué pagás',
        label:
          'El pago a un proveedor: tres comprobantes, dos tildados; las cajas para elegir con qué se paga y el botón «Pagar» con el total, marcado.',
        scene: { kind: 'pay' },
      },
    ],
    checks: [
      'La factura pasa a figurar pagada.',
      'Bajó lo que le debés a ese proveedor.',
      'Bajó el saldo de la caja con la que pagaste.',
    ],
    troubles: [
      {
        problem: 'Pagué solo una parte',
        fix: 'Tocá «Pagar solo una parte» en esa factura y escribí cuánto. El resto queda pendiente.',
      },
      {
        problem: 'Pagué de más o no tengo la factura',
        fix: 'Queda como saldo a favor con ese proveedor. Se descuenta solo en el próximo pago.',
      },
      {
        problem: 'Tildé la factura equivocada',
        fix: 'Hoy no se puede cambiar a qué factura fue un pago. Anulá el pago y cargalo de nuevo.',
      },
      {
        problem: 'Queda una diferencia de pocos pesos',
        fix: 'Si el resto es de hasta $ 1.000, lo podés dar por cancelado ahí mismo.',
      },
    ],
    result: 'Baja lo que debés y baja la caja de donde salió la plata.',
    action: { label: 'Pagar algo que debo', target: { kind: 'sheet', sheet: 'pagar' } },
  },
  {
    id: 'gasto-fijo',
    title: 'Pago un gasto fijo',
    hint: 'El alquiler, la luz, internet',
    frequency: 'event',
    minutes: 2,
    launcher: 'gasto',
    steps: [
      { text: 'Tocá «+ Cargar» y elegí «Pagué algo recién».' },
      {
        text: 'En «¿En qué se gastó?» elegí el gasto fijo. Los de este mes aparecen primero.',
        screen: 0,
      },
      { text: 'Revisá el importe y con qué caja pagás. Si el monto es fijo, ya viene puesto.' },
      { text: 'Guardá. En Gastos fijos, el renglón queda pago.', screen: 1 },
    ],
    screens: [
      {
        title: 'Elegí el gasto fijo',
        label:
          'La hoja del gasto. En «¿En qué se gastó?» aparecen los gastos fijos del mes; está elegido y marcado el alquiler.',
        scene: { kind: 'expense', focus: 'category', paper: 'factura_bc' },
      },
      {
        title: 'El renglón queda pago',
        label:
          'La lista de gastos fijos del mes: el alquiler figura pago; la luz y el internet, sin pagar, con su vencimiento.',
        scene: { kind: 'fixed' },
      },
    ],
    checks: [
      'En Gastos fijos, ese renglón figura pago.',
      'Su próximo vencimiento pasó al mes que viene.',
      'En el Resumen bajó «Te falta de gasto fijo».',
    ],
    troubles: [
      {
        problem: 'Me llegó la factura y la pago después',
        fix: 'En Gastos fijos, tocá «Cargar factura» en ese renglón. Queda como deuda hasta que la pagues.',
        link: { label: 'Gastos fijos', path: '/gastos-fijos' },
      },
      {
        problem: 'Lo cargué sin elegir el gasto fijo',
        fix: 'Hoy no se puede vincular después. Anulá esa carga y hacela de nuevo eligiendo el gasto fijo.',
      },
      {
        problem: 'Este mes no lo pago',
        fix: 'En el menú del renglón, marcá que este mes no se paga. El vencimiento pasa al mes siguiente.',
      },
    ],
    result: 'Sale la plata de la caja y el gasto fijo queda pago este mes.',
    action: { label: 'Cargar el gasto fijo', target: { kind: 'sheet', sheet: 'gasto' } },
  },
  {
    id: 'cobro',
    title: 'Me entró plata de una tarjeta o una app',
    hint: 'Lo que te acreditan después de vender',
    frequency: 'event',
    minutes: 3,
    launcher: 'cobrar',
    steps: [
      { text: 'Tocá «+ Cargar» y elegí «Me entró plata».', screen: 0 },
      { text: 'Elegí quién te pagó: la tarjeta, la app de delivery o el cliente.', screen: 1 },
      { text: 'Tildá de qué ventas es. Aparecen las que estaban en camino.' },
      { text: 'Elegí a qué caja entró y escribí cuánto entró de verdad.' },
      { text: 'Revisá los descuentos (la comisión y los impuestos) y guardá.' },
    ],
    screens: [
      {
        title: 'Elegí «Me entró plata»',
        label: 'El lanzador «¿Qué querés cargar?». Está marcada la opción «Me entró plata».',
        scene: { kind: 'launcher', pick: 'cobrar' },
      },
      {
        title: 'Quién pagó, de qué ventas y cuánto entró',
        label:
          'El cobro: quién pagó, dos días de ventas tildados (marcados), a qué caja entró, cuánto entró y los descuentos estimados.',
        scene: { kind: 'collect' },
      },
    ],
    checks: [
      'Bajó lo que estaba en camino.',
      'Subió la caja o el banco donde entró la plata.',
      'La diferencia quedó anotada como comisión y descuentos.',
    ],
    troubles: [
      {
        problem: 'Es de Mercado Pago',
        fix: 'Es más fácil contar la caja de Mercado Pago: escribís el saldo de la app y se acredita solo. O subí el reporte.',
      },
      {
        problem: 'No aparece ninguna venta para tildar',
        fix: 'Falta el cierre de ese día. Cargalo primero: si guardás sin ventas, el cobro queda a cuenta.',
      },
      {
        problem: 'No sé cuánto fue la comisión',
        fix: 'Viene estimada con los porcentajes de Ajustes. Corregila con la liquidación, si la tenés.',
      },
    ],
    result: 'Lo que estaba en camino pasa a la caja o al banco, menos los descuentos.',
    action: { label: 'Anotar lo que entró', target: { kind: 'sheet', sheet: 'cobrar' } },
  },
  {
    id: 'contar-caja',
    title: 'Conté la caja y no da',
    hint: 'Para que el sistema diga lo que hay de verdad',
    frequency: 'event',
    minutes: 2,
    launcher: 'ajustar',
    routine: 'treasury_check',
    steps: [
      { text: 'Tocá «+ Cargar» y elegí «Conté la caja».', screen: 0 },
      { text: 'Elegí qué caja contaste y escribí cuánto hay de verdad.', screen: 1 },
      { text: 'Si coincide, confirmalo. La caja queda marcada como revisada.' },
      { text: 'Si no coincide, mirá la diferencia y guardá. El saldo queda como lo contaste.' },
    ],
    screens: [
      {
        title: 'Elegí «Conté la caja»',
        label: 'El lanzador «¿Qué querés cargar?». Está marcada la opción «Conté la caja».',
        scene: { kind: 'launcher', pick: 'ajustar' },
      },
      {
        title: 'Lo que dice el sistema y lo que contaste',
        label:
          'La hoja para contar la caja: lo que dice el sistema, el campo para escribir lo contado (marcado) y la diferencia en palabras: faltan mil doscientos cincuenta y siete pesos.',
        scene: { kind: 'count' },
      },
    ],
    checks: [
      'El saldo de la caja es el que contaste.',
      'La diferencia quedó anotada como faltante o sobrante.',
      'La caja figura revisada este mes.',
    ],
    troubles: [
      {
        problem: 'Es el banco y la diferencia son gastos del banco',
        fix: 'Elegí «gastos del banco»: te lleva a cargarlos como gasto bancario.',
      },
      {
        problem: 'No sé de dónde sale la diferencia',
        fix: 'En el banco y en Mercado Pago, lo que no se explica queda aparte para que lo revise la contadora.',
      },
      {
        problem: 'Solo quiero ver la diferencia de cada día',
        fix: 'Eso es «Ventas contra caja»: compara lo vendido con lo que entró y no cambia ningún saldo.',
        link: { label: 'Ventas › Ventas contra caja', path: '/ventas?tab=caja' },
      },
      {
        problem: 'Conté el efectivo la noche del cierre',
        fix: 'Anotalo dentro del cierre del día. Es lo mismo y queda junto con el cierre.',
      },
    ],
    result: 'El saldo queda como lo contaste. La diferencia queda anotada, no se pierde.',
    action: { label: 'Contar la caja', target: { kind: 'sheet', sheet: 'ajustar' } },
  },
  {
    id: 'mercado-pago',
    title: 'Subo el reporte de Mercado Pago',
    hint: 'Una vez por semana, desde la compu',
    frequency: 'weekly',
    minutes: 10,
    routine: 'mp_weekly',
    howTo: 'mercado_pago',
    steps: [
      { text: 'Bajá de Mercado Pago el reporte de «Liquidaciones». Hacelo desde la compu.' },
      { text: 'Entrá a Importar › Mercado Pago y subí el archivo.', screen: 0 },
      { text: 'Revisá lo que propone: un cobro por día y por medio, con su comisión.', screen: 1 },
      { text: 'Confirmá. Nada se carga solo: vos decidís qué entra.' },
    ],
    screens: [
      {
        title: 'Subí el archivo',
        label:
          'El importador de Mercado Pago: una zona para arrastrar el archivo y el botón «Elegir archivo», marcado.',
        scene: { kind: 'import', source: 'mercado_pago', phase: 'upload' },
      },
      {
        title: 'Revisá y confirmá',
        label:
          'La revisión del archivo: tres cobros, uno por día y por medio, cada uno con su comisión. Al pie, el botón para cargarlos, marcado.',
        scene: { kind: 'import', source: 'mercado_pago', phase: 'review' },
      },
    ],
    checks: [
      'Bajó lo que estaba en camino de Mercado Pago.',
      'El saldo de Mercado Pago se parece al de la app.',
      'Cada cobro tiene su comisión aparte.',
    ],
    troubles: [
      {
        problem: 'Dice que ese día ya tiene movimientos cargados a mano',
        fix: 'No se cargan dos veces. Importá desde el día siguiente o anulá lo que cargaste a mano.',
      },
      {
        problem: 'Dice que falta el cierre del día',
        fix: 'Ese cobro queda a cuenta. Conviene cargar el cierre antes de subir el reporte.',
      },
      {
        problem: 'Me pregunta a qué medio corresponde',
        fix: 'Elegilo una vez. Queda guardado para la próxima.',
      },
      {
        problem: '¿Y el banco?',
        fix: 'Se sube igual, con los movimientos de la cuenta.',
        link: { label: 'Importar › Banco', path: '/importar/banco' },
      },
    ],
    result: 'Lo acreditado pasa de «en camino» a Mercado Pago, con su comisión separada.',
    action: {
      label: 'Subir el reporte',
      target: { kind: 'route', path: '/importar/mercado-pago' },
    },
  },
  {
    id: 'arca',
    title: 'Bajo las compras de ARCA',
    hint: 'Una vez por mes, del 11 en adelante',
    frequency: 'monthly',
    minutes: 15,
    routine: 'arca_monthly',
    howTo: 'mis_comprobantes',
    steps: [
      {
        text: 'Del día 11 en adelante, bajá de ARCA «Mis Comprobantes» › Recibidos del mes pasado.',
      },
      {
        text: 'Entrá a Importar › ARCA y subí el archivo, sin abrirlo antes con Excel.',
        screen: 0,
      },
      { text: 'Revisá lo que propone. Lo que ya cargaste a mano dice «Ya está cargado».' },
      {
        text: 'Si avisa que ya cargaste algo parecido, elegí «Es el mismo» o «Es otro».',
        screen: 1,
      },
      { text: 'Confirmá lo que queda.' },
    ],
    screens: [
      {
        title: 'Subí el archivo',
        label:
          'El importador de ARCA: una zona para arrastrar el archivo y el botón «Elegir archivo», marcado.',
        scene: { kind: 'import', source: 'arca', phase: 'upload' },
      },
      {
        title: '¿Es el mismo o es otro?',
        label:
          'La revisión del archivo: una factura que ya está cargada y otra parecida a una que se cargó a mano, con dos botones: «Es otro: cargalo» y «Es el mismo: no lo cargues», marcado.',
        scene: { kind: 'import', source: 'arca', phase: 'review' },
      },
    ],
    checks: [
      'Las facturas del mes aparecen en Compras y pagos.',
      'Ninguna quedó cargada dos veces.',
      'Los proveedores nuevos quedaron con su categoría.',
    ],
    troubles: [
      {
        problem: 'Me pide la CUIT de la empresa',
        fix: 'Sin la CUIT no se puede importar de ARCA.',
        link: { label: 'Ajustes › Datos de la SAS', path: '/ajustes?tab=sas' },
      },
      {
        problem: 'No reconoce algo que cargué a mano',
        fix: 'Compara por la CUIT del proveedor. Si le falta, agregala en su ficha antes de importar.',
        link: { label: 'Compras y pagos › Proveedores', path: '/compras?tab=proveedores' },
      },
      {
        problem: 'Dije «Es el mismo» y no veo con cuál lo juntó',
        fix: 'Hoy solo la deja sin cargar. No queda anotado con qué comprobante coincidía.',
      },
      {
        problem: 'Subí el archivo de lo que facturé yo',
        fix: 'Ese es «Emitidos». Acá van los «Recibidos»: lo que te facturaron a vos.',
      },
    ],
    result: 'Las compras con factura del mes quedan cargadas, sin repetir las que ya estaban.',
    action: { label: 'Importar de ARCA', target: { kind: 'route', path: '/importar/arca' } },
  },
  {
    id: 'corregir',
    title: 'Me equivoqué y quiero corregir',
    hint: 'Deshacer, anular o corregir un mes cerrado',
    frequency: 'event',
    minutes: 2,
    steps: [
      {
        text: 'Si recién guardaste, tocá «Deshacer» en el aviso de abajo. Dura unos segundos.',
        screen: 0,
      },
      { text: 'Si ya pasó, abrí el comprobante desde Compras y pagos › Comprobantes.' },
      {
        text: 'Tocá «Anular» y escribí el motivo. Queda anulado con tu nombre: no se borra.',
        screen: 1,
      },
      { text: 'Cargalo de nuevo, bien. No existe «editar»: se anula y se vuelve a cargar.' },
    ],
    screens: [
      {
        title: '«Deshacer», apenas guardás',
        label: 'El aviso que aparece al guardar un gasto, con el botón «Deshacer», marcado.',
        scene: { kind: 'undo' },
      },
      {
        title: '«Anular», con el motivo',
        label:
          'Un comprobante abierto y el cuadro para anularlo: pide el motivo y tiene el botón «Anular», marcado.',
        scene: { kind: 'void' },
      },
    ],
    checks: [
      'El comprobante figura anulado, con el motivo.',
      'Los saldos volvieron a como estaban antes.',
      'Si se había guardado junto con un pago, se anularon los dos.',
    ],
    troubles: [
      {
        problem: 'El mes ya está cerrado',
        fix: 'No se puede anular. Se corrige con una nota de crédito, anulándolo con fecha de hoy o con un ajuste de la contadora.',
      },
      {
        problem: 'Tiene pagos aplicados',
        fix: 'Si lo anulás, esos pagos quedan como saldo a favor con el proveedor.',
      },
      {
        problem: 'Es una factura hecha con ARCA',
        fix: 'No se anula. Se corrige con una nota de crédito.',
      },
    ],
    result: 'Lo anulado deja de contar en los números. Queda a la vista quién lo anuló y por qué.',
    action: {
      label: 'Ver los comprobantes',
      target: { kind: 'route', path: '/compras?tab=comprobantes' },
    },
  },
  {
    id: 'fin-de-mes',
    title: 'Fin de mes para la contadora',
    hint: 'Revisar, cerrar y mandar los libros',
    frequency: 'monthly',
    minutes: 20,
    routine: 'month_close',
    steps: [
      {
        text: 'Cargá lo que falte: los cierres del día, Mercado Pago, el banco y las compras de ARCA.',
      },
      { text: 'Contá cada caja, para que los saldos sean los de verdad.' },
      {
        text: 'Entrá a Libros › Cierres de mes y mirá los avisos. Cada uno dice qué falta.',
        screen: 0,
      },
      { text: 'Cerrá el mes con la contadora. Después ya no cambia.' },
      { text: 'Bajá el sumas y saldos y las compras con factura, y mandáselos.' },
    ],
    screens: [
      {
        title: 'Los avisos antes de cerrar',
        label:
          'El cierre del mes: tres avisos (faltan dos cierres del día, falta contar una caja, las compras de ARCA están al día) y los botones para exportar y para cerrar el mes. Están marcados los avisos.',
        scene: { kind: 'month-close' },
      },
    ],
    checks: [
      'El mes figura cerrado.',
      'No quedan avisos sin mirar.',
      'La contadora tiene los archivos, o entra con su usuario de solo lectura.',
    ],
    troubles: [
      {
        problem: 'Los Libros de IVA no se pueden bajar',
        fix: 'Falta la CUIT de la empresa.',
        link: { label: 'Ajustes › Datos de la SAS', path: '/ajustes?tab=sas' },
      },
      {
        problem: 'La contadora quiere solo lo que tiene factura',
        fix: 'En Comprobantes, filtrá «Con factura» y exportá. Los libros no se filtran: llevan todo.',
        link: { label: 'Compras y pagos › Comprobantes', path: '/compras?tab=comprobantes' },
      },
      {
        problem: 'Hay gastos fijos sin cargar',
        fix: 'El aviso los nombra. Cargalos, o marcá que este mes no se pagan.',
        link: { label: 'Gastos fijos', path: '/gastos-fijos' },
      },
      {
        problem: 'Cerré y hay que cambiar algo',
        fix: 'Un mes cerrado no se toca. Mirá «Me equivoqué y quiero corregir».',
      },
    ],
    result: 'El mes queda fijo y la contadora tiene todo para trabajar.',
    action: { label: 'Ir al cierre del mes', target: { kind: 'route', path: '/libros/cierres' } },
  },
]

const RECIPE_BY_ID: ReadonlyMap<RecipeId, GuideRecipe> = new Map(
  GUIDE_RECIPES.map((recipe) => [recipe.id, recipe]),
)

/** La receta de un id. Todos los ids de `RECIPE_IDS` tienen la suya (lo fija un test). */
export function guideRecipe(id: RecipeId): GuideRecipe {
  const recipe = RECIPE_BY_ID.get(id)
  if (!recipe) throw new Error(`guideRecipe: no hay receta «${id}».`)
  return recipe
}

// ─── El mapa ─────────────────────────────────────────────────────────────────

export const STATION_IDS = ['vender', 'comprar', 'pagar', 'controlar', 'fin-de-mes'] as const
export type StationId = (typeof STATION_IDS)[number]

/** Los tres lugares donde está la plata del bar. */
export type MoneyPocket = 'cajas' | 'en_camino' | 'deuda'

export const MONEY_POCKET_LABEL: Readonly<Record<MoneyPocket, string>> = {
  cajas: 'Cajas',
  en_camino: 'En camino',
  deuda: 'Lo que debés',
}

/** Qué es cada lugar, en una línea (la referencia del mapa). */
export const MONEY_POCKET_HINT: Readonly<Record<MoneyPocket, string>> = {
  cajas: 'La plata que tenés hoy: efectivo, banco y billeteras.',
  en_camino: 'Ventas con tarjeta, QR o app que todavía no llegaron a tu cuenta.',
  deuda: 'Compras que te dejaron a pagar y todavía no pagaste.',
}

export type StationMove = { pocket: MoneyPocket; direction: 'up' | 'down' }

export type GuideStation = {
  id: StationId
  n: number
  title: string
  /** Qué se hace, en una oración. */
  what: string
  /** Qué mueve, en chips (vacío: no mueve plata). */
  moves: readonly StationMove[]
  /** Qué mueve, en palabras. */
  movesText: string
  /** La receta de «Ver cómo». */
  recipe: RecipeId
  /** «Hacerlo ahora». */
  action: GuideAction
}

export const GUIDE_STATIONS: readonly GuideStation[] = [
  {
    id: 'vender',
    n: 1,
    title: 'Vendés',
    what: 'Cargás el cierre del día: cuánto se vendió y cómo te pagaron.',
    moves: [
      { pocket: 'cajas', direction: 'up' },
      { pocket: 'en_camino', direction: 'up' },
    ],
    movesText:
      'El efectivo entra a la caja. Las tarjetas, el QR y las apps quedan en camino hasta que te los acreditan.',
    recipe: 'cierre',
    action: { label: 'Cargar el cierre', target: { kind: 'route', path: '/ventas/cierre' } },
  },
  {
    id: 'comprar',
    n: 2,
    title: 'Comprás y gastás',
    what: 'Cargás cada compra y cada gasto, con el papel que te dieron.',
    moves: [
      { pocket: 'cajas', direction: 'down' },
      { pocket: 'deuda', direction: 'up' },
    ],
    movesText: 'Lo que pagás en el momento baja la caja. Lo que te dejan a pagar queda como deuda.',
    recipe: 'gasto',
    action: { label: 'Cargar un gasto', target: { kind: 'sheet', sheet: 'gasto' } },
  },
  {
    id: 'pagar',
    n: 3,
    title: 'Pagás',
    what: 'Elegís a quién le pagás y qué facturas cancelás.',
    moves: [
      { pocket: 'deuda', direction: 'down' },
      { pocket: 'cajas', direction: 'down' },
    ],
    movesText: 'Baja lo que debés y baja la caja de donde salió la plata.',
    recipe: 'pagar-deuda',
    action: { label: 'Pagar algo que debo', target: { kind: 'sheet', sheet: 'pagar' } },
  },
  {
    id: 'controlar',
    n: 4,
    title: 'Controlás la plata',
    what: 'Contás la caja y anotás lo que te acreditaron Mercado Pago, las tarjetas y el banco.',
    moves: [
      { pocket: 'en_camino', direction: 'down' },
      { pocket: 'cajas', direction: 'up' },
    ],
    movesText:
      'Lo acreditado pasa de «en camino» a tu cuenta. Si contás y no coincide, el saldo se corrige.',
    recipe: 'contar-caja',
    action: { label: 'Contar la caja', target: { kind: 'sheet', sheet: 'ajustar' } },
  },
  {
    id: 'fin-de-mes',
    n: 5,
    title: 'Fin de mes',
    what: 'Revisás los avisos, cerrás el mes y le mandás los libros a la contadora.',
    moves: [],
    movesText: 'No mueve plata. Deja el mes fijo: después ya no cambia.',
    recipe: 'fin-de-mes',
    action: { label: 'Ir al cierre del mes', target: { kind: 'route', path: '/libros/cierres' } },
  },
]

// ─── El estado real ──────────────────────────────────────────────────────────

/** Lo que devuelve `getOnboarding` (los datos de la base y el estado de cada ítem). */
export type GuideOverview = {
  data: OnboardingData
  state: Pick<OnboardingState, 'items'>
}

/**
 * Cómo viene algo, en palabras: `done` al día · `todo` te toca · `idle` todavía no aplica (falta
 * un dato previo o no es el momento). Nunca un «te toca» que la persona no puede cumplir.
 */
export type GuideStatus = { state: 'done' | 'todo' | 'idle'; text: string }

function plural(n: number, one: string, many: string): string {
  return n === 1 ? one : many
}

function itemDone(overview: GuideOverview, id: OnboardingItemId): boolean {
  return overview.state.items.find((item) => item.id === id)?.status === 'done'
}

/** ¿Los libros arrancaron este mes? Entonces el mes pasado no es de la plataforma. */
function booksStartedThisMonth(data: OnboardingData): boolean {
  return Boolean(data.booksStartDate && data.booksStartDate > addDays(startOfMonth(data.today), -1))
}

const UP_TO_DATE: GuideStatus = { state: 'done', text: 'Al día' }

/** Los ítems de «Cómo arrancar» que son rutina y tienen estado en la base. */
export type RoutineItemId = Extract<
  OnboardingItemId,
  'daily_close' | 'mp_weekly' | 'bank_weekly' | 'arca_monthly' | 'treasury_check' | 'month_close'
>

/**
 * El estado de una rutina con lo que hay cargado. `null` sin datos de la base (la guía se ve
 * igual, sin marcas).
 */
export function routineStatus(
  id: RoutineItemId,
  overview: GuideOverview | null,
): GuideStatus | null {
  if (!overview) return null
  const { data } = overview
  const done = itemDone(overview, id)
  switch (id) {
    case 'daily_close': {
      if (done) return UP_TO_DATE
      const n = data.dailyCloseMissing
      return {
        state: 'todo',
        text: `${plural(n, 'Falta', 'Faltan')} ${n} ${plural(n, 'cierre', 'cierres')} de la última semana`,
      }
    }
    case 'mp_weekly': {
      if (done) return UP_TO_DATE
      const stats = data.imports.mp_release
      if ((stats?.pendingReview ?? 0) > 0) {
        return { state: 'todo', text: 'Hay un reporte para revisar' }
      }
      return stats?.lastBatchAt
        ? { state: 'todo', text: 'Pasó más de una semana' }
        : { state: 'idle', text: 'Todavía no subiste ninguno' }
    }
    case 'bank_weekly': {
      if (done) return UP_TO_DATE
      const stats = data.imports.bank_statement
      if ((stats?.pendingReview ?? 0) > 0) {
        return { state: 'todo', text: 'Hay un extracto para revisar' }
      }
      if (stats?.lastBatchAt) return { state: 'todo', text: 'Pasó más de una semana' }
      return {
        state: 'idle',
        text: data.bankWithCbu ? 'Todavía no subiste ninguno' : 'Cuando tengas un banco cargado',
      }
    }
    case 'arca_monthly': {
      if (done) return UP_TO_DATE
      if (data.sasMissing.includes('cuit')) {
        return { state: 'idle', text: 'Primero cargá la CUIT de la empresa' }
      }
      if (booksStartedThisMonth(data)) return { state: 'idle', text: 'Empieza el mes que viene' }
      return Number(data.today.slice(8, 10)) < 11
        ? { state: 'idle', text: 'Se baja del día 11 en adelante' }
        : { state: 'todo', text: 'Falta bajar el mes pasado' }
    }
    case 'treasury_check': {
      if (done) return UP_TO_DATE
      const n = data.treasuriesUnchecked
      return {
        state: 'todo',
        text: `${plural(n, 'Falta', 'Faltan')} contar ${n} ${plural(n, 'caja', 'cajas')} este mes`,
      }
    }
    case 'month_close': {
      if (booksStartedThisMonth(data)) {
        return { state: 'idle', text: 'Todavía no hay un mes para cerrar' }
      }
      return done ? UP_TO_DATE : { state: 'todo', text: 'El mes pasado sigue abierto' }
    }
  }
}

const STATION_ROUTINE: Readonly<Partial<Record<StationId, RoutineItemId>>> = {
  vender: 'daily_close',
  controlar: 'treasury_check',
  'fin-de-mes': 'month_close',
}

export type StationStates = {
  /** `null`: de esa estación la base no dice nada (comprar y pagar son «cuando pasa»). */
  byId: Readonly<Record<StationId, GuideStatus | null>>
  /** La primera estación que te toca: ahí va el botón principal del mapa. */
  current: StationId | null
  /** Hay datos y no te toca nada. */
  allClear: boolean
}

/** Cómo viene cada estación del mapa y cuál te toca. */
export function stationStates(overview: GuideOverview | null): StationStates {
  const byId = Object.fromEntries(
    STATION_IDS.map((id) => {
      const routine = STATION_ROUTINE[id]
      return [id, routine ? routineStatus(routine, overview) : null]
    }),
  ) as Record<StationId, GuideStatus | null>
  const current = STATION_IDS.find((id) => byId[id]?.state === 'todo') ?? null
  return { byId, current, allClear: overview !== null && current === null }
}

/** El estado de una receta (solo las que son rutina con dato en la base). */
export function recipeStatus(
  recipe: Pick<GuideRecipe, 'routine'>,
  overview: GuideOverview | null,
): GuideStatus | null {
  const id = recipe.routine
  if (
    id === 'daily_close' ||
    id === 'mp_weekly' ||
    id === 'bank_weekly' ||
    id === 'arca_monthly' ||
    id === 'treasury_check' ||
    id === 'month_close'
  ) {
    return routineStatus(id, overview)
  }
  return null
}

// ─── Tu rutina ───────────────────────────────────────────────────────────────

export type RoutineRow = {
  key: string
  title: string
  /** La receta que lo explica, o la pantalla donde se hace. */
  link: { kind: 'recipe'; recipe: RecipeId } | { kind: 'route'; path: string }
  /** `null`: no hay un dato que lo diga (se hace cuando pasa). */
  status: GuideStatus | null
}

export type RoutineGroup = {
  frequency: Exclude<RecipeFrequency, 'event'>
  title: string
  /** Cuándo y cuánto lleva. */
  hint: string
  rows: RoutineRow[]
}

/** La rutina del bar sin punto de venta (todo a mano), con el estado real de cada cosa. */
export function guideRoutine(overview: GuideOverview | null): RoutineGroup[] {
  return [
    {
      frequency: 'daily',
      title: 'Todos los días',
      hint: 'A la mañana siguiente, unos 10 minutos.',
      rows: [
        {
          key: 'cierre',
          title: 'Cargar el cierre de ayer',
          link: { kind: 'recipe', recipe: 'cierre' },
          status: routineStatus('daily_close', overview),
        },
        {
          key: 'gastos',
          title: 'Cargar las compras y los gastos del día',
          link: { kind: 'recipe', recipe: 'gasto' },
          status: null,
        },
        {
          key: 'pagos',
          title: 'Anotar los pagos que hiciste',
          link: { kind: 'recipe', recipe: 'pagar-deuda' },
          status: null,
        },
      ],
    },
    {
      frequency: 'weekly',
      title: 'Cada semana',
      hint: 'Un día fijo, unos 20 minutos.',
      rows: [
        {
          key: 'mercado-pago',
          title: 'Subir el reporte de Mercado Pago',
          link: { kind: 'recipe', recipe: 'mercado-pago' },
          status: routineStatus('mp_weekly', overview),
        },
        {
          key: 'banco',
          title: 'Subir los movimientos del banco',
          link: { kind: 'route', path: '/importar/banco' },
          status: routineStatus('bank_weekly', overview),
        },
        {
          key: 'cobros',
          title: 'Anotar lo que acreditaron las tarjetas y las apps',
          link: { kind: 'recipe', recipe: 'cobro' },
          status: null,
        },
      ],
    },
    {
      frequency: 'monthly',
      title: 'Cada mes',
      hint: 'Del 11 en adelante, con la contadora.',
      rows: [
        {
          key: 'arca',
          title: 'Bajar las compras de ARCA',
          link: { kind: 'recipe', recipe: 'arca' },
          status: routineStatus('arca_monthly', overview),
        },
        {
          key: 'cajas',
          title: 'Contar cada caja',
          link: { kind: 'recipe', recipe: 'contar-caja' },
          status: routineStatus('treasury_check', overview),
        },
        {
          key: 'cierre-mes',
          title: 'Cerrar el mes y mandarle los libros a la contadora',
          link: { kind: 'recipe', recipe: 'fin-de-mes' },
          status: routineStatus('month_close', overview),
        },
      ],
    },
  ]
}

// ─── Con factura y sin factura ───────────────────────────────────────────────

export const PAPER_IDS = ['factura_a', 'factura_bc', 'tique', 'sin'] as const

export const PAPER_FACT_IDS = ['recover_vat', 'vat_book', 'your_numbers', 'accountant'] as const
export type PaperFactId = (typeof PAPER_FACT_IDS)[number]

/** Las cuatro preguntas que cambian (o no) según el papel. */
export const PAPER_FACTS: ReadonlyArray<{ id: PaperFactId; question: string }> = [
  { id: 'recover_vat', question: '¿Recuperás el IVA?' },
  { id: 'vat_book', question: '¿Entra al Libro IVA?' },
  { id: 'your_numbers', question: '¿Queda en tus números?' },
  { id: 'accountant', question: '¿Qué ve la contadora?' },
]

/** `yes` y `no` llevan su ícono; `depends` es «a veces»; `text` es una descripción. */
export type PaperAnswer = 'yes' | 'no' | 'depends' | 'text'

export type GuidePaper = {
  id: PaperId
  title: string
  /** Qué cambia si te dan este papel, en una línea (la misma de la carga del gasto). */
  lead: string
  /** Cómo figura en Compras y pagos › Comprobantes. */
  filter: 'Con factura' | 'Sin factura'
  facts: Readonly<Record<PaperFactId, { answer: PaperAnswer; text: string }>>
}

export const GUIDE_PAPERS: readonly GuidePaper[] = [
  {
    id: 'factura_a',
    title: 'Factura A',
    lead: 'Te discrimina el IVA: lo recuperás.',
    filter: 'Con factura',
    facts: {
      recover_vat: {
        answer: 'yes',
        text: 'Sí, si el proveedor y tu empresa son responsables inscriptos.',
      },
      vat_book: { answer: 'yes', text: 'Sí.' },
      your_numbers: { answer: 'yes', text: 'Sí.' },
      accountant: { answer: 'text', text: 'La factura, con el IVA aparte.' },
    },
  },
  {
    id: 'factura_bc',
    title: 'Factura B o C',
    lead: 'Queda registrada. El IVA va al costo.',
    filter: 'Con factura',
    facts: {
      recover_vat: { answer: 'no', text: 'No. El IVA queda dentro del gasto.' },
      vat_book: { answer: 'yes', text: 'Sí.' },
      your_numbers: { answer: 'yes', text: 'Sí.' },
      accountant: { answer: 'text', text: 'La factura, con el IVA dentro del total.' },
    },
  },
  {
    id: 'tique',
    title: 'Tique',
    lead: 'Queda registrado como tique.',
    filter: 'Con factura',
    facts: {
      recover_vat: { answer: 'no', text: 'No. El IVA queda dentro del gasto.' },
      vat_book: { answer: 'depends', text: 'Solo si cargás el comercio y el número.' },
      your_numbers: { answer: 'yes', text: 'Sí.' },
      accountant: {
        answer: 'text',
        text: 'El tique. Si le falta el comercio, se lo avisa al cerrar el mes.',
      },
    },
  },
  {
    id: 'sin',
    title: 'Remito o nada',
    lead: 'Sin factura: queda en tus números y no entra al Libro IVA.',
    filter: 'Sin factura',
    facts: {
      recover_vat: { answer: 'no', text: 'No. Va todo al gasto.' },
      vat_book: { answer: 'no', text: 'No.' },
      your_numbers: { answer: 'yes', text: 'Sí, igual que todo lo demás.' },
      accountant: { answer: 'text', text: 'El gasto, con la marca «Sin factura».' },
    },
  },
]

export type PaperCase = {
  id: string
  /** La situación, en primera persona. */
  title: string
  /** El dibujo: uno de los cuatro papeles o la nota de crédito. */
  art: PaperId | 'nota_credito'
  /** «Dónde lo cargo»: el camino, de izquierda a derecha. */
  where: readonly string[]
  /** Qué pasa, una idea por renglón. */
  result: readonly string[]
  action: GuideAction
  /** La receta que lo muestra paso a paso. */
  recipe: RecipeId | null
}

export const GUIDE_PAPER_CASES: readonly PaperCase[] = [
  {
    id: 'remito-contado',
    title: 'Me dieron un remito y pagué en el momento',
    art: 'sin',
    where: ['+ Cargar', 'Pagué algo recién', 'Remito o nada'],
    result: [
      'Sale la plata de la caja.',
      'No queda deuda con el proveedor.',
      'No entra al Libro IVA.',
    ],
    action: { label: 'Cargar un gasto', target: { kind: 'sheet', sheet: 'gasto' } },
    recipe: 'sin-factura',
  },
  {
    id: 'remito-cuenta',
    title: 'Me dejaron un remito y lo pago después',
    art: 'sin',
    where: [
      '+ Cargar',
      'Me llegó una factura o un remito y lo pago después',
      'Sin factura (remito o nada)',
    ],
    result: [
      'Queda la deuda con el proveedor, con su vencimiento.',
      'La caja baja recién cuando la pagás.',
      'No entra al Libro IVA.',
    ],
    action: {
      label: 'Cargar una compra que debo',
      target: { kind: 'route', path: '/compras/nueva' },
    },
    recipe: 'compra',
  },
  {
    id: 'tique',
    title: 'Me dieron un tique',
    art: 'tique',
    where: ['+ Cargar', 'Pagué algo recién', 'Tique'],
    result: [
      'Sale la plata de la caja.',
      'Con el comercio y el número, entra al Libro IVA.',
      'Si falta alguno de los dos, queda como gasto y no entra.',
    ],
    action: { label: 'Cargar un gasto', target: { kind: 'sheet', sheet: 'gasto' } },
    recipe: 'gasto',
  },
  {
    id: 'factura-bc',
    title: 'Me dieron una Factura B o C',
    art: 'factura_bc',
    where: ['+ Cargar', 'Pagué algo recién, o lo pago después', 'Factura B o C'],
    result: [
      'Entra al Libro IVA.',
      'El IVA no se recupera: queda dentro del gasto.',
      'Si el proveedor es responsable inscripto, pedile Factura A.',
    ],
    action: { label: 'Cargar un gasto', target: { kind: 'sheet', sheet: 'gasto' } },
    recipe: 'gasto',
  },
  {
    id: 'factura-a',
    title: 'Me dieron una Factura A',
    art: 'factura_a',
    where: ['+ Cargar', 'Pagué algo recién, o lo pago después', 'Factura A'],
    result: [
      'Entra al Libro IVA.',
      'El IVA queda a tu favor: se resta del que pagás cada mes.',
      'Hace falta la CUIT del proveedor.',
    ],
    action: { label: 'Cargar un gasto', target: { kind: 'sheet', sheet: 'gasto' } },
    recipe: 'gasto',
  },
  {
    id: 'nota-credito',
    title: 'Me dieron una nota de crédito',
    art: 'nota_credito',
    where: ['Compras y pagos', 'Cargar una compra que debo', 'Nota de crédito'],
    result: [
      'Es el papel que descuenta o anula una factura.',
      'Si elegís qué factura corrige, se descuenta sola de esa.',
      'Si no elegís, queda a favor para el próximo pago.',
    ],
    action: {
      label: 'Cargar una nota de crédito',
      target: { kind: 'route', path: '/compras/nueva?tipo=nc' },
    },
    recipe: null,
  },
]

// ─── Cómo se vincula cada cosa ───────────────────────────────────────────────

export const LINK_IDS = [
  'proveedor-categoria',
  'compra-pago',
  'saldo-factura',
  'nota-factura',
  'gasto-fijo',
  'foto',
  'cierre-cajas',
  'importado',
  'libros',
] as const
export type GuideLinkId = (typeof LINK_IDS)[number]

export type GuideLink = {
  id: GuideLinkId
  /** Las dos (o tres) cosas que se unen, de izquierda a derecha. */
  ends: readonly [string, string] | readonly [string, string, string]
  /** `auto`: se une solo · `you`: lo unís vos. */
  how: 'auto' | 'you'
  /** Cuándo, en dos o tres palabras (va sobre la línea del dibujo). */
  when: string
  what: string
  where: string
  ifNot: string
  undo: string
  /** Lo que hoy NO se puede. `null` si no hay nada que avisar. */
  limit: string | null
  recipe: RecipeId | null
}

/** `vinculo-compra-pago`: el `id` del bloque en la página. */
export function linkAnchor(id: GuideLinkId): string {
  return `vinculo-${id}`
}

export const GUIDE_LINKS: readonly GuideLink[] = [
  {
    id: 'proveedor-categoria',
    ends: ['Proveedor', 'Su categoría de siempre'],
    how: 'you',
    when: 'una sola vez',
    what: 'Le decís una vez en qué se gasta con ese proveedor. Desde ahí, cada compra suya ya viene con esa categoría.',
    where:
      'En la ficha del proveedor, en Compras y pagos › Proveedores. O al cargarle algo, tildando «Usar siempre para» ese proveedor.',
    ifNot: 'Cada vez que le cargás algo, te pregunta en qué se gastó.',
    undo: 'Cambiala o quitala en la ficha. Lo que ya cargaste no cambia.',
    limit: null,
    recipe: 'gasto',
  },
  {
    id: 'compra-pago',
    ends: ['Compra', 'Su pago'],
    how: 'you',
    when: 'al pagar',
    what: 'Es decir que esta plata que salió es para pagar esta factura.',
    where:
      'En «Pago algo que debía», tildando la factura. O al cargar la compra, con «Guardar y pagar…». Si pagaste en el momento con «Pagué algo recién», queda unido solo.',
    ifNot:
      'La factura sigue figurando como deuda. La plata que salió queda como saldo a favor con ese proveedor.',
    undo: 'Anulá el pago. La factura vuelve a quedar sin pagar.',
    limit: 'Hoy no se puede cambiar a qué factura fue un pago sin anularlo.',
    recipe: 'pagar-deuda',
  },
  {
    id: 'saldo-factura',
    ends: ['Saldo a favor', 'Una factura'],
    how: 'auto',
    when: 'en el próximo pago',
    what: 'Es usar plata que ya le diste a un proveedor (un pago de más o una nota de crédito) contra una factura que le debés.',
    where:
      'Se usa solo en el próximo pago: viene tildado. Si no querés esperar, en la ficha del proveedor está «Aplicar ahora».',
    ifNot: 'El proveedor muestra a la vez una deuda y un saldo a favor.',
    undo: 'Con «Deshacer», apenas lo aplicás.',
    limit:
      'Pasado el «Deshacer», hoy no hay un botón para volver a separarlos. Y del lado de la plata por cobrar todavía no existe «Aplicar ahora».',
    recipe: 'pagar-deuda',
  },
  {
    id: 'nota-factura',
    ends: ['Nota de crédito', 'La factura que corrige'],
    how: 'you',
    when: 'al cargarla',
    what: 'La nota de crédito es el papel que descuenta o anula una factura. Unirla es decir cuál corrige.',
    where:
      'Al cargarla, en «¿Qué factura corrige?». Es opcional. Al importar de ARCA te lo pregunta también.',
    ifNot: 'Queda a favor del proveedor y se usa sola en el próximo pago.',
    undo: 'Anulá la nota de crédito. La factura vuelve a deber lo que debía.',
    limit: null,
    recipe: null,
  },
  {
    id: 'gasto-fijo',
    ends: ['Gasto', 'Gasto fijo del mes'],
    how: 'you',
    when: 'solo al cargar',
    what: 'Es decir que este gasto es, por ejemplo, el alquiler de este mes. El renglón queda cargado y el vencimiento pasa al mes que viene.',
    where:
      'Al cargar el gasto, eligiendo el gasto fijo en «¿En qué se gastó?». O desde Gastos fijos, con el botón de ese renglón.',
    ifNot:
      'El gasto queda en tus números, pero el renglón sigue figurando sin pagar y sigue avisando.',
    undo: 'Anulá el gasto y cargalo de nuevo.',
    limit:
      'Hoy no se puede vincular después. Si lo cargaste sin elegir el gasto fijo, anulalo y cargalo de nuevo, o marcá que este mes no se paga.',
    recipe: 'gasto-fijo',
  },
  {
    id: 'foto',
    ends: ['Comprobante', 'Su foto'],
    how: 'you',
    when: 'cuando quieras',
    what: 'Es la foto o el PDF del papel, guardado junto a lo que cargaste.',
    where:
      'Al cargar un gasto o una compra. O después, abriendo el comprobante, también con el mes cerrado. Hasta 5 archivos.',
    ifNot: 'No cambia ningún número. Falta el respaldo el día que lo pida la contadora.',
    undo: 'Quitá el archivo desde el comprobante. Se borra y no se recupera.',
    limit: 'Hoy las listas no muestran qué comprobantes tienen foto y cuáles no.',
    recipe: 'gasto',
  },
  {
    id: 'cierre-cajas',
    ends: ['Cierre del día', 'Cajas', 'En camino'],
    how: 'auto',
    when: 'al guardar el cierre',
    what: 'El cierre reparte solo cada medio de cobro. El efectivo entra a la caja. Lo demás queda en camino hasta que te lo acreditan.',
    where:
      'A dónde va cada medio se define una vez, en Ajustes › Medios de cobro. Lo acreditado se anota con «Me entró plata» o subiendo el reporte de Mercado Pago.',
    ifNot:
      'Las ventas están contadas, pero la plata figura sin entrar: «en camino» crece y tu cuenta queda por debajo de la real.',
    undo: 'Anulá el cobro: esas ventas vuelven a quedar en camino. El cierre no se edita: se anula y se carga de nuevo.',
    limit:
      'Si anotás un cobro antes de cargar el cierre de ese día, queda a cuenta. Hoy no hay un botón para aplicarlo después.',
    recipe: 'cobro',
  },
  {
    id: 'importado',
    ends: ['Línea importada', 'Lo que cargaste a mano'],
    how: 'auto',
    when: 'al revisar el archivo',
    what: 'Cuando subís un archivo de ARCA, de Mercado Pago o del banco, la plataforma busca si eso ya lo habías cargado.',
    where:
      'Lo hace sola al revisar el archivo. Con el mismo proveedor, tipo y número dice «Ya está cargado». Con el mismo total y una fecha parecida, te pregunta.',
    ifNot: 'Podría quedar cargado dos veces. Por eso avisa antes de confirmar.',
    undo: 'Si dijiste que no la cargue, podés deshacerlo en el momento. Si algo se cargó de más, anulá ese comprobante.',
    limit:
      'Hoy no podés decir «es este comprobante». Solo «Es el mismo: no lo cargues», y no queda anotado con cuál coincidía.',
    recipe: 'arca',
  },
  {
    id: 'libros',
    ends: ['Comprobante', 'Cómo queda en los libros'],
    how: 'auto',
    when: 'siempre',
    what: 'Cada cosa que guardás arma sola su registro en los libros. Los contadores le dicen asiento.',
    where:
      'No hay que hacer nada. Antes de guardar lo podés mirar en «Ver cómo queda en los libros».',
    ifNot:
      'No hay forma de guardar algo sin que quede en los libros. Con factura o sin factura, va al mismo libro.',
    undo: 'Anulando el comprobante. Queda anulado con tu nombre y el motivo, y deja de contar.',
    limit: null,
    recipe: 'corregir',
  },
]

// ─── Glosario ────────────────────────────────────────────────────────────────

export type GuideGlossaryEntry = {
  /** La idea, como la diría un socio. */
  idea: string
  /** Cómo le dicen los contadores (`null` si es la misma palabra). */
  name: string | null
  meaning: string
}

/** La definición que ya usa «Cómo arrancar», para no explicar lo mismo de dos maneras. */
function sharedMeaning(term: string): string {
  return ONBOARDING_GLOSSARY.find((entry) => entry.term === term)?.meaning ?? ''
}

/** Un solo glosario: la idea primero, el nombre de contadora después. */
export const GUIDE_GLOSSARY: readonly GuideGlossaryEntry[] = [
  {
    idea: 'Cajas',
    name: 'Disponibilidades',
    meaning: MONEY_POCKET_HINT.cajas,
  },
  { idea: 'En camino', name: 'Por acreditar', meaning: MONEY_POCKET_HINT.en_camino },
  { idea: 'Lo que debés', name: 'Cuentas a pagar', meaning: MONEY_POCKET_HINT.deuda },
  {
    idea: 'Plata por cobrar',
    name: 'Cuentas a cobrar',
    meaning: 'Lo que te deben las tarjetas, las apps y los clientes con cuenta.',
  },
  {
    idea: 'Saldo a favor',
    name: 'Pago a cuenta',
    meaning: 'Plata que ya le diste a un proveedor y todavía no se usó contra una factura.',
  },
  {
    idea: 'Categoría',
    name: 'Cuenta contable',
    meaning: 'En qué se gastó o por dónde entró la plata. Se elige una vez por proveedor.',
  },
  {
    idea: 'La lista de categorías',
    name: 'Plan de cuentas',
    meaning: sharedMeaning('Plan de cuentas'),
  },
  {
    idea: 'Cómo queda en los libros',
    name: 'Asiento',
    meaning: sharedMeaning('Asiento'),
  },
  {
    idea: 'El IVA que recuperás',
    name: 'Crédito fiscal',
    meaning: sharedMeaning('Crédito fiscal'),
  },
  { idea: 'Factura A y Factura B', name: null, meaning: sharedMeaning('Factura A y Factura B') },
  {
    idea: 'Sin factura',
    name: 'Sin comprobante',
    meaning: 'Un remito o ningún papel. Queda en tus números igual y no entra al Libro IVA.',
  },
  {
    idea: 'Nota de crédito',
    name: null,
    meaning: 'El papel que descuenta o anula una factura.',
  },
  {
    idea: 'Libro IVA',
    name: null,
    meaning: 'La lista de las facturas de cada mes, con su IVA. La arma la plataforma sola.',
  },
  {
    idea: 'Numeración de facturas',
    name: 'Punto de venta',
    meaning: sharedMeaning('Punto de venta'),
  },
  {
    idea: 'Cuando la plata llega a tu cuenta',
    name: 'Acreditación',
    meaning: sharedMeaning('Acreditación'),
  },
  {
    idea: 'Contar la caja',
    name: 'Arqueo',
    meaning: 'Comparar lo que hay de verdad con lo que dice el sistema y anotar la diferencia.',
  },
  {
    idea: 'Lo que te descuentan antes de pagarte',
    name: 'Retención',
    meaning: sharedMeaning('Retención'),
  },
  {
    idea: 'Con cuánto arrancaste',
    name: 'Saldos iniciales',
    meaning: sharedMeaning('Saldos iniciales'),
  },
  { idea: 'Cerrar el mes', name: null, meaning: sharedMeaning('Cerrar el mes') },
  {
    idea: 'Sumas y saldos',
    name: null,
    meaning:
      'El listado de todas las categorías con su total. Es lo que se le manda a la contadora.',
  },
  { idea: 'ARCA', name: null, meaning: sharedMeaning('ARCA') },
  { idea: 'CUIT', name: null, meaning: sharedMeaning('CUIT') },
]
