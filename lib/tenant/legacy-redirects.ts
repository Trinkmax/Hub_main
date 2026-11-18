import { RESERVED_SLUGS } from './types'

/**
 * Las direcciones viejas del panel y a dónde llevan hoy. Las usa `next.config.ts › redirects()`.
 *
 * Viven acá y no sueltas en la configuración para poder probarlas (`tests/lib/legacy-redirects`):
 * cada destino tiene que ser una pantalla que existe y ninguna regla puede tapar una pantalla de hoy.
 * El 18/11/2026 se retiraron once páginas que solo redirigían y varias pantallas del sistema
 * anterior; sus direcciones siguen entrando por acá para que un favorito o un link viejo no termine
 * en «no existe».
 *
 * Archivo sin dependencias a propósito: `next.config.ts` lo importa antes de que exista el alias `@/`.
 */

export type LegacyRedirect = { source: string; destination: string; permanent: boolean }

/**
 * El bar: el primer tramo de la dirección, siempre que NO sea un prefijo reservado.
 *
 * Sin este filtro `/:slug/eventos` también agarraba `/p/eventos` (una landing que sube marketing,
 * con el nombre que elige quien la sube), `/carta/…` o `/api/…`, y las mandaba a cualquier lado.
 */
export const BAR_SEGMENT = `:slug((?!(?:${[...RESERVED_SLUGS].join('|')})(?:/|$))[^/]+)`

/** `/<bar><from>` → `/<bar><to>`. Un `from` terminado en `/:rest*` cubre también lo que cuelga. */
function rule(from: string, to: string, permanent: boolean): LegacyRedirect {
  return { source: `/${BAR_SEGMENT}${from}`, destination: `/:slug${to}`, permanent }
}

/** Mudanzas que ya se publicaron como permanentes: los navegadores las tienen guardadas. */
const moved = (from: string, to: string) => rule(from, to, true)
/** Pantallas retiradas: temporales, por si algún día ese nombre vuelve a ser una pantalla. */
const retired = (from: string, to: string) => rule(from, to, false)

export const LEGACY_REDIRECTS: LegacyRedirect[] = [
  // Mensajería: la sección se consolidó en /mensajeria/*
  moved('/bandeja/:rest*', '/mensajeria/inbox/:rest*'),
  moved('/difusiones/:rest*', '/mensajeria/difusiones/:rest*'),
  moved('/flows/:rest*', '/mensajeria/flows/:rest*'),
  moved('/audiencias/:rest*', '/mensajeria/audiencias/:rest*'),
  moved('/configuracion/canales', '/mensajeria/canales'),
  moved('/configuracion/templates', '/mensajeria/plantillas'),
  moved('/configuracion/mensajes-rapidos', '/mensajeria/mensajes-rapidos'),
  moved('/marketing', '/mensajeria'),

  // Etiquetas de la carta: son un diálogo de la Carta.
  moved('/configuracion/tags', '/menu?etiquetas=1'),
  retired('/menu/tags', '/menu?etiquetas=1'),

  // Club: puntos, niveles, aliados, bienvenida y tarjetas de sellos son solapas de /club.
  moved('/configuracion/puntos/:rest*', '/club?tab=programa'),
  moved('/configuracion/punch-cards/:rest*', '/club?tab=punch'),
  retired('/puntos/:rest*', '/club?tab=programa'),
  retired('/punch-cards/:rest*', '/club?tab=punch'),
  retired('/club/puntos', '/club?tab=programa'),
  retired('/club/niveles', '/club?tab=programa'),
  retired('/club/aliados', '/club?tab=aliados'),
  retired('/club/bienvenida', '/club?tab=bienvenida'),
  retired('/club/punch-cards', '/club?tab=punch'),
  retired('/configuracion/bienvenida', '/club?tab=bienvenida'),

  // Sumar puntos es una hoja de Clientes; el QR del club, un diálogo del Club.
  retired('/acreditar', '/clientes?sumar=1'),
  retired('/visitas/nueva', '/clientes?sumar=1'),
  retired('/visitas/:rest*', '/clientes'),
  retired('/local/captura', '/club?qr=1'),

  // Calendario
  retired('/eventos', '/eventos/programados'),
  retired('/eventos/templates', '/eventos/programados?tab=eventos'),

  // Servicio de mesa anterior: hoy el salón es el del punto de venta.
  moved('/sesiones/:rest*', '/salon'),
  moved('/cocina/:rest*', '/salon'),
  retired('/salon/mesas/:rest*', '/salon'),
  retired('/salon/cocina', '/salon'),
  retired('/salon/mi-turno', '/salon'),
  retired('/salon/validar', '/salon/escanear'),
  retired('/local/auto-aceptacion', '/configuracion'),

  // Ayuda y arranque: la guía vive en el Resumen.
  retired('/docs', ''),
  retired('/onboarding', ''),
]
