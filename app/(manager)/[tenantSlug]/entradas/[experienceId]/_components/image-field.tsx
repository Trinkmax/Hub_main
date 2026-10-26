'use client'

import { ImagePlus, Loader2, Trash2, Upload } from 'lucide-react'
import Image from 'next/image'
import { type Ref, useRef, useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { uploadLandingImage } from '@/lib/landings/media'
import { cn } from '@/lib/utils'
import { isGifUrl } from '../../_components/poster-thumb'
import { uploadErrorMessage } from '../../_lib/experience-form'

/**
 * Una imagen de la página (el afiche o la portada): se sube, se cambia o se
 * quita, con la previa en su proporción real.
 *
 * Sube DESDE EL BROWSER al bucket público `landing-media` (la carpeta del
 * bar), igual que las imágenes de Páginas: una Server Action tiene 1 MB de
 * límite y una foto de celular pesa cuatro veces eso. Quitar no borra el
 * archivo del bucket (puede estar usándose en otra página): solo lo saca de
 * esta película.
 */
export function ImageField({
  id,
  label,
  hint,
  tenantId,
  value,
  onChange,
  shape,
  onBusyChange,
  buttonRef,
  error,
}: {
  id: string
  label: string
  hint: string
  tenantId: string
  value: string
  onChange: (url: string) => void
  /** `poster` = vertical 2:3 · `wide` = horizontal 16:9. */
  shape: 'poster' | 'wide'
  /** +1 al empezar a subir, −1 al terminar (el editor no guarda a mitad de una subida). */
  onBusyChange: (delta: 1 | -1) => void
  buttonRef?: Ref<HTMLButtonElement>
  error?: string
}) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [uploading, setUploading] = useState(false)
  const [dragging, setDragging] = useState(false)
  const pickId = `${id}-pick`

  async function take(file: File | undefined) {
    if (!file || uploading) return
    setUploading(true)
    onBusyChange(1)
    try {
      const image = await uploadLandingImage({ tenantId, file })
      onChange(image.publicUrl)
    } catch (uploadError) {
      console.error('[entradas.image.upload]', {
        field: id,
        error: uploadError instanceof Error ? uploadError.message : 'unknown',
      })
      toast.error(uploadErrorMessage(uploadError))
    } finally {
      setUploading(false)
      onBusyChange(-1)
    }
  }

  return (
    <div className="grid content-start gap-2">
      <Label htmlFor={pickId}>{label}</Label>

      {/* biome-ignore lint/a11y/noStaticElementInteractions: soltar la imagen es un atajo; el botón de abajo hace lo mismo con teclado. */}
      <div
        onDragOver={(event) => {
          if (!event.dataTransfer.types.includes('Files')) return
          event.preventDefault()
          setDragging(true)
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(event) => {
          if (!event.dataTransfer.types.includes('Files')) return
          event.preventDefault()
          setDragging(false)
          void take(event.dataTransfer.files?.[0])
        }}
        className={cn(
          'relative overflow-hidden rounded-xl border bg-cream-tint transition-[border-color,box-shadow]',
          shape === 'poster' ? 'aspect-[2/3] w-full max-w-[13rem]' : 'aspect-video w-full',
          value ? 'border-border/70' : 'border-dashed border-border',
          dragging && 'border-primary ring-[3px] ring-primary/20',
          error && 'border-destructive',
        )}
      >
        {value ? (
          <Image
            src={value}
            alt=""
            fill
            sizes={shape === 'poster' ? '208px' : '(min-width: 1024px) 420px, 92vw'}
            className="object-cover"
            unoptimized={isGifUrl(value)}
          />
        ) : (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 p-4 text-center text-muted-foreground">
            <ImagePlus className="size-6" aria-hidden />
            <span className="text-xs">Arrastrá la imagen acá</span>
          </div>
        )}
        {uploading ? (
          <div className="absolute inset-0 grid place-items-center bg-background/70 backdrop-blur-sm">
            <Loader2 className="size-6 animate-spin text-foreground" aria-hidden />
          </div>
        ) : null}
      </div>

      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        tabIndex={-1}
        aria-hidden
        className="sr-only"
        onChange={(event) => {
          void take(event.target.files?.[0])
          // Permite volver a elegir el MISMO archivo después de un error.
          event.target.value = ''
        }}
      />
      <div className="flex flex-wrap gap-2">
        <Button
          ref={buttonRef}
          id={pickId}
          type="button"
          variant="outline"
          className="h-11 sm:h-9"
          disabled={uploading}
          aria-describedby={`${id}-hint`}
          onClick={() => inputRef.current?.click()}
        >
          {uploading ? (
            <Loader2 className="size-4 animate-spin" aria-hidden />
          ) : (
            <Upload className="size-4" aria-hidden />
          )}
          {uploading ? 'Subiendo…' : value ? 'Cambiar' : 'Subir imagen'}
        </Button>
        {value ? (
          <Button
            type="button"
            variant="ghost"
            className="h-11 text-muted-foreground hover:text-destructive sm:h-9"
            disabled={uploading}
            onClick={() => onChange('')}
          >
            <Trash2 className="size-4" aria-hidden />
            Quitar
            <span className="sr-only">{label.toLowerCase()}</span>
          </Button>
        ) : null}
      </div>
      <p id={`${id}-hint`} className="text-xs leading-snug text-muted-foreground text-pretty">
        {hint}
      </p>
      {error ? (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  )
}
