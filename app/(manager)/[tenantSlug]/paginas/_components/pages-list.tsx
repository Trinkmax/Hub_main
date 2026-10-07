'use client'

import { Copy, Eye, FileUp, MoreHorizontal, Pencil, Trash2 } from 'lucide-react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useState, useTransition } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { useConfirm } from '@/components/ui/confirm-dialog'
import { CopyButton } from '@/components/ui/copy-button'
import { DataTable, type DataTableColumn } from '@/components/ui/data-table'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { EmptyState } from '@/components/ui/empty-state'
import { StatusBadge } from '@/components/ui/status-badge'
import { formatNumber } from '@/lib/format/number-kind'
import { deleteLandingPage, duplicateLandingPage } from '@/lib/landings/actions'
import type { LandingPageRow } from '@/lib/landings/queries'
import { LANDING_HTML_MAX_CHARS, LANDING_HTML_MAX_LABEL } from '@/lib/landings/schemas'
import { DropOverlay } from './drop-overlay'
import { NewPageButton, NewPageDialog } from './new-page-dialog'
import { LANDING_STATUS, landingStatus, whenLabel } from './page-status'

/** "halloween-2026.html" → "Halloween 2026". */
function titleFromFilename(name: string): string {
  const base = name
    .replace(/\.html?$/i, '')
    .replace(/[-_]+/g, ' ')
    .trim()
  return base.length === 0 ? '' : base.charAt(0).toUpperCase() + base.slice(1).slice(0, 79)
}

export function PagesList({
  tenantSlug,
  pages,
  landingsBase,
  today,
}: {
  tenantSlug: string
  pages: LandingPageRow[]
  /** Base pública ya resuelta: `${landingsBase}/${slug}` es el link. */
  landingsBase: string
  /** Hoy en Córdoba, resuelto en el server: «Hoy 14:32» sale igual en los dos lados. */
  today: string
}) {
  const router = useRouter()
  const confirm = useConfirm()
  const [pending, startTransition] = useTransition()
  // Archivo .html soltado sobre el listado: abre el alta con el código adentro.
  const [dropping, setDropping] = useState(false)
  const [dropped, setDropped] = useState<{ title: string; html: string } | null>(null)

  const urlPrefix = `${landingsBase.replace(/^https?:\/\//, '')}/`

  async function takeFile(file: File) {
    if (!/\.html?$/i.test(file.name) && file.type !== 'text/html') {
      toast.error('Tiene que ser un archivo .html')
      return
    }
    const text = await file.text()
    if (text.length > LANDING_HTML_MAX_CHARS) {
      toast.error(
        `Ese archivo pesa ${Math.round(text.length / 1024)} KB y el máximo es ${LANDING_HTML_MAX_LABEL}.`,
      )
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

  // La confirmación vive en el shell (`useConfirm`), no adentro del menú: un
  // diálogo dentro del DropdownMenu se desmontaba con el menú antes de confirmar.
  async function remove(page: LandingPageRow) {
    const ok = await confirm({
      tone: 'danger',
      icon: Trash2,
      title: `¿Borrar la página «${page.title}»?`,
      description: page.published
        ? 'Está publicada: el link deja de funcionar al instante y se pierde el historial de versiones. No se puede deshacer.'
        : 'Se borran el código y todo el historial de versiones. No se puede deshacer.',
      confirmLabel: 'Borrar página',
      pendingLabel: 'Borrando…',
      onConfirm: async () => {
        const result = await deleteLandingPage(tenantSlug, { id: page.id })
        if (!result.ok) return { ok: false, error: result.message }
      },
    })
    if (ok) {
      toast.success('Página borrada.')
      router.refresh()
    }
  }

  const columns: DataTableColumn<LandingPageRow>[] = [
    { id: 'pagina', header: 'Página', cell: (page) => page.title },
    {
      id: 'link',
      header: 'Link',
      mobile: 'secondary',
      cell: (page) => (
        <span className="inline-flex max-w-full items-center gap-1">
          <code className="max-w-60 truncate font-mono type-small text-muted-foreground">
            {urlPrefix}
            <span className="text-foreground">{page.slug}</span>
          </code>
          <CopyButton
            value={`${landingsBase}/${page.slug}`}
            iconOnly
            variant="ghost"
            size="icon-sm"
            label={`Copiar el link de ${page.title}`}
            copiedLabel="Link copiado"
          />
        </span>
      ),
    },
    {
      id: 'estado',
      header: 'Estado',
      // En la tarjeta del celular va junto a «Editada…»: con el link en la misma
      // línea, la etiqueta bajaba sola de renglón.
      mobile: 'meta',
      cell: (page) => <StatusBadge status={landingStatus(page.published)} map={LANDING_STATUS} />,
    },
    {
      id: 'visitas',
      header: 'Visitas',
      numeric: true,
      cell: (page) => (
        <>
          {formatNumber(page.views)}
          {/* En la tarjeta del celular no hay encabezado: el número lleva su palabra. */}
          <span aria-hidden className="font-normal text-muted-foreground md:hidden">
            {page.views === 1 ? ' visita' : ' visitas'}
          </span>
        </>
      ),
    },
    {
      id: 'editada',
      header: 'Editada',
      hideBelow: 'lg',
      mobile: 'meta',
      cell: (page) => (
        <span className="whitespace-nowrap text-muted-foreground">
          {/* En la tarjeta del celular va como frase; en la tabla, bajo «Editada». */}
          <span className="md:hidden">
            Editada {whenLabel(page.updatedAt, today, { lowercase: true })}
          </span>
          <span className="max-md:hidden">{whenLabel(page.updatedAt, today)}</span>
        </span>
      ),
    },
    {
      id: 'acciones',
      header: 'Acciones',
      headerHidden: true,
      width: '3.5rem',
      cell: (page) => {
        const publicUrl = `${landingsBase}/${page.slug}`
        return (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" aria-label={`Acciones de ${page.title}`}>
                <MoreHorizontal aria-hidden />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem asChild>
                <Link href={`/${tenantSlug}/paginas/${page.id}`}>
                  <Pencil aria-hidden />
                  Editar
                </Link>
              </DropdownMenuItem>
              {page.published ? (
                <DropdownMenuItem asChild>
                  <a href={publicUrl} target="_blank" rel="noopener noreferrer">
                    <Eye aria-hidden />
                    Ver publicada
                  </a>
                </DropdownMenuItem>
              ) : null}
              <DropdownMenuItem onSelect={() => duplicate(page)} disabled={pending}>
                <Copy aria-hidden />
                Duplicar
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                variant="destructive"
                onSelect={() => void remove(page)}
                disabled={pending}
              >
                <Trash2 aria-hidden />
                Borrar
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )
      },
    },
  ]

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
      {dropping ? <DropOverlay description="Te armamos la página con eso adentro." /> : null}

      {pages.length === 0 ? (
        <EmptyState
          variant="dashed"
          icon={FileUp}
          title="Arrastrá tu archivo .html acá"
          description="O creá la página y pegá el código a mano. Cada una queda en su propio link, listo para mandar por WhatsApp o poner en una historia."
          action={<NewPageButton tenantSlug={tenantSlug} urlPrefix={urlPrefix} />}
        />
      ) : (
        <DataTable
          caption="Páginas"
          rows={pages}
          getRowId={(page) => page.id}
          rowHref={(page) => `/${tenantSlug}/paginas/${page.id}`}
          columns={columns}
        />
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
    </div>
  )
}
