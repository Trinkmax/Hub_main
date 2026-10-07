'use client'

import { Film, Loader2, Upload, X } from 'lucide-react'
import { useRef, useState, useTransition } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
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
    <div className="grid gap-1.5">
      <span className="text-xs text-muted-foreground">{label}</span>
      <input
        ref={inputRef}
        type="file"
        accept="video/mp4,video/webm,video/quicktime"
        className="sr-only"
        onChange={(e) => onFile(e.target.files?.[0])}
      />

      {value ? (
        <div
          {...dnd}
          className={cn(
            'relative flex items-center gap-3 rounded-lg border bg-card/40 p-2 transition-colors',
            dragging ? 'border-primary bg-primary/5 ring-2 ring-primary/40' : 'border-border/60',
          )}
        >
          <div className="relative size-16 shrink-0 overflow-hidden rounded-md bg-secondary">
            <PosterThumb videoUrl={value} />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-xs font-medium">
              {dragging ? 'Soltá para reemplazar' : 'Video cargado'}
            </p>
            <p className="text-[10px] text-muted-foreground">
              {dragging ? ' ' : 'Arrastrá otro video para reemplazarlo'}
            </p>
          </div>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={onPick}
            disabled={busy}
            className="gap-1.5"
          >
            {busy ? <Loader2 className="size-3.5 animate-spin" /> : <Upload className="size-3.5" />}
            {busy ? 'Subiendo…' : 'Cambiar'}
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => onChange(null)}
            disabled={busy}
            aria-label="Quitar video"
          >
            <X className="size-3.5" />
          </Button>
        </div>
      ) : (
        <button
          type="button"
          onClick={onPick}
          disabled={busy}
          {...dnd}
          className={cn(
            'flex flex-col items-center justify-center gap-1.5 rounded-lg border border-dashed px-3 py-6 text-xs transition-colors',
            dragging
              ? 'border-primary bg-primary/10 text-foreground ring-2 ring-primary/40'
              : 'border-border/70 bg-background/30 text-muted-foreground hover:border-primary/50 hover:text-foreground',
          )}
        >
          {busy ? (
            <span className="flex items-center gap-2">
              <Loader2 className="size-3.5 animate-spin" />
              Subiendo…
            </span>
          ) : dragging ? (
            <span className="flex items-center gap-2 font-medium">
              <Upload className="size-3.5" />
              Soltá para subir
            </span>
          ) : (
            <>
              <span className="flex items-center gap-2">
                <Film className="size-3.5" />
                Subir video (opcional)
              </span>
              <span className="text-[10px] text-muted-foreground/80">
                o arrastrá un video · máx. 55 MB y 90 s · MP4 recomendado (los .mov de iPhone pueden
                no verse en Android)
              </span>
            </>
          )}
        </button>
      )}
    </div>
  )
}
