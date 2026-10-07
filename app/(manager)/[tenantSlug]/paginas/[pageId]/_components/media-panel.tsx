'use client'

import { ImagePlus, Loader2, Plus, Trash2 } from 'lucide-react'
import Image from 'next/image'
import { useCallback, useEffect, useState } from 'react'
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
import { Button } from '@/components/ui/button'
import { CopyButton } from '@/components/ui/copy-button'
import { Skeleton } from '@/components/ui/skeleton'
import {
  deleteLandingImage,
  type LandingImage,
  listLandingImages,
  uploadLandingImage,
} from '@/lib/landings/media'
import { cn } from '@/lib/utils'

/**
 * La galería de imágenes de las landings de este bar.
 *
 * POR QUÉ EXISTE: sin esto, marketing tiene dos opciones y las dos son malas —
 * pegar la foto adentro del HTML en base64 (la página pasa a pesar un mega y
 * tarda una eternidad en 4G) o linkear una imagen de otro sitio (que un día
 * desaparece y deja la landing rota). Acá la sube una vez y se queda.
 *
 * Sube directo del browser a Supabase Storage: una Server Action tiene 1 MB de
 * límite de body y una foto de celular pesa cuatro veces eso.
 */
export function MediaPanel({
  tenantId,
  onInsert,
}: {
  tenantId: string
  onInsert: (snippet: string) => void
}) {
  const [images, setImages] = useState<LandingImage[]>([])
  const [loading, setLoading] = useState(true)
  // Contador y no booleano: si entra un segundo lote mientras el primero sigue,
  // el `false` del primero apagaba el spinner con archivos todavía subiendo.
  const [batches, setBatches] = useState(0)
  const uploading = batches > 0
  const [dragging, setDragging] = useState(false)
  const [deleting, setDeleting] = useState<LandingImage | null>(null)

  const refresh = useCallback(async () => {
    try {
      setImages(await listLandingImages(tenantId))
    } catch (error) {
      console.error('[landings.media.list]', error)
      toast.error('No pudimos cargar las imágenes.')
    } finally {
      setLoading(false)
    }
  }, [tenantId])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const upload = useCallback(
    async (files: FileList | File[]) => {
      const list = Array.from(files)
      if (list.length === 0) return
      setBatches((n) => n + 1)
      let uploaded = 0
      for (const file of list) {
        try {
          const image = await uploadLandingImage({ tenantId, file })
          setImages((current) => [image, ...current])
          uploaded += 1
        } catch (error) {
          const message = error instanceof Error ? error.message : 'No pudimos subir la imagen.'
          toast.error(`${file.name}: ${message}`)
        }
      }
      setBatches((n) => n - 1)
      if (uploaded > 0) {
        toast.success(uploaded === 1 ? 'Imagen subida.' : `${uploaded} imágenes subidas.`)
      }
    },
    [tenantId],
  )

  async function confirmDelete() {
    const image = deleting
    if (!image) return
    try {
      await deleteLandingImage(image.path)
      setImages((current) => current.filter((item) => item.path !== image.path))
      toast.success('Imagen borrada.')
    } catch (error) {
      console.error('[landings.media.delete]', error)
      toast.error('No pudimos borrar la imagen.')
    } finally {
      setDeleting(null)
    }
  }

  return (
    <div className="space-y-4">
      {/* biome-ignore lint/a11y/noStaticElementInteractions: el drop es un atajo; el botón de adentro hace lo mismo con teclado. */}
      <div
        onDragOver={(event) => {
          event.preventDefault()
          event.stopPropagation()
          setDragging(true)
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(event) => {
          event.preventDefault()
          // El editor entero también escucha drops (para el .html): sin esto,
          // soltar una foto acá dispararía además su handler y avisaría que
          // "eso es una imagen" justo cuando el lugar es el correcto.
          event.stopPropagation()
          setDragging(false)
          if (event.dataTransfer.files.length > 0) void upload(event.dataTransfer.files)
        }}
        className={cn(
          'flex flex-col items-center justify-center rounded-xl border border-dashed border-border/80 bg-card/50 px-6 py-8 text-center transition-colors',
          dragging && 'border-primary bg-primary/5',
        )}
      >
        <div className="mb-3 flex size-11 items-center justify-center rounded-full border border-primary/20 bg-cream-tint text-primary">
          {uploading ? (
            <Loader2 className="size-5 animate-spin" aria-hidden />
          ) : (
            <ImagePlus className="size-5" aria-hidden />
          )}
        </div>
        <p className="text-sm font-medium">{uploading ? 'Subiendo…' : 'Arrastrá las fotos acá'}</p>
        <p className="mt-1 max-w-sm text-xs text-muted-foreground text-pretty">
          Las achicamos y las convertimos al formato más liviano. Los GIF quedan animados. Después
          copiás el link o lo insertás directo en el código.
        </p>
        {/* El input queda sr-only (sigue siendo focusable) y el outline global
            está apagado: el anillo lo pinta el `span` con focus-within. */}
        <label className="mt-4">
          <input
            type="file"
            accept="image/*"
            multiple
            className="peer sr-only"
            onChange={(event) => {
              if (event.target.files) void upload(event.target.files)
              event.target.value = ''
            }}
          />
          <span className="inline-flex h-9 cursor-pointer items-center gap-2 rounded-md border border-input bg-background px-3 text-sm font-medium shadow-2xs transition-colors hover:bg-cream-tint peer-focus-visible:ring-[3px] peer-focus-visible:ring-ring/50">
            <Plus className="size-4" aria-hidden />
            Elegir imágenes
          </span>
        </label>
      </div>

      {loading ? (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {[0, 1, 2, 3].map((n) => (
            <Skeleton key={n} className="aspect-square rounded-xl" />
          ))}
        </div>
      ) : images.length === 0 ? (
        <p className="px-1 text-xs text-muted-foreground">
          Todavía no subiste ninguna imagen para tus páginas.
        </p>
      ) : (
        <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {images.map((image) => (
            <li
              key={image.path}
              className="card-hairline group relative overflow-hidden rounded-xl border bg-card"
            >
              <div className="relative aspect-square bg-cream-tint">
                <Image
                  src={image.publicUrl}
                  alt=""
                  fill
                  sizes="200px"
                  className="object-cover"
                  unoptimized={image.publicUrl.endsWith('.gif')}
                />
              </div>

              <div className="flex items-center justify-between gap-1 border-t border-border/60 px-1.5 py-1.5">
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 px-2 text-xs"
                  onClick={() =>
                    onInsert(
                      `<img src="${image.publicUrl}" alt="" style="max-width:100%;height:auto">`,
                    )
                  }
                >
                  Insertar
                </Button>
                <div className="flex items-center">
                  <CopyButton
                    value={image.publicUrl}
                    iconOnly
                    variant="ghost"
                    size="sm"
                    label="Copiar link de la imagen"
                    copiedLabel="¡Copiado!"
                  />
                  <Button
                    variant="ghost"
                    size="icon"
                    className="size-7 text-muted-foreground hover:text-destructive"
                    aria-label="Borrar imagen"
                    onClick={() => setDeleting(image)}
                  >
                    <Trash2 className="size-3.5" aria-hidden />
                  </Button>
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}

      <AlertDialog open={deleting !== null} onOpenChange={(open) => !open && setDeleting(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Borrar la imagen?</AlertDialogTitle>
            <AlertDialogDescription>
              Si alguna página publicada la está usando, ahí va a quedar un cuadrado roto. No se
              puede deshacer.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={(event) => {
                event.preventDefault()
                void confirmDelete()
              }}
            >
              Sí, borrar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
