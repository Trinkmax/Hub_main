'use client'

import { Camera, FileText, FileUp, ImagePlus, RotateCcw, X } from 'lucide-react'
import {
  type DragEvent,
  type ReactNode,
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react'
import { useAccountingOptional } from '@/components/administracion/accounting-provider'
import { classifyDroppedFile } from '@/components/administracion/drop/classify'
import { onDroppedComprobante, takeDroppedFile } from '@/components/administracion/drop/drop-store'
import { Button, buttonVariants } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Skeleton } from '@/components/ui/skeleton'
import type { ArcaQrData } from '@/lib/accounting/arca-qr'
import {
  ATTACHMENT_ACCEPT,
  ATTACHMENT_MESSAGES,
  attachmentKind,
  attachmentRoom,
  checkAttachmentCandidate,
  formatAttachmentSize,
  guessAttachmentMime,
  MAX_ATTACHMENTS_PER_DOCUMENT,
} from '@/lib/accounting/attachments'
import { cn } from '@/lib/utils'
import { type UploadLinkState, useUploadLink } from './use-upload-link'

/**
 * El panel de la foto del comprobante: un QR para sacarla con el celular, o soltarla acá. Es el mismo
 * en la compra, en los gastos fijos y en el pago.
 *
 * Es controlado y no sube nada al comprobante, igual que `AttachmentPicker`: guarda los `File` en
 * `files` y avisa con `onFiles`. Cuando el formulario guarda, los sube `attachPendingFiles`.
 *
 * Cómo llega una foto: por el QR (la baja `useUploadLink`), soltándola acá o en cualquier lado de la
 * pantalla (`onDroppedComprobante`), o desde otra pantalla (`takeDropped`, con `?desde=archivo`). Si
 * la pantalla pasa `onRead`, se busca su QR de ARCA. Sin QR no pasa nada: la foto queda adjunta y se
 * tipea.
 *
 * Para que el QR vuelva a empezar (después de guardar, «Cargar otra»), montá el panel con otra `key`:
 * al desmontarse cierra el link y borra la copia temporal.
 */
export type FotoPanelProps = {
  tenantSlug: string
  files: readonly File[]
  onFiles: (files: File[]) => void
  /** Se leyó un QR de ARCA. Sin esto no se busca. */
  onRead?: (data: ArcaQrData) => void
  /** Más chico y en una sola fila: una hoja, un diálogo. */
  compact?: boolean
  /** Toma el archivo que se soltó en otra pantalla (`?desde=archivo`). */
  takeDropped?: boolean
  /** Mientras el formulario guarda. */
  disabled?: boolean
  className?: string
}

/** Cuánto se ve el escaneo aunque el QR se lea enseguida. */
const SCAN_MS = 1_050

const WIDE_QUERY = '(min-width: 768px)'

/** En el celular no hay QR: se saca la foto ahí mismo. Del lado del servidor, tampoco. */
function useWideScreen(): boolean {
  return useSyncExternalStore(
    (notify) => {
      const query = window.matchMedia(WIDE_QUERY)
      query.addEventListener('change', notify)
      return () => query.removeEventListener('change', notify)
    },
    () => window.matchMedia(WIDE_QUERY).matches,
    () => false,
  )
}

function sameFile(a: File, b: File): boolean {
  return a.name === b.name && a.size === b.size && a.lastModified === b.lastModified
}

function fileKey(file: File): string {
  return `${file.name}:${file.size}:${file.lastModified}`
}

