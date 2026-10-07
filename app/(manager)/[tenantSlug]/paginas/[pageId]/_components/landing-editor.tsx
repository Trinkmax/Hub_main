'use client'

import { ArrowUpRight, Check, Clock, Code2, FileUp, Images, Settings2, Upload } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useCallback, useEffect, useId, useMemo, useRef, useState, useTransition } from 'react'
import { toast } from 'sonner'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { CopyButton } from '@/components/ui/copy-button'
import { EmptyState } from '@/components/ui/empty-state'
import { FormActions } from '@/components/ui/form-actions'
import { Label } from '@/components/ui/label'
import { PageHeader } from '@/components/ui/page-header'
import { PageShell } from '@/components/ui/page-shell'
import { ReloadLink } from '@/components/ui/reload-link'
import { StatusBadge } from '@/components/ui/status-badge'
import { Switch } from '@/components/ui/switch'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { formatDateTime } from '@/lib/dates'
import { formatNumber } from '@/lib/format/number-kind'
import {
  fetchLandingVersionHtml,
  restoreLandingVersion,
  saveLandingHtml,
  setLandingPublished,
} from '@/lib/landings/actions'
import { analyzeLandingHtml, summarizeChecks } from '@/lib/landings/checks'
import { landingFileName } from '@/lib/landings/download'
import type { LandingPageDetail, LandingVersionRow, LandingViewPoint } from '@/lib/landings/queries'
import { LANDING_HTML_MAX_CHARS, LANDING_HTML_MAX_LABEL } from '@/lib/landings/schemas'
import { HAS_LANDINGS_HOST } from '@/lib/landings/security'
import { cn } from '@/lib/utils'
import { DropOverlay } from '../../_components/drop-overlay'
import { LANDING_STATUS, landingStatus } from '../../_components/page-status'
import { DownloadHtmlButton } from './download-button'
import { HistoryPanel } from './history-panel'
import { MediaPanel } from './media-panel'
import { PreviewPanel } from './preview-panel'
import { SettingsDialog } from './settings-dialog'

/**
 * El editor de una página HTML.
 *
 * DOS IDEAS QUE MANDAN SOBRE TODO EL RESTO:
 *
 * 1. La previa NO puede mentir. Se renderiza con el mismo `sandbox` con el que
 *    se sirve la página publicada (ver lib/landings/security.ts), así que si
 *    algo no anda online, tampoco anda acá — y se ve antes de publicar.
 *
 * 2. `landing_pages.html` es lo que está EN VIVO. Mientras la página está
 *    apagada da igual, pero una vez publicada, guardar = publicar. Por eso el
 *    botón cambia de nombre según el estado, y cada guardado deja una versión
 *    en el historial.
 */

/** Lo que tarda en refrescarse la previa después de tipear. */
const PREVIEW_DEBOUNCE_MS = 400

/**
 * El alto del código en escritorio: lo que queda de la pantalla debajo del
 * topbar y de la barra del editor (`--editor-bar-h`, medida abajo), menos las
 * pestañas, la fila del tamaño y el aire de la página.
 */
const CODE_HEIGHT =
  'h-[52dvh] lg:h-[calc(100dvh-var(--topbar-h)-var(--editor-bar-h,7rem)-10.5rem)] lg:min-h-[24rem]'

/** «menos de 1 KB» mientras no llega al KB (redondeado daba «0 KB» con código adentro). */
function sizeLabel(chars: number): string {
  if (chars === 0) return '0 KB'
  if (chars < 1024) return 'menos de 1 KB'
  return `${formatNumber(Math.round(chars / 1024))} KB`
}

