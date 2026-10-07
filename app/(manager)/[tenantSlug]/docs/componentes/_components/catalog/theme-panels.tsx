'use client'

import * as React from 'react'
import { Badge } from '@/components/ui/badge'
import { ConfirmProvider } from '@/components/ui/confirm-dialog'
import { ControlSizeProvider } from '@/components/ui/control-size'
import { PortalContainerProvider } from '@/components/ui/portal-container'
import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/utils'
import { type PanelTheme, PanelThemeProvider, useCatalog } from './catalog-provider'

const THEME_CLASS: Readonly<Record<PanelTheme, string>> = {
  light: 'theme-light',
  dark: 'theme-dark',
}

const THEME_LABEL: Readonly<Record<PanelTheme, string>> = { light: 'Claro', dark: 'Oscuro' }

/**
 * Un panel de tema (kit HUB §6.2, punto 3): `.theme-light` o `.theme-dark`
 * (el claro y el oscuro nuevos, que comparten bloque con `:root` y `.dark`;
 * no `.force-light`, que es el claro congelado).
 *
 * - **Portales adentro del panel.** Los menús, selects y diálogos de los
 *   ejemplos se abren adentro de su panel y con su tema: un portal al
 *   `<body>` heredaría los tokens del `<html>`. El elemento llega por estado
 *   (ref callback), como pide `PortalContainerProvider`.
 * - **`useConfirm` también:** cada panel monta su `ConfirmProvider`, así la
 *   confirmación que se pide desde un menú del panel oscuro se abre en oscuro.
 * - **Densidad:** el interruptor del encabezado fija el tamaño por defecto de
 *   los controles (`ControlSizeProvider`); la prop explícita de cada ejemplo
 *   gana. El proveedor va siempre (en `md` con la cómoda) para que cambiar la
 *   densidad no vuelva a montar los ejemplos ni les borre lo que se tipeó.
 * - `text-foreground` además de `bg-background`: el color de texto se hereda
 *   ya calculado desde el `<body>`, así que sin esto el panel oscuro heredaría
 *   la tinta del claro.
 */
function ThemePanel({
  theme,
  hidden,
  sample,
  mounted,
  wide,
  children,
}: {
  theme: PanelTheme
  hidden: boolean
  sample: boolean
  /** `false` mientras el bloque está lejos de la pantalla: va un esqueleto del alto aproximado. */
  mounted: boolean
  wide: boolean
  children: React.ReactNode
}) {
  const { density } = useCatalog()
  const [root, setRoot] = React.useState<HTMLDivElement | null>(null)

  return (
    // biome-ignore lint/a11y/useSemanticElements: el panel agrupa ejemplos de todo tipo (badges, tablas, formularios enteros), no los controles de un formulario: un <fieldset> diría otra cosa y su `min-inline-size` rompe el layout
    <div
      ref={setRoot}
      role="group"
      aria-label={`Ejemplo en ${THEME_LABEL[theme].toLowerCase()}`}
      aria-busy={mounted ? undefined : true}
      data-slot="catalog-panel"
      data-theme={theme}
      hidden={hidden}
      className={cn(
        THEME_CLASS[theme],
        'min-w-0 rounded-xl border border-border bg-background p-4 text-foreground sm:p-6',
      )}
    >
      <div aria-hidden="true" className="mb-4 flex flex-wrap items-center gap-2">
        <span className="type-caption text-subtle-foreground">{THEME_LABEL[theme]}</span>
        {sample ? <Badge size="sm">Datos de ejemplo</Badge> : null}
      </div>
      {mounted ? (
        <PanelThemeProvider theme={theme}>
          <PortalContainerProvider container={root}>
            <ConfirmProvider>
              <ControlSizeProvider size={density === 'compact' ? 'sm' : 'md'}>
                {children}
              </ControlSizeProvider>
            </ConfirmProvider>
          </PortalContainerProvider>
        </PanelThemeProvider>
      ) : (
        <div
          aria-hidden="true"
          data-slot="catalog-panel-placeholder"
          className={cn('flex flex-col gap-3', wide ? 'min-h-96' : 'min-h-48')}
        >
          <Skeleton className="h-4 w-40" />
          <Skeleton className="h-9 w-full max-w-md" />
          <Skeleton className="h-9 w-2/3" />
        </div>
      )}
    </div>
  )
}

/**
 * ¿Ya está cerca de la pantalla? Una vez que sí, queda en sí (lo montado no se
 * desmonta: lo que se tocó no se pierde). Sin `IntersectionObserver`, monta.
 */
function useNearViewport(eager: boolean) {
  const ref = React.useRef<HTMLDivElement>(null)
  const [near, setNear] = React.useState(eager)
  React.useEffect(() => {
    if (near) return
    const element = ref.current
    if (!element) return
    if (typeof IntersectionObserver === 'undefined') {
      setNear(true)
      return
    }
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setNear(true)
          observer.disconnect()
        }
      },
      // Una pantalla y media antes: al llegar, el ejemplo ya está.
      { rootMargin: '150% 0px' },
    )
    observer.observe(element)
    return () => observer.disconnect()
  }, [near])
  return { ref, near }
}

export type ThemePanelsProps = {
  /** Lo que se dibuja en cada panel (se monta dos veces: cada panel tiene su propio estado). */
  children: React.ReactNode
  /**
   * Plantillas, tablas y libros: siempre uno debajo del otro. Lado a lado, en
   * una laptop de 1.280 px cada panel mediría unos 350 px.
   */
  wide?: boolean
  /** Marca los paneles con «Datos de ejemplo». */
  sample?: boolean
  className?: string
}

/**
 * El claro y el oscuro, lado a lado desde `xl` y apilados debajo (§6.2). Con
 * la vista «Claro» u «Oscuro» del encabezado, el otro panel se esconde
 * (`hidden`): sigue montado, así lo que se tocó en él no se pierde.
 *
 * Los ejemplos se montan cuando el bloque se acerca a la pantalla (con
 * `eager`, de entrada): montados todos juntos son unos 30.000 elementos y el
 * primer HTML pesaría 2,6 MB. El encabezado, el uso y las notas de cada bloque
 * van siempre, así las anclas del índice y la búsqueda del navegador los
 * encuentran; al montarse un bloque que quedó arriba, el anclaje de scroll del
 * navegador deja quieto lo que se está mirando.
 */
export function ThemePanels({
  children,
  wide = false,
  sample = false,
  className,
}: ThemePanelsProps) {
  const { view, eager } = useCatalog()
  const { ref, near } = useNearViewport(eager)
  const split = view === 'both' && !wide
  return (
    <div
      ref={ref}
      data-slot="catalog-panels"
      className={cn('grid min-w-0 gap-4', split && 'xl:grid-cols-2', className)}
    >
      <ThemePanel theme="light" hidden={view === 'dark'} sample={sample} mounted={near} wide={wide}>
        {children}
      </ThemePanel>
      <ThemePanel theme="dark" hidden={view === 'light'} sample={sample} mounted={near} wide={wide}>
        {children}
      </ThemePanel>
    </div>
  )
}
