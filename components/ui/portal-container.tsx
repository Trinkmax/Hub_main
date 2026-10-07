'use client'

import * as React from 'react'

/**
 * Dónde se abren los overlays del kit (kit HUB §3.0, «Portales»).
 *
 * Dialog, Sheet, Popover, DropdownMenu, Tooltip y Command leen este contexto y
 * le pasan `container` al `Portal` de Radix. Sin proveedor van al `<body>`,
 * como siempre.
 *
 * Existe por los scopes de tema: un portal al `<body>` hereda los tokens del
 * `<html>`, no los del bloque donde vive el disparador. El catálogo pone un
 * proveedor en cada panel de tema (si no, el menú de un ejemplo en oscuro se
 * abre en claro) y las vistas previas congeladas del panel (`enlaces`,
 * `club/simular`) lo ponen en su envoltorio `.force-light`:
 *
 * ```tsx
 * const [root, setRoot] = useState<HTMLDivElement | null>(null)
 * <div ref={setRoot} className="theme-dark">
 *   <PortalContainerProvider container={root}>…</PortalContainerProvider>
 * </div>
 * ```
 *
 * El elemento llega por estado (ref callback), no por `useRef`: así el primer
 * render, con `null`, cae al `<body>` y el siguiente ya apunta al bloque.
 */
const PortalContainerContext = React.createContext<HTMLElement | null>(null)

function PortalContainerProvider({
  container,
  children,
}: {
  container: HTMLElement | null
  children: React.ReactNode
}) {
  return (
    <PortalContainerContext.Provider value={container}>{children}</PortalContainerContext.Provider>
  )
}

/** El contenedor del proveedor más cercano; `undefined` deja a Radix usar el `<body>`. */
function usePortalContainer(): HTMLElement | undefined {
  return React.useContext(PortalContainerContext) ?? undefined
}

/**
 * Movimiento de lo que sale de su disparador: popover, menú, select, combobox
 * (§2.10: entra en 180 ms, sale en 120 ms, opacidad + escala 0,97). El origen
 * lo pone cada componente con la variable de su primitivo de Radix
 * (`origin-(--radix-popover-content-transform-origin)`).
 *
 * Las variables de entrada y salida van sin variante de estado a propósito:
 * solo las lee la animación que corresponde (`enter` mientras está abierto,
 * `exit` al cerrar). Con `data-[state=open]:zoom-in-97` la regla pesa más
 * (0,2,0) que `motion-reduce:zoom-in-100` (0,1,0) y «reducir movimiento» no
 * sacaría la escala.
 */
const MENU_MOTION = [
  'data-[state=open]:animate-in data-[state=closed]:animate-out',
  'fade-in-0 zoom-in-97 fade-out-0 zoom-out-97',
  'duration-(--duration-menu) data-[state=closed]:duration-(--duration-menu-exit) ease-(--ease-ui)',
  'motion-reduce:zoom-in-100 motion-reduce:zoom-out-100',
].join(' ')

/** Diálogo y confirmación: entra en 220 ms y sale en 160 ms, centrado (§2.10). */
const DIALOG_MOTION = [
  'data-[state=open]:animate-in data-[state=closed]:animate-out',
  'fade-in-0 zoom-in-97 fade-out-0 zoom-out-97',
  'duration-(--duration-overlay) data-[state=closed]:duration-(--duration-overlay-exit) ease-(--ease-ui)',
  'motion-reduce:zoom-in-100 motion-reduce:zoom-out-100',
].join(' ')

/** El velo de diálogos y hojas: solo fundido, con los tiempos del overlay. */
const OVERLAY_MOTION = [
  'data-[state=open]:animate-in data-[state=closed]:animate-out fade-in-0 fade-out-0',
  'duration-(--duration-overlay) data-[state=closed]:duration-(--duration-overlay-exit) ease-(--ease-ui)',
].join(' ')

export { DIALOG_MOTION, MENU_MOTION, OVERLAY_MOTION, PortalContainerProvider, usePortalContainer }
