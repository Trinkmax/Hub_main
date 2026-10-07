'use client'

import { Film, Upload, X } from 'lucide-react'
import { useId, useRef, useState, useTransition } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Spinner } from '@/components/ui/spinner'
import { posterUrlFor } from '@/lib/menu/media-urls'
import { uploadMenuVideo } from '@/lib/menu/upload-video'
import { cn } from '@/lib/utils'

// Slot de video del ítem: mismo lenguaje visual que MenuImageUploader
// (drag&drop o click, Cambiar/Quitar). Muestra el poster pregenerado
// (`..._vp.webp`) o un placeholder con icono Film si todavía no existe.

const ACCEPTED = ['video/mp4', 'video/webm', 'video/quicktime']

function prettyBytes(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`
  return `${(n / (1024 * 1024)).toFixed(1)} MB`
}

function pickVideoFile(items: DataTransferItemList | null | undefined): File | null {
  if (!items) return null
  for (const it of items) {
    if (it.kind === 'file' && it.type.startsWith('video/')) {
      const f = it.getAsFile()
      if (f) return f
    }
  }
  return null
}

/** Poster del video con fallback a placeholder si (todavía) no existe. */
function PosterThumb({ videoUrl }: { videoUrl: string }) {
  const [failed, setFailed] = useState(false)
  const poster = posterUrlFor(videoUrl)
  if (!poster || failed) {
    return (
      <div className="flex h-full w-full items-center justify-center bg-secondary text-muted-foreground">
        <Film className="size-5" aria-hidden />
      </div>
    )
  }
  return (
    // biome-ignore lint/performance/noImgElement: optimizer de Vercel agotado — servimos variantes pregeneradas de Storage
    <img
      src={poster}
      alt="Vista previa del video"
      className="h-full w-full object-cover"
      onError={() => setFailed(true)}
    />
  )
}

export function MenuVideoUploader({
  tenantId,
  value,
  onChange,
  label = 'Video (opcional)',
}: {
  tenantId: string
  value: string | null
  onChange: (url: string | null) => void
  label?: string
}) {
  const labelId = useId()
  const inputRef = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)
  const [dragging, setDragging] = useState(false)
  const dragDepth = useRef(0)
  const [, startTransition] = useTransition()

  const onPick = () => inputRef.current?.click()

  const onFile = (file: File | undefined) => {
    if (!file) return
    if (!ACCEPTED.includes(file.type)) {
      toast.error('Formato no soportado. Subí un video MP4, WebM o MOV.')
      return
    }
    setBusy(true)
    const toastId = toast.loading(`Subiendo video… ${prettyBytes(file.size)}`)
    startTransition(async () => {
      try {
        const { publicUrl } = await uploadMenuVideo({ tenantId, file })
        onChange(publicUrl)
        toast.success(`Video listo · ${prettyBytes(file.size)}`, { id: toastId })
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'No pudimos subir el video.'
        toast.error(msg, { id: toastId })
      } finally {
        setBusy(false)
        if (inputRef.current) inputRef.current.value = ''
      }
    })
  }

  const onDragEnter = (e: React.DragEvent) => {
    if (busy) return
    e.preventDefault()
    e.stopPropagation()
    dragDepth.current += 1
    if (e.dataTransfer.types.includes('Files')) setDragging(true)
  }
  const onDragOver = (e: React.DragEvent) => {
    if (busy) return
    e.preventDefault()
    e.stopPropagation()
    e.dataTransfer.dropEffect = 'copy'
  }
  const onDragLeave = (e: React.DragEvent) => {
    if (busy) return
    e.preventDefault()
    e.stopPropagation()
    dragDepth.current = Math.max(0, dragDepth.current - 1)
    if (dragDepth.current === 0) setDragging(false)
  }
  const onDrop = (e: React.DragEvent) => {
    if (busy) return
    e.preventDefault()
    e.stopPropagation()
    dragDepth.current = 0
    setDragging(false)
    const file = pickVideoFile(e.dataTransfer.items) ?? e.dataTransfer.files[0]
    onFile(file)
  }

  const dnd = { onDragEnter, onDragOver, onDragLeave, onDrop }

  return (
    <fieldset
      aria-labelledby={labelId}
      aria-busy={busy || undefined}
      data-slot="video-uploader"
      className="grid min-w-0 gap-2"
    >
      <span id={labelId} className="type-label text-foreground">
        {label}
      </span>
      {/* Fuera del orden de Tab: lo abre el botón de abajo (una sola parada). */}
      <input
        ref={inputRef}
        type="file"
        accept="video/mp4,video/webm,video/quicktime"
        className="sr-only"
        tabIndex={-1}
        aria-hidden="true"
        onChange={(e) => onFile(e.target.files?.[0])}
      />

      {value ? (
        <div
          {...dnd}
          data-dragging={dragging || undefined}
          className={cn(
            'flex items-center gap-3 rounded-lg border p-2 transition-colors duration-(--duration-quick)',
            dragging ? 'border-primary bg-selected' : 'border-border bg-card',
          )}
        >
          <div className="relative size-16 shrink-0 overflow-hidden rounded-md bg-secondary">
            <PosterThumb videoUrl={value} />
          </div>
          <div className="min-w-0 flex-1">
            <p className="type-label text-foreground">
              {dragging ? 'Soltá para reemplazar' : 'Video cargado'}
            </p>
            <p className="type-caption text-muted-foreground">
              {dragging ? '\u00a0' : 'Tocá «Cambiar» o arrastrá otro video.'}
            </p>
          </div>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={onPick}
            loading={busy}
            loadingText="Subiendo…"
          >
            <Upload aria-hidden="true" />
            Cambiar
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            onClick={() => onChange(null)}
            disabled={busy}
            aria-label="Quitar el video"
          >
            <X aria-hidden="true" />
          </Button>
        </div>
      ) : (
        <button
          type="button"
          onClick={onPick}
          disabled={busy}
          data-dragging={dragging || undefined}
          {...dnd}
          className={cn(
            'flex min-h-24 flex-col items-center justify-center gap-1 rounded-lg border border-dashed px-3 py-5 text-center',
            'transition-colors duration-(--duration-quick) outline-offset-2 outline-(--ring) focus-visible:outline-2',
            'disabled:cursor-not-allowed',
            dragging
              ? 'border-primary bg-selected text-foreground'
              : 'border-border-strong bg-card text-muted-foreground hover:bg-hover hover:text-foreground',
          )}
        >
          {busy ? (
            <span className="flex items-center gap-2 type-label">
              <Spinner size={16} aria-hidden />
              Subiendo…
            </span>
          ) : dragging ? (
            <span className="flex items-center gap-2 type-label">
              <Upload className="size-4" aria-hidden="true" />
              Soltá para subir
            </span>
          ) : (
            <>
              <span className="flex items-center gap-2 type-label">
                <Film className="size-4" aria-hidden="true" />
                Subir video
              </span>
              <span className="max-w-sm type-caption text-pretty text-subtle-foreground">
                o arrastrá un video · hasta 55 MB y 90 s · mejor en MP4 (los .mov de iPhone pueden
                no verse en Android)
              </span>
            </>
          )}
        </button>
      )}
    </fieldset>
  )
}
