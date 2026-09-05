'use client'

import { format } from 'date-fns'
import { es } from 'date-fns/locale'
import {
  ArrowLeft,
  ArrowUpRight,
  Check,
  Clock,
  Code2,
  Images,
  Loader2,
  Settings2,
  Upload,
} from 'lucide-react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from 'react'
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
import { CopyButton } from '@/components/ui/copy-button'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import {
  fetchLandingVersionHtml,
  restoreLandingVersion,
  saveLandingHtml,
  setLandingPublished,
} from '@/lib/landings/actions'
import { analyzeLandingHtml, summarizeChecks } from '@/lib/landings/checks'
import type { LandingPageDetail, LandingVersionRow, LandingViewPoint } from '@/lib/landings/queries'
import { LANDING_HTML_MAX_CHARS } from '@/lib/landings/schemas'
import { cn } from '@/lib/utils'
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

export function LandingEditor({
  tenantSlug,
  tenantId,
  page,
  versions,
  views,
  appUrl,
}: {
  tenantSlug: string
  tenantId: string
  page: LandingPageDetail
  versions: LandingVersionRow[]
  views: LandingViewPoint[]
  appUrl: string
}) {
  const router = useRouter()
  const textareaRef = useRef<HTMLTextAreaElement>(null)

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
  // Sube en cada apertura de Ajustes: remonta el diálogo para que su estado
  // (link, indexable) vuelva a salir de las props. Sin esto, cancelar dejaba lo
  // tipeado en memoria y el guardado siguiente aplicaba cambios descartados.
  const [settingsSession, setSettingsSession] = useState(0)

  const dirty = html !== saved
  const publicUrl = `${appUrl}/p/${page.slug}`

  // La previa se recalcula con retraso: recargar el iframe en cada tecla hace
  // parpadear la pantalla y come CPU con landings pesadas.
  const [debouncedHtml, setDebouncedHtml] = useState(page.html)
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedHtml(html), PREVIEW_DEBOUNCE_MS)
    return () => clearTimeout(timer)
  }, [html])

  const checks = useMemo(() => analyzeLandingHtml(debouncedHtml), [debouncedHtml])
  // Para el punto rojo de la solapa: estando en Imágenes o Historial, la
  // revisión queda fuera de la vista y hay que avisar igual.
  const checkCount = useMemo(() => summarizeChecks(checks), [checks])
  const chars = html.length
  const overflow = chars > LANDING_HTML_MAX_CHARS

  const save = useCallback(
    (options: { silent?: boolean } = {}) =>
      new Promise<boolean>((resolve) => {
        if (overflow) {
          toast.error('El código pasa los 512 KB. Sacá las imágenes pegadas adentro del HTML.')
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
      toast.error('Tiene que ser un archivo .html')
      return
    }
    const text = await file.text()
    if (text.length > LANDING_HTML_MAX_CHARS) {
      toast.error('El archivo pasa los 512 KB. Subí las imágenes por separado.')
      return
    }
    if (html.trim().length > 0) {
      setDroppedHtml(text)
      return
    }
    setHtml(text)
    toast.success('Archivo cargado. Revisá la previa y guardá.')
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

  return (
    <div className="mx-auto w-full max-w-screen-2xl space-y-4 px-4 py-6 sm:px-6 lg:px-8">
      {/* ── Barra de la página ───────────────────────────── */}
      {/* top-16 y z-10: el topbar del shell es `sticky top-0 z-20 h-14`. Con el
          mismo z-index ganaba esta barra (va después en el DOM) y tapaba el
          menú, el ⌘K y el avatar al scrollear. */}
      <header className="card-hairline sticky top-16 z-10 rounded-xl border bg-card/95 px-4 py-3 backdrop-blur supports-[backdrop-filter]:bg-card/80">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-3">
          {/* La navegación del App Router no dispara `beforeunload`: sin este
              guard, volver al listado con cambios sin guardar los perdía sin
              una sola pregunta. */}
          <Button
            asChild
            variant="ghost"
            size="icon"
            aria-label="Volver a Páginas"
            onClick={(event) => {
              if (dirty) {
                event.preventDefault()
                setLeaving(true)
              }
            }}
          >
            <Link href={`/${tenantSlug}/paginas`}>
              <ArrowLeft className="size-4" aria-hidden />
            </Link>
          </Button>

          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <h1 className="truncate font-serif text-xl font-semibold tracking-tight">
                {page.title}
              </h1>
              {published ? (
                <Badge variant="secondary">Publicada</Badge>
              ) : (
                <Badge variant="outline">Borrador</Badge>
              )}
              {dirty ? (
                <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-500/15 px-2 py-0.5 text-[11px] font-medium text-amber-700 dark:text-amber-400">
                  <span className="size-1.5 rounded-full bg-amber-500" aria-hidden />
                  Sin guardar
                </span>
              ) : null}
            </div>
            <div className="mt-0.5 flex items-center gap-1.5">
              <code className="truncate font-mono text-xs text-muted-foreground">
                {publicUrl.replace(/^https?:\/\//, '')}
              </code>
              <CopyButton
                value={publicUrl}
                iconOnly
                variant="ghost"
                size="sm"
                label="Copiar link"
                copiedLabel="¡Copiado!"
              />
            </div>
          </div>

          {/* flex-wrap + textos que se esconden abajo de sm: con la página
              publicada, los cuatro controles no entran en 360px de ancho. */}
          <div className="flex flex-wrap items-center justify-end gap-2">
            <div className="flex items-center gap-2 rounded-lg border border-border/70 px-2.5 py-1.5 sm:px-3">
              <Switch
                id="published"
                checked={published}
                onCheckedChange={togglePublished}
                disabled={pending}
                aria-label="Publicar página"
              />
              <Label htmlFor="published" className="hidden cursor-pointer text-xs sm:inline">
                {published ? 'En vivo' : 'Publicar'}
              </Label>
            </div>

            {published ? (
              <Button asChild variant="outline" size="sm">
                <a
                  href={publicUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  title="Ver la página publicada"
                >
                  <span className="hidden sm:inline">Ver</span>
                  <ArrowUpRight className="size-4" aria-hidden />
                  <span className="sr-only sm:hidden">Ver la página publicada</span>
                </a>
              </Button>
            ) : null}

            <Button
              variant="ghost"
              size="icon"
              aria-label="Ajustes de la página"
              onClick={() => {
                setSettingsSession((n) => n + 1)
                setSettingsOpen(true)
              }}
            >
              <Settings2 className="size-4" aria-hidden />
            </Button>

            <Button onClick={() => void save()} disabled={!dirty || pending || overflow}>
              {pending ? (
                <Loader2 className="size-4 animate-spin" aria-hidden />
              ) : dirty ? null : (
                <Check className="size-4" aria-hidden />
              )}
              {dirty ? (published ? 'Publicar cambios' : 'Guardar') : 'Guardado'}
            </Button>
          </div>
        </div>
      </header>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(22rem,26rem)] lg:items-start">
        {/* ── Previa (arriba en celular, a la derecha en escritorio) ── */}
        <div className="order-1 lg:order-2 lg:sticky lg:top-[9.5rem]">
          <PreviewPanel
            html={viewing ? viewing.html : debouncedHtml}
            checks={checks}
            viewingLabel={
              viewing
                ? `Versión del ${format(new Date(viewing.version.createdAt), "d 'de' MMM HH:mm", { locale: es })}`
                : null
            }
            onExitViewing={() => setViewing(null)}
            onRestoreViewing={viewing ? () => restoreVersion(viewing.version) : undefined}
            pending={pending}
          />
        </div>

        {/* ── Panel de trabajo ────────────────────────────── */}
        <div className="order-2 min-w-0 lg:order-1">
          <Tabs value={tab} onValueChange={(value) => setTab(value as typeof tab)}>
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <TabsList>
                <TabsTrigger value="codigo">
                  <Code2 className="size-4" aria-hidden />
                  Código
                  {checkCount.errors > 0 ? (
                    <span
                      className="ml-1 inline-flex min-w-4 items-center justify-center rounded-full bg-destructive px-1 text-[10px] font-semibold leading-4 text-destructive-foreground"
                      title={`${checkCount.errors} ${checkCount.errors === 1 ? 'problema' : 'problemas'} para revisar`}
                    >
                      {checkCount.errors}
                    </span>
                  ) : null}
                </TabsTrigger>
                <TabsTrigger value="imagenes">
                  <Images className="size-4" aria-hidden />
                  Imágenes
                </TabsTrigger>
                <TabsTrigger value="historial">
                  <Clock className="size-4" aria-hidden />
                  Historial
                  {versions.length > 0 ? (
                    <span className="ml-1 text-xs text-muted-foreground">{versions.length}</span>
                  ) : null}
                </TabsTrigger>
              </TabsList>

              {tab === 'codigo' ? (
                <div className="flex items-center gap-3">
                  <span
                    className={cn(
                      'font-mono text-xs tabular-nums',
                      overflow ? 'text-destructive' : 'text-muted-foreground',
                    )}
                  >
                    {Math.round(chars / 1024)} KB / 512 KB
                  </span>
                  <FilePicker onFile={loadFile} />
                </div>
              ) : null}
            </div>

            {/* forceMount + `hidden`: sin esto Radix DESMONTA el textarea al
                cambiar de solapa, `textareaRef.current` queda en null y
                "Insertar" desde Imágenes pegaba el <img> al final del archivo
                (después de </html>) en vez de en el cursor. */}
            <TabsContent
              value="codigo"
              forceMount
              className={tab === 'codigo' ? undefined : 'hidden'}
            >
              <CodePanel
                ref={textareaRef}
                value={html}
                onChange={setHtml}
                onFile={loadFile}
                overflow={overflow}
              />
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
                pending={pending}
                onView={viewVersion}
                onRestore={restoreVersion}
              />
            </TabsContent>
          </Tabs>
        </div>
      </div>

      <SettingsDialog
        key={settingsSession}
        tenantSlug={tenantSlug}
        page={page}
        urlPrefix={`${appUrl.replace(/^https?:\/\//, '')}/p/`}
        open={settingsOpen}
        onOpenChange={setSettingsOpen}
      />

      {/* Salir con cambios sin guardar */}
      <AlertDialog open={leaving} onOpenChange={setLeaving}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Tenés cambios sin guardar</AlertDialogTitle>
            <AlertDialogDescription>
              Si salís ahora se pierde lo que escribiste desde el último guardado.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Seguir editando</AlertDialogCancel>
            <Button
              variant="outline"
              disabled={pending}
              onClick={async () => {
                const ok = await save()
                if (ok) {
                  setLeaving(false)
                  router.push(`/${tenantSlug}/paginas`)
                }
              }}
            >
              Guardar y salir
            </Button>
            <AlertDialogAction
              onClick={(event) => {
                event.preventDefault()
                setLeaving(false)
                router.push(`/${tenantSlug}/paginas`)
              }}
            >
              Salir sin guardar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog
        open={droppedHtml !== null}
        onOpenChange={(open) => !open && setDroppedHtml(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Reemplazar el código actual?</AlertDialogTitle>
            <AlertDialogDescription>
              El archivo que soltaste va a pisar todo lo que hay en el editor. Si la página estaba
              publicada, todavía podés volver atrás desde el historial.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={(event) => {
                event.preventDefault()
                if (droppedHtml !== null) {
                  setHtml(droppedHtml)
                  setDroppedHtml(null)
                  toast.success('Archivo cargado. Revisá la previa y guardá.')
                }
              }}
            >
              Reemplazar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

/** Botón que abre el explorador de archivos (el mismo handler que el drop). */
function FilePicker({ onFile }: { onFile: (file: File) => void }) {
  const inputRef = useRef<HTMLInputElement>(null)
  return (
    <>
      <input
        ref={inputRef}
        type="file"
        accept=".html,.htm,text/html"
        className="sr-only"
        onChange={(event) => {
          const file = event.target.files?.[0]
          if (file) onFile(file)
          // Permite volver a elegir el MISMO archivo después de corregirlo.
          event.target.value = ''
        }}
      />
      <Button variant="outline" size="sm" onClick={() => inputRef.current?.click()}>
        <Upload className="size-4" aria-hidden />
        Subir .html
      </Button>
    </>
  )
}

function CodePanel({
  ref,
  value,
  onChange,
  onFile,
  overflow,
}: {
  ref: React.RefObject<HTMLTextAreaElement | null>
  value: string
  onChange: (value: string) => void
  onFile: (file: File) => void
  overflow: boolean
}) {
  const [dragging, setDragging] = useState(false)

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: soltar el archivo es un atajo; el botón "Subir .html" hace lo mismo con teclado.
    <div
      className={cn(
        'card-hairline relative overflow-hidden rounded-xl border bg-card transition-colors',
        dragging && 'border-primary ring-2 ring-primary/30',
        overflow && 'border-destructive',
      )}
      onDragOver={(event) => {
        event.preventDefault()
        setDragging(true)
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={(event) => {
        event.preventDefault()
        setDragging(false)
        const file = event.dataTransfer.files?.[0]
        if (file) onFile(file)
      }}
    >
      <textarea
        ref={ref}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        spellCheck={false}
        autoCapitalize="off"
        autoCorrect="off"
        aria-label="Código HTML de la página"
        placeholder={
          '<!doctype html>\n<html lang="es-AR">\n  <head>\n    <meta charset="utf-8">\n    <meta name="viewport" content="width=device-width, initial-scale=1">\n    <title>Halloween en el bar</title>\n  </head>\n  <body>\n    ¡Pegá acá tu landing!\n  </body>\n</html>'
        }
        className="block h-[52dvh] w-full resize-y bg-transparent p-4 font-mono text-[13px] leading-relaxed outline-none placeholder:text-muted-foreground/50 lg:h-[calc(100dvh-16rem)]"
      />

      {dragging ? (
        <div className="pointer-events-none absolute inset-0 grid place-items-center bg-card/85">
          <p className="font-serif text-lg font-semibold">Soltá el archivo .html</p>
        </div>
      ) : null}
    </div>
  )
}
