'use client'

import { ImageIcon, Loader2, Upload, X } from 'lucide-react'
import Image from 'next/image'
import { useRef, useState, useTransition } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { uploadMenuImage } from '@/lib/menu/upload-image'

type Stage = 'idle' | 'optimizing' | 'uploading'

function prettyBytes(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`
  return `${(n / (1024 * 1024)).toFixed(1)} MB`
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
  const [, startTransition] = useTransition()

  const busy = stage !== 'idle'
  const onPick = () => inputRef.current?.click()

  const onFile = (file: File | undefined) => {
    if (!file) return
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

  const stageLabel = stage === 'optimizing' ? 'Optimizando…' : 'Subiendo…'

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
        <div className="relative flex items-center gap-3 rounded-lg border border-border/60 bg-card/40 p-2">
          <div className="relative size-16 shrink-0 overflow-hidden rounded-md bg-secondary">
            <Image
              src={value}
              alt="Vista previa"
              fill
              sizes="64px"
              className="object-cover"
              unoptimized
            />
          </div>
          <div className="min-w-0 flex-1">
            <p className="truncate text-xs text-muted-foreground">{value}</p>
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
          className="flex items-center justify-center gap-2 rounded-lg border border-dashed border-border/70 bg-background/30 px-3 py-4 text-xs text-muted-foreground transition-colors hover:border-primary/50 hover:text-foreground"
        >
          {busy ? (
            <>
              <Loader2 className="size-3.5 animate-spin" />
              {stageLabel}
            </>
          ) : (
            <>
              <ImageIcon className="size-3.5" />
              Subir foto (opcional)
            </>
          )}
        </button>
      )}
    </div>
  )
}