function prefersReducedMotion(): boolean {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

type Reading = {
  key: string
  status: 'scanning' | 'read' | 'none'
}

/** Lo que entra por cualquiera de los caminos, y la lectura de su QR. */
function useFotoIntake({
  files,
  onFiles,
  onRead,
  takeDropped,
}: Pick<FotoPanelProps, 'files' | 'onFiles' | 'onRead' | 'takeDropped'>) {
  const [errors, setErrors] = useState<string[]>([])
  const [reading, setReading] = useState<Reading | null>(null)
  const [previews, setPreviews] = useState<ReadonlyMap<string, string>>(() => new Map())
  const previewsRef = useRef(previews)
  previewsRef.current = previews
  const mounted = useRef(true)
  // Lo que ya entró, sin esperar a que el padre vuelva a dibujar: el mismo archivo puede llegar dos
  // veces seguidas (soltado acá lo ve este panel y también el que escucha toda la pantalla).
  const current = useRef<readonly File[]>(files)
  current.current = files
  const handlers = useRef({ onFiles, onRead })
  handlers.current = { onFiles, onRead }

  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
      for (const url of previewsRef.current.values()) URL.revokeObjectURL(url)
    }
  }, [])

  const read = useCallback(async (file: File) => {
    const key = fileKey(file)
    setReading({ key, status: 'scanning' })
    const started = Date.now()
    const { readComprobante } = await import('./read-qr')
    const result = await readComprobante(file)
    if (!mounted.current) {
      if (result.previewUrl) URL.revokeObjectURL(result.previewUrl)
      return
    }
    if (result.previewUrl) {
      const url = result.previewUrl
      setPreviews((prev) => new Map(prev).set(key, url))
    }
    // Que se vea el escaneo también cuando el QR se lee al toque.
    if (!prefersReducedMotion()) await wait(Math.max(0, SCAN_MS - (Date.now() - started)))
    if (!mounted.current) return
    setReading((prev) => {
      if (prev?.key !== key) return prev
      return { key, status: result.qr ? 'read' : 'none' }
    })
    if (result.qr) handlers.current.onRead?.(result.qr)
  }, [])

  const add = useCallback(
    (picked: readonly File[]) => {
      const problems: string[] = []
      const fresh: File[] = []
      for (const file of picked) {
        if ([...current.current, ...fresh].some((other) => sameFile(other, file))) continue
        const check = checkAttachmentCandidate(file)
        if (check.ok) fresh.push(file)
        else problems.push(`${file.name}: ${check.message}`)
      }
      const { accept, overflow } = attachmentRoom(current.current.length, fresh.length)
      if (overflow > 0) problems.push(ATTACHMENT_MESSAGES.limit)
      setErrors(problems)
      const accepted = fresh.slice(0, accept)
      if (accepted.length === 0) return
      const next = [...current.current, ...accepted]
      current.current = next
      handlers.current.onFiles(next)
      if (handlers.current.onRead) {
        const first = accepted[0]
        if (first) void read(first)
      } else {
        setReading(null)
      }
    },
    [read],
  )

  const remove = useCallback((file: File) => {
    const next = current.current.filter((other) => other !== file)
    current.current = next
    handlers.current.onFiles(next)
    setErrors([])
    const key = fileKey(file)
    setReading((prev) => (prev?.key === key ? null : prev))
    setPreviews((prev) => {
      const url = prev.get(key)
      if (!url) return prev
      URL.revokeObjectURL(url)
      const without = new Map(prev)
      without.delete(key)
      return without
    })
  }, [])

  // Lo que se suelta en cualquier lado de la pantalla viene acá, sin navegar.
  useEffect(() => onDroppedComprobante((file) => add([file])), [add])

  // Lo que se soltó en otra pantalla y trajo hasta acá (`?desde=archivo`).
  useEffect(() => {
    if (!takeDropped) return
    const file = takeDroppedFile()
    if (file) add([file])
  }, [takeDropped, add])

  return { errors, reading, previews, add, remove }
}

