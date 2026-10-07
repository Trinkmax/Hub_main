'use client'

import { ImageIcon, Loader2, Upload, X } from 'lucide-react'
import Image from 'next/image'
import { useRef, useState, useTransition } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
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
      toast.error('Eso no parece una imagen.')
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
    <div className="grid gap-1.5">
      <span className="text-xs text-muted-foreground">{label}</span>
      <input
        ref={inputRef}
        type="file"
        accept="image/png,image/jpeg,image/webp,image/avif,image/heic,image/heif"
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
            <Image src={value} alt="Vista previa" fill sizes="64px" className="object-cover" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-xs font-medium">
              {dragging ? 'Soltá para reemplazar' : 'Foto cargada'}
            </p>
            <p className="text-[10px] text-muted-foreground">
              {dragging ? ' ' : 'Arrastrá otra imagen para reemplazarla'}
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
            {busy ? stageLabel : 'Cambiar'}
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => onChange(null)}
            disabled={busy}
            aria-label="Quitar imagen"
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
              {stageLabel}
            </span>
          ) : dragging ? (
            <span className="flex items-center gap-2 font-medium">
              <Upload className="size-3.5" />
              Soltá para subir
            </span>
          ) : (
            <>
              <span className="flex items-center gap-2">
                <ImageIcon className="size-3.5" />
                Subir foto (opcional)
              </span>
              <span className="text-[10px] text-muted-foreground/80">o arrastrá una imagen</span>
            </>
          )}
        </button>
      )}
    </div>
  )
}
