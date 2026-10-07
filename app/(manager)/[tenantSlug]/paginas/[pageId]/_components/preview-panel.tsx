'use client'

import {
  History,
  Lightbulb,
  Maximize2,
  Monitor,
  RotateCw,
  Smartphone,
  TriangleAlert,
  X,
} from 'lucide-react'
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Callout, type CalloutTone } from '@/components/ui/callout'
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog'
import { SegmentedControl, type SegmentedItem } from '@/components/ui/segmented-control'
import type { LandingCheck, LandingCheckLevel } from '@/lib/landings/checks'
import { LANDING_PREVIEW_SANDBOX } from '@/lib/landings/security'
import { cn } from '@/lib/utils'
import { DownloadHtmlButton } from './download-button'

/**
 * La vista previa y la revisión rápida.
 *
 * El iframe usa EXACTAMENTE los mismos flags de sandbox con los que se sirve la
 * página publicada (lib/landings/security.ts). Es la única forma de que la
 * previa no mienta: si el JS de la landing usa localStorage, acá también se
 * rompe, y el dueño se entera antes de mandar el link por Instagram.
 *
 * "Escritorio" renderiza a 1280px y lo achica con un scale: mostrar una página
 * de escritorio dentro de una columna de 380px sin escalar daría una versión
 * mobile, o sea justo lo contrario de lo que se quiere revisar.
 */

const DESKTOP_WIDTH = 1280
// Tope, no ancho fijo: la columna de la previa llega como máximo a 26rem y,
// descontando bordes y padding, quedan ~382px de contenido. Un marco de 390px
// clavado se recortaba y dejaba scroll horizontal para siempre.
const PHONE_WIDTH = 390

type Device = 'movil' | 'escritorio'

/** Celular o escritorio: un filtro de una sola opción (radios), con nombre para el lector. */
const DEVICE_ITEMS: SegmentedItem<Device>[] = [
  { value: 'movil', icon: Smartphone, label: <span className="sr-only">Celular</span> },
  { value: 'escritorio', icon: Monitor, label: <span className="sr-only">Escritorio</span> },
]

/**
 * El alto del escenario en escritorio: el resto de la pantalla debajo del
 * topbar, la barra del editor (`--editor-bar-h`, la mide el editor) y la
 * cabecera de esta tarjeta, con lugar para la revisión de abajo.
 */
const STAGE_HEIGHT =
  'h-[42dvh] lg:h-[calc(100dvh-var(--topbar-h)-var(--editor-bar-h,7rem)-13.5rem)] lg:min-h-[26rem]'

export function PreviewPanel({
  html,
  checks,
  note,
  viewingLabel,
  viewingFileName,
  onExitViewing,
  onRestoreViewing,
  pending,
}: {
  html: string
  checks: LandingCheck[]
  /** Aclaración fija sobre lo que esta previa no puede mostrar. */
  note: string | null
  /** Si está, la previa muestra una versión vieja y no el código actual. */
  viewingLabel: string | null
  /** Nombre del .html de esa versión vieja (lleva su fecha, no la de hoy). */
  viewingFileName: string | null
  onExitViewing: () => void
  onRestoreViewing?: () => void
  pending: boolean
}) {
  const [device, setDevice] = useState<Device>('movil')
  const [expanded, setExpanded] = useState(false)
  // Fuerza recargar el iframe (remonta por `key`) cuando se toca "actualizar".
  const [reloadKey, setReloadKey] = useState(0)

  const deviceSwitch = (
    <SegmentedControl
      aria-label="Ver la previa como"
      size="sm"
      items={DEVICE_ITEMS}
      value={device}
      onValueChange={setDevice}
    />
  )

  return (
    <div className="flex flex-col gap-3">
      <section
        aria-label="Vista previa"
        className="overflow-clip rounded-xl border border-border bg-card"
      >
        <header className="flex items-center justify-between gap-2 border-b border-border px-3 py-2">
          {deviceSwitch}
          <div className="flex items-center gap-1">
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="Actualizar la vista previa"
              onClick={() => setReloadKey((n) => n + 1)}
            >
              <RotateCw aria-hidden />
            </Button>
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="Ver la previa en grande"
              onClick={() => setExpanded(true)}
            >
              <Maximize2 aria-hidden />
            </Button>
          </div>
        </header>

        {viewingLabel ? (
          <div
            role="status"
            className="flex flex-wrap items-center gap-2 border-b border-border bg-warning-soft px-3 py-2"
          >
            <History className="size-4 shrink-0 text-warning-text" aria-hidden />
            <p className="min-w-0 flex-1 type-small text-foreground">
              Estás viendo la {viewingLabel.toLowerCase()}
            </p>
            {/* Para pasarle a ChatGPT la versión que andaba, sin tener que
                restaurarla y pisar lo que hay en el editor. */}
            {viewingFileName ? (
              <DownloadHtmlButton
                html={html}
                fileName={() => viewingFileName}
                label="Descargar esta versión como .html"
                showLabel={false}
                variant="ghost"
                size="sm"
              />
            ) : null}
            {onRestoreViewing ? (
              <Button size="sm" variant="secondary" disabled={pending} onClick={onRestoreViewing}>
                Restaurar
              </Button>
            ) : null}
            <Button
              size="icon-sm"
              variant="ghost"
              aria-label="Volver al código actual"
              onClick={onExitViewing}
            >
              <X aria-hidden />
            </Button>
          </div>
        ) : null}

        {note ? (
          <p className="border-b border-border bg-secondary px-3 py-2 type-caption text-pretty text-muted-foreground">
            {note}
          </p>
        ) : null}

        <PreviewStage key={reloadKey} html={html} device={device} className={STAGE_HEIGHT} />
      </section>

      <ChecksList checks={checks} />

      <Dialog open={expanded} onOpenChange={setExpanded}>
        <DialogContent className="h-[92dvh] w-[96vw] max-w-none gap-0 overflow-hidden p-0 sm:max-w-none">
          <DialogTitle className="sr-only">Vista previa de la página</DialogTitle>
          {/* `pe-14`: deja lugar a la X del diálogo, que va arriba a la derecha. */}
          <div className="flex items-center gap-1 border-b border-border px-3 py-3 pe-14">
            {deviceSwitch}
          </div>
          <PreviewStage html={html} device={device} className="h-[calc(92dvh-3.5rem)]" />
        </DialogContent>
      </Dialog>
    </div>
  )
}

