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

// ─── Lo que dicen las pantallas de verdad ────────────────────────────────────

/**
 * Los rótulos de las pantallas REALES que la guía dibuja o cita, tal cual están hoy. Los dibujos
 * (`guias/uso/mock-scenes.tsx`) los toman de acá y un test comprueba que cada uno siga escrito en
 * el código de su pantalla: si una pantalla cambia un nombre, el test avisa y se cambian las dos
 * cosas juntas. Mejor una guía que repite un nombre feo que una que promete un botón que no está.
 *
 * Los títulos de las hojas y las tarjetas del lanzador no están acá: salen de `ACTION_TITLES` y
 * `LAUNCHER_ITEMS`, que ya son la fuente de las pantallas.
 */
export const SCREEN_LABELS = {
  /** El cierre del día (`ventas/cierre`). */
  cierre: {
    title: 'Cierre del día',
    methods: '¿Cuánto se vendió y cómo te pagaron?',
    counted: '¿Contaste el efectivo?',
    invoiced: '¿Qué facturaste?',
    total: 'Total vendido',
    withInvoice: 'Con factura',
    withoutInvoice: 'Sin factura',
    /** Sigue el día: «Guardar cierre del miércoles 07/10». */
    save: 'Guardar cierre del',
    otherShift: 'Cargar otro turno',
  },
  /** La hoja «Nuevo gasto». */
  gasto: {
    amount: '¿Cuánto gastaste?',
    target: '¿En qué se gastó?',
    treasury: '¿Con qué pagaste?',
    paper: '¿Qué papel te dieron?',
    paperNone: 'Remito o nada',
    remito: 'Agregar n.º de remito',
    another: 'Cargar otro después',
    /** Sigue el importe: «Cargar gasto · $ 12.500». */
    save: 'Cargar gasto',
    books: 'Ver cómo queda en los libros',
    duplicate: 'Ver el que ya está',
    remember: 'Usar siempre para',
    /** Lo elegido en «¿En qué se gastó?», cuando es un gasto fijo: «Gasto fijo «Alquiler»». */
    fixedMark: 'Gasto fijo',
    pickOther: 'Elegir otro',
    stampA: 'Con factura A',
    stampTicket: 'Con tique',
    stampNone: 'Sin factura',
    ticketNet: 'Neto',
    ticketVat: 'Lo recuperás',
    /** Sigue la caja: «Salen de Caja». */
    ticketTotal: 'Salen de',
    noteA: 'Entra al Libro IVA y recuperás el IVA. Con el proveedor no queda deuda.',
    noteNone: 'Queda en tus números, sin factura. No entra al Libro IVA.',
    saved: 'Gasto cargado',
  },
  /** La compra que queda a pagar (`compras/nueva`): cuatro preguntas y el ticket al costado. */
  compra: {
    title: 'Cargar una compra que debo',
    who: '¿A quién le compraste?',
    /** Sigue lo que se le debe: «Hoy le debés $ 42.500». */
    owedToday: 'Hoy le debés',
    change: 'Cambiar',
    paper: '¿Qué papel te dieron?',
    paperNone: 'Remito o nada',
    otherPaper: 'Es otro papel',
    notPurchase: '¿No es una compra?',
    creditNote: 'Es una nota de crédito',
    debitNote: 'Es una nota de débito',
    /** El rótulo largo: sigue en «Otro papel» y en la ficha del proveedor. */
    typeNone: 'Remito u otro comprobante (sin factura)',
    number: 'Punto de venta y número',
    remito: 'N.º de remito',
    amount: '¿Cuánto es?',
    total: 'Total del papel',
    payWhen: '¿Cuándo le pagás?',
    payLater: 'Más adelante: lo debo',
    payLaterNote: 'Queda anotado en su libreta hasta que le pagues.',
    paidNow: 'Ya lo pagué',
    paidNowNote: 'Sale de la caja ahora. No queda deuda.',
    due: '¿Cuándo vence?',
    dueSameDay: 'El mismo día',
    /** Sigue el importe: «Cargar compra · $ 84.000». */
    save: 'Cargar compra',
    /** El mismo botón con «Ya lo pagué» elegido. */
    saveAndPay: 'Cargar y pagar',
    recurring: '¿Es un gasto fijo?',
    corrects: '¿Qué compra corrige?',
  },
  /** La hoja «Pagar»: primero a quién, después qué y con qué. */
  pagar: {
    description: 'A quién, qué le pagás y con qué.',
    who: '¿A quién le pagás?',
    urgent: 'Lo más urgente',
    owes: 'Le debés',
    search: 'Buscar otro proveedor',
    notSupplier: '¿No es a un proveedor?',
    fixed: 'Un gasto fijo',
    invoices: '¿Qué le pagás?',
    overdue: 'Lo vencido',
    all: 'Todo',
    credit: 'A tu favor',
    treasury: '¿Con qué pagás?',
    partial: 'Pagar solo una parte',
  },
  /** La hoja «Registrar un cobro»: tres pasos. */
  cobrar: {
    who: '¿Quién te pagó?',
    step: '¿Cuánto te entró y a dónde?',
    amount: '¿Cuánto te entró?',
    into: '¿A dónde entró?',
    day: '¿Qué día entró?',
    sales: '¿De qué ventas es y qué te descontaron?',
    pending: 'Ventas pendientes',
    discounted: 'Te descontaron',
    deductions: '¿En qué te lo descontaron?',
    estimated: 'Estimado',
    explainFee: 'Es comisión',
    explainOther: 'Son otros cargos',
    explainUnknown: 'No sé qué es',
    /** Sigue lo que entró: «Anotar el cobro · entraron $ 133.650». */
    save: 'Anotar el cobro',
  },
  /** La hoja de contar la caja (la acción se llama «Contar la caja»; la hoja pregunta). */
  ajustar: {
    title: '¿Coincide la caja?',
    description: 'Contá lo que hay de verdad y lo comparamos con el sistema.',
    treasury: '¿Qué caja contaste?',
    book: 'El sistema dice',
    loaded: 'Según lo cargado.',
    never: 'Todavía no la contaste.',
    counted: '¿Cuánto hay de verdad?',
    matches: 'Sí, coincide',
    /** El botón cuando falta o sobra. */
    save: 'Guardar la diferencia',
    /** El resultado: «Faltan» y el número grande, en ámbar. */
    missing: 'Faltan',
    /** Sigue: «…y el sistema pasa a decir $ 285.000.» */
    shortage: 'Queda anotado como faltante de caja',
    bankFees: 'Son gastos del banco',
  },
  /** Las subidas de archivos y la revisión de lo que se subió (`importar`). */
  importar: {
    titleMercadoPago: 'Subir el reporte de Mercado Pago',
    titleArca: 'Subir las compras de ARCA',
    stepGetArca: 'Bajalo de ARCA',
    stepGetMercadoPago: 'Bajalo de Mercado Pago',
    stepUpload: 'Subilo acá',
    stepReview: 'Revisá y cargá',
    promise: 'Te muestro cada comprobante antes de cargar nada. Lo que no sepa, te lo pregunto.',
    dropMercadoPago: 'Soltá acá el reporte de Liquidaciones',
    dropArca: 'Soltá acá el ZIP que bajaste de ARCA',
    choose: 'Elegir archivo',
    ready: 'Listo',
    question: 'Con una pregunta',
    loaded: 'Ya está cargado',
    sameOrOther: '¿Es el mismo o es otro?',
    different: 'Es otro: cargalo',
    same: 'Es el mismo: no lo cargues',
    knownBefore: '¿Los tenés de antes?',
    moreOptions: 'Más opciones',
    discard: 'Descartar este archivo',
  },
  /** Un comprobante abierto (`comprobantes/[id]`). */
  comprobante: {
    fix: '¿Hay algo mal?',
    void: 'Anular',
    voidToday: 'Anular con fecha de hoy',
    voidNote: 'Queda anulado con tu nombre y el motivo (no se borra) y deja de contar en los',
    cancel: 'Cancelar',
    separate: 'Separar',
    arrived: 'Ya llegó',
  },
  /** Gastos fijos: la planilla del mes. */
  gastosFijos: {
    title: 'Gastos fijos',
    /** Sigue el mes: «Te falta de gasto fijo · octubre». */
    pending: 'Te falta de gasto fijo',
    next: 'Lo que sigue',
    pay: 'Pagar',
    /** Sigue el día: «Pagado el 08/10». */
    paid: 'Pagado el',
    bill: 'Me llegó la factura y la pago después',
    skip: 'Este mes no se paga',
    unskip: 'Sí se paga este mes',
    /** Pagaste menos de lo calculado: «Calculabas $ X y pagaste $ Y. ¿Era eso?» */
    ask: '¿Era eso?',
    /** Sigue el importe: «Sí, dejar $ 170.000». */
    keep: 'Sí, dejar',
    fill: 'Completar la planilla',
    restore: 'Volver a dejarlo pendiente',
  },
  /** La hoja de un proveedor (`compras/proveedores/[id]`). */
  proveedor: {
    edit: 'Editar datos',
    voucher: '¿Qué papel te da?',
    applyCredit: 'Usarlo ahora',
  },
  /** El fin de mes (`libros/cierres`): tres pasos. */
  cierreMes: {
    title: 'Fin de mes',
    review: 'Revisá los avisos',
    closes: 'Cierres del día',
    purchases: 'Compras y gastos',
    money: 'La plata',
    papers: 'Los papeles del bar',
    noNotices: 'Sin avisos',
    uncounted: 'Hay cajas sin contar en',
    /** El paso 3. */
    send: 'Mandale los libros a tu contadora',
    sendWhen: 'Cuando el mes esté cerrado.',
    /** Sigue el mes: «Descargar el paquete de septiembre». */
    package: 'Descargar el paquete',
    message: 'Copiar el mensaje',
  },
  /** Ventas. */
  ventas: {
    cashCheck: 'Ventas contra caja',
  },
  /** El Resumen. */
  resumen: {
    fixedLeft: 'Te falta de gasto fijo',
  },
  /** El aviso que aparece al guardar. */
  aviso: {
    undo: 'Deshacer',
  },
  /** El botón «＋ Cargar» (el «＋» es un dibujo). */
  lanzador: {
    button: 'Cargar',
  },
} as const