/** Un botón que abre el selector de archivos. Se llega con Tab y se abre con Enter o Espacio. */
function PickButton({
  onFiles,
  capture = false,
  multiple = true,
  disabled = false,
  variant = 'outline',
  className,
  children,
}: {
  onFiles: (files: File[]) => void
  capture?: boolean
  multiple?: boolean
  disabled?: boolean
  variant?: 'default' | 'outline' | 'ghost'
  className?: string
  children: ReactNode
}) {
  return (
    <label className={cn('relative inline-flex', disabled && 'pointer-events-none', className)}>
      <input
        type="file"
        accept={ATTACHMENT_ACCEPT}
        capture={capture ? 'environment' : undefined}
        multiple={multiple && !capture}
        disabled={disabled}
        className="peer sr-only"
        onChange={(event) => {
          const picked = Array.from(event.currentTarget.files ?? [])
          // Para poder elegir el mismo archivo otra vez.
          event.currentTarget.value = ''
          if (picked.length > 0) onFiles(picked)
        }}
      />
      <span
        className={cn(
          buttonVariants({ variant }),
          'w-full cursor-pointer peer-focus-visible:border-ring peer-focus-visible:ring-[3px] peer-focus-visible:ring-ring/50',
          disabled && 'opacity-50',
        )}
      >
        {children}
      </span>
    </label>
  )
}

/** El QR, con lo que corresponda mientras no está. */
function QrBlock({
  state,
  retry,
  compact,
}: {
  state: UploadLinkState
  retry: () => void
  compact: boolean
}) {
  const box = cn('shrink-0 rounded-lg', compact ? 'size-24' : 'size-[124px]')
  if (state.status === 'ready') {
    return (
      <div
        role="img"
        aria-label="Código QR para subir la foto desde el celular"
        className={cn(box, 'adm-breathe border border-border/70 bg-white p-1.5 [&_svg]:size-full')}
        // biome-ignore lint/security/noDangerouslySetInnerHtml: lo dibuja `qrcode` en el servidor a partir de nuestra URL
        dangerouslySetInnerHTML={{ __html: state.link.qrSvg }}
      />
    )
  }
  if (state.status === 'error' || state.status === 'expired') {
    return (
      <div
        role="status"
        className={cn(
          box,
          'grid place-content-center justify-items-center gap-1.5 border border-border/70 bg-secondary/40 p-2 text-center',
        )}
      >
        <p className="text-xs text-muted-foreground text-pretty">
          {state.status === 'expired' ? 'Este QR venció.' : 'No pudimos armar el QR.'}
        </p>
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="h-8 gap-1 px-2"
          onClick={retry}
        >
          <RotateCcw className="size-3" aria-hidden />
          Otro
        </Button>
      </div>
    )
  }
  return <Skeleton className={box} />
}

function useObjectUrl(file: File | null): string | null {
  const [url, setUrl] = useState<string | null>(null)
  useEffect(() => {
    if (!file) {
      setUrl(null)
      return
    }
    const next = URL.createObjectURL(file)
    setUrl(next)
    return () => URL.revokeObjectURL(next)
  }, [file])
  return url
}

/** La foto: cae al panel y, mientras se lee, la cruza el escaneo. */
function PhotoCard({
  file,
  preview,
  scanning,
  compact,
}: {
  file: File
  /** La primera página, si es un PDF. */
  preview: string | null
  scanning: boolean
  compact: boolean
}) {
  const mime = guessAttachmentMime(file)
  const drawable = mime !== null && attachmentKind(mime) === 'image'
  const objectUrl = useObjectUrl(drawable ? file : null)
  const src = drawable ? objectUrl : preview
  return (
    <div
      className={cn(
        'adm-land relative mx-auto w-full max-w-md overflow-hidden rounded-md border border-border bg-white shadow-[0_8px_18px_rgb(0_0_0/0.16)]',
        scanning && 'adm-scan',
      )}
    >
      {src ? (
        // biome-ignore lint/performance/noImgElement: un blob local: next/image no aplica
        <img
          src={src}
          alt="Foto del comprobante"
          className={cn('block h-auto w-full object-contain', compact ? 'max-h-40' : 'max-h-72')}
        />
      ) : (
        <div className="flex h-28 flex-col items-center justify-center gap-1.5 p-3 text-neutral-600">
          <FileText className="size-7" aria-hidden />
          <span className="max-w-full truncate text-xs">{file.name}</span>
        </div>
      )}
    </div>
  )
}

