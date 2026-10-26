'use client'

import { ArrowDown, ArrowUp, ImagePlus, Loader2, Trash2 } from 'lucide-react'
import Image from 'next/image'
import { useRef, useState } from 'react'
import { Controller, useFieldArray, useFormContext } from 'react-hook-form'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { uploadLandingImage } from '@/lib/landings/media'
import type { ExperienceFormInput } from '@/lib/ticketing/schemas'
import type { GalleryKind } from '@/lib/ticketing/types'
import { cn } from '@/lib/utils'
import { isGifUrl } from '../../_components/poster-thumb'
import { MAX_GALLERY, uploadErrorMessage } from '../../_lib/experience-form'

const KINDS: ReadonlyArray<{ value: GalleryKind; label: string }> = [
  { value: 'scene', label: 'Escena de la película' },
  { value: 'venue', label: 'Foto real en el bar' },
]

/**
 * Las fotos de la página: escenas de la película y fotos reales de una
 * función en el bar. Se suben varias juntas (desde el browser, al bucket del
 * bar), cada una con su epígrafe, y se ordenan con las flechas.
 */
export function GalleryEditor({
  tenantId,
  onBusyChange,
}: {
  tenantId: string
  onBusyChange: (delta: 1 | -1) => void
}) {
  const {
    control,
    register,
    getValues,
    formState: { errors },
  } = useFormContext<ExperienceFormInput>()
  const { fields, append, remove, move, insert } = useFieldArray({ control, name: 'gallery' })
  const inputRef = useRef<HTMLInputElement>(null)
  const [uploading, setUploading] = useState(0)
  const [dragging, setDragging] = useState(false)
  const full = fields.length >= MAX_GALLERY
  const listError = errors.gallery?.message ?? errors.gallery?.root?.message

  async function upload(files: FileList | File[]) {
    const list = Array.from(files)
    if (list.length === 0) return
    const room = MAX_GALLERY - getValues('gallery').length
    if (room <= 0) {
      toast.error(`Ya hay ${MAX_GALLERY} fotos: es el máximo. Quitá alguna para sumar otra.`)
      return
    }
    const batch = list.slice(0, room)
    if (list.length > room) {
      toast.info(`Subimos ${room} de ${list.length}: el máximo son ${MAX_GALLERY} fotos.`)
    }
    setUploading((n) => n + batch.length)
    onBusyChange(1)
    let added = 0
    for (const file of batch) {
      try {
        const image = await uploadLandingImage({ tenantId, file })
        append({ url: image.publicUrl, caption: '', kind: 'scene' }, { shouldFocus: false })
        added += 1
      } catch (error) {
        console.error('[entradas.gallery.upload]', {
          error: error instanceof Error ? error.message : 'unknown',
        })
        toast.error(`${file.name}: ${uploadErrorMessage(error)}`)
      } finally {
        setUploading((n) => n - 1)
      }
    }
    onBusyChange(-1)
    if (added > 0) toast.success(added === 1 ? 'Foto agregada.' : `${added} fotos agregadas.`)
  }

  function removePhoto(index: number) {
    const removed = getValues(`gallery.${index}`)
    remove(index)
    toast('Foto quitada.', {
      action: { label: 'Deshacer', onClick: () => insert(index, removed, { shouldFocus: false }) },
    })
  }

  return (
    <div className="space-y-4">
      {/* biome-ignore lint/a11y/noStaticElementInteractions: soltar las fotos es un atajo; el botón de adentro hace lo mismo con teclado. */}
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
          void upload(event.dataTransfer.files)
        }}
        className={cn(
          'flex flex-col items-center justify-center rounded-xl border border-dashed border-border/80 bg-card/50 px-6 py-7 text-center transition-colors',
          dragging && 'border-primary bg-primary/5',
        )}
      >
        <div className="mb-3 flex size-11 items-center justify-center rounded-full border border-primary/20 bg-cream-tint text-primary">
          {uploading > 0 ? (
            <Loader2 className="size-5 animate-spin" aria-hidden />
          ) : (
            <ImagePlus className="size-5" aria-hidden />
          )}
        </div>
        <p className="text-sm font-medium" aria-live="polite">
          {uploading > 0
            ? `Subiendo ${uploading === 1 ? 'una foto' : `${uploading} fotos`}…`
            : full
              ? `Llegaste al máximo: ${MAX_GALLERY} fotos`
              : 'Arrastrá las fotos acá'}
        </p>
        <p className="mt-1 max-w-sm text-xs text-muted-foreground text-pretty">
          Escenas de la película y fotos reales de una función en el bar. Las achicamos y las
          pasamos al formato más liviano. Hasta {MAX_GALLERY}.
        </p>
        <input
          ref={inputRef}
          type="file"
          accept="image/*"
          multiple
          tabIndex={-1}
          aria-hidden
          className="sr-only"
          onChange={(event) => {
            if (event.target.files) void upload(event.target.files)
            event.target.value = ''
          }}
        />
        <Button
          type="button"
          variant="outline"
          className="mt-4 h-11 sm:h-9"
          disabled={full || uploading > 0}
          onClick={() => inputRef.current?.click()}
        >
          <ImagePlus className="size-4" aria-hidden />
          Elegir fotos
        </Button>
      </div>

      {listError ? (
        <p role="alert" className="text-xs text-destructive">
          {listError}
        </p>
      ) : null}

      {fields.length > 0 ? (
        <ol className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {fields.map((field, index) => {
            const itemErrors = errors.gallery?.[index]
            const name = `la foto ${index + 1}`
            return (
              <li
                key={field.id}
                className="overflow-hidden rounded-xl border border-border/70 bg-background/60"
              >
                <div className="relative aspect-[4/3] bg-cream-tint">
                  <Image
                    src={field.url}
                    alt=""
                    fill
                    sizes="(min-width: 1280px) 280px, (min-width: 640px) 45vw, 92vw"
                    className="object-cover"
                    unoptimized={isGifUrl(field.url)}
                  />
                  <span className="absolute top-2 left-2 rounded-full bg-background/90 px-2 py-0.5 text-[11px] font-medium tabular-nums shadow-xs">
                    {index + 1}
                  </span>
                </div>
                <div className="space-y-2.5 p-3">
                  <Input
                    maxLength={140}
                    placeholder="Epígrafe (opcional)"
                    aria-label={`Epígrafe de ${name}`}
                    aria-invalid={itemErrors?.caption ? true : undefined}
                    className="h-11 sm:h-10"
                    defaultValue={field.caption ?? ''}
                    {...register(`gallery.${index}.caption`)}
                  />
                  {itemErrors?.caption?.message || itemErrors?.url?.message ? (
                    <p role="alert" className="text-xs text-destructive">
                      {itemErrors?.caption?.message ?? itemErrors?.url?.message}
                    </p>
                  ) : null}
                  <Controller
                    control={control}
                    name={`gallery.${index}.kind`}
                    render={({ field: kind }) => (
                      <fieldset
                        aria-label={`Qué es ${name}`}
                        className="grid min-w-0 grid-cols-2 gap-1.5"
                      >
                        {KINDS.map((option) => {
                          const active = (kind.value ?? 'scene') === option.value
                          return (
                            <button
                              key={option.value}
                              type="button"
                              aria-pressed={active}
                              onClick={() => kind.onChange(option.value)}
                              className={cn(
                                'min-h-11 rounded-full border px-2 py-1.5 text-xs font-medium leading-tight transition-colors outline-none',
                                'focus-visible:ring-[3px] focus-visible:ring-ring/50',
                                active
                                  ? 'border-primary bg-primary text-primary-foreground'
                                  : 'border-border bg-card/40 text-muted-foreground hover:bg-secondary',
                              )}
                            >
                              {option.label}
                            </button>
                          )
                        })}
                      </fieldset>
                    )}
                  />
                  <div className="flex items-center justify-between gap-1">
                    <div className="flex items-center gap-1">
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="size-11 sm:size-9"
                        aria-label={`Mover ${name} antes`}
                        disabled={index === 0}
                        onClick={() => move(index, index - 1)}
                      >
                        <ArrowUp className="size-4" aria-hidden />
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="size-11 sm:size-9"
                        aria-label={`Mover ${name} después`}
                        disabled={index === fields.length - 1}
                        onClick={() => move(index, index + 1)}
                      >
                        <ArrowDown className="size-4" aria-hidden />
                      </Button>
                    </div>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="size-11 text-muted-foreground hover:text-destructive sm:size-9"
                      aria-label={`Quitar ${name}`}
                      onClick={() => removePhoto(index)}
                    >
                      <Trash2 className="size-4" aria-hidden />
                    </Button>
                  </div>
                </div>
              </li>
            )
          })}
        </ol>
      ) : null}
    </div>
  )
}
