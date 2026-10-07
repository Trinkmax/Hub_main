import type { ThemePreference } from '@/lib/theme/types'

/**
 * Qué workspace está sirviendo este request. Lo marca el proxy sobre los
 * headers del request y lo lee el root layout para decidir el tema del `<html>`.
 *
 * - `salon` (`/{slug}/salon…`) es **light-only**. El mozo lo usa con el celular
 *   a plena luz y el modo oscuro le arruinaba el contraste del escáner y de las
 *   tarjetas de sellos.
 * - `public` (carta, wallet, QR de mesa, reseña, links, landings, impresión y
 *   captura) queda **congelado** mientras el panel estrena el kit HUB: el
 *   `<html>` lleva `legacy-theme`, que fija los tokens de antes, y sigue la
 *   preferencia de tema como siempre (cookie o sistema operativo).
 * - `manager` es todo lo demás: panel, auth, onboarding y plataforma.
 *
 * Módulo aparte (sin `server-only`, sin imports pesados) porque lo comparten el
 * proxy —que corre en el runtime del middleware— y el root layout.
 */
export const WORKSPACE_HEADER = 'x-hub-workspace'

/**
 * Path del request (`/hub/administracion/libros`). Lo lee el backstop de roles
 * del layout del panel: el JWT puede traer un rol viejo hasta 1 h, así que el
 * layout cruza el rol real de la base con la ruta. Lo setea el proxy con el
 * mismo mecanismo que `WORKSPACE_HEADER`.
 */
export const PATH_HEADER = 'x-hub-path'

export type Workspace = 'salon' | 'public' | 'manager'

/**
 * Primer segmento de las rutas del workspace `public`. Todos son slugs
 * reservados: una ruta pública nueva se suma acá, en `RESERVED_SLUGS` y en
 * tests/lib/workspace.test.ts. Si falta acá, la página nueva sale con los
 * tokens nuevos del panel encima de componentes del kit viejo.
 */
export const PUBLIC_WORKSPACE_SEGMENTS: ReadonlySet<string> = new Set([
  'carta', // carta pública (QR de la carta)
  'c', // wallet del socio
  'm', // QR de mesa
  'r', // reseña
  'v', // QR de canje
  'l', // link del bar (bio de Instagram)
  'p', // landings que sube el bar
  'print', // hojas de QR para imprimir
  'capture', // captura pública del cliente
])

export function parseWorkspace(headerValue: string | null | undefined): Workspace {
  return headerValue === 'salon' || headerValue === 'public' ? headerValue : 'manager'
}

/**
 * Clases de tema que el server pone en el `<html>` de cada workspace. El script
 * no-flash del `<head>` y el ThemeProvider solo tocan `dark` y `force-light`,
 * así que `legacy-theme` queda como lo dejó el server.
 */
export function htmlThemeClass(workspace: Workspace, preference: ThemePreference): string {
  if (workspace === 'salon') return 'force-light'
  const dark = preference === 'dark' ? 'dark' : ''
  return workspace === 'public' ? `legacy-theme ${dark}`.trim() : dark
}
