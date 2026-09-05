'use client'

import {
  AlertTriangle,
  CheckCircle2,
  History,
  Info,
  Lightbulb,
  Maximize2,
  Monitor,
  RotateCw,
  Smartphone,
  X,
} from 'lucide-react'
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog'
import type { LandingCheck, LandingCheckLevel } from '@/lib/landings/checks'
import { LANDING_PREVIEW_SANDBOX } from '@/lib/landings/security'
import { cn } from '@/lib/utils'

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

export function PreviewPanel({
  html,
  checks,
  viewingLabel,
  onExitViewing,
  onRestoreViewing,
  pending,
}: {
  html: string
  checks: LandingCheck[]
  /** Si está, la previa muestra una versión vieja y no el código actual. */
  viewingLabel: string | null
  onExitViewing: () => void
  onRestoreViewing?: () => void
  pending: boolean
}) {
  const [device, setDevice] = useState<Device>('movil')
  const [expanded, setExpanded] = useState(false)
  // Fuerza recargar el iframe (remonta por `key`) cuando se toca "actualizar".
  const [reloadKey, setReloadKey] = useState(0)

  return (
    <div className="space-y-3">
      <section className="card-hairline overflow-hidden rounded-xl border bg-card">
        <header className="flex items-center justify-between gap-2 border-b border-border/60 px-3 py-2">
          <div className="flex items-center gap-1">
            <DeviceButton
              active={device === 'movil'}
              onClick={() => setDevice('movil')}
              label="Ver como celular"
            >
              <Smartphone className="size-4" aria-hidden />
            </DeviceButton>
            <DeviceButton
              active={device === 'escritorio'}
              onClick={() => setDevice('escritorio')}
              label="Ver como escritorio"
            >
              <Monitor className="size-4" aria-hidden />
            </DeviceButton>
          </div>

          <div className="flex items-center gap-1">
            <Button
              variant="ghost"
              size="icon"
              aria-label="Actualizar la vista previa"
              onClick={() => setReloadKey((n) => n + 1)}
            >
              <RotateCw className="size-4" aria-hidden />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              aria-label="Ver la previa en grande"
              onClick={() => setExpanded(true)}
            >
              <Maximize2 className="size-4" aria-hidden />
            </Button>
          </div>
        </header>

        {viewingLabel ? (
          <div className="flex flex-wrap items-center gap-2 border-b border-amber-500/30 bg-amber-500/10 px-3 py-2">
            <History className="size-4 shrink-0 text-amber-700 dark:text-amber-400" aria-hidden />
            <p className="min-w-0 flex-1 text-xs text-amber-800 dark:text-amber-300">
              Estás viendo la {viewingLabel.toLowerCase()}
            </p>
            {onRestoreViewing ? (
              <Button size="sm" variant="outline" disabled={pending} onClick={onRestoreViewing}>
                Restaurar
              </Button>
            ) : null}
            <Button
              size="icon"
              variant="ghost"
              aria-label="Volver al código actual"
              onClick={onExitViewing}
            >
              <X className="size-4" aria-hidden />
            </Button>
          </div>
        ) : null}

        <PreviewStage
          key={reloadKey}
          html={html}
          device={device}
          className="h-[42dvh] lg:h-[calc(100dvh-22rem)] lg:min-h-[26rem]"
        />
      </section>

      <ChecksList checks={checks} />

      <Dialog open={expanded} onOpenChange={setExpanded}>
        <DialogContent className="h-[92dvh] w-[96vw] max-w-none gap-0 overflow-hidden p-0 sm:max-w-none">
          <DialogTitle className="sr-only">Vista previa de la página</DialogTitle>
          <div className="flex items-center gap-1 border-b border-border/60 px-3 py-2">
            <DeviceButton
              active={device === 'movil'}
              onClick={() => setDevice('movil')}
              label="Ver como celular"
            >
              <Smartphone className="size-4" aria-hidden />
            </DeviceButton>
            <DeviceButton
              active={device === 'escritorio'}
              onClick={() => setDevice('escritorio')}
              label="Ver como escritorio"
            >
              <Monitor className="size-4" aria-hidden />
            </DeviceButton>
          </div>
          <PreviewStage html={html} device={device} className="h-[calc(92dvh-3rem)]" />
        </DialogContent>
      </Dialog>
    </div>
  )
}

function DeviceButton({
  active,
  onClick,
  label,
  children,
}: {
  active: boolean
  onClick: () => void
  label: string
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      aria-pressed={active}
      className={cn(
        // El reset global apaga el outline del navegador (globals.css): cada
        // control tiene que traer su propio anillo de foco.
        'inline-flex size-8 items-center justify-center rounded-md outline-none transition-colors duration-[var(--duration-fast)] focus-visible:ring-[3px] focus-visible:ring-ring/50',
        active
          ? 'bg-primary/10 text-primary'
          : 'text-muted-foreground hover:bg-cream-tint hover:text-foreground',
      )}
    >
      {children}
    </button>
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
      className={cn(
        'grid place-items-center overflow-auto bg-[color-mix(in_oklab,var(--muted)_60%,transparent)] p-4',
        className,
      )}
    >
      {isDesktop ? (
        <div
          // El wrapper reserva el alto REAL que ocupa el iframe escalado; si no,
          // el contenedor cree que mide 800px y aparece un scroll fantasma.
          style={{ width: DESKTOP_WIDTH * scale, height: 800 * scale }}
          className="overflow-hidden rounded-lg border border-border/70 bg-white shadow-sm"
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
          className="h-full w-full overflow-hidden rounded-[1.75rem] border-[6px] border-foreground/85 bg-white shadow-lg"
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

const CHECK_STYLES: Record<
  LandingCheckLevel,
  { icon: typeof AlertTriangle; wrapper: string; iconClass: string }
> = {
  error: {
    icon: AlertTriangle,
    wrapper: 'border-destructive/30 bg-destructive/5',
    iconClass: 'text-destructive',
  },
  aviso: {
    icon: Info,
    wrapper: 'border-amber-500/30 bg-amber-500/5',
    iconClass: 'text-amber-600 dark:text-amber-400',
  },
  tip: {
    icon: Lightbulb,
    wrapper: 'border-border/70 bg-card',
    iconClass: 'text-muted-foreground',
  },
}

function ChecksList({ checks }: { checks: LandingCheck[] }) {
  if (checks.length === 0) {
    return (
      <div className="card-hairline flex items-center gap-2.5 rounded-xl border border-emerald-500/30 bg-emerald-500/5 px-4 py-3">
        <CheckCircle2
          className="size-4 shrink-0 text-emerald-600 dark:text-emerald-400"
          aria-hidden
        />
        <p className="text-sm text-foreground">
          Todo en orden. La página está lista para publicar.
        </p>
      </div>
    )
  }

  return (
    <section aria-label="Revisión del código" className="space-y-2">
      {checks.map((check) => {
        const style = CHECK_STYLES[check.level]
        const Icon = style.icon
        return (
          <div
            key={check.id}
            className={cn('card-hairline flex gap-2.5 rounded-xl border px-4 py-3', style.wrapper)}
          >
            <Icon className={cn('mt-0.5 size-4 shrink-0', style.iconClass)} aria-hidden />
            <div className="min-w-0 space-y-0.5">
              <p className="text-sm font-medium leading-snug">{check.title}</p>
              <p className="text-xs leading-relaxed text-muted-foreground text-pretty">
                {check.detail}
              </p>
            </div>
          </div>
        )
      })}
    </section>
  )
}