export function LandingEditor({
  tenantSlug,
  tenantId,
  page,
  versions,
  views,
  landingsBase,
  today,
}: {
  tenantSlug: string
  tenantId: string
  page: LandingPageDetail
  versions: LandingVersionRow[]
  views: LandingViewPoint[]
  /** Base pública ya resuelta: `${landingsBase}/${slug}` es el link. */
  landingsBase: string
  /** Hoy en Córdoba, resuelto en el server: las fechas relativas salen igual en los dos lados. */
  today: string
}) {
  const router = useRouter()
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const barRef = useRef<HTMLDivElement>(null)
  const sizeId = useId()

  const [html, setHtml] = useState(page.html)
  // Lo último confirmado por el server. La diferencia con `html` es lo que
  // todavía no se guardó.
  const [saved, setSaved] = useState(page.html)
  const [published, setPublished] = useState(page.published)
  const [tab, setTab] = useState<'codigo' | 'imagenes' | 'historial'>('codigo')
  const [pending, startTransition] = useTransition()

  // Una versión vieja que se está mirando en la previa (null = el código actual).
  const [viewing, setViewing] = useState<{ version: LandingVersionRow; html: string } | null>(null)
  // Archivo .html arrastrado cuando ya había código: hay que confirmar antes de pisar.
  const [droppedHtml, setDroppedHtml] = useState<string | null>(null)
  const [settingsOpen, setSettingsOpen] = useState(false)
  // Intento de volver al listado con cambios sin guardar.
  const [leaving, setLeaving] = useState(false)
  // Hay un archivo encima del editor ahora mismo (todo el editor es zona de
  // drop, no sólo el textarea: si estás mirando Imágenes o Historial y soltás
  // tu landing, tiene que entrar igual).
  const [dropping, setDropping] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)
  // Sube en cada apertura de Ajustes: remonta el diálogo para que su estado
  // (link, indexable) vuelva a salir de las props. Sin esto, cancelar dejaba lo
  // tipeado en memoria y el guardado siguiente aplicaba cambios descartados.
  const [settingsSession, setSettingsSession] = useState(0)

  const dirty = html !== saved
  const publicUrl = `${landingsBase}/${page.slug}`
  const backHref = `/${tenantSlug}/paginas`

  // La barra de arriba queda fija desde `sm` y su alto cambia con el ancho (los
  // botones bajan de fila): se mide y se publica como `--editor-bar-h` en la
  // raíz, así la previa fija y el alto del código se acomodan debajo de ella.
  useEffect(() => {
    const bar = barRef.current
    const root = bar?.parentElement
    if (!bar || !root) return
    const update = () => root.style.setProperty('--editor-bar-h', `${bar.offsetHeight}px`)
    update()
    const observer = new ResizeObserver(update)
    observer.observe(bar)
    return () => {
      observer.disconnect()
      root.style.removeProperty('--editor-bar-h')
    }
  }, [])

  // La previa se recalcula con retraso: recargar el iframe en cada tecla hace
  // parpadear la pantalla y come CPU con landings pesadas.
  const [debouncedHtml, setDebouncedHtml] = useState(page.html)
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedHtml(html), PREVIEW_DEBOUNCE_MS)
    return () => clearTimeout(timer)
  }, [html])

  // Con host dedicado la página publicada NO va sandboxeada: avisar de
  // localStorage o de los videos sería mentir al revés.
  const checks = useMemo(
    () => analyzeLandingHtml(debouncedHtml, { isolated: !HAS_LANDINGS_HOST }),
    [debouncedHtml],
  )
  // Para la marca de la pestaña: estando en Imágenes o Historial, la revisión
  // queda fuera de la vista y hay que avisar igual.
  const checkCount = useMemo(() => summarizeChecks(checks), [checks])
  // La previa usa `srcdoc`, y ahí NUNCA podemos dar allow-same-origin (heredaría
  // el origen del panel, con la sesión adentro). O sea que los embebidos no se
  // reproducen acá aunque sí lo hagan publicados: hay que decirlo.
  const previewNote =
    HAS_LANDINGS_HOST && /<iframe/i.test(debouncedHtml)
      ? 'Los videos y mapas no se reproducen en esta previa (está aislada). En la página publicada sí.'
      : null
  const chars = html.length
  const overflow = chars > LANDING_HTML_MAX_CHARS

  const save = useCallback(
    (options: { silent?: boolean } = {}) =>
      new Promise<boolean>((resolve) => {
        if (overflow) {
          toast.error(
            `El código pasa los ${LANDING_HTML_MAX_LABEL}. Sacá las imágenes pegadas adentro del HTML y subilas en la pestaña Imágenes.`,
          )
          resolve(false)
          return
        }
        startTransition(async () => {
          const result = await saveLandingHtml(tenantSlug, { id: page.id, html })
          if (result.ok) {
            setSaved(html)
            if (!options.silent) {
              toast.success(published ? 'Cambios publicados.' : 'Guardado.')
            }
            router.refresh()
            resolve(true)
          } else {
            toast.error(result.message)
            resolve(false)
          }
        })
      }),
    [html, overflow, page.id, published, router, tenantSlug],
  )

  // ⌘S / Ctrl+S: el reflejo de cualquiera que escriba código.
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 's') {
        event.preventDefault()
        if (dirty) void save()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [dirty, save])

  // Cerrar la pestaña con cambios sin guardar tiene que costar una pregunta.
  useEffect(() => {
    if (!dirty) return
    function onBeforeUnload(event: BeforeUnloadEvent) {
      event.preventDefault()
    }
    window.addEventListener('beforeunload', onBeforeUnload)
    return () => window.removeEventListener('beforeunload', onBeforeUnload)
  }, [dirty])

  function togglePublished(next: boolean) {
    startTransition(async () => {
      // Publicar con cambios sin guardar publicaría la versión vieja: primero
      // se guarda lo que está en pantalla.
      if (next && dirty) {
        const okSave = await saveLandingHtml(tenantSlug, { id: page.id, html })
        if (!okSave.ok) {
          toast.error(okSave.message)
          return
        }
        setSaved(html)
      }
      const result = await setLandingPublished(tenantSlug, { id: page.id, published: next })
      if (result.ok) {
        setPublished(next)
        toast.success(next ? '¡Página publicada!' : 'Página despublicada.')
        router.refresh()
      } else {
        toast.error(result.message)
      }
    })
  }

  /** Inserta texto en la posición del cursor del textarea (o al final). */
  const insertAtCursor = useCallback((snippet: string) => {
    const node = textareaRef.current
    setHtml((current) => {
      if (!node) return `${current}\n${snippet}`
      const start = node.selectionStart ?? current.length
      const end = node.selectionEnd ?? current.length
      const next = `${current.slice(0, start)}${snippet}${current.slice(end)}`
      // El cursor queda después de lo insertado, listo para seguir escribiendo.
      requestAnimationFrame(() => {
        node.focus()
        const caret = start + snippet.length
        node.setSelectionRange(caret, caret)
      })
      return next
    })
    setTab('codigo')
  }, [])

  async function loadFile(file: File) {
    if (!/\.html?$/i.test(file.name) && file.type !== 'text/html') {
      // El error más probable: soltar una foto en el editor en vez de en la
      // galería. Decirlo así ahorra el viaje a preguntar.
      toast.error(
        file.type.startsWith('image/')
          ? 'Eso es una imagen: soltala en la pestaña Imágenes.'
          : 'Tiene que ser un archivo .html',
      )
      return
    }
    const text = await file.text()
    if (text.length > LANDING_HTML_MAX_CHARS) {
      toast.error(
        `Ese archivo pesa ${Math.round(text.length / 1024)} KB y el máximo es ${LANDING_HTML_MAX_LABEL}. Casi siempre es por imágenes pegadas adentro del HTML: subilas en la pestaña Imágenes.`,
      )
      return
    }
    setTab('codigo')
    if (html.trim().length > 0) {
      setDroppedHtml(text)
      return
    }
    setHtml(text)
    toast.success(`"${file.name}" cargado. Mirá la previa y guardá.`)
  }

  function viewVersion(version: LandingVersionRow) {
    startTransition(async () => {
      const result = await fetchLandingVersionHtml(tenantSlug, {
        id: page.id,
        versionId: version.id,
      })
      if (result.ok) setViewing({ version, html: result.html })
      else toast.error(result.message)
    })
  }

  function restoreVersion(version: LandingVersionRow) {
    startTransition(async () => {
      // El diálogo promete que "lo que tenés ahora queda guardado en el
      // historial": para que sea verdad, el buffer sin guardar se guarda ANTES
      // (cada guardado deja su versión). Si no, restaurar borraba trabajo sin
      // dejar rastro en ningún lado.
      if (html !== saved) {
        const kept = await saveLandingHtml(tenantSlug, { id: page.id, html })
        if (!kept.ok) {
          toast.error(kept.message)
          return
        }
        setSaved(html)
      }

      const result = await restoreLandingVersion(tenantSlug, {
        id: page.id,
        versionId: version.id,
      })
      if (!result.ok) {
        toast.error(result.message)
        return
      }
      const loaded = await fetchLandingVersionHtml(tenantSlug, {
        id: page.id,
        versionId: version.id,
      })
      if (loaded.ok) {
        setHtml(loaded.html)
        setSaved(loaded.html)
        setDebouncedHtml(loaded.html)
      }
      setViewing(null)
      setTab('codigo')
      toast.success('Versión restaurada.')
      router.refresh()
    })
  }

  /**
   * La navegación del App Router no dispara `beforeunload`: sin esta guarda,
   * volver al listado con cambios sin guardar los perdía sin una sola pregunta.
   * Se intercepta en captura el click del «← Páginas» del encabezado (también
   * llega con Enter): el `<Link>` ve el evento cancelado y no navega.
   */
  function guardBackLink(event: React.MouseEvent<HTMLDivElement>) {
    if (!dirty) return
    const target = event.target
    if (!(target instanceof Element) || !target.closest('[data-slot="page-back"]')) return
    event.preventDefault()
    setLeaving(true)
  }

  const saveLabel = dirty ? (published ? 'Publicar cambios' : 'Guardar') : 'Guardado'
  const renderSaveButton = (className?: string) => (
    <Button
      onClick={() => void save()}
      disabled={!dirty || overflow}
      loading={pending}
      className={className}
    >
      {dirty ? null : <Check aria-hidden />}
      {saveLabel}
    </Button>
  )

  return (
    <PageShell
      width="wide"
      className="relative gap-4"
      // Soltar el archivo es un atajo: «Subir .html» hace exactamente lo mismo con teclado.
      onDragOver={(event) => {
        // Sólo reaccionamos a archivos: arrastrar texto seleccionado dentro del
        // textarea no tiene que prender la zona de drop.
        if (!event.dataTransfer.types.includes('Files')) return
        event.preventDefault()
        setDropping(true)
      }}
      onDragLeave={(event) => {
        // `dragleave` también salta al pasar de un hijo a otro: sólo apagamos
        // cuando el puntero se fue de verdad del editor.
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
          setDropping(false)
        }
      }}
      onDrop={(event) => {
        if (!event.dataTransfer.types.includes('Files')) return
        event.preventDefault()
        setDropping(false)
        const file = event.dataTransfer.files?.[0]
        if (file) void loadFile(file)
      }}
    >
      {/* El input vive acá arriba porque lo abren dos lugares: el botón de la
          pestaña Código y el cartel del editor vacío. */}
      <input
        ref={fileInputRef}
        type="file"
        accept=".html,.htm,text/html"
        className="sr-only"
        tabIndex={-1}
        aria-hidden
        onChange={(event) => {
          const file = event.target.files?.[0]
          if (file) void loadFile(file)
          // Permite volver a elegir el MISMO archivo después de corregirlo.
          event.target.value = ''
        }}
      />

      {dropping ? <DropOverlay description="Lo cargamos en el editor al instante." /> : null}

      {/* ── Barra de la página ───────────────────────────── */}
      {/* Fija debajo del topbar desde `sm` (z-10: el topbar es z-20 y tiene que
          quedar arriba). En el celular no se fija: ocuparía media pantalla, y
          el «Guardar» va en la barra de abajo. */}
      <div
        ref={barRef}
        data-slot="landing-editor-bar"
        onClickCapture={guardBackLink}
        className="-mx-4 border-b border-border bg-background px-4 pb-4 sm:sticky sm:top-(--topbar-h) sm:z-10 sm:-mx-6 sm:px-6 sm:pt-3 lg:-mx-8 lg:px-8"
      >
        <PageHeader
          back={{ href: backHref, label: 'Páginas' }}
          title={page.title}
          meta={[
            <StatusBadge key="estado" status={landingStatus(published)} map={LANDING_STATUS} />,
            dirty ? (
              <Badge key="sin-guardar" tone="warning" dot>
                Sin guardar
              </Badge>
            ) : null,
            <span key="link" className="inline-flex min-w-0 max-w-full items-center gap-1">
              <code className="truncate font-mono">{publicUrl.replace(/^https?:\/\//, '')}</code>
              <CopyButton
                value={publicUrl}
                iconOnly
                variant="ghost"
                size="icon-sm"
                label="Copiar link"
                copiedLabel="¡Copiado!"
              />
            </span>,
          ]}
          actions={
            <>
              {/* Baja lo que está en el editor, no lo último guardado: si
                  retocaste algo y se lo vas a pasar a ChatGPT, es eso lo que
                  tiene que ver. */}
              <DownloadHtmlButton
                html={html}
                fileName={() => landingFileName(page.slug, new Date())}
                label="Descargar el código como .html"
                onDownloaded={() => {
                  if (!dirty) return
                  toast.info('Descargado con cambios sin guardar', {
                    description: published
                      ? 'El archivo tiene lo que ves en el editor, pero la página en vivo todavía no.'
                      : 'El archivo tiene lo que ves en el editor, pero acá todavía no está guardado.',
                  })
                }}
              />

              <PublishToggle published={published} pending={pending} onChange={togglePublished} />

              {published ? (
                <Button asChild variant="secondary">
                  <ReloadLink
                    href={publicUrl}
                    newTab
                    aria-label="Ver la página publicada (se abre en otra pestaña)"
                  >
                    <span className="max-sm:hidden">Ver</span>
                    <ArrowUpRight aria-hidden />
                  </ReloadLink>
                </Button>
              ) : null}

              <Button
                variant="secondary"
                size="icon"
                aria-label="Ajustes de la página"
                onClick={() => {
                  setSettingsSession((n) => n + 1)
                  setSettingsOpen(true)
                }}
              >
                <Settings2 aria-hidden />
              </Button>

              {/* En el celular el «Guardar» va en la barra fija de abajo. */}
              {renderSaveButton('max-sm:hidden')}
            </>
          }
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(22rem,26rem)] lg:items-start">
        {/* ── Previa (arriba en celular, a la derecha en escritorio) ── */}
        <div className="order-1 lg:sticky lg:top-[calc(var(--topbar-h)+var(--editor-bar-h,7rem)+1rem)] lg:order-2">
          <PreviewPanel
            html={viewing ? viewing.html : debouncedHtml}
            checks={checks}
            note={previewNote}
            viewingLabel={
              viewing ? `Versión del ${formatDateTime(viewing.version.createdAt)}` : null
            }
            viewingFileName={
              viewing ? landingFileName(page.slug, new Date(viewing.version.createdAt)) : null
            }
            onExitViewing={() => setViewing(null)}
            onRestoreViewing={viewing ? () => restoreVersion(viewing.version) : undefined}
            pending={pending}
          />
        </div>

        {/* ── Panel de trabajo ────────────────────────────── */}
        <div className="order-2 min-w-0 lg:order-1">
          <Tabs
            value={tab}
            onValueChange={(value) => {
              if (value === 'codigo' || value === 'imagenes' || value === 'historial') setTab(value)
            }}
          >
            <TabsList aria-label="Partes del editor">
              <TabsTrigger value="codigo" icon={Code2}>
                Código
                {checkCount.errors > 0 ? (
                  <Badge tone="danger" className="type-amount">
                    {checkCount.errors}
                    <span className="sr-only">
                      {checkCount.errors === 1
                        ? ' problema para revisar'
                        : ' problemas para revisar'}
                    </span>
                  </Badge>
                ) : null}
              </TabsTrigger>
              <TabsTrigger value="imagenes" icon={Images}>
                Imágenes
              </TabsTrigger>
              <TabsTrigger
                value="historial"
                icon={Clock}
                count={versions.length > 0 ? versions.length : undefined}
              >
                Historial
              </TabsTrigger>
            </TabsList>

            {/* forceMount + `hidden`: sin esto Radix DESMONTA el textarea al
                cambiar de pestaña, `textareaRef.current` queda en null y
                "Insertar" desde Imágenes pegaba el <img> al final del archivo
                (después de </html>) en vez de en el cursor. */}
            <TabsContent
              value="codigo"
              forceMount
              className={tab === 'codigo' ? undefined : 'hidden'}
            >
              <div className="flex flex-col gap-2">
                <div className="flex items-center justify-between gap-3">
                  <span
                    id={sizeId}
                    className={cn(
                      'type-caption type-amount',
                      overflow ? 'text-destructive-text' : 'text-muted-foreground',
                    )}
                  >
                    {sizeLabel(chars)} de {LANDING_HTML_MAX_LABEL}
                    {overflow ? ': sacá las imágenes pegadas y subilas en Imágenes' : null}
                  </span>
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => fileInputRef.current?.click()}
                  >
                    <Upload aria-hidden />
                    Subir .html
                  </Button>
                </div>
                <CodePanel
                  ref={textareaRef}
                  value={html}
                  onChange={setHtml}
                  onPick={() => fileInputRef.current?.click()}
                  overflow={overflow}
                  describedBy={sizeId}
                />
              </div>
            </TabsContent>

            <TabsContent value="imagenes">
              <MediaPanel tenantId={tenantId} onInsert={insertAtCursor} />
            </TabsContent>

            <TabsContent value="historial">
              <HistoryPanel
                versions={versions}
                views={views}
                totalViews={page.views}
                lastViewedAt={page.lastViewedAt}
                today={today}
                pending={pending}
                onView={viewVersion}
                onRestore={restoreVersion}
              />
            </TabsContent>
          </Tabs>
        </div>
      </div>

      {/* Celular: el «Guardar» fijo abajo, a mano del pulgar. */}
      <div className="sm:hidden">
        <FormActions>{renderSaveButton()}</FormActions>
      </div>

      <SettingsDialog
        key={settingsSession}
        tenantSlug={tenantSlug}
        page={page}
        urlPrefix={`${landingsBase.replace(/^https?:\/\//, '')}/`}
        open={settingsOpen}
        onOpenChange={setSettingsOpen}
      />

      {/* Salir con cambios sin guardar: tres caminos, no una confirmación. La
          principal es la que no pierde nada. */}
      <AlertDialog open={leaving} onOpenChange={setLeaving}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Tenés cambios sin guardar</AlertDialogTitle>
            <AlertDialogDescription>
              Si salís ahora, se pierde lo que escribiste desde la última vez que guardaste.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Seguir editando</AlertDialogCancel>
            <AlertDialogAction variant="danger-ghost" onClick={() => router.push(backHref)}>
              Salir sin guardar
            </AlertDialogAction>
            <Button
              loading={pending}
              onClick={async () => {
                const ok = await save()
                if (ok) {
                  setLeaving(false)
                  router.push(backHref)
                }
              }}
            >
              {published ? 'Publicar y salir' : 'Guardar y salir'}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <ConfirmDialog
        open={droppedHtml !== null}
        onOpenChange={(open) => {
          if (!open) setDroppedHtml(null)
        }}
        title="¿Reemplazar el código actual?"
        description="El archivo que soltaste va a pisar todo lo que hay en el editor. Si la página estaba publicada, todavía podés volver atrás desde el historial."
        confirmLabel="Reemplazar código"
        onConfirm={() => {
          if (droppedHtml !== null) {
            setHtml(droppedHtml)
            toast.success('Archivo cargado. Revisá la previa y guardá.')
          }
        }}
      />
    </PageShell>
  )
}

