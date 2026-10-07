'use client'

import { ImageIcon, Upload, X } from 'lucide-react'
import Image from 'next/image'
import { useId, useRef, useState, useTransition } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Spinner } from '@/components/ui/spinner'
import { uploadMenuImage } from '@/lib/menu/upload-image'
import { cn } from '@/lib/utils'

type Stage = 'idle' | 'optimizing' | 'uploading'

function prettyBytes(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`
  return `${(n / (1024 * 1024)).toFixed(1)} MB`
}

function pickImageFile(items: DataTransferItemList | null | undefined): File | null {
  if (!items) return null
  for (const it of items) {
    if (it.kind === 'file' && it.type.startsWith('image/')) {
      const f = it.getAsFile()
      if (f) return f
    }
  }
  return null
}

/**
 * Foto de un ítem, una categoría, una recompensa o un aliado (kit HUB): soltar
 * o tocar «Subir foto», se optimiza sola en el navegador y se sube a Storage.
 * Con foto cargada muestra la miniatura con «Cambiar» y «Quitar».
 *
 * La misma API de siempre (`tenantId`, `value`, `onChange`, `label`): la URL
 * vive en el estado de quien la usa y viaja como prefiera (input hidden o en
 * la llamada a la acción).
 */
export function MenuImageUploader({
  tenantId,
  value,
  onChange,
  label = 'Foto del ítem',
}: {
  tenantId: string
  value: string | null
  onChange: (url: string | null) => void
  label?: string
}) {
  const labelId = useId()
  const inputRef = useRef<HTMLInputElement>(null)
  const [stage, setStage] = useState<Stage>('idle')
  const [dragging, setDragging] = useState(false)
  // Contador para soportar dragenter/leave anidados sin que entre/salgan
  // los hijos rompa el highlight (cada hijo dispara enter+leave al pasar).
  const dragDepth = useRef(0)
  const [, startTransition] = useTransition()

  const busy = stage !== 'idle'
  const onPick = () => inputRef.current?.click()

  const onFile = (file: File | undefined) => {
    if (!file) return
    if (!file.type.startsWith('image/')) {
      toast.error('Eso no parece una imagen. Subí una foto JPG, PNG o WebP.')
      return
    }
    setStage('optimizing')
    startTransition(async () => {
      try {
        const { publicUrl, originalBytes, finalBytes } = await uploadMenuImage({
          tenantId,
          file,
          onProgress: (p) => {
            if (p.stage === 'uploading') setStage('uploading')
          },
        })
        onChange(publicUrl)
        const saved = Math.max(0, originalBytes - finalBytes)
        const pct = originalBytes > 0 ? Math.round((saved / originalBytes) * 100) : 0
        toast.success(
          pct > 5
            ? `Optimizada · ${prettyBytes(originalBytes)} → ${prettyBytes(finalBytes)} (-${pct}%)`
            : `Imagen lista · ${prettyBytes(finalBytes)}`,
        )
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'No pudimos subir la imagen.'
        toast.error(msg)
      } finally {
        setStage('idle')
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
    const file = pickImageFile(e.dataTransfer.items) ?? e.dataTransfer.files[0]
    onFile(file)
  }

  const stageLabel = stage === 'optimizing' ? 'Optimizando…' : 'Subiendo…'
  const dnd = { onDragEnter, onDragOver, onDragLeave, onDrop }

  return (
    <fieldset
      aria-labelledby={labelId}
      aria-busy={busy || undefined}
      data-slot="image-uploader"
      className="grid min-w-0 gap-2"
    >
      <span id={labelId} className="type-label text-foreground">
        {label}
      </span>
      {/* Fuera del orden de Tab: lo abre el botón de abajo (una sola parada). */}
      <input
        ref={inputRef}
        type="file"
        accept="image/png,image/jpeg,image/webp,image/avif,image/heic,image/heif"
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
            <Image src={value} alt="Vista previa" fill sizes="64px" className="object-cover" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="type-label text-foreground">
              {dragging ? 'Soltá para reemplazar' : 'Foto cargada'}
            </p>
            <p className="type-caption text-muted-foreground">
              {dragging ? '\u00a0' : 'Tocá «Cambiar» o arrastrá otra imagen.'}
            </p>
          </div>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={onPick}
            loading={busy}
            loadingText={stageLabel}
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
            aria-label="Quitar la foto"
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
              {stageLabel}
            </span>
          ) : dragging ? (
            <span className="flex items-center gap-2 type-label">
              <Upload className="size-4" aria-hidden="true" />
              Soltá para subir
            </span>
          ) : (
            <>
              <span className="flex items-center gap-2 type-label">
                <ImageIcon className="size-4" aria-hidden="true" />
                Subir foto
              </span>
              <span className="type-caption text-subtle-foreground">
                o arrastrá una imagen · se optimiza sola
              </span>
            </>
          )}
        </button>
      )}
    </fieldset>
  )
}