export function FotoPanel({
  tenantSlug,
  files,
  onFiles,
  onRead,
  compact = false,
  takeDropped = false,
  disabled = false,
  className,
}: FotoPanelProps) {
  const accounting = useAccountingOptional()
  const wide = useWideScreen()
  const { errors, reading, previews, add, remove } = useFotoIntake({
    files,
    onFiles,
    onRead,
    takeDropped,
  })
  const link = useUploadLink({
    tenantSlug,
    enabled: wide && accounting?.readOnly !== true,
    onFile: (file) => add([file]),
  })

  const shown = files.at(-1) ?? null
  const others = files.slice(0, -1)
  const shownKey = shown ? fileKey(shown) : null
  const shownReading = reading && reading.key === shownKey ? reading : null
  const full = files.length >= MAX_ATTACHMENTS_PER_DOCUMENT

  const onDrop = (event: DragEvent<HTMLElement>) => {
    // Sin frenar el evento: el que escucha toda la pantalla tiene que enterarse para sacar su aviso.
    // Si le llega el primero de nuevo, acá ya está y no entra dos veces.
    event.preventDefault()
    const dropped = Array.from(event.dataTransfer.files).filter(
      (file) => classifyDroppedFile(file) === 'comprobante',
    )
    if (dropped.length > 0) add(dropped)
  }

  return (
    <section
      aria-label="Foto del comprobante"
      onDrop={onDrop}
      onDragOver={(event) => event.preventDefault()}
      className={cn(
        '@container relative grid justify-items-center gap-2.5 rounded-xl border-[1.5px] bg-card text-center transition-colors motion-reduce:transition-none',
        compact ? 'p-3' : 'p-3.5',
        shown ? 'border-solid border-border/70' : 'border-dashed border-border',
        className,
      )}
    >
      {shown ? (
        <>
          <PhotoCard
            key={shownKey}
            file={shown}
            preview={shownKey ? (previews.get(shownKey) ?? null) : null}
            scanning={shownReading?.status === 'scanning'}
            compact={compact}
          />
          {shownReading?.status === 'scanning' ? (
            <p role="status" className="text-xs text-muted-foreground">
              Leyendo el comprobante…
            </p>
          ) : null}
          {shownReading?.status === 'read' ? (
            <p
              role="status"
              className="adm-rise w-full rounded-md bg-success/10 px-2.5 py-1.5 text-left text-[12.5px] text-success"
            >
              <b className="font-semibold">Leímos el QR de ARCA.</b> Revisá y listo.
            </p>
          ) : null}
          {others.length > 0 ? (
            <ul className="grid w-full gap-1 text-left">
              {others.map((file) => (
                <li
                  key={fileKey(file)}
                  className="flex items-center gap-2 rounded-md bg-secondary/50 py-0.5 pr-0.5 pl-2 text-xs"
                >
                  <span className="min-w-0 flex-1 truncate">{file.name}</span>
                  <span className="shrink-0 text-muted-foreground">
                    {formatAttachmentSize(file.size)}
                  </span>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="size-9 shrink-0 text-muted-foreground hover:text-destructive md:size-7"
                    aria-label={`Quitar ${file.name}`}
                    disabled={disabled}
                    onClick={() => remove(file)}
                  >
                    <X className="size-3.5" aria-hidden />
                  </Button>
                </li>
              ))}
            </ul>
          ) : null}
          <div className="flex flex-wrap items-center justify-center gap-1.5">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-11 text-muted-foreground md:h-8"
              disabled={disabled}
              onClick={() => remove(shown)}
            >
              Cambiar la foto
            </Button>
            {full ? null : (
              <PickButton onFiles={add} variant="ghost" disabled={disabled}>
                <ImagePlus className="size-4" aria-hidden />
                Otra
              </PickButton>
            )}
          </div>
        </>
      ) : (
        // Angosto (al costado de la factura), una columna. Con lugar (arriba, en una tablet), el QR al
        // lado de lo que explica.
        <div
          className={cn(
            'grid w-full justify-items-center gap-2.5',
            'md:@md:grid-cols-[auto_minmax(0,1fr)] md:@md:items-center md:@md:justify-items-start md:@md:text-left',
            compact &&
              'md:@xs:grid-cols-[auto_minmax(0,1fr)] md:@xs:items-center md:@xs:justify-items-start md:@xs:text-left',
          )}
        >
          <div className="hidden md:block">
            <QrBlock state={link.state} retry={link.retry} compact={compact} />
          </div>
          <div
            className={cn(
              'grid w-full justify-items-center gap-1.5',
              'md:@md:justify-items-start',
              compact && 'md:@xs:justify-items-start',
            )}
          >
            <h2 className="hidden text-sm font-semibold md:block">Escanealo y sacale la foto</h2>
            <p className="hidden text-xs text-muted-foreground text-pretty md:block">
              O arrastrá la foto o el PDF acá.
              {onRead ? ' Si es factura electrónica, se completa sola.' : null}
            </p>
            <PickButton
              onFiles={add}
              capture
              multiple={false}
              variant="default"
              disabled={disabled}
              className="w-full md:hidden"
            >
              <Camera className="size-4" aria-hidden />
              Sacar la foto
            </PickButton>
            <PickButton
              onFiles={add}
              variant="ghost"
              disabled={disabled}
              className="w-full text-muted-foreground md:w-auto"
            >
              <FileUp className="size-4" aria-hidden />
              Elegir un archivo
            </PickButton>
          </div>
        </div>
      )}

      {link.problem ? (
        <p role="alert" className="w-full text-left text-xs text-destructive text-pretty">
          {link.problem}
        </p>
      ) : null}
      {errors.length > 0 ? (
        <div role="alert" className="grid w-full gap-0.5 text-left text-xs text-destructive">
          {errors.map((message) => (
            <p key={message} className="text-pretty">
              {message}
            </p>
          ))}
        </div>
      ) : null}
    </section>
  )
}

