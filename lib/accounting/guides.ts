/**
 * «Cómo se usa Administración»: el contenido de la guía, en datos.
 *
 * - DÓNDE ESTÁ CADA COSA: las seis secciones del menú, el engranaje y «+ Cargar».
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
 * Los títulos de las hojas y las opciones de «+ Cargar» no están acá: salen de `ACTION_TITLES` y
 * `LAUNCHER_ITEMS`, que ya son la fuente de las pantallas.
 */
export const SCREEN_LABELS = {
  /** El cierre del día (`ventas/cierre`). */
  cierre: {
    counted: 'Efectivo contado',
    withInvoice: 'Con factura',
    withoutInvoice: 'Sin factura',
    total: 'Total vendido',
    /** Sigue el importe: «Cargar cierre · $ 1.450.000». */
    save: 'Cargar cierre',
  },
  /** Compra y Compra y pago (`compras/nueva`). */
  compra: {
    who: 'Proveedor',
    paperNone: 'Remito',
    number: 'Punto de venta y número',
    remito: 'N.º de remito',
    due: 'Vence',
    owe: 'La debo',
    paid: 'Ya la pagué',
    from: 'Salió de',
    entry: 'Ver el asiento',
    notPurchase: '¿No es una compra?',
    creditNote: 'Es una nota de crédito',
    /** Sigue el importe: «Cargar compra · $ 84.000». */
    save: 'Cargar compra',
    savePaid: 'Cargar compra y pago',
  },
  /** El panel de la foto, al lado de la carga. */
  foto: {
    scan: 'Escanealo y sacale la foto',
    drop: 'O arrastrá la foto o el PDF acá.',
  },
  /** La hoja «Pagar»: primero a quién, después qué y con qué. */
  pagar: {
    who: '¿A quién le pagás?',
    urgent: 'Lo más urgente',
    notSupplier: '¿No es a un proveedor?',
    fixed: 'Un gasto fijo',
    invoices: '¿Qué le pagás?',
    from: 'Salió de',
    partial: 'Pagar solo una parte',
  },
  /** La hoja «Registrar un cobro». */
  cobrar: {
    amount: '¿Cuánto te entró?',
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
    void: 'Anular',
    voidToday: 'Anular con fecha de hoy',
    voidNote: 'Queda anulado con tu nombre y el motivo (no se borra) y deja de contar en los',
    cancel: 'Cancelar',
    separate: 'Separar',
  },
  /** Gastos fijos: la planilla del mes. */
  gastosFijos: {
    add: 'Agregar gasto fijo',
    from: 'Salió de',
    /** Sigue el importe: «Cargar pago · $ 850.000». */
    save: 'Cargar pago',
    bill: 'Me llegó la factura y la pago después',
    skip: 'Este mes no se paga',
  },
  /** Sueldos: la planilla del mes. */
  sueldos: {
    add: 'Agregar empleado',
    advance: 'Adelanto',
    pay: 'Pagar',
    /** Sigue el mes: «Devengar noviembre». */
    accrue: 'Devengar',
    leave: 'Dar de baja',
  },
  /** El Plan de la semana. */
  semana: {
    budget: 'Presupuesto',
    bring: 'Traer lo vencido',
    copy: 'Copiar la semana pasada',
    month: 'Ver el mes',
  },
  /** Caja: cuánto hay en cada cuenta. */
  caja: {
    in: 'Entró plata',
    out: 'Salió plata',
    add: 'Agregar cuenta',
    transfer: 'Transferir a otra cuenta',
  },
  /** El cierre de mes (`libros/cierres`). */
  cierreMes: {
    title: 'Cierre de mes',
    download: 'Descargar los libros',
  },
  /** Lo de la contadora: reimputar y el asiento manual. */
  contabilidad: {
    reimpute: 'Reimputar',
    model: 'Modelo',
    save: 'Grabar asiento',
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

/** Las opciones del menú «¿Qué cargás?» (las claves de `LAUNCHER_ITEMS`). */
export type GuideLauncherKey =
  | 'compra'
  | 'compra-y-pago'
  | 'pago'
  | 'cierre'
  | 'sueldo'
  | 'cobrar'
  | 'movimiento'
  | 'banco'
  | 'ajustar'

export type PaperId = 'factura_a' | 'factura_bc' | 'tique' | 'sin'

/**
 * Qué dibuja cada pantalla simulada (las arma `guias/uso/mock-scenes.tsx`). Son pocas a propósito:
 * el menú y lo que no cambia. Lo demás se cuenta con palabras: dibujar cada pantalla obligaba a
 * cambiar dos veces cada cosa.
 */
export type GuideScene =
  | { kind: 'launcher'; pick: GuideLauncherKey }
  | { kind: 'count' }
  | { kind: 'import'; source: 'mercado_pago' | 'arca'; phase: 'upload' | 'review' }
  | { kind: 'undo' }
  | { kind: 'void' }

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
  'compra',
  'gasto',
  'sin-factura',
  'pagar-deuda',
  'plan-semana',
  'gasto-fijo',
  'sueldos',
  'cobro',
  'contar-caja',
  'mercado-pago',
  'banco',
  'arca',
  'impuestos',
  'corregir',
  'reimputar',
  'asiento',
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
  /** El ejemplo en gris. */
  hint: string
  /** Dónde se hace, con el nombre que tiene en el menú: «+ Cargar › Compra». */
  where: string
  frequency: RecipeFrequency
  minutes: number | null
  /** La opción de «+ Cargar» por la que se entra (el paso que la nombra la cita igual). */
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
    where: '+ Cargar › Cierre del día',
    frequency: 'daily',
    minutes: 5,
    launcher: 'cierre',
    routine: 'daily_close',
    steps: [
      {
        text: 'Tené a mano el cierre de caja de tu sistema de ventas, con el total de cada medio.',
      },
      {
        text: 'Tocá «+ Cargar» y elegí «Cierre del día». Se abre en el primer día que te falta.',
        screen: 0,
      },
      {
        text: 'Escribí cuánto se cobró con cada medio, o pegá la columna entera en el primero.',
      },
      {
        text: `Si contaste el efectivo, anotalo en «${S.cierre.counted}». Si facturaste, cargá cuánto fue en «${S.cierre.withInvoice}».`,
      },
      {
        text: `Revisá que «${S.cierre.total}» dé lo mismo que tu cierre de caja y tocá «${S.cierre.save}».`,
      },
    ],
    screens: [
      {
        title: 'Elegí «Cierre del día»',
        label: 'El menú «¿Qué cargás?» con «Cierre del día» marcado.',
        scene: { kind: 'launcher', pick: 'cierre' },
      },
    ],
    checks: [
      'El total es igual al de tu cierre de caja.',
      'En Ventas, ese día figura con lo vendido.',
      'Ingresos Brutos y Comercio e Industria salieron solos, con los porcentajes de Ajustes › Impuestos.',
    ],
    troubles: [
      {
        problem: 'No me aparece ningún medio de cobro',
        fix: 'Se cargan una sola vez. Ahí también se define a qué cuenta va cada uno.',
        link: { label: 'Ajustes › Medios de cobro', path: '/ajustes?tab=medios' },
      },
      {
        problem: 'Hubo dos turnos',
        fix: 'Cargá el primero. Después podés sumar el segundo para el mismo día.',
      },
      {
        problem: 'Ya lo guardé y está mal',
        fix: 'El cierre no se edita. Abrilo, anulalo y cargalo de nuevo.',
      },
    ],
    result: 'El efectivo entra a la caja. Lo demás queda por cobrar hasta que te lo depositan.',
    action: { label: 'Cargar el cierre', target: { kind: 'route', path: '/ventas/cierre' } },
  },
  {
    id: 'compra',
    title: 'Me llegó una factura que pago después',
    hint: 'Queda como deuda con el proveedor',
    where: '+ Cargar › Compra',
    frequency: 'daily',
    minutes: 3,
    launcher: 'compra',
    steps: [
      { text: 'Tocá «+ Cargar» y elegí «Compra».', screen: 0 },
      {
        text: `Donde dice «${S.foto.scan}», escaneá el QR con el celular, o arrastrá la foto. Si es factura electrónica, se completa sola.`,
      },
      {
        text: `Elegí el «${S.compra.who}»: la cuenta sale sola. Marcá el papel: A, B, C, tique o remito.`,
      },
      { text: `Completá lo que falte: «${S.compra.number}» solo se pide en una factura.` },
      { text: `Dejá «${S.compra.owe}», revisá «${S.compra.due}» y tocá «${S.compra.save}».` },
    ],
    screens: [
      {
        title: 'Elegí «Compra»',
        label: 'El menú «¿Qué cargás?» con «Compra» marcada, la primera de la lista.',
        scene: { kind: 'launcher', pick: 'compra' },
      },
    ],
    checks: [
      'En Compras y pagos › Proveedores, ese proveedor muestra lo que le debés.',
      'La compra figura sin pagar, con su vencimiento.',
      'En Comprobantes tiene su foto.',
    ],
    troubles: [
      {
        problem: 'La pagué en el momento',
        fix: `Elegí «${S.compra.paid}», o entrá por «Compra y pago»: guarda la compra junto con su pago.`,
      },
      {
        problem: 'Es una nota de crédito o de débito',
        fix: `Abajo, en «${S.compra.notPurchase}», elegí «${S.compra.creditNote}» o la de débito.`,
        link: { label: 'Cargar una nota de crédito', path: '/compras/nueva?tipo=nc' },
      },
      {
        problem: 'Me avisa que ya la cargué',
        fix: 'Mirá la que ya está. Si es la misma, no la cargues dos veces.',
      },
    ],
    result: 'La caja no se mueve. Queda la deuda con el proveedor, con su vencimiento.',
    action: { label: 'Cargar una compra', target: { kind: 'route', path: '/compras/nueva' } },
  },
  {
    id: 'gasto',
    title: 'Compré y pagué en el momento',
    hint: 'El hielo, la verdulería, un flete',
    where: '+ Cargar › Compra y pago',
    frequency: 'daily',
    minutes: 2,
    launcher: 'compra-y-pago',
    steps: [
      { text: 'Tocá «+ Cargar» y elegí «Compra y pago».', screen: 0 },
      { text: `Sumá la foto, con el QR o arrastrándola. Elegí el «${S.compra.who}» y el papel.` },
      { text: 'Escribí el total, con el IVA incluido, tal cual dice el papel.' },
      {
        text: `En «${S.compra.from}» elegí la cuenta. Con banco o billetera, el impuesto al cheque se anota solo.`,
      },
      { text: `Tocá «${S.compra.savePaid}»: la compra y su pago quedan juntos.` },
    ],
    screens: [
      {
        title: 'Elegí «Compra y pago»',
        label: 'El menú «¿Qué cargás?» con «Compra y pago» marcada.',
        scene: { kind: 'launcher', pick: 'compra-y-pago' },
      },
    ],
    checks: [
      'El saldo de esa cuenta bajó por ese importe.',
      'En Comprobantes figura con la marca de su papel.',
      'Con el proveedor no quedó deuda.',
    ],
    troubles: [
      {
        problem: 'Siempre me pregunta en qué se gastó',
        fix: 'La categoría sale del proveedor: en su ficha elegí en qué le comprás y ya viene puesta.',
        link: { label: 'Compras y pagos › Proveedores', path: '/compras' },
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
    result: 'Sale la plata de la cuenta y el gasto queda en su categoría, con su papel.',
    action: {
      label: 'Cargar compra y pago',
      target: { kind: 'route', path: '/compras/nueva?modo=pago' },
    },
  },
  {
    id: 'sin-factura',
    title: 'Compré sin factura',
    hint: 'Con un remito o sin ningún papel',
    where: '+ Cargar › Compra o Compra y pago',
    frequency: 'event',
    minutes: 2,
    steps: [
      {
        text: '¿Lo pagaste en el momento? Entrá por «Compra y pago». ¿Lo pagás después? Por «Compra».',
      },
      { text: `Como papel marcá «${S.compra.paperNone}», aunque no te hayan dado ninguno.` },
      { text: `Si tiene número, anotalo en «${S.compra.remito}». No pide punto de venta.` },
      { text: 'Sacale una foto al papel, si hay, y guardá.' },
    ],
    screens: [],
    checks: [
      'En Compras y pagos › Comprobantes aparece con la marca «Sin factura».',
      'Queda en tus números igual que cualquier otra compra.',
      'No entra al Libro IVA.',
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
        fix: 'Decilo en su ficha y ya viene elegido.',
        link: { label: 'Compras y pagos › Proveedores', path: '/compras' },
      },
    ],
    result: 'Queda registrado como cualquier compra. No entra al Libro IVA.',
    action: {
      label: 'Cargar compra y pago',
      target: { kind: 'route', path: '/compras/nueva?modo=pago' },
    },
  },
  {
    id: 'pagar-deuda',
    title: 'Pago una deuda',
    hint: 'A un proveedor al que le debés',
    where: '+ Cargar › Pago',
    frequency: 'event',
    minutes: 1,
    launcher: 'pago',
    steps: [
      { text: 'Tocá «+ Cargar» y elegí «Pago».', screen: 0 },
      { text: `En «${S.pagar.who}» tocá al proveedor en «${S.pagar.urgent}», o buscalo debajo.` },
      { text: `En «${S.pagar.invoices}» tildá lo que le pagás. Lo vencido ya viene tildado.` },
      { text: `En «${S.pagar.from}» elegí la cuenta y revisá el importe.` },
      { text: 'Guardá. Con banco o billetera, el impuesto al cheque se anota solo.' },
    ],
    screens: [
      {
        title: 'Elegí «Pago»',
        label: 'El menú «¿Qué cargás?» con «Pago» marcado.',
        scene: { kind: 'launcher', pick: 'pago' },
      },
    ],
    checks: [
      'La compra pasa a figurar pagada.',
      'Bajó lo que le debés a ese proveedor.',
      'Bajó el saldo de la cuenta con la que pagaste.',
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
        fix: `Abrí el pago y tocá «${S.comprobante.separate}»: queda a favor con ese proveedor. Después pagá la correcta.`,
      },
      {
        problem: 'No es a un proveedor: es el alquiler o la luz',
        fix: `En «${S.pagar.notSupplier}» tocá «${S.pagar.fixed}» y elegilo de la lista.`,
      },
    ],
    result: 'Baja lo que debés y baja la cuenta de donde salió la plata.',
    action: { label: 'Cargar un pago', target: { kind: 'sheet', sheet: 'pagar' } },
  },
  {
    id: 'plan-semana',
    title: 'Armo los pagos de la semana',
    hint: 'Cuánto le voy a pagar a cada proveedor',
    where: 'Compras y pagos › Plan de la semana',
    frequency: 'weekly',
    minutes: 10,
    steps: [
      { text: 'Entrá a Compras y pagos › Plan de la semana.' },
      {
        text: `En cada proveedor escribí en «${S.semana.budget}» cuánto le vas a pagar. Se guarda solo.`,
      },
      { text: `Podés «${S.semana.bring}» o «${S.semana.copy}», y después corregir.` },
      { text: 'A medida que cargás los pagos, se va viendo lo pagado y lo que falta.' },
    ],
    screens: [],
    checks: [
      'Arriba, el presupuesto, lo pagado y lo que falta dan lo mismo que la suma de la tabla.',
      'Cada pago de la semana aparece en su proveedor.',
    ],
    troubles: [
      {
        problem: 'Le pagué más de lo que había puesto',
        fix: 'La tabla te avisa cuánto te pasaste. El pago queda igual.',
      },
      {
        problem: '¿Y todo el mes junto?',
        fix: `Tocá «${S.semana.month}»: las semanas una al lado de la otra.`,
      },
      {
        problem: 'Es un presupuesto: ¿mueve plata?',
        fix: 'No. Solo los pagos mueven plata; esta tabla es tu plan.',
      },
    ],
    result: 'Sabés cuánto tenés pensado pagar y cuánto falta, proveedor por proveedor.',
    action: {
      label: 'Ir al Plan de la semana',
      target: { kind: 'route', path: '/compras/semana' },
    },
  },
  {
    id: 'gasto-fijo',
    title: 'Pago un gasto fijo',
    hint: 'El alquiler, la luz, internet',
    where: 'Gastos y sueldos › Gastos fijos',
    frequency: 'event',
    minutes: 2,
    steps: [
      { text: 'Entrá a Gastos y sueldos › Gastos fijos y buscá el renglón.' },
      { text: `Tildalo: se abre para elegir «${S.gastosFijos.from}» y qué papel te dieron.` },
      { text: 'Si tenés el comprobante, sumá la foto. También con el QR.' },
      { text: `Tocá «${S.gastosFijos.save}»: el renglón queda pagado y arriba baja lo que falta.` },
    ],
    screens: [],
    checks: [
      'El renglón quedó tildado, con la marca de pagado.',
      'Arriba, el total pagado subió y lo que falta bajó.',
      'Bajó el saldo de la cuenta con la que pagaste.',
    ],
    troubles: [
      {
        problem: 'Me llegó la factura y la pago más adelante',
        fix: `En su renglón, tocá «${S.gastosFijos.bill}». Queda como deuda hasta que la pagues.`,
        link: { label: 'Gastos fijos', path: '/gastos-fijos' },
      },
      {
        problem: 'Este mes no lo pago',
        fix: `En su renglón, tocá «${S.gastosFijos.skip}». Después lo podés volver a dejar pendiente.`,
      },
      {
        problem: 'Pagué otro monto',
        fix: 'Escribí el monto del mes en la celda del renglón.',
      },
    ],
    result: 'Sale la plata de la cuenta y el gasto fijo queda pago este mes.',
    action: { label: 'Ir a Gastos fijos', target: { kind: 'route', path: '/gastos-fijos' } },
  },
  {
    id: 'sueldos',
    title: 'Pago un sueldo o un adelanto',
    hint: 'Cuánto le debo a cada empleado',
    where: 'Gastos y sueldos › Sueldos',
    frequency: 'event',
    minutes: 2,
    launcher: 'sueldo',
    steps: [
      {
        text: 'Tocá «+ Cargar» y elegí «Adelanto o sueldo», o entrá a Gastos y sueldos › Sueldos.',
        screen: 0,
      },
      { text: `La primera vez, tocá «${S.sueldos.add}» y cargale su sueldo.` },
      {
        text: `En su renglón tocá «${S.sueldos.advance}» o «${S.sueldos.pay}» y elegí de qué cuenta salió.`,
      },
      { text: 'El saldo dice cuánto le debés a fin de mes: el sueldo menos lo que ya le pagaste.' },
      { text: `A fin de mes, tocá «${S.sueldos.accrue}»: el sueldo del mes queda en los libros.` },
    ],
    screens: [
      {
        title: 'Elegí «Adelanto o sueldo»',
        label: 'El menú «¿Qué cargás?» con «Adelanto o sueldo» marcado, entre las de cada tanto.',
        scene: { kind: 'launcher', pick: 'sueldo' },
      },
    ],
    checks: [
      'El saldo de ese empleado bajó por lo que le pagaste.',
      'Bajó el saldo de la cuenta de donde salió.',
      'En Gastos fijos, los sueldos suman en el total del mes.',
    ],
    troubles: [
      {
        problem: 'Le cambió el sueldo',
        fix: 'Escribilo en la celda de su renglón: vale desde ese mes.',
      },
      {
        problem: 'Se fue del bar',
        fix: `Abrí su renglón y tocá «${S.sueldos.leave}». Lo que ya le pagaste queda registrado.`,
      },
      {
        problem: '¿Y los recibos y las cargas sociales?',
        fix: 'Los sigue llevando la contadora.',
      },
    ],
    result: 'Queda cada pago en los libros y el saldo de cada empleado al día.',
    action: { label: 'Ir a Sueldos', target: { kind: 'route', path: '/sueldos' } },
  },
  {
    id: 'cobro',
    title: 'Entró plata de una tarjeta o una app',
    hint: 'Lo que te depositan después de vender',
    where: '+ Cargar › Entró plata',
    frequency: 'event',
    minutes: 3,
    launcher: 'cobrar',
    steps: [
      { text: 'Tocá «+ Cargar» y elegí «Entró plata».', screen: 0 },
      { text: 'Elegí quién te pagó: la tarjeta, la app de delivery o el cliente.' },
      {
        text: `En «${S.cobrar.amount}» escribí lo que ves en el banco. Elegí a qué cuenta entró y qué día.`,
      },
      { text: 'Tildá de qué ventas es. Las que ya tenían que llegar vienen tildadas.' },
      {
        text: `Revisá en qué te lo descontaron (la comisión y los impuestos) y tocá «${S.cobrar.save}».`,
      },
    ],
    screens: [
      {
        title: 'Elegí «Entró plata»',
        label: 'El menú «¿Qué cargás?» con «Entró plata» marcado, entre las de cada tanto.',
        scene: { kind: 'launcher', pick: 'cobrar' },
      },
    ],
    checks: [
      'En Ventas › Por cobrar bajó lo que te tenían que depositar.',
      'Subió la cuenta donde entró la plata.',
      'La diferencia quedó anotada como comisión y descuentos.',
    ],
    troubles: [
      {
        problem: 'Es de Mercado Pago',
        fix: 'Es más fácil subir el reporte de «Liquidaciones»: separa la comisión y los impuestos solo.',
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
    result: 'Lo que estaba por cobrar pasa a la cuenta, menos los descuentos.',
    action: { label: 'Anotar lo que entró', target: { kind: 'sheet', sheet: 'cobrar' } },
  },
  {
    id: 'contar-caja',
    title: 'Conté la caja y no da',
    hint: 'Para que el sistema diga lo que hay de verdad',
    where: '+ Cargar › Contar la caja',
    frequency: 'event',
    minutes: 2,
    launcher: 'ajustar',
    routine: 'treasury_check',
    steps: [
      {
        text: `Tocá «+ Cargar» y elegí «Contar la caja». Se abre la hoja «${S.ajustar.title}».`,
        screen: 0,
      },
      {
        text: `En «${S.ajustar.treasury}» tocá la que contaste y, en «${S.ajustar.counted}», escribí cuánto hay.`,
        screen: 1,
      },
      {
        text: `Si coincide, tocá «${S.ajustar.matches}». La cuenta queda como contada hoy.`,
        screen: 1,
      },
      {
        text: `Si no coincide, mirá cuánto falta o sobra y tocá «${S.ajustar.save}». El saldo queda como lo contaste.`,
        screen: 1,
      },
    ],
    screens: [
      {
        title: 'Elegí «Contar la caja»',
        label: 'El menú «¿Qué cargás?» con «Contar la caja» marcado, entre las de cada tanto.',
        scene: { kind: 'launcher', pick: 'ajustar' },
      },
      {
        title: 'Lo que dice el sistema y lo que contaste',
        label: `La hoja «${S.ajustar.title}», en tres renglones: la caja que contaste, lo que dice el sistema y el campo para escribir cuánto hay de verdad (marcado). Debajo, el resultado en un recuadro ámbar: faltan mil quinientos pesos. Al pie, el botón «${S.ajustar.save}».`,
        scene: { kind: 'count' },
      },
    ],
    checks: [
      'El saldo de la cuenta es el que contaste.',
      'La diferencia quedó anotada como faltante o sobrante.',
      'La cuenta figura contada este mes.',
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
    where: 'Arrastrá el archivo a cualquier pantalla',
    frequency: 'weekly',
    minutes: 10,
    routine: 'mp_weekly',
    howTo: 'mercado_pago',
    steps: [
      {
        text: 'Bajá de Mercado Pago el reporte de «Liquidaciones», desde la compu. El de Cobros no sirve: no trae los descuentos.',
      },
      { text: 'Arrastralo a cualquier pantalla de Administración: se reconoce solo.', screen: 0 },
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
      'En Ventas › Por cobrar bajó lo de Mercado Pago.',
      'El saldo de Mercado Pago se parece al de la app.',
      'Cada cobro tiene su comisión aparte.',
    ],
    troubles: [
      {
        problem: 'Dice que ese es el reporte de Cobros',
        fix: 'Ese no trae lo que te descontaron. Bajá «Liquidaciones»: en la pantalla te muestra cómo.',
      },
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
    ],
    result: 'Lo que te depositaron pasa de por cobrar a Mercado Pago, con su comisión separada.',
    action: {
      label: 'Subir el reporte',
      target: { kind: 'route', path: '/importar/mercado-pago' },
    },
  },
  {
    id: 'banco',
    title: 'Subo los movimientos del banco',
    hint: 'Una vez por semana, del home banking',
    where: 'Arrastrá el archivo a cualquier pantalla',
    frequency: 'weekly',
    minutes: 10,
    routine: 'bank_weekly',
    howTo: 'banco',
    steps: [
      { text: 'En el home banking de la empresa, exportá los movimientos en CSV, TXT o Excel.' },
      { text: 'Arrastralos a cualquier pantalla. La primera vez decinos qué es cada columna.' },
      {
        text: 'Revisá lo que propone: el impuesto al cheque, las comisiones, el IVA y el SIRCREB se reconocen solos.',
      },
      {
        text: 'Lo que el sistema ya anotó al pagar dice «Ya está cargado»: no se cuenta dos veces.',
      },
    ],
    screens: [],
    checks: [
      'El saldo del banco se parece al del home banking.',
      'Cada día tiene sus gastos del banco juntos.',
      'El impuesto al cheque no quedó dos veces.',
    ],
    troubles: [
      {
        problem: 'No reconoce el archivo',
        fix: 'Si es del banco, te pregunta qué es cada columna y se acuerda para la próxima.',
      },
      {
        problem: 'Un gasto no lo reconoció',
        fix: 'Decile qué es en la revisión y enseñáselo: la próxima vez lo reconoce solo.',
      },
    ],
    result: 'Los gastos del banco quedan cargados, sin repetir lo que ya estaba.',
    action: { label: 'Subir los movimientos', target: { kind: 'route', path: '/importar/banco' } },
  },
  {
    id: 'arca',
    title: 'Bajo las compras de ARCA',
    hint: 'Una vez por mes, del 11 en adelante',
    where: 'Arrastrá el archivo a cualquier pantalla',
    frequency: 'monthly',
    minutes: 15,
    routine: 'arca_monthly',
    howTo: 'mis_comprobantes',
    steps: [
      {
        text: 'Del día 11 en adelante, bajá de ARCA «Mis Comprobantes» › «Recibidos» del mes pasado.',
      },
      { text: 'Arrastrá el ZIP a cualquier pantalla, sin abrirlo con Excel.', screen: 0 },
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
        link: { label: 'Compras y pagos › Proveedores', path: '/compras' },
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
    id: 'impuestos',
    title: 'Quiero cambiar un impuesto',
    hint: 'Ingresos Brutos, Comercio e Industria, débitos y créditos',
    where: 'Ajustes › Impuestos',
    frequency: 'event',
    minutes: 2,
    steps: [
      { text: 'Tocá el engranaje y entrá a Ajustes › Impuestos.' },
      { text: 'Cambiá el porcentaje en su celda. Elegí sobre qué se calcula cada uno.' },
      {
        text: 'Ingresos Brutos y Comercio e Industria se calculan en cada cierre. Débitos y créditos, al pagar con banco o billetera.',
      },
    ],
    screens: [],
    checks: [
      'El próximo cierre del día los calcula con el porcentaje nuevo.',
      'Lo que ya estaba cargado no cambia.',
    ],
    troubles: [
      {
        problem: 'Esta cuenta no cobra el impuesto al cheque',
        fix: 'Se elige por cuenta, en el menú «⋯» de cada una, en Caja. Bancos y billeteras lo cobran; el efectivo, no.',
        link: { label: 'Caja', path: '/cajas' },
      },
    ],
    result: 'Lo que cargues desde ahora se calcula con esos porcentajes.',
    action: { label: 'Ir a Impuestos', target: { kind: 'route', path: '/ajustes?tab=impuestos' } },
  },
  {
    id: 'corregir',
    title: 'Me equivoqué y quiero corregir',
    hint: 'Deshacer, anular o corregir un mes cerrado',
    where: 'Compras y pagos › Comprobantes',
    frequency: 'event',
    minutes: 2,
    steps: [
      {
        text: 'Si recién guardaste, tocá «Deshacer» en el aviso de abajo. Dura unos segundos.',
        screen: 0,
      },
      { text: 'Si ya pasó, abrí el comprobante desde Compras y pagos › Comprobantes.' },
      {
        text: `Tocá «${S.comprobante.void}» y escribí el motivo: queda anulado con tu nombre, no se borra.`,
        screen: 1,
      },
      { text: 'Cargalo de nuevo, bien. No existe «editar»: se anula y se vuelve a cargar.' },
    ],
    screens: [
      {
        title: '«Deshacer», apenas guardás',
        label: 'El aviso que aparece al guardar una compra, con el botón «Deshacer», marcado.',
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
        problem: 'Solo está mal la cuenta',
        fix: 'No hace falta anular: se reimputa. Mirá «Un gasto quedó en otra cuenta».',
      },
      {
        problem: 'El mes ya está cerrado',
        fix: `No se anula con su fecha. El comprobante te ofrece la salida: una nota de crédito, «${S.comprobante.voidToday}» o un ajuste de la contadora.`,
      },
      {
        problem: 'Tiene pagos unidos',
        fix: 'Si lo anulás, esos pagos quedan a cuenta: como saldo a favor con el proveedor.',
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
    id: 'reimputar',
    title: 'Un gasto quedó en otra cuenta',
    hint: 'La luz cargada en el agua',
    where: 'Contabilidad › Mayor',
    frequency: 'event',
    minutes: 2,
    steps: [
      { text: 'Entrá a Contabilidad › Sumas y saldos y tocá la cuenta que no da.' },
      { text: 'En el Mayor, abrí el movimiento: ves su asiento y su comprobante.' },
      {
        text: `Tocá «${S.contabilidad.reimpute}», elegí la cuenta que corresponde y, si querés, escribí el motivo.`,
      },
    ],
    screens: [],
    checks: [
      'El Mayor de las dos cuentas cambió.',
      'En el comprobante queda la historia: quién lo cambió, cuándo y por qué.',
      'El importe, el proveedor y el IVA no se movieron.',
    ],
    troubles: [
      {
        problem: 'No me deja: el mes está cerrado',
        fix: 'Reimputar se hace con el mes abierto. Si hace falta, reabrilo desde Contabilidad › Cierre de mes.',
        link: { label: 'Contabilidad › Cierre de mes', path: '/libros/cierres' },
      },
      {
        problem: '¿Quién puede hacerlo?',
        fix: 'Los dueños con acceso y la contadora.',
      },
    ],
    result: 'El renglón queda en la cuenta correcta, con su historia.',
    action: { label: 'Ir al Mayor', target: { kind: 'route', path: '/libros/mayor' } },
  },
  {
    id: 'asiento',
    title: 'Necesito un asiento manual',
    hint: 'Un préstamo, una amortización, un aporte',
    where: 'Contabilidad › Asiento manual',
    frequency: 'event',
    minutes: 5,
    steps: [
      { text: 'Entrá a Contabilidad y tocá Asiento manual.' },
      {
        text: `Partí de un «${S.contabilidad.model}», si hay uno que sirva, o cargá los renglones a mano.`,
      },
      { text: `«${S.contabilidad.save}» se destraba recién cuando el Debe da igual que el Haber.` },
    ],
    screens: [],
    checks: [
      'Aparece en el Libro diario con su fecha.',
      'Las cuentas de Sumas y saldos se movieron.',
    ],
    troubles: [
      {
        problem: 'Es una compra, un pago o una venta',
        fix: 'Eso va por «+ Cargar»: el asiento sale solo. El manual es para lo que no tiene otro lugar.',
      },
      {
        problem: '¿Quién puede hacerlo?',
        fix: 'Los dueños con acceso y la contadora.',
      },
    ],
    result: 'El asiento queda en los libros, con Debe igual a Haber.',
    action: {
      label: 'Ir a Asiento manual',
      target: { kind: 'route', path: '/libros/asiento-manual' },
    },
  },
  {
    id: 'fin-de-mes',
    title: 'Cierre de mes para la contadora',
    hint: 'Revisar, cerrar y mandar los libros',
    where: 'Contabilidad › Cierre de mes',
    frequency: 'monthly',
    minutes: 20,
    routine: 'month_close',
    steps: [
      {
        text: 'Cargá lo que falte: los cierres del día, Mercado Pago, el banco y las compras de ARCA.',
      },
      { text: 'Contá cada cuenta, para que los saldos sean los de verdad.' },
      {
        text: 'Entrá a Contabilidad › Cierre de mes y mirá la lista: cada renglón dice qué falta.',
      },
      { text: 'Cerrá el mes con la contadora. Después ya no cambia, salvo que lo reabras.' },
      {
        text: `Tocá «${S.cierreMes.download}» para mandárselos, o que los baje ella con su acceso.`,
      },
    ],
    screens: [],
    checks: [
      'El mes figura cerrado.',
      'No quedan avisos sin mirar.',
      'La contadora tiene los archivos, o entra con su acceso.',
    ],
    troubles: [
      {
        problem: 'Los Libros de IVA no se pueden bajar',
        fix: 'Falta la CUIT de la empresa.',
        link: { label: 'Ajustes › Datos de la SAS', path: '/ajustes?tab=sas' },
      },
      {
        problem: 'La contadora quiere solo lo que tiene factura',
        fix: 'En Comprobantes, filtrá con factura y exportá. Los libros no se filtran: llevan todo.',
        link: { label: 'Compras y pagos › Comprobantes', path: '/compras?tab=comprobantes' },
      },
      {
        problem: 'Cerré y hay que cambiar algo',
        fix: 'Un mes cerrado no se toca. Mirá «Me equivoqué y quiero corregir»; si no alcanza, la contadora te dice si hay que reabrirlo.',
      },
    ],
    result: 'El mes queda fijo y la contadora tiene todo para trabajar.',
    action: { label: 'Ir a Cierre de mes', target: { kind: 'route', path: '/libros/cierres' } },
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

// ─── Dónde está cada cosa ────────────────────────────────────────────────────

export type GuideSection = {
  key: string
  /** El nombre en el menú. */
  title: string
  what: string
  /** Sus solapas, con el nombre que tienen en pantalla. */
  tabs: readonly string[]
  /** Después de `/administracion`. */
  path: string
}

/** Las seis palabras de arriba y el engranaje. Un test las compara con `ADM_SECTIONS`. */
export const GUIDE_SECTIONS: readonly GuideSection[] = [
  {
    key: 'resumen',
    title: 'Resumen',
    what: 'Cómo viene el mes y lo que te toca hoy.',
    tabs: [],
    path: '',
  },
  {
    key: 'compras',
    title: 'Compras y pagos',
    what: 'Lo que le debés a cada proveedor, qué le vas a pagar esta semana y cada comprobante.',
    tabs: ['Proveedores', 'Plan de la semana', 'Comprobantes'],
    path: '/compras',
  },
  {
    key: 'gastos',
    title: 'Gastos y sueldos',
    what: 'Lo que pagás todos los meses y lo de cada empleado: sueldo, adelantos y saldo.',
    tabs: ['Gastos fijos', 'Sueldos'],
    path: '/gastos-fijos',
  },
  {
    key: 'ventas',
    title: 'Ventas',
    what: 'El objetivo y lo vendido de cada día, lo que te tienen que depositar y lo que llegó.',
    tabs: ['Proyección', 'Por cobrar', 'Lo que llegó'],
    path: '/ventas',
  },
  {
    key: 'caja',
    title: 'Caja',
    what: 'Cuánto hay en cada cuenta y de dónde salió cada movimiento.',
    tabs: [],
    path: '/cajas',
  },
  {
    key: 'contabilidad',
    title: 'Contabilidad',
    what: 'Los libros, para la contadora: de ahí se reimputa, se hacen asientos y se cierra el mes.',
    tabs: ['Sumas y saldos', 'Mayor', 'Libro diario', 'IVA', 'Plan de cuentas', 'Cierre de mes'],
    path: '/libros/sumas-y-saldos',
  },
  {
    key: 'ajustes',
    title: 'Ajustes',
    what: 'Detrás del engranaje: impuestos, cuentas, medios de cobro y accesos, y lo de una sola vez.',
    tabs: ['Ajustes', 'Puesta en marcha', 'Guía', 'Importar'],
    path: '/ajustes',
  },
]

/** Lo que se hace desde cualquier pantalla. */
export const GUIDE_EVERYWHERE: ReadonlyArray<{ title: string; what: string }> = [
  {
    title: '+ Cargar',
    what: 'Compra, Compra y pago, Pago y Cierre del día. Lo demás, en la fila de abajo.',
  },
  {
    title: 'Arrastrar un archivo',
    what: 'Una foto o un PDF abre la compra. El ZIP de ARCA, el reporte de Mercado Pago o los movimientos del banco se reconocen solos.',
  },
  {
    title: 'La foto por QR',
    what: 'Al lado de cada carga hay un QR: lo escaneás con el celular, sacás la foto y aparece en la compu.',
  },
]

/** Lo que significa cada parte de la plata, en una línea (el glosario). */
const MONEY_WORDS = {
  cuentas: 'La plata que tenés hoy: efectivo, banco y billeteras.',
  porCobrar:
    'Ventas con tarjeta, QR o app que todavía no llegaron a tu cuenta, y clientes con cuenta.',
  deuda: 'Compras que te dejaron a pagar y todavía no pagaste.',
} as const

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
        return { state: 'idle', text: 'Primero cargá lo que había en cada cuenta al arrancar' }
      }
      const n = data.treasuriesUnchecked
      return {
        state: 'todo',
        text: `${plural(n, 'Falta', 'Faltan')} contar ${n} ${plural(n, 'cuenta', 'cuentas')} este mes`,
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
          title: 'Cargar las compras del día',
          link: { kind: 'recipe', recipe: 'compra' },
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
          link: { kind: 'recipe', recipe: 'banco' },
          status: routineStatus('bank_weekly', overview),
        },
        {
          key: 'plan',
          title: 'Armar los pagos de la semana',
          link: { kind: 'recipe', recipe: 'plan-semana' },
          status: null,
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
          title: 'Contar cada cuenta',
          link: { kind: 'recipe', recipe: 'contar-caja' },
          status: routineStatus('treasury_check', overview),
        },
        {
          key: 'sueldos',
          title: 'Pagar y devengar los sueldos',
          link: { kind: 'recipe', recipe: 'sueldos' },
          status: null,
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
    title: 'Remito',
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
const PAID_NOW = 'Compra y pago'
const PAY_LATER = 'Compra'

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
    where: [{ steps: [LAUNCH, PAID_NOW, S.compra.paperNone] }],
    result: [
      'Sale la plata de la caja.',
      'No queda deuda con el proveedor.',
      'No entra al Libro IVA.',
    ],
    action: {
      label: 'Cargar compra y pago',
      target: { kind: 'route', path: '/compras/nueva?modo=pago' },
    },
    recipe: 'sin-factura',
  },
  {
    id: 'remito-cuenta',
    title: 'Me dejaron un remito y lo pago después',
    art: 'sin',
    where: [{ steps: [LAUNCH, PAY_LATER, S.compra.paperNone] }],
    result: [
      'Queda la deuda con el proveedor, con su vencimiento.',
      'La caja baja recién cuando la pagás.',
      'No entra al Libro IVA.',
    ],
    action: { label: 'Cargar una compra', target: { kind: 'route', path: '/compras/nueva' } },
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
    action: {
      label: 'Cargar compra y pago',
      target: { kind: 'route', path: '/compras/nueva?modo=pago' },
    },
    recipe: 'gasto',
  },
  {
    id: 'factura-bc',
    title: 'Me dieron una Factura B o C',
    art: 'factura_bc',
    where: [
      { when: 'Si ya la pagaste', steps: [LAUNCH, PAID_NOW, 'Factura B o C'] },
      { when: 'Si la pagás después', steps: [LAUNCH, PAY_LATER, 'Factura B o C'] },
    ],
    result: [
      'Entra al Libro IVA.',
      'El IVA no se recupera: queda dentro del gasto.',
      'Si el proveedor es responsable inscripto, pedile Factura A.',
    ],
    action: {
      label: 'Cargar compra y pago',
      target: { kind: 'route', path: '/compras/nueva?modo=pago' },
    },
    recipe: 'gasto',
  },
  {
    id: 'factura-a',
    title: 'Me dieron una Factura A',
    art: 'factura_a',
    where: [
      { when: 'Si ya la pagaste', steps: [LAUNCH, PAID_NOW, 'Factura A'] },
      { when: 'Si la pagás después', steps: [LAUNCH, PAY_LATER, 'Factura A'] },
    ],
    result: [
      'Entra al Libro IVA.',
      'El IVA queda a tu favor: se resta del que pagás cada mes.',
      'Hace falta la CUIT del proveedor.',
    ],
    action: {
      label: 'Cargar compra y pago',
      target: { kind: 'route', path: '/compras/nueva?modo=pago' },
    },
    recipe: 'gasto',
  },
  {
    id: 'nota-credito',
    title: 'Me dieron una nota de crédito',
    art: 'nota_credito',
    where: [{ steps: [LAUNCH, PAY_LATER, S.compra.creditNote] }],
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
      'En la ficha del proveedor, en Compras y pagos › Proveedores. O al cargarle algo, eligiendo la categoría de siempre.',
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
    where: `En «Pago», tildándola en «${S.pagar.invoices}». O al cargar la compra, eligiendo «${S.compra.paid}». Con «Compra y pago» queda unido solo.`,
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
    where:
      'Se usa solo en el próximo pago: viene tildado. Si no querés esperar, se usa desde la ficha del proveedor.',
    ifNot: 'El proveedor muestra a la vez una deuda y un saldo a favor.',
    undo: `Con «Deshacer», apenas lo usás. Después, con «${S.comprobante.separate}» en el comprobante.`,
    limit: `Del lado de la plata por cobrar todavía no se puede, ni existe «${S.comprobante.separate}».`,
    recipe: 'pagar-deuda',
  },
  {
    id: 'nota-factura',
    ends: ['Nota de crédito', 'La factura que corrige'],
    how: 'you',
    when: 'al cargarla',
    what: 'La nota de crédito es el papel que descuenta o anula una factura. Unirla es decir cuál corrige.',
    where:
      'Al cargarla, eligiendo qué compra corrige. Es opcional. Al subir las compras de ARCA te lo pregunta también.',
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
    where: `Desde Gastos y sueldos › Gastos fijos, tildando ese renglón. Si la factura la pagás después, en su renglón tocá «${S.gastosFijos.bill}».`,
    ifNot:
      'El gasto queda en tus números, pero el renglón sigue figurando sin pagar y sigue avisando. El comprobante te pregunta si era ese gasto fijo.',
    undo: 'Anulá el gasto. En Gastos fijos aparece un aviso para que el renglón vuelva a su mes.',
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
      'Al cargar: con el QR desde el celular, o arrastrándola. O después, abriendo el comprobante, también con el mes cerrado. Hasta 5 archivos.',
    ifNot: 'No cambia ningún número. Falta el respaldo el día que lo pida la contadora.',
    undo: 'Quitá el archivo desde el comprobante. Se borra y no se recupera.',
    limit: null,
    recipe: 'gasto',
  },
  {
    id: 'cierre-cajas',
    ends: ['Cierre del día', 'Cuentas', 'Por cobrar'],
    how: 'auto',
    when: 'al guardar el cierre',
    what: 'El cierre reparte solo cada medio de cobro. El efectivo entra a la caja. Lo demás queda por cobrar hasta que te lo depositan.',
    where:
      'A dónde va cada medio se define una vez, en Ajustes › Medios de cobro. Lo que te depositan se anota con «Entró plata», o subiendo el reporte de Mercado Pago.',
    ifNot:
      'Las ventas están contadas, pero la plata figura sin entrar: lo que está por cobrar crece y tu cuenta queda por debajo de la real.',
    undo: 'Anulá el cobro: esas ventas vuelven a quedar por cobrar. El cierre no se edita: se anula y se carga de nuevo.',
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
    where: `No hay que hacer nada. Antes de guardar lo podés mirar en «${S.compra.entry}».`,
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
  { idea: 'Cuentas', name: 'Disponibilidades', meaning: MONEY_WORDS.cuentas },
  { idea: 'Por cobrar', name: 'Cuentas a cobrar', meaning: MONEY_WORDS.porCobrar },
  { idea: 'Lo que debés', name: 'Cuentas a pagar', meaning: MONEY_WORDS.deuda },
  {
    idea: 'Impuesto al cheque',
    name: 'Ley 25.413, débitos y créditos',
    meaning: 'Lo que cobra el banco o la billetera cada vez que sale o entra plata.',
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
    meaning: 'El listado de todas las cuentas con su total. Es lo que se le manda a la contadora.',
  },
  { idea: 'Mayor', name: null, meaning: 'Los movimientos de una cuenta y su saldo.' },
  {
    idea: 'Cambiarle la cuenta a un renglón',
    name: 'Reimputar',
    meaning: 'Pasar un renglón a la cuenta correcta, sin tocar el importe. Queda la historia.',
  },
  {
    idea: 'Anotar el sueldo del mes',
    name: 'Devengar',
    meaning: 'Dejarlo en los libros como gasto del mes, aunque todavía no lo hayas pagado.',
  },
  { idea: 'ARCA', name: null, meaning: sharedMeaning('ARCA') },
  { idea: 'CUIT', name: null, meaning: sharedMeaning('CUIT') },
  // Las de la puesta en marcha: «Cómo arrancar» manda acá en vez de tener su propia lista.
  {
    idea: 'La hoja de ARCA de la SAS',
    name: 'Constancia de inscripción',
    meaning: sharedMeaning('Constancia de inscripción'),
  },
  {
    idea: 'El impuesto de la provincia',
    name: 'Ingresos Brutos',
    meaning: sharedMeaning('Ingresos Brutos'),
  },
  {
    idea: 'Tus facturas, en ARCA',
    name: 'Mis Comprobantes',
    meaning: sharedMeaning('Mis Comprobantes'),
  },
  { idea: 'El número de una cuenta', name: 'CBU y CVU', meaning: sharedMeaning('CBU y CVU') },
]
