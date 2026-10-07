/**
 * Qué workspace está sirviendo este request. Lo marca el proxy sobre los
 * headers del request y lo lee el root layout para decidir el tema del `<html>`.
 *
 * Existe un solo caso hoy: el salón (`/{slug}/salon…`) es **light-only**. El
 * mozo lo usa con el celular a plena luz y el modo oscuro le arruinaba el
 * contraste del escáner y de las tarjetas de sellos.
 *
 * Módulo aparte (sin `server-only`, sin imports pesados) porque lo comparten el
 * proxy —que corre en el runtime del middleware— y el root layout.
 */
export const WORKSPACE_HEADER = 'x-hub-workspace'

/**
 * El pathname del request, tal como lo vio el proxy. Lo lee el layout del
 * panel para repetir el ruteo de los roles acotados (editor, anfitrión,
 * contadora) con el rol REAL de la base: el JWT puede traer un rol viejo hasta
 * 1 h. El proxy lo pisa siempre (un valor que mande el navegador no pasa).
 */
export const PATH_HEADER = 'x-hub-path'

export type Workspace = 'salon' | 'manager'

export function parseWorkspace(headerValue: string | null | undefined): Workspace {
  return headerValue === 'salon' ? 'salon' : 'manager'
}