export type ScreenKey = keyof typeof SCREEN_LABELS

/* Los textos de abajo citan estos rótulos por su clave: si una pantalla cambia un nombre, se
   cambia arriba y la guía entera lo sigue. */
const S = SCREEN_LABELS

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
  | { kind: 'expense-ticket'; paper: 'factura_a' | 'sin' }
  /**
   * La compra, en dos mitades (entera no entra en un celular): `paper` = a quién y qué papel;
   * `pay` = cuánto es, cuándo le pagás y el botón. `remito`: con «Remito o nada» elegido.
   */
  | { kind: 'purchase'; paper: 'factura' | 'remito'; part: 'paper' | 'pay' }
  /** `who`: «¿A quién le pagás?» · `what`: lo que le pagás y con qué. */
  | { kind: 'pay'; part: 'who' | 'what' }
  /** El cobro, en dos mitades: `amount` = cuánto entró y a dónde · `sales` = de qué ventas es. */
  | { kind: 'collect'; part: 'amount' | 'sales' }
  | { kind: 'count' }
  | { kind: 'import'; source: 'mercado_pago' | 'arca'; phase: 'upload' | 'review' }
  | { kind: 'undo' }
  | { kind: 'void' }
  | { kind: 'month-close' }
  /** La planilla de gastos fijos: `due` con «Pagar» en el renglón · `paid` con el casillero tildado. */
  | { kind: 'fixed'; state: 'due' | 'paid' }

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
        text: 'Revisá el ticket: tiene que dar lo mismo que tu cierre de caja. Tocá «Guardar cierre», que dice el día.',
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
          'El ticket del cierre con cada medio, el total vendido y cuánto fue con factura y sin factura. Debajo, el botón «Guardar cierre» con el día, marcado.',
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
        fix: `Cargá el primero. Después aparece «${S.cierre.otherShift}» para sumar el segundo.`,
      },
      {
        problem: 'Ya lo guardé y está mal',
        fix: 'El cierre no se edita. Abrilo, anulalo y cargalo de nuevo.',
      },
    ],
    result: 'El efectivo entra a la caja. Lo demás queda en camino hasta que te lo depositan.',
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
      { text: 'Elegí en qué se gastó y con qué caja pagaste.', screen: 1 },
      {
        text: 'Elegí qué papel te dieron: Factura A, Factura B o C, tique, o remito o nada.',
        screen: 1,
      },
      { text: `Sacale una foto al papel y tocá «${S.gasto.save}».`, screen: 2 },
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
        label: `Un ticket chico que dice de qué caja sale la plata, el proveedor, la categoría y el sello «${S.gasto.stampA}». Debajo, el botón «${S.gasto.save}» con el importe, marcado.`,
        scene: { kind: 'expense-ticket', paper: 'factura_a' },
      },
    ],
    checks: [
      'El ticket dice de qué caja sale la plata y cuánto.',
      'El sello dice «Con factura», «Con tique» o «Sin factura», según el papel.',
      'El saldo de esa caja bajó por ese importe.',
    ],
    troubles: [
      {
        problem: 'Siempre me pregunta en qué se gastó',
        fix: `Tildá «${S.gasto.remember}» ese proveedor. La próxima vez ya viene elegido.`,
      },
      {
        problem: 'Me avisa que ya lo cargué',
        fix: `Tocá «${S.gasto.duplicate}». Si es el mismo, no lo guardes dos veces.`,
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
        text: `Tocá «+ Cargar» y elegí «Me llegó una factura o un remito y lo pago después». Se abre «${S.compra.title}».`,
        screen: 0,
      },
      {
        text: `Elegí el proveedor. En «${S.compra.paper}» tocá el que tenés en la mano y escribí su número.`,
        screen: 1,
      },
      {
        text: `En «${S.compra.amount}» escribí el total, tal cual figura en el papel.`,
        screen: 2,
      },
      {
        text: `En «${S.compra.payWhen}» dejá «${S.compra.payLater}», elegí cuándo vence y tocá «${S.compra.save}».`,
        screen: 2,
      },
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
        title: `El proveedor y «${S.compra.paper}»`,
        label: `La pantalla «${S.compra.title}»: el proveedor elegido con lo que le debés hoy y, en «${S.compra.paper}», las cuatro tarjetas de papel con «Factura A» elegida y marcada. Debajo, el punto de venta y el número.`,
        scene: { kind: 'purchase', paper: 'factura', part: 'paper' },
      },
      {
        title: 'El total, cuándo le pagás y guardar',
        label: `La misma pantalla, más abajo: el total del papel; «${S.compra.payWhen}» con «${S.compra.payLater}» elegido, y cuándo vence. Al pie, el botón «${S.compra.save}» con el importe, marcado.`,
        scene: { kind: 'purchase', paper: 'factura', part: 'pay' },
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
        fix: `En «${S.compra.payWhen}» elegí «${S.compra.paidNow}» y con qué caja: el botón pasa a decir «${S.compra.saveAndPay}» y guarda la compra con su pago.`,
      },
      {
        problem: 'Es un gasto fijo, como el alquiler',
        fix: `Si ese proveedor tiene un gasto fijo de este mes, te pregunta «${S.compra.recurring}». Elegilo y el renglón queda cargado.`,
      },
      {
        problem: 'No es una factura, es un remito',
        fix: `En «${S.compra.paper}» tocá «${S.compra.paperNone}». La deuda queda igual y no entra al Libro IVA.`,
      },
      {
        problem: 'Es una nota de crédito',
        fix: `Al pie de «${S.compra.paper}», al lado de «${S.compra.notPurchase}», tocá «${S.compra.creditNote}».`,
      },
    ],
    result: 'La caja no se mueve. Queda la deuda con el proveedor, con su vencimiento.',
    // El botón dice lo mismo que el título de la pantalla que abre.
    action: {
      label: S.compra.title,
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
      {
        text: `¿Lo pagaste en el momento? Entrá por «Pagué algo recién» y en «${S.gasto.paper}» elegí «${S.gasto.paperNone}».`,
        screen: 0,
      },
      {
        text: `¿Lo pagás después? Entrá por «Me llegó una factura o un remito y lo pago después» y en «${S.compra.paper}» elegí «${S.compra.paperNone}».`,
        screen: 1,
      },
      {
        text: `Si el remito tiene número, anotalo en «${S.compra.remito}». Sacale una foto al papel.`,
        screen: 1,
      },
      {
        text: `Guardá. Si pagaste en el momento, el ticket lleva el sello «${S.gasto.stampNone}».`,
        screen: 2,
      },
    ],
    screens: [
      {
        title: `Si ya pagaste: «${S.gasto.paperNone}»`,
        label: `La hoja del gasto con los cuatro papeles para elegir. Está elegido y marcado «${S.gasto.paperNone}»; debajo, «${S.gasto.remito}».`,
        scene: { kind: 'expense', focus: 'paper', paper: 'sin' },
      },
      {
        title: `Si lo pagás después: también «${S.compra.paperNone}»`,
        label: `La pantalla «${S.compra.title}»: el proveedor elegido y, en «${S.compra.paper}», las cuatro tarjetas de papel con «${S.compra.paperNone}» elegida y marcada. Debajo, el número de remito.`,
        scene: { kind: 'purchase', paper: 'remito', part: 'paper' },
      },
      {
        title: 'El ticket con el sello',
        label: `Un ticket chico que dice de qué caja sale la plata y lleva el sello «${S.gasto.stampNone}». Debajo, el botón «${S.gasto.save}» con el importe, marcado.`,
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
        fix: `En su ficha tocá «${S.proveedor.edit}» y en «${S.proveedor.voucher}» elegí «${S.compra.typeNone}». Así ya viene elegido.`,
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
      {
        text: `En «${S.pagar.who}» tocá al proveedor en «${S.pagar.urgent}», o buscalo debajo.`,
        screen: 1,
      },
      {
        text: `En «${S.pagar.invoices}» tildá lo que le pagás. Lo vencido y lo de esta semana ya viene tildado.`,
        screen: 2,
      },
      { text: `En «${S.pagar.treasury}» elegí la caja y revisá el monto.`, screen: 2 },
      { text: 'Tocá «Pagar», que dice cuánto sale.', screen: 2 },
    ],
    screens: [
      {
        title: 'Elegí «Pago algo que debía»',
        label: 'El lanzador «¿Qué querés cargar?». Está marcada la opción «Pago algo que debía».',
        scene: { kind: 'launcher', pick: 'pagar' },
      },
      {
        title: 'A quién: lo más urgente, arriba',
        label: `La hoja «Pagar»: bajo «${S.pagar.who}», la lista «${S.pagar.urgent}» con los proveedores a los que les debés, marcada. En el margen de cada uno, hace cuánto venció o cuándo vence; a la derecha, cuánto le debés. Debajo, el buscador y «${S.pagar.notSupplier}».`,
        scene: { kind: 'pay', part: 'who' },
      },
      {
        title: 'Lo que le pagás y con qué',
        label: `El pago a un proveedor: bajo «${S.pagar.invoices}», tres compras con su vencimiento en el margen, dos tildadas; las cajas para elegir con qué se paga y el botón «Pagar» con el total, marcado.`,
        scene: { kind: 'pay', part: 'what' },
      },
    ],
    checks: [
      'La compra pasa a figurar pagada.',
      'Bajó lo que le debés a ese proveedor.',
      'Bajó el saldo de la caja con la que pagaste.',
    ],
    troubles: [
      {
        problem: 'Pagué solo una parte',
        fix: `Tildala, tocá «${S.pagar.partial}» y escribí cuánto. El resto queda pendiente.`,
      },
      {
        problem: 'Pagué de más o no tengo la factura',
        fix: 'Queda como saldo a favor con ese proveedor. Se descuenta solo en el próximo pago.',
      },
      {
        problem: 'Tildé la factura equivocada',
        fix: `Abrí el pago y tocá «${S.comprobante.separate}»: queda a favor con ese proveedor. Después pagá la correcta: el saldo a favor ya viene tildado.`,
      },
      {
        problem: 'Queda una diferencia de pocos pesos',
        fix: 'Si el resto es de hasta $ 1.000, lo podés dar por pagado ahí mismo.',
      },
      {
        problem: 'No es a un proveedor: es el alquiler o la luz',
        fix: `En «${S.pagar.notSupplier}» tocá «${S.pagar.fixed}» y elegilo de la lista. Mirá «Pago un gasto fijo».`,
      },
    ],
    result: 'Baja lo que debés y baja la caja de donde salió la plata.',
    action: { label: 'Pagar una deuda', target: { kind: 'sheet', sheet: 'pagar' } },
  },
  {
    id: 'gasto-fijo',
    title: 'Pago un gasto fijo',
    hint: 'El alquiler, la luz, internet',
    frequency: 'event',
    minutes: 2,
    steps: [
      {
        text: `En Gastos fijos, tocá «${S.gastosFijos.pay}» en el renglón. Se abre «Nuevo gasto» con ese gasto fijo ya elegido.`,
        screen: 0,
      },
      {
        text: 'Revisá el importe y con qué caja pagás. Si el gasto fijo tiene monto, ya viene puesto.',
        screen: 1,
      },
      { text: `Elegí qué papel te dieron y tocá «${S.gasto.save}».`, screen: 1 },
      {
        text: `En Gastos fijos, el casillero queda tildado y el renglón dice «${S.gastosFijos.paid}», con el día.`,
        screen: 2,
      },
    ],
    screens: [
      {
        title: `«${S.gastosFijos.pay}», en el renglón`,
        label: `La planilla de gastos fijos del mes: arriba, «${S.gastosFijos.pending}» con el importe. Debajo, un renglón por gasto, con el día en que vence en el margen, un casillero y el monto. El alquiler está vencido y tiene el botón «${S.gastosFijos.pay}», marcado. La heladera muestra sus cuotas en puntitos.`,
        scene: { kind: 'fixed', state: 'due' },
      },
      {
        title: 'El gasto, con el gasto fijo ya elegido',
        label: `La hoja «Nuevo gasto»: el importe ya viene puesto y, en «${S.gasto.target}», figura el alquiler con la marca de gasto fijo (marcado). Debajo, con qué caja se paga y los cuatro papeles.`,
        scene: { kind: 'expense', focus: 'category', paper: 'factura_bc' },
      },
      {
        title: 'El renglón queda tildado',
        label: `La misma planilla después de pagar: el casillero del alquiler está tildado y el renglón dice «${S.gastosFijos.paid}» con el día (marcado). «${S.gastosFijos.pending}» bajó.`,
        scene: { kind: 'fixed', state: 'paid' },
      },
    ],
    checks: [
      `En Gastos fijos, ese renglón quedó tildado y dice «${S.gastosFijos.paid}», con el día.`,
      'Su próximo vencimiento pasó al mes que viene.',
      `En el Resumen bajó «${S.resumen.fixedLeft}».`,
    ],
    troubles: [
      {
        problem: 'Me llegó la factura y la pago más adelante',
        fix: `En Gastos fijos, abrí el renglón y tocá «${S.gastosFijos.bill}». Queda como deuda hasta que la pagues.`,
        link: { label: 'Gastos fijos', path: '/gastos-fijos' },
      },
      {
        problem: 'Lo cargué sin elegir el gasto fijo',
        fix: 'Hoy no se puede vincular después. Anulá esa carga y hacela de nuevo desde el renglón del gasto fijo.',
      },
      {
        problem: 'Este mes no lo pago',
        fix: `En Gastos fijos, abrí el renglón y tocá «${S.gastosFijos.skip}». Si te arrepentís, ahí mismo está «${S.gastosFijos.unskip}».`,
      },
      {
        problem: 'Pagué otro monto',
        fix: `Si pagaste menos, el renglón te pregunta «${S.gastosFijos.ask}». Con «${S.gastosFijos.keep}» y el importe, ese pasa a ser el monto de siempre.`,
      },
      {
        problem: 'Tengo muchos sin monto ni día',
        fix: `Tocá «${S.gastosFijos.fill}»: los completás todos de corrido, sin abrir uno por uno.`,
      },
    ],
    result: 'Sale la plata de la caja y el gasto fijo queda pago este mes.',
    action: { label: 'Ir a Gastos fijos', target: { kind: 'route', path: '/gastos-fijos' } },
  },
  {
    id: 'cobro',
    title: 'Me entró plata de una tarjeta o una app',
    hint: 'Lo que te depositan después de vender',
    frequency: 'event',
    minutes: 3,
    launcher: 'cobrar',
    steps: [
      { text: 'Tocá «+ Cargar» y elegí «Me entró plata».', screen: 0 },
      { text: 'Elegí quién te pagó: la tarjeta, la app de delivery o el cliente.', screen: 1 },
      {
        text: `En «${S.cobrar.amount}» escribí lo que ves en el banco. Elegí a qué caja entró y qué día.`,
        screen: 1,
      },
      {
        text: 'Tildá de qué ventas es. Las que ya tenían que llegar vienen tildadas.',
        screen: 2,
      },
      {
        text: `Revisá en qué te lo descontaron (la comisión y los impuestos) y tocá «${S.cobrar.save}».`,
        screen: 2,
      },
    ],
    screens: [
      {
        title: 'Elegí «Me entró plata»',
        label: 'El lanzador «¿Qué querés cargar?». Está marcada la opción «Me entró plata».',
        scene: { kind: 'launcher', pick: 'cobrar' },
      },
      {
        title: 'Quién te pagó, cuánto entró y a dónde',
        label: `La hoja «Registrar un cobro», en tres pasos numerados. El primero dice quién te pagó y cuánto te debe. En el segundo, «${S.cobrar.step}», está escrito lo que entró (marcado), elegida la caja y puesto el día.`,
        scene: { kind: 'collect', part: 'amount' },
      },
      {
        title: 'De qué ventas es y qué te descontaron',
        label: `La misma hoja, en el tercer paso: bajo «${S.cobrar.pending}», dos días de ventas tildados (marcados). Debajo, cuánto te descontaron, con la marca «${S.cobrar.estimated}», y en qué. Al pie, el botón «${S.cobrar.save}» con lo que entró.`,
        scene: { kind: 'collect', part: 'sales' },
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
        fix: 'Es más fácil contar la caja de Mercado Pago: escribís lo que dice la app y lo que entró queda anotado solo. O subí el reporte.',
      },
      {
        problem: 'No aparece ninguna venta para tildar',
        fix: 'Falta el cierre de ese día. Cargalo primero: si guardás sin ventas, el cobro queda a cuenta.',
      },
      {
        problem: 'No sé cuánto fue la comisión',
        fix: 'Viene estimada con los porcentajes de Ajustes › Medios de cobro. Corregila con la liquidación, si la tenés.',
      },
      {
        problem: 'Me dice que faltan explicar unos pesos',
        fix: `Elegí «${S.cobrar.explainFee}», «${S.cobrar.explainOther}» o «${S.cobrar.explainUnknown}». Lo que no sepas queda aparte, a la vista de la contadora.`,
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
      {
        text: `Tocá «+ Cargar» y elegí «Conté la caja». Se abre la hoja «${S.ajustar.title}».`,
        screen: 0,
      },
      {
        text: `En «${S.ajustar.treasury}» tocá la que contaste y, en «${S.ajustar.counted}», escribí cuánto hay.`,
        screen: 1,
      },
      {
        text: `Si coincide, tocá «${S.ajustar.matches}». La caja queda como contada hoy.`,
        screen: 1,
      },
      {
        text: `Si no coincide, mirá cuánto falta o sobra y tocá «${S.ajustar.save}». El saldo queda como lo contaste.`,
        screen: 1,
      },
    ],
    screens: [
      {
        title: 'Elegí «Conté la caja»',
        label: 'El lanzador «¿Qué querés cargar?». Está marcada la opción «Conté la caja».',
        scene: { kind: 'launcher', pick: 'ajustar' },
      },
      {
        title: 'Lo que dice el sistema y lo que contaste',
        label: `La hoja «${S.ajustar.title}», en tres renglones: la caja que contaste, lo que dice el sistema y el campo para escribir cuánto hay de verdad (marcado). Debajo, el resultado en un recuadro ámbar: faltan mil quinientos pesos. Al pie, el botón «${S.ajustar.save}».`,
        scene: { kind: 'count' },
      },
    ],
    checks: [
      'El saldo de la caja es el que contaste.',
      'La diferencia quedó anotada como faltante o sobrante.',
      'La caja figura contada este mes.',
    ],
    troubles: [
      {
        problem: 'Es el banco y la diferencia son gastos del banco',
        fix: `Elegí «${S.ajustar.bankFees}»: te lleva a cargarlos, con la diferencia ya puesta como total.`,
      },
      {
        problem: 'No sé de dónde sale la diferencia',
        fix: 'En el banco y en Mercado Pago, lo que no se explica queda aparte para que lo revise la contadora.',
      },
      {
        problem: 'Solo quiero ver la diferencia de cada día',
        fix: `Eso es «${S.ventas.cashCheck}»: compara lo vendido con lo que entró y no cambia ningún saldo.`,
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
      {
        text: `En Importar, tocá «${S.importar.titleMercadoPago}» y soltá el archivo en «${S.importar.stepUpload}».`,
        screen: 0,
      },
      { text: 'Revisá lo que propone: un cobro por día y por medio, con su comisión.', screen: 1 },
      {
        text: 'Tocá el botón «Cargar», que dice cuántos movimientos son. Nada se carga solo: vos decidís qué entra.',
        screen: 1,
      },
    ],
    screens: [
      {
        title: 'Subí el archivo',
        label: `La pantalla «${S.importar.titleMercadoPago}», con sus tres pasos. El primero ya está hecho; en el segundo, «${S.importar.stepUpload}», hay una zona para soltar el reporte de Liquidaciones y el botón «${S.importar.choose}», marcado.`,
        scene: { kind: 'import', source: 'mercado_pago', phase: 'upload' },
      },
      {
        title: 'Revisá y confirmá',
        label: `La revisión del archivo: arriba, los tres movimientos que están listos para cargar, con una hojita por cada uno. Debajo, los tres cobros, uno por día y por medio, con su comisión y la marca «${S.importar.ready}». Al pie, el botón «Cargar 3 movimientos», marcado.`,
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
        fix: 'No se cargan dos veces. Pedí el reporte desde el día siguiente, o anulá lo que cargaste a mano.',
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
    result: 'Lo que te depositaron pasa de «en camino» a Mercado Pago, con su comisión separada.',
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
        text: `En Importar, tocá «${S.importar.titleArca}» y soltá el archivo en «${S.importar.stepUpload}», sin abrirlo con Excel.`,
        screen: 0,
      },
      {
        text: `Contestá lo que te pregunta. Lo que ya cargaste a mano dice «${S.importar.loaded}».`,
        screen: 1,
      },
      {
        text: 'Si avisa que ya cargaste uno igual, elegí «Es el mismo» o «Es otro».',
        screen: 1,
      },
      {
        text: 'Cuando no quede ninguna pregunta, tocá el botón «Cargar», que dice cuántos son.',
      },
    ],
    screens: [
      {
        title: 'Subí el archivo',
        label: `La pantalla «${S.importar.titleArca}», con sus tres pasos. El primero ya está hecho; en el segundo, «${S.importar.stepUpload}», hay una zona para soltar el ZIP que bajaste de ARCA y el botón «${S.importar.choose}», marcado.`,
        scene: { kind: 'import', source: 'arca', phase: 'upload' },
      },
      {
        title: `«${S.importar.sameOrOther}»`,
        label: `La revisión del archivo: arriba, cuántas preguntas te falta contestar y una hojita por comprobante. Debajo, la pregunta en la mano, «${S.importar.sameOrOther}», con dos respuestas: «${S.importar.same}», marcada, y «${S.importar.different}». Más abajo, una factura que dice «${S.importar.loaded}».`,
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
        fix: 'Sin la CUIT no se puede subir nada de ARCA.',
        link: { label: 'Ajustes › Datos de la SAS', path: '/ajustes?tab=sas' },
      },
      {
        problem: 'No reconoce algo que cargué a mano',
        fix: `Compara por la CUIT del proveedor. Agregala en su ficha antes de subir el archivo, o contestá «${S.importar.knownBefore}» en la revisión.`,
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
      {
        problem: 'Subí el archivo equivocado',
        fix: `En la revisión, abrí «${S.importar.moreOptions}» y tocá «${S.importar.discard}». Lo que ya se había cargado sigue registrado.`,
      },
    ],
    result: 'Las compras con factura del mes quedan cargadas, sin repetir las que ya estaban.',
    // El botón dice lo mismo que el título de la pantalla que abre.
    action: { label: S.importar.titleArca, target: { kind: 'route', path: '/importar/arca' } },
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
        text: `Bajá hasta «${S.comprobante.fix}» y tocá «${S.comprobante.void}». Escribí el motivo: queda anulado con tu nombre, no se borra.`,
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
        fix: `No se anula con su fecha. En «${S.comprobante.fix}» el comprobante te ofrece la salida: una nota de crédito, «${S.comprobante.voidToday}» o un ajuste de la contadora.`,
      },
      {
        problem: 'Tiene pagos aplicados',
        fix: 'Si lo anulás, esos pagos quedan como saldo a favor con el proveedor.',
      },
      {
        problem: 'Es una factura hecha con ARCA',
        fix: 'No se anula. Se corrige con una nota de crédito.',
      },
      {
        problem: 'Lo único mal es a qué factura fue el pago',
        fix: `No hace falta anular: en el comprobante tocá «${S.comprobante.separate}» y el pago queda a favor con ese proveedor.`,
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
        text: `Entrá a Libros › ${S.cierreMes.title}. En el paso 1, «${S.cierreMes.review}», cada aviso dice qué falta.`,
        screen: 0,
      },
      {
        text: 'En el paso 2, cerrá el mes con la contadora: el botón dice «Cerrar» y el mes. Después ya no cambia.',
        screen: 0,
      },
      {
        text: `En el paso 3, tocá «${S.cierreMes.package}» o «${S.cierreMes.message}» para mandárselo.`,
        screen: 0,
      },
    ],
    screens: [
      {
        title: 'Los tres pasos del fin de mes',
        label: `La pantalla «${S.cierreMes.title}»: arriba, los meses del año, con el que falta cerrar marcado. Debajo, tres pasos numerados. En el primero, «${S.cierreMes.review}», cuatro renglones: cierres del día, compras y gastos, la plata y los papeles del bar; uno tiene un aviso. Están marcados. Siguen «Cerrá septiembre», con su botón, y «${S.cierreMes.send}».`,
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
        fix: `El aviso los nombra, cada uno con su «${S.gastosFijos.pay}». Si alguno no va, abrí su renglón en Gastos fijos y tocá «${S.gastosFijos.skip}».`,
        link: { label: 'Gastos fijos', path: '/gastos-fijos' },
      },
      {
        problem: 'Cerré y hay que cambiar algo',
        fix: 'Un mes cerrado no se toca. Mirá «Me equivoqué y quiero corregir»; si no alcanza, la contadora te dice si hay que reabrirlo.',
      },
    ],
    result: 'El mes queda fijo y la contadora tiene todo para trabajar.',
    action: { label: 'Cerrar el mes', target: { kind: 'route', path: '/libros/cierres' } },
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
      'El efectivo entra a la caja. Las tarjetas, el QR y las apps quedan en camino hasta que te los depositan.',
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
    what: 'Elegís a quién le pagás y qué compras le cancelás.',
    moves: [
      { pocket: 'deuda', direction: 'down' },
      { pocket: 'cajas', direction: 'down' },
    ],
    movesText: 'Baja lo que debés y baja la caja de donde salió la plata.',
    recipe: 'pagar-deuda',
    action: { label: 'Pagar una deuda', target: { kind: 'sheet', sheet: 'pagar' } },
  },
  {
    id: 'controlar',
    n: 4,
    title: 'Controlás la plata',
    what: 'Contás cada caja y anotás lo que te depositaron Mercado Pago, las tarjetas y las apps.',
    moves: [
      { pocket: 'en_camino', direction: 'down' },
      { pocket: 'cajas', direction: 'up' },
    ],
    movesText:
      'Lo que te depositan pasa de «en camino» a tu cuenta. Si contás y no coincide, el saldo se corrige.',
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
    action: { label: 'Cerrar el mes', target: { kind: 'route', path: '/libros/cierres' } },
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
      // Sin los saldos iniciales no hay con qué comparar lo contado: primero se dice cuánto hay
      // en cada caja (es lo que pide el Resumen). Recién después contar es una rutina.
      if (!data.openingDone) {
        return { state: 'idle', text: 'Primero cargá lo que hay en cada caja' }
      }
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
          title: 'Anotar lo que depositaron las tarjetas y las apps',
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

/** Las partes de «Con factura y sin factura» a las que se llega con una duda (el `#` del link). */
export const PAPERS_ANCHOR = { papers: 'papeles', cases: 'casos', sales: 'ventas' } as const

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

/** Un camino de «Dónde lo cargo»: lo que se toca, en orden. */
export type PaperRoute = {
  /** Cuándo vale este camino («Si ya la pagaste»). Sin texto si es el único. */
  when?: string
  /** Cada paso es el rótulo real de lo que se toca. */
  steps: readonly string[]
}

const LAUNCH = '+ Cargar'
const PAID_NOW = 'Pagué algo recién'
const PAY_LATER = 'Me llegó una factura o un remito y lo pago después'
/** La pregunta de la compra y la tarjeta que se toca: «¿Qué papel te dieron? Factura A». */
const paperStep = (card: string) => `${S.compra.paper} ${card}`

export type PaperCase = {
  id: string
  /** La situación, en primera persona. */
  title: string
  /** El dibujo: uno de los cuatro papeles o la nota de crédito. */
  art: PaperId | 'nota_credito'
  /** «Dónde lo cargo»: uno o dos caminos (según si ya pagaste o lo pagás después). */
  where: readonly PaperRoute[]
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
    where: [{ steps: [LAUNCH, PAID_NOW, 'Remito o nada'] }],
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
    where: [{ steps: [LAUNCH, PAY_LATER, paperStep(S.compra.paperNone)] }],
    result: [
      'Queda la deuda con el proveedor, con su vencimiento.',
      'La caja baja recién cuando la pagás.',
      'No entra al Libro IVA.',
    ],
    action: {
      label: S.compra.title,
      target: { kind: 'route', path: '/compras/nueva' },
    },
    recipe: 'sin-factura',
  },
  {
    id: 'tique',
    title: 'Me dieron un tique',
    art: 'tique',
    where: [{ steps: [LAUNCH, PAID_NOW, 'Tique'] }],
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
    where: [
      { when: 'Si ya la pagaste', steps: [LAUNCH, PAID_NOW, 'Factura B o C'] },
      { when: 'Si la pagás después', steps: [LAUNCH, PAY_LATER, paperStep('Factura B o C')] },
    ],
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
    where: [
      { when: 'Si ya la pagaste', steps: [LAUNCH, PAID_NOW, 'Factura A'] },
      { when: 'Si la pagás después', steps: [LAUNCH, PAY_LATER, paperStep('Factura A')] },
    ],
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
    where: [{ steps: [LAUNCH, PAY_LATER, `${S.compra.notPurchase} ${S.compra.creditNote}`] }],
    result: [
      'Es el papel que descuenta o anula una factura.',
      'Si elegís qué compra corrige, se descuenta sola de esa.',
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
    what: 'Le decís una vez en qué le comprás a ese proveedor. Desde ahí, cada compra suya ya viene con esa categoría.',
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
    what: 'Es decir que esta plata que salió es para pagar esta compra.',
    where: `En «Pago algo que debía», tildándola en «${S.pagar.invoices}». O al cargar la compra, eligiendo «${S.compra.paidNow}» en «${S.compra.payWhen}». Si pagaste en el momento con «Pagué algo recién», queda unido solo.`,
    ifNot:
      'La compra sigue figurando como deuda. La plata que salió queda como saldo a favor con ese proveedor.',
    undo: `Tocá «${S.comprobante.separate}» en el comprobante: el pago queda a favor con ese proveedor y la compra vuelve a deber. Si se guardaron juntos, se anulan los dos.`,
    limit: null,
    recipe: 'pagar-deuda',
  },
  {
    id: 'saldo-factura',
    ends: ['Saldo a favor', 'Una factura'],
    how: 'auto',
    when: 'en el próximo pago',
    what: 'Es usar plata que ya le diste a un proveedor (un pago de más o una nota de crédito) contra una factura que le debés.',
    where: `Se usa solo en el próximo pago: viene tildado, en «${S.pagar.credit}». Si no querés esperar, en la ficha del proveedor está «${S.proveedor.applyCredit}».`,
    ifNot: 'El proveedor muestra a la vez una deuda y un saldo a favor.',
    undo: `Con «Deshacer», apenas lo usás. Después, con «${S.comprobante.separate}» en el comprobante.`,
    limit: `Del lado de la plata por cobrar todavía no existe «${S.proveedor.applyCredit}» ni «${S.comprobante.separate}».`,
    recipe: 'pagar-deuda',
  },
  {
    id: 'nota-factura',
    ends: ['Nota de crédito', 'La factura que corrige'],
    how: 'you',
    when: 'al cargarla',
    what: 'La nota de crédito es el papel que descuenta o anula una factura. Unirla es decir cuál corrige.',
    where: `Al cargarla, en «${S.compra.corrects}». Es opcional. Al subir las compras de ARCA te lo pregunta también.`,
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
    where: `Desde Gastos fijos, con «${S.gastosFijos.pay}» en ese renglón. O al cargar un gasto, eligiéndolo en «${S.gasto.target}». Si la factura la pagás después, abrí el renglón y tocá «${S.gastosFijos.bill}».`,
    ifNot:
      'El gasto queda en tus números, pero el renglón sigue figurando sin pagar y sigue avisando. El comprobante te pregunta si era ese gasto fijo.',
    undo: `Anulá el gasto. En Gastos fijos aparece un aviso con «${S.gastosFijos.restore}», para que el renglón vuelva a su mes.`,
    limit: `Hoy no se puede vincular después. Si lo cargaste sin elegir el gasto fijo, anulalo y cargalo de nuevo, o abrí su renglón y tocá «${S.gastosFijos.skip}».`,
    recipe: 'gasto-fijo',
  },
  {
    id: 'foto',
    ends: ['Comprobante', 'Su foto'],
    how: 'you',
    when: 'cuando quieras',
    what: 'Es la foto o el PDF del papel, guardado junto a lo que cargaste.',
    where:
      'Al cargar un gasto o una compra. O después, abriendo el comprobante, también con el mes cerrado: ahí mismo avisa cuando le falta. Hasta 5 archivos.',
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
    what: 'El cierre reparte solo cada medio de cobro. El efectivo entra a la caja. Lo demás queda en camino hasta que te lo depositan.',
    where: `A dónde va cada medio se define una vez, en Ajustes › Medios de cobro. Lo que te depositan se anota con «Me entró plata», con «${S.comprobante.arrived}» en el comprobante del cierre, o subiendo el reporte de Mercado Pago.`,
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
    where: `Lo hace sola al revisar el archivo. Con el mismo proveedor, tipo y número dice «${S.importar.loaded}». Con el mismo proveedor y el mismo total, te pregunta «${S.importar.sameOrOther}».`,
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
