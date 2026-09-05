'use client'

import { format, formatDistanceToNow } from 'date-fns'
import { es } from 'date-fns/locale'
import { Copy, Eye, FileUp, MoreHorizontal, Pencil, Trash2 } from 'lucide-react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useState, useTransition } from 'react'
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
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { CopyButton } from '@/components/ui/copy-button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { EmptyState } from '@/components/ui/empty-state'
import { deleteLandingPage, duplicateLandingPage } from '@/lib/landings/actions'
import type { LandingPageRow } from '@/lib/landings/queries'
import { LANDING_HTML_MAX_CHARS } from '@/lib/landings/schemas'
import { NewPageButton, NewPageDialog } from './new-page-dialog'

/** "halloween-2026.html" → "Halloween 2026". */
function titleFromFilename(name: string): string {
  const base = name
    .replace(/\.html?$/i, '')
    .replace(/[-_]+/g, ' ')
    .trim()
  return base.length === 0 ? '' : base.charAt(0).toUpperCase() + base.slice(1).slice(0, 79)
}

const numberFormat = new Intl.NumberFormat('es-AR')

export function PagesList({
  tenantSlug,
  pages,
  appUrl,
}: {
  tenantSlug: string
  pages: LandingPageRow[]
  appUrl: string
}) {
  const router = useRouter()
  const [deleting, setDeleting] = useState<LandingPageRow | null>(null)
  const [pending, startTransition] = useTransition()
  // Archivo .html soltado sobre el listado: abre el alta con el código adentro.
  const [dropping, setDropping] = useState(false)
  const [dropped, setDropped] = useState<{ title: string; html: string } | null>(null)

  const urlPrefix = `${appUrl.replace(/^https?:\/\//, '')}/p/`

  async function takeFile(file: File) {
    if (!/\.html?$/i.test(file.name) && file.type !== 'text/html') {
      toast.error('Tiene que ser un archivo .html')
      return
    }
    const text = await file.text()
    if (text.length > LANDING_HTML_MAX_CHARS) {
      toast.error('El archivo pasa los 512 KB. Subí las imágenes por separado.')
      return
    }
    setDropped({ title: titleFromFilename(file.name), html: text })
  }

  function duplicate(page: LandingPageRow) {
    startTransition(async () => {
      const result = await duplicateLandingPage(tenantSlug, { id: page.id })
      if (result.ok && result.id) {
        toast.success('Página duplicada.')
        router.push(`/${tenantSlug}/paginas/${result.id}`)
      } else if (!result.ok) {
        toast.error(result.message)
      }
    })
  }

  function confirmDelete() {
    const page = deleting
    if (!page) return
    startTransition(async () => {
      const result = await deleteLandingPage(tenantSlug, { id: page.id })
      if (result.ok) {
        toast.success('Página borrada.')
        setDeleting(null)
        router.refresh()
      } else {
        toast.error(result.message)
      }
    })
  }

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: soltar el archivo es un atajo; "Nueva página" hace lo mismo con teclado.
    <div
      className="relative"
      onDragOver={(event) => {
        if (!event.dataTransfer.types.includes('Files')) return
        event.preventDefault()
        setDropping(true)
      }}
      onDragLeave={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDropping(false)
      }}
      onDrop={(event) => {
        if (!event.dataTransfer.types.includes('Files')) return
        event.preventDefault()
        setDropping(false)
        const file = event.dataTransfer.files?.[0]
        if (file) void takeFile(file)
      }}
    >
      {dropping ? (
        <div className="pointer-events-none fixed inset-0 z-50 grid place-items-center bg-background/70 backdrop-blur-sm">
          <div className="card-hairline flex flex-col items-center gap-3 rounded-2xl border-2 border-dashed border-primary bg-card px-10 py-8 shadow-lg">
            <div className="flex size-14 items-center justify-center rounded-full bg-primary/10 text-primary">
              <FileUp className="size-7" aria-hidden />
            </div>
            <p className="font-serif text-xl font-semibold">Soltá tu archivo .html</p>
            <p className="text-sm text-muted-foreground">Te armamos la página con eso adentro.</p>
          </div>
        </div>
      ) : null}

      {pages.length === 0 ? (
        <EmptyState
          icon={FileUp}
          title="Arrastrá tu archivo .html acá"
          description="O creá la página y pegá el código a mano. Cada una queda en su propio link, listo para mandar por WhatsApp o poner en una historia."
          action={<NewPageButton tenantSlug={tenantSlug} urlPrefix={urlPrefix} />}
        />
      ) : (
        <ul className="grid gap-3">
          {pages.map((page) => {
            const publicUrl = `${appUrl}/p/${page.slug}`
            return (
              <li
                key={page.id}
                className="card-hairline group relative rounded-xl border bg-card transition-[transform,box-shadow] duration-[var(--duration-base)] ease-[var(--ease-out)] hover:-translate-y-0.5 hover:shadow-md"
              >
                <div className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:gap-4">
                  <div className="min-w-0 flex-1 space-y-1.5">
                    <div className="flex flex-wrap items-center gap-2">
                      {/* El link cubre toda la tarjeta (before:inset-0) para que
                        el área clickeable sea grande, pero los botones de arriba
                        quedan por encima con z-10. */}
                      <Link
                        href={`/${tenantSlug}/paginas/${page.id}`}
                        className="font-serif text-lg font-semibold leading-tight tracking-tight before:absolute before:inset-0 before:content-[''] hover:underline"
                      >
                        {page.title}
                      </Link>
                      {page.published ? (
                        <Badge variant="secondary">Publicada</Badge>
                      ) : (
                        <Badge variant="outline">Borrador</Badge>
                      )}
                    </div>

                    {/* w-fit: con ancho completo, este bloque (z-10) tapaba el
                      link que cubre la tarjeta y dejaba una franja muerta. */}
                    <div className="relative z-10 flex w-fit max-w-full flex-wrap items-center gap-1.5">
                      <code className="truncate rounded-md bg-cream-tint px-2 py-1 font-mono text-xs text-muted-foreground">
                        {urlPrefix}
                        <span className="text-foreground">{page.slug}</span>
                      </code>
                      <CopyButton
                        value={publicUrl}
                        iconOnly
                        variant="ghost"
                        label="Copiar link"
                        copiedLabel="¡Copiado!"
                      />
                    </div>
                  </div>

                  <div className="flex items-center gap-4 sm:gap-6">
                    <div className="text-right">
                      <div className="font-display text-lg font-semibold tabular-nums leading-none">
                        {numberFormat.format(page.views)}
                      </div>
                      <div className="text-[11px] uppercase tracking-[0.14em] text-muted-foreground">
                        {page.views === 1 ? 'visita' : 'visitas'}
                      </div>
                    </div>

                    <div className="hidden text-right text-xs text-muted-foreground sm:block">
                      <div>Editada</div>
                      <div
                        title={format(new Date(page.updatedAt), "d 'de' MMM yyyy HH:mm", {
                          locale: es,
                        })}
                      >
                        {formatDistanceToNow(new Date(page.updatedAt), {
                          locale: es,
                          addSuffix: true,
                        })}
                      </div>
                    </div>

                    <div className="relative z-10">
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button
                            variant="ghost"
                            size="icon"
                            aria-label={`Acciones de ${page.title}`}
                          >
                            <MoreHorizontal className="size-4" aria-hidden />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem asChild>
                            <Link href={`/${tenantSlug}/paginas/${page.id}`}>
                              <Pencil className="size-4" aria-hidden />
                              Editar
                            </Link>
                          </DropdownMenuItem>
                          {page.published ? (
                            <DropdownMenuItem asChild>
                              <a href={publicUrl} target="_blank" rel="noopener noreferrer">
                                <Eye className="size-4" aria-hidden />
                                Ver publicada
                              </a>
                            </DropdownMenuItem>
                          ) : null}
                          <DropdownMenuItem onSelect={() => duplicate(page)} disabled={pending}>
                            <Copy className="size-4" aria-hidden />
                            Duplicar
                          </DropdownMenuItem>
                          <DropdownMenuSeparator />
                          <DropdownMenuItem
                            variant="destructive"
                            onSelect={() => setDeleting(page)}
                            disabled={pending}
                          >
                            <Trash2 className="size-4" aria-hidden />
                            Borrar
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>
                  </div>
                </div>
              </li>
            )
          })}
        </ul>
      )}

      {/* El alta con el archivo ya cargado. `key` para que arranque limpio en
          cada archivo nuevo. */}
      {dropped ? (
        <NewPageDialog
          key={dropped.title + dropped.html.length}
          tenantSlug={tenantSlug}
          urlPrefix={urlPrefix}
          open
          onOpenChange={(next) => !next && setDropped(null)}
          initialTitle={dropped.title}
          initialHtml={dropped.html}
        />
      ) : null}

      {/* Fuera del menú: si el AlertDialog vive adentro del DropdownMenu, al
          cerrarse el menú se desmonta el diálogo antes de que confirmes. */}
      <AlertDialog open={deleting !== null} onOpenChange={(open) => !open && setDeleting(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Borrar “{deleting?.title}”?</AlertDialogTitle>
            <AlertDialogDescription>
              {deleting?.published
                ? 'La página está publicada: el link deja de funcionar al instante y se pierde el historial de versiones. No se puede deshacer.'
                : 'Se borran el código y todo el historial de versiones. No se puede deshacer.'}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={pending}>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              disabled={pending}
              onClick={(event) => {
                event.preventDefault()
                confirmDelete()
              }}
            >
              {pending ? 'Borrando…' : 'Sí, borrar'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