/**
 * La misma foto para una fila de una planilla: un botón que abre el QR en un diálogo. El link se abre
 * al abrir el diálogo y se cierra al cerrarlo; las fotos quedan en `files`.
 */
export function FotoQrButton({
  tenantSlug,
  files,
  onFiles,
  onRead,
  label = 'Foto',
  disabled = false,
  className,
}: Omit<FotoPanelProps, 'compact' | 'takeDropped'> & {
  /** Lo que dice el botón sin fotos. */
  label?: string
}) {
  const [open, setOpen] = useState(false)
  const count = files.length
  return (
    <>
      <Button
        type="button"
        size="sm"
        variant="outline"
        disabled={disabled}
        aria-label={
          count === 0
            ? `${label} del comprobante`
            : count === 1
              ? 'Foto del comprobante: 1 cargada'
              : `Foto del comprobante: ${count} cargadas`
        }
        className={cn('h-11 gap-1.5 md:h-8', className)}
        onClick={() => setOpen(true)}
      >
        <Camera className="size-3.5" aria-hidden />
        {count > 0 ? (count === 1 ? '1 foto' : `${count} fotos`) : label}
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Foto del comprobante</DialogTitle>
            <DialogDescription className="sr-only">
              Escaneá el código con el celular y sacale la foto, o elegí un archivo.
            </DialogDescription>
          </DialogHeader>
          {open ? (
            <FotoPanel
              tenantSlug={tenantSlug}
              files={files}
              onFiles={onFiles}
              onRead={onRead}
              disabled={disabled}
            />
          ) : null}
        </DialogContent>
      </Dialog>
    </>
  )
}
