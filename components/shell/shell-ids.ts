/**
 * Constantes del shell que comparten el server (`AppShell`) y los componentes
 * cliente. Viven en un módulo sin `'use client'` a propósito: lo que un Server
 * Component importa de un archivo `'use client'` no es el valor sino una
 * referencia de cliente (una función). Con `SIDEBAR_COOKIE` exportado desde
 * `sidebar-state.tsx`, `cookies().get(SIDEBAR_COOKIE)` buscaba una cookie sin
 * nombre y el menú plegado se volvía a abrir en cada recarga.
 */

/** Plegado del menú lateral de escritorio: `collapsed` | `open`. La lee el server en el primer render. */
export const SIDEBAR_COOKIE = 'hub_sidebar'

/** El `<aside>` del menú lateral (destino del `aria-controls` de «Ocultar menú»). */
export const SIDEBAR_ID = 'menu-lateral'

/** El `<main>` del panel: destino de «Saltar al contenido» y del foco al navegar desde el cajón. */
export const MAIN_CONTENT_ID = 'contenido'
