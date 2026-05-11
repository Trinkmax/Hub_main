'use client'

import { ImageIcon, Loader2, Upload, X } from 'lucide-react'
import Image from 'next/image'
import { useRef, useState, useTransition } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { uploadMenuImage } from '@/lib/menu/upload-image'

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
  const [previewBusy, setPreviewBusy] = useState(false)
  const [, startTransition] = useTransition()

  const onPick = () => inputRef.current?.click()

  const onFile = (file: File | undefined) => {
    if (!file) return
    setPreviewBusy(true)
    startTransition(async () => {
      try {
        const { publicUrl } = await uploadMenuImage({ tenantId, file })
        onChange(publicUrl)
        toast.success('Imagen lista para guardar.')
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'No pudimos subir la imagen.'
        toast.error(msg)
      } finally {
        setPreviewBusy(false)
        if (inputRef.current) inputRef.current.value = ''
      }
    })
  }

  return (
    <div className="grid gap-1.5">
      <span className="text-xs text-muted-foreground">{label}</span>
      <input
        ref={inputRef}
        type="file"
        accept="image/png,image/jpeg,image/webp,image/avif"
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
            disabled={previewBusy}
            className="gap-1.5"
          >
            {previewBusy ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : (
              <Upload className="size-3.5" />
            )}
            Cambiar
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => onChange(null)}
            aria-label="Quitar imagen"
          >
            <X className="size-3.5" />
          </Button>
        </div>
      ) : (
        <button
          type="button"
          onClick={onPick}
          disabled={previewBusy}
          className="flex items-center justify-center gap-2 rounded-lg border border-dashed border-border/70 bg-background/30 px-3 py-4 text-xs text-muted-foreground transition-colors hover:border-primary/50 hover:text-foreground"
        >
          {previewBusy ? (
            <>
              <Loader2 className="size-3.5 animate-spin" />
              Subiendo…
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