/** El escenario: fondo neutro + el documento del bar adentro de un iframe. */
function PreviewStage({
  html,
  device,
  className,
}: {
  html: string
  device: Device
  className?: string
}) {
  const stageRef = useRef<HTMLDivElement>(null)
  const [stageWidth, setStageWidth] = useState(0)

  // Medimos el ancho real para calcular el scale del modo escritorio.
  useLayoutEffect(() => {
    const node = stageRef.current
    if (!node) return
    setStageWidth(node.clientWidth)
    const observer = new ResizeObserver(([entry]) => {
      if (entry) setStageWidth(entry.contentRect.width)
    })
    observer.observe(node)
    return () => observer.disconnect()
  }, [])

  const isDesktop = device === 'escritorio'
  // 32px de aire a los costados; nunca agrandamos (scale > 1 se vería borroso).
  const scale = isDesktop ? Math.min(1, Math.max(0.15, (stageWidth - 32) / DESKTOP_WIDTH)) : 1

  return (
    <div
      ref={stageRef}
      className={cn('grid place-items-center overflow-auto bg-muted/60 p-4', className)}
    >
      {/* Los marcos van en blanco: es el lienzo por defecto de una página web,
          lo que se ve al abrir el link publicado (no un color del panel). */}
      {isDesktop ? (
        <div
          // El wrapper reserva el alto REAL que ocupa el iframe escalado; si no,
          // el contenedor cree que mide 800px y aparece un scroll fantasma.
          style={{ width: DESKTOP_WIDTH * scale, height: 800 * scale }}
          className="overflow-hidden rounded-lg border border-border-strong bg-white"
        >
          <PreviewFrame
            html={html}
            style={{
              width: DESKTOP_WIDTH,
              height: 800,
              transform: `scale(${scale})`,
              transformOrigin: 'top left',
            }}
          />
        </div>
      ) : (
        <div
          className="h-full w-full overflow-hidden rounded-[1.75rem] border-[6px] border-foreground/85 bg-white"
          style={{ maxWidth: PHONE_WIDTH }}
        >
          <PreviewFrame html={html} className="size-full" />
        </div>
      )}
    </div>
  )
}

function PreviewFrame({
  html,
  className,
  style,
}: {
  html: string
  className?: string
  style?: React.CSSProperties
}) {
  // `srcDoc` como estado local para no re-renderizar el iframe en cada tecla:
  // el padre ya manda el valor con debounce, pero esto evita además que un
  // re-render por otra razón (abrir un menú) recargue la página del bar.
  const [doc, setDoc] = useState(html)
  useEffect(() => setDoc(html), [html])

  return (
    <iframe
      title="Vista previa de la página"
      srcDoc={doc}
      // Los MISMOS flags que el CSP de la página publicada: sin allow-same-origin.
      sandbox={LANDING_PREVIEW_SANDBOX}
      className={cn('border-0 bg-white', className)}
      style={style}
    />
  )
}

/** Cada nivel de la revisión con su aviso del kit: error, aviso o consejo. */
const CHECK_CALLOUT: Record<LandingCheckLevel, { tone: CalloutTone; icon?: typeof TriangleAlert }> =
  {
    error: { tone: 'danger' },
    aviso: { tone: 'warning', icon: TriangleAlert },
    tip: { tone: 'neutral', icon: Lightbulb },
  }

function ChecksList({ checks }: { checks: LandingCheck[] }) {
  if (checks.length === 0) {
    return <Callout tone="success">Todo en orden. La página está lista para publicar.</Callout>
  }

  return (
    <section aria-label="Revisión del código" className="flex flex-col gap-2">
      {checks.map((check) => {
        const look = CHECK_CALLOUT[check.level]
        return (
          <Callout key={check.id} tone={look.tone} icon={look.icon} title={check.title}>
            {check.detail}
          </Callout>
        )
      })}
    </section>
  )
}