/**
 * Publicar o despublicar al toque (es una acción, con su aviso). La etiqueta
 * dice el estado («En vivo») o lo que hace («Publicar»); en el celular queda
 * solo para el lector de pantalla.
 */
function PublishToggle({
  published,
  pending,
  onChange,
}: {
  published: boolean
  pending: boolean
  onChange: (next: boolean) => void
}) {
  const id = useId()
  return (
    <div className="flex h-(--control-md) items-center gap-2 rounded-md border border-border-strong bg-card px-3">
      <Switch id={id} checked={published} onCheckedChange={onChange} disabled={pending} />
      <Label htmlFor={id} className="cursor-pointer max-sm:sr-only">
        {published ? 'En vivo' : 'Publicar'}
      </Label>
    </div>
  )
}

function CodePanel({
  ref,
  value,
  onChange,
  onPick,
  overflow,
  describedBy,
}: {
  ref: React.RefObject<HTMLTextAreaElement | null>
  value: string
  onChange: (value: string) => void
  onPick: () => void
  overflow: boolean
  /** El tamaño del código («12 KB de 2 MB»), que el lector lee con el campo. */
  describedBy: string
}) {
  // Con el editor vacío, el textarea solo no comunica que se puede arrastrar un
  // archivo: el cartel se dibuja ENCIMA pero sin capturar el mouse
  // (`pointer-events-none`), así que hacer click igual entra a escribir. Sólo el
  // botón vuelve a ser clickeable.
  const empty = value.trim().length === 0

  return (
    <div
      className={cn(
        'relative overflow-clip rounded-xl border border-border bg-card',
        // El foco del textarea se dibuja en la caja, «sobre el borde» como en
        // todo campo del kit.
        'outline-(--ring) -outline-offset-1 focus-within:outline-2',
        overflow && 'border-destructive outline-(--destructive)',
      )}
    >
      <textarea
        ref={ref}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        spellCheck={false}
        autoCapitalize="off"
        autoCorrect="off"
        aria-label="Código HTML de la página"
        aria-describedby={describedBy}
        aria-invalid={overflow || undefined}
        className={cn(
          'block w-full resize-y bg-transparent p-4 font-mono text-[13px] leading-relaxed text-foreground outline-none',
          CODE_HEIGHT,
        )}
      />

      {empty ? (
        <EmptyState
          icon={FileUp}
          title="Arrastrá tu archivo .html acá"
          description="O pegá el código directamente: hacé click en cualquier lado y escribí."
          action={
            <Button variant="secondary" size="sm" className="pointer-events-auto" onClick={onPick}>
              <Upload aria-hidden />
              Buscar el archivo en la compu
            </Button>
          }
          className="pointer-events-none absolute inset-0"
        />
      ) : null}
    </div>
  )
}
