/**
 * Las habitaciones de Ajustes (rediseño de octubre 2026): una pantalla por
 * cosa, y una portada cuando no se pide ninguna. Puro: lo prueba
 * `administracion-ajustes-rooms.test.ts`.
 *
 * Las claves de `?tab=` son las nueve de siempre: unos cien textos de la app
 * mandan a «Ajustes › …» con esos links, y todos siguen cayendo en lo que
 * nombran. Cambian dos cosas, nada más: `medios` y `participes` abren la misma
 * habitación («Medios de cobro»), y sin `?tab=` —o con una clave que no
 * existe— se ve la portada (antes, Datos de la SAS).
 */

/** Las claves que puede traer `?tab=`. No se agrega ni se saca ninguna. */
export const TAB_VALUES = [
  'sas',
  'arca',
  'ejercicio',
  'accesos',
  'medios',
  'cajas',
  'participes',
  'puntos-de-venta',
  'integridad',
] as const
export type TabValue = (typeof TAB_VALUES)[number]

/** Las ocho habitaciones, en el orden de la portada: las seis del dueño y las dos de la contadora. */
export const ROOM_KEYS = [
  'accesos',
  'cajas',
  'medios',
  'sas',
  'puntos-de-venta',
  'arca',
  'ejercicio',
  'integridad',
] as const
export type RoomKey = (typeof ROOM_KEYS)[number]

/** Las seis que tienen su objeto en la portada. */
export const OWNER_ROOMS = [
  'accesos',
  'cajas',
  'medios',
  'sas',
  'puntos-de-venta',
  'arca',
] as const satisfies readonly RoomKey[]
export type OwnerRoom = (typeof OWNER_ROOMS)[number]

export type RoomInfo = {
  /** El `h1`: el nombre con el que el resto de la app manda acá («Ajustes › Medios de cobro»). */
  title: string
  /** Una oración: para qué sirve la habitación, dicho como lo diría un dueño. */
  description: string
  /** La clave de `?tab=` que la abre. */
  tab: TabValue
  /** De quién es: las del dueño tienen su objeto en la portada; las otras van al cajón. */
  audience: 'owner' | 'accountant'
}

export const ROOMS: Readonly<Record<RoomKey, RoomInfo>> = {
  accesos: {
    title: 'Accesos',
    description: 'Administración es privada: la ven solo los socios que habilites y la contadora.',
    tab: 'accesos',
    audience: 'owner',
  },
  cajas: {
    title: 'Cajas y cuentas',
    description:
      'Las cajas, los bancos y las billeteras del bar. Acá se agregan y se les cargan los datos; la plata y los movimientos se miran en Cajas.',
    tab: 'cajas',
    audience: 'owner',
  },
  medios: {
    title: 'Medios de cobro',
    description:
      'Cómo te pagan, en el orden de tu cierre del día: a dónde va cada cobro, cuándo llega y cuánto te descuentan.',
    tab: 'medios',
    audience: 'owner',
  },
  sas: {
    title: 'Datos de la SAS',
    description:
      'Así figura el bar en ARCA. Copialo tal cual está en la constancia de inscripción.',
    tab: 'sas',
    audience: 'owner',
  },
  'puntos-de-venta': {
    title: 'Puntos de venta',
    description:
      'El número con el que salen tus facturas. No es la caja registradora ni el posnet.',
    tab: 'puntos-de-venta',
    audience: 'owner',
  },
  arca: {
    title: 'ARCA',
    description:
      'La conexión con ARCA (la ex AFIP), para completar datos con la CUIT y facturar desde acá.',
    tab: 'arca',
    audience: 'owner',
  },
  ejercicio: {
    title: 'Ejercicio',
    description:
      'Los meses del año contable, los días en que vencen los impuestos y las reglas que define la contadora.',
    tab: 'ejercicio',
    audience: 'accountant',
  },
  integridad: {
    title: 'Integridad',
    description: 'Una revisión de que los libros cierran. Es para la contadora y para soporte.',
    tab: 'integridad',
    audience: 'accountant',
  },
}

/** Qué habitación abre cada clave. `participes` es la lista de CUIT de «Medios de cobro». */
const ROOM_OF_TAB: Readonly<Record<TabValue, RoomKey>> = {
  sas: 'sas',
  arca: 'arca',
  ejercicio: 'ejercicio',
  accesos: 'accesos',
  medios: 'medios',
  cajas: 'cajas',
  participes: 'medios',
  'puntos-de-venta': 'puntos-de-venta',
  integridad: 'integridad',
}

/** `?tab=` tal como llega (puede venir repetido) → una clave válida, o `null`. */
export function readTab(value: string | readonly string[] | undefined | null): TabValue | null {
  const first = typeof value === 'string' ? value : (value?.[0] ?? null)
  return (TAB_VALUES as readonly string[]).includes(first ?? '') ? (first as TabValue) : null
}

/** La habitación que pide `?tab=`. `null` = la portada (sin clave, o una que no existe). */
export function roomOfTab(value: string | readonly string[] | undefined | null): RoomKey | null {
  const tab = readTab(value)
  return tab ? ROOM_OF_TAB[tab] : null
}

/**
 * El link a una habitación. `base` es `/<bar>/administracion`. `tab` deja pedir
 * la otra clave de la misma habitación (`participes`, que abre la lista de
 * CUIT) y `hash` un ancla de adentro (`reglas`, `cuit`, `homologacion`).
 */
export function roomHref(
  base: string,
  room: RoomKey,
  opts: { tab?: TabValue; hash?: string } = {},
): string {
  const tab = opts.tab && ROOM_OF_TAB[opts.tab] === room ? opts.tab : ROOMS[room].tab
  return `${base}/ajustes?tab=${tab}${opts.hash ? `#${opts.hash}` : ''}`
}

/** «Otros ajustes»: todas menos la que se está viendo, en el orden de la portada. */
export function otherRooms(current: RoomKey): RoomKey[] {
  return ROOM_KEYS.filter((key) => key !== current)
}
