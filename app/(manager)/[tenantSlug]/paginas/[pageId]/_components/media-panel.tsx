'use client'

import { ImagePlus, Plus, Trash2 } from 'lucide-react'
import Image from 'next/image'
import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'
import { Button, buttonVariants } from '@/components/ui/button'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { CopyButton } from '@/components/ui/copy-button'
import { ErrorState } from '@/components/ui/error-state'
import { Skeleton } from '@/components/ui/skeleton'
import { Spinner } from '@/components/ui/spinner'
import {
  deleteLandingImage,
  type LandingImage,
  listLandingImages,
  uploadLandingImage,
} from '@/lib/landings/media'
import { cn } from '@/lib/utils'

const SKELETON_TILES = ['a', 'b', 'c', 'd'] as const

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
  const [loadFailed, setLoadFailed] = useState(false)
  // Contador y no booleano: si entra un segundo lote mientras el primero sigue,
  // el `false` del primero apagaba el spinner con archivos todavía subiendo.
  const [batches, setBatches] = useState(0)
  const uploading = batches > 0
  const [dragging, setDragging] = useState(false)
  // La imagen a borrar queda guardada mientras el diálogo se cierra.
  const [toDelete, setToDelete] = useState<LandingImage | null>(null)
  const [deleteOpen, setDeleteOpen] = useState(false)

  const refresh = useCallback(async () => {
    try {
      setImages(await listLandingImages(tenantId))
      setLoadFailed(false)
    } catch (error) {
      console.error('[landings.media.list]', error)
      setLoadFailed(true)
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

  return (
    <div className="flex flex-col gap-4">
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
          'flex flex-col items-center justify-center rounded-xl border border-dashed px-6 py-8 text-center transition-colors duration-(--duration-quick)',
          dragging ? 'border-primary bg-selected' : 'border-border-strong',
        )}
      >
        <div className="mb-3 flex size-10 items-center justify-center rounded-full bg-secondary text-primary">
          {uploading ? (
            <Spinner size={20} aria-hidden />
          ) : (
            <ImagePlus className="size-5" strokeWidth={1.75} aria-hidden />
          )}
        </div>
        <p className="type-label text-foreground" aria-live="polite">
          {uploading ? 'Subiendo…' : 'Arrastrá las fotos acá'}
        </p>
        <p className="mt-1 max-w-sm type-caption text-pretty text-muted-foreground">
          Las achicamos y las convertimos al formato más liviano. Los GIF quedan animados. Después
          copiás el link o lo insertás directo en el código.
        </p>
        {/* El input queda sr-only (sigue siendo enfocable): el anillo de foco lo
            pinta el `span` que se ve, con `peer-focus-visible`. */}
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
          <span
            className={cn(
              buttonVariants({ variant: 'secondary', size: 'sm' }),
              'cursor-pointer peer-focus-visible:outline-2',
            )}
          >
            <Plus aria-hidden />
            Elegir imágenes
          </span>
        </label>
      </div>

      {loading ? (
        <div aria-hidden className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {SKELETON_TILES.map((tile) => (
            <Skeleton key={tile} className="aspect-square rounded-xl" />
          ))}
        </div>
      ) : loadFailed ? (
        <ErrorState
          size="sm"
          title="No pudimos cargar las imágenes"
          description="Revisá la conexión y probá de nuevo. Las que ya subiste siguen guardadas."
          onRetry={refresh}
        />
      ) : images.length === 0 ? (
        <p className="px-1 type-small text-muted-foreground">
          Todavía no subiste ninguna imagen para tus páginas.
        </p>
      ) : (
        <ul
          aria-label="Imágenes subidas"
          className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4"
        >
          {images.map((image) => (
            <li
              key={image.path}
              className="flex flex-col overflow-clip rounded-xl border border-border bg-card"
            >
              <div className="relative aspect-square bg-secondary">
                <Image
                  src={image.publicUrl}
                  alt=""
                  fill
                  sizes="200px"
                  className="object-cover"
                  unoptimized={image.publicUrl.endsWith('.gif')}
                />
              </div>

              <div className="flex items-center justify-between gap-1 border-t border-border p-1.5">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() =>
                    onInsert(
                      `<img src="${image.publicUrl}" alt="" style="max-width:100%;height:auto">`,
                    )
                  }
                >
                  Insertar
                </Button>
                <div className="flex items-center gap-1">
                  <CopyButton
                    value={image.publicUrl}
                    iconOnly
                    variant="ghost"
                    size="icon-sm"
                    label="Copiar el link de la imagen"
                    copiedLabel="Link copiado"
                  />
                  <Button
                    variant="danger-ghost"
                    size="icon-sm"
                    aria-label="Borrar imagen"
                    onClick={() => {
                      setToDelete(image)
                      setDeleteOpen(true)
                    }}
                  >
                    <Trash2 aria-hidden />
                  </Button>
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}

      <ConfirmDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        tone="danger"
        icon={Trash2}
        title="¿Borrar la imagen?"
        description="Si alguna página publicada la está usando, ahí va a quedar un cuadrado roto. No se puede deshacer."
        confirmLabel="Borrar imagen"
        pendingLabel="Borrando…"
        onConfirm={async () => {
          const image = toDelete
          if (!image) return
          try {
            await deleteLandingImage(image.path)
          } catch (error) {
            console.error('[landings.media.delete]', error)
            return { ok: false, error: 'No pudimos borrar la imagen. Probá de nuevo.' }
          }
          setImages((current) => current.filter((item) => item.path !== image.path))
          toast.success('Imagen borrada.')
        }}
      />
    </div>
  )
}
