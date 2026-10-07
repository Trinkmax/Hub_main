'use client'

import { ArrowDown, ArrowUp, Eye, Link2, Pencil, Plus, Star } from 'lucide-react'
import { useActionState, useEffect, useMemo, useState, useTransition } from 'react'
import { toast } from 'sonner'
import { CURATED_ICONS } from '@/components/icons/curated-lucide'
import { LinkPageView } from '@/components/public-links/link-page-view'
import { BrandAccent } from '@/components/theme/brand-accent-provider'
import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/ui/empty-state'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import {
  type PublicLinkActionState,
  reorderPublicLinks,
  savePublicLinkPage,
  togglePublicLink,
} from '@/lib/public-links/actions'
import type { PublicLinkPage, PublicLinkRow } from '@/lib/public-links/queries'
import { cn } from '@/lib/utils'
import { LinkDialog } from './link-dialog'

const INITIAL: PublicLinkActionState = { ok: false, message: '' }

export function LinksManager({
  tenantSlug,
  tenantName,
  logoUrl,
  brandAccent,
  page,
  links,
}: {
  tenantSlug: string
  tenantName: string
  logoUrl: string | null
  brandAccent: string | null
  page: PublicLinkPage
  links: PublicLinkRow[]
}) {
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editing, setEditing] = useState<PublicLinkRow | null>(null)
  // Remonta el diálogo en cada apertura para que `useActionState` arranque
  // limpio y no arrastre el resultado del guardado anterior.
  const [dialogSession, setDialogSession] = useState(0)

  // Copia local para que reordenar y prender/apagar se vea al instante; el
  // server revalida y vuelve a mandar la lista buena.
  const [items, setItems] = useState(links)
  useEffect(() => setItems(links), [links])

  const [headline, setHeadline] = useState(page.headline ?? '')
  const [bio, setBio] = useState(page.bio ?? '')
  const [active, setActive] = useState(page.active)

  const [, startTransition] = useTransition()

  function openNew() {
    setEditing(null)
    setDialogSession((n) => n + 1)
    setDialogOpen(true)
  }

  function openEdit(link: PublicLinkRow) {
    setEditing(link)
    setDialogSession((n) => n + 1)
    setDialogOpen(true)
  }

  const [state, formAction, saving] = useActionState(
    (prev: PublicLinkActionState, fd: FormData) => savePublicLinkPage(tenantSlug, prev, fd),
    INITIAL,
  )

  useEffect(() => {
    if (state.ok) toast.success('Página actualizada.')
    else if (state.message) toast.error(state.message)
  }, [state])

  function move(index: number, delta: number) {
    const target = index + delta
    if (target < 0 || target >= items.length) return
    const next = [...items]
    const moved = next[index]
    const swapped = next[target]
    if (!moved || !swapped) return
    next[index] = swapped
    next[target] = moved
    setItems(next)
    startTransition(async () => {
      const result = await reorderPublicLinks(
        tenantSlug,
        next.map((item) => item.id),
      )
      if (!result.ok) {
        setItems(items)
        toast.error(result.message)
      }
    })
  }

  function toggle(link: PublicLinkRow, value: boolean) {
    setItems((prev) =>
      prev.map((item) => (item.id === link.id ? { ...item, active: value } : item)),
    )
    startTransition(async () => {
      const result = await togglePublicLink(tenantSlug, { id: link.id, active: value })
      if (!result.ok) {
        setItems((prev) =>
          prev.map((item) => (item.id === link.id ? { ...item, active: !value } : item)),
        )
        toast.error(result.message)
      }
    })
  }

  // La previa muestra sólo lo que está prendido: es exactamente lo que va a ver
  // quien entre desde Instagram.
  const previewLinks = useMemo(() => items.filter((item) => item.active), [items])

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_20rem] lg:items-start">
      <div className="space-y-6">
        {/* ── Cabecera de la página ─────────────────────────── */}
        <section className="card-hairline overflow-hidden rounded-xl border bg-card">
          <header className="border-b border-border/60 px-5 py-3.5">
            <h2 className="font-serif text-lg font-semibold tracking-tight">Encabezado</h2>
            <p className="text-xs text-muted-foreground">
              El título y la bajada que se leen arriba de los botones.
            </p>
          </header>
          <form action={formAction} className="space-y-4 p-5">
            <input type="hidden" name="active" value={active ? 'true' : 'false'} />

            <div className="space-y-1.5">
              <Label htmlFor="headline">Título</Label>
              <Input
                id="headline"
                name="headline"
                maxLength={80}
                value={headline}
                onChange={(event) => setHeadline(event.target.value)}
                placeholder={tenantName}
              />
              <p className="text-xs text-muted-foreground">
                Si lo dejás vacío usamos «{tenantName}».
              </p>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="bio">Bajada</Label>
              <Textarea
                id="bio"
                name="bio"
                rows={2}
                maxLength={280}
                value={bio}
                onChange={(event) => setBio(event.target.value)}
                placeholder="Tragos, comida y cafetería de calidad. Mariano Fragueiro 2151, Alta Córdoba."
                className="resize-none"
              />
            </div>

            <div className="flex items-start justify-between gap-4 rounded-xl border border-border/70 bg-background p-3">
              <div>
                <Label htmlFor="page-active" className="text-sm font-medium">
                  Página publicada
                </Label>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  Apagada, el link deja de funcionar para todo el mundo.
                </p>
              </div>
              <Switch id="page-active" checked={active} onCheckedChange={setActive} />
            </div>

            <div className="flex justify-end">
              <Button type="submit" disabled={saving}>
                {saving ? 'Guardando…' : 'Guardar encabezado'}
              </Button>
            </div>
          </form>
        </section>

        {/* ── Botones ───────────────────────────────────────── */}
        <section className="card-hairline overflow-hidden rounded-xl border bg-card">
          <header className="flex items-center justify-between gap-3 border-b border-border/60 px-5 py-3.5">
            <div>
              <h2 className="font-serif text-lg font-semibold tracking-tight">Botones</h2>
              <p className="text-xs text-muted-foreground">
                Se muestran en este orden. Movelos con las flechas.
              </p>
            </div>
            <Button size="sm" onClick={openNew}>
              <Plus className="size-4" aria-hidden />
              Agregar
            </Button>
          </header>

          {items.length === 0 ? (
            <div className="p-5">
              <EmptyState
                icon={Link2}
                title="Todavía no hay botones"
                description="Sumá la carta, las reservas por WhatsApp, el delivery… lo que quieras que esté a un toque desde Instagram."
                action={
                  <Button onClick={openNew}>
                    <Plus className="size-4" aria-hidden />
                    Agregar el primero
                  </Button>
                }
              />
            </div>
          ) : (
            <ul className="divide-y divide-border/60">
              {items.map((link, index) => {
                const Icon = link.icon ? CURATED_ICONS[link.icon] : undefined
                return (
                  <li
                    key={link.id}
                    className={cn(
                      'flex items-center gap-3 px-4 py-3 transition-opacity',
                      !link.active && 'opacity-55',
                    )}
                  >
                    {/* Targets de 32px con aire entre medio: se usan desde el
                        celular y de a pares apiladas se erraba de flecha. */}
                    <div className="flex flex-col gap-1">
                      <Button
                        variant="ghost"
                        size="icon"
                        className="size-8"
                        aria-label={`Subir ${link.label}`}
                        disabled={index === 0}
                        onClick={() => move(index, -1)}
                      >
                        <ArrowUp className="size-4" aria-hidden />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="size-8"
                        aria-label={`Bajar ${link.label}`}
                        disabled={index === items.length - 1}
                        onClick={() => move(index, 1)}
                      >
                        <ArrowDown className="size-4" aria-hidden />
                      </Button>
                    </div>

                    <span className="flex size-9 shrink-0 items-center justify-center rounded-lg border border-border/70 bg-background text-primary">
                      {Icon ? (
                        <Icon className="size-4" aria-hidden />
                      ) : (
                        <Link2 className="size-4 text-muted-foreground" aria-hidden />
                      )}
                    </span>

                    <div className="min-w-0 flex-1">
                      <p className="flex items-center gap-1.5 truncate text-sm font-medium">
                        {link.label}
                        {link.highlight ? (
                          <Star
                            className="size-3.5 shrink-0 fill-primary text-primary"
                            aria-label="Destacado"
                          />
                        ) : null}
                      </p>
                      <p className="truncate text-xs text-muted-foreground">{link.url}</p>
                    </div>

                    <Switch
                      checked={link.active}
                      onCheckedChange={(value) => toggle(link, value)}
                      aria-label={`Mostrar ${link.label}`}
                    />
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label={`Editar ${link.label}`}
                      onClick={() => openEdit(link)}
                    >
                      <Pencil className="size-4" aria-hidden />
                    </Button>
                  </li>
                )
              })}
            </ul>
          )}
        </section>
      </div>

      {/* ── Vista previa ────────────────────────────────────── */}
      <aside className="lg:sticky lg:top-24">
        <div className="mb-2 flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-[0.18em] text-muted-foreground">
          <Eye className="size-3.5" aria-hidden />
          Vista previa
        </div>
        {/* Marco de celular: el 99% de quien entra lo hace desde la app de
            Instagram, así que la previa tiene que verse en ese ancho. */}
        <BrandAccent
          accent={brandAccent}
          className="force-light overflow-hidden rounded-[2rem] border-4 border-foreground/85 bg-background shadow-lg"
        >
          <div className="max-h-[34rem] overflow-y-auto">
            <LinkPageView
              tenantName={tenantName}
              headline={headline.trim() || null}
              bio={bio.trim() || null}
              logoUrl={logoUrl}
              links={previewLinks}
              interactive={false}
            />
          </div>
        </BrandAccent>
        {/* El estado REAL es el del server: el switch de arriba no persiste
            hasta apretar "Guardar encabezado", y un aviso que siguiera al switch
            diría que el link no abre cuando sí abre (y al revés, que es peor). */}
        {page.active ? null : (
          <p className="mt-2 rounded-lg bg-warning/10 px-3 py-2 text-xs text-warning">
            La página está apagada: hoy el link no abre.
          </p>
        )}
        {active !== page.active ? (
          <p className="mt-2 rounded-lg bg-secondary px-3 py-2 text-xs text-muted-foreground">
            Cambiaste el interruptor: guardá el encabezado para que tenga efecto.
          </p>
        ) : null}
      </aside>

      <LinkDialog
        key={dialogSession}
        tenantSlug={tenantSlug}
        link={editing}
        open={dialogOpen}
        onOpenChange={setDialogOpen}
      />
    </div>
  )
}
