'use client'

import { ArrowDown, ArrowUp, EyeOff, Link2, Pencil, Plus, Star } from 'lucide-react'
import { useActionState, useEffect, useId, useMemo, useState, useTransition } from 'react'
import { toast } from 'sonner'
import { CURATED_ICONS } from '@/components/icons/curated-lucide'
import { LinkPageView } from '@/components/public-links/link-page-view'
import { BrandAccent } from '@/components/theme/brand-accent-provider'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Callout } from '@/components/ui/callout'
import { Card } from '@/components/ui/card'
import { EmptyState } from '@/components/ui/empty-state'
import { Field, FormError } from '@/components/ui/field'
import { FormActions } from '@/components/ui/form-actions'
import { Input } from '@/components/ui/input'
import { Section } from '@/components/ui/section'
import { SubmitButton } from '@/components/ui/submit-button'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import {
  type PublicLinkActionState,
  reorderPublicLinks,
  savePublicLinkPage,
  togglePublicLink,
} from '@/lib/public-links/actions'
import type { PublicLinkPage, PublicLinkRow } from '@/lib/public-links/queries'
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
  const previewTitleId = useId()
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

  const [state, formAction] = useActionState(
    (prev: PublicLinkActionState, fd: FormData) => savePublicLinkPage(tenantSlug, prev, fd),
    INITIAL,
  )

  // El error se ve en el formulario (FormError); el éxito, en un aviso.
  useEffect(() => {
    if (state.ok) toast.success('Página actualizada.')
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
    <div className="flex flex-col gap-8 lg:flex-row lg:items-start">
      <div className="flex min-w-0 flex-1 flex-col gap-8">
        {/* ── Encabezado de la página ─────────────────────────── */}
        <Section
          title="Encabezado"
          description="El título y la bajada que se leen arriba de los botones."
        >
          <Card>
            <form action={formAction} className="grid gap-4">
              <FormError message={state.ok ? null : state.message} />
              <input type="hidden" name="active" value={active ? 'true' : 'false'} />

              <Field
                label="Título"
                name="headline"
                optional
                hint={`Si lo dejás vacío, usamos «${tenantName}».`}
              >
                <Input
                  maxLength={80}
                  value={headline}
                  onChange={(event) => setHeadline(event.target.value)}
                  placeholder={tenantName}
                />
              </Field>

              <Field label="Bajada" name="bio" optional>
                <Textarea
                  rows={2}
                  maxLength={280}
                  showCount
                  value={bio}
                  onChange={(event) => setBio(event.target.value)}
                  placeholder="Tragos, comida y cafetería de calidad. Mariano Fragueiro 2151, Alta Córdoba."
                />
              </Field>

              {/* El interruptor no persiste hasta guardar: la ayuda lo dice al
                  lado del control, apenas cambia. */}
              <Field
                label="Página publicada"
                layout="toggle"
                hint={
                  active === page.active
                    ? 'Apagada, el link deja de funcionar para todo el mundo.'
                    : 'Cambiaste el interruptor: guardá el encabezado para que tenga efecto.'
                }
              >
                <Switch checked={active} onCheckedChange={setActive} />
              </Field>

              <FormActions sticky={false}>
                <SubmitButton pendingText="Guardando…">Guardar encabezado</SubmitButton>
              </FormActions>
            </form>
          </Card>
        </Section>

        {/* ── Botones ───────────────────────────────────────── */}
        <Section
          title="Botones"
          description="Se muestran en este orden. Movelos con las flechas y apagá los que no quieras mostrar por un tiempo."
          actions={
            items.length > 0 ? (
              <Button variant="secondary" onClick={openNew}>
                <Plus aria-hidden />
                Agregar botón
              </Button>
            ) : null
          }
        >
          {items.length === 0 ? (
            <EmptyState
              icon={Link2}
              title="Todavía no hay botones"
              description="Sumá la carta, las reservas por WhatsApp, el delivery… lo que quieras que esté a un toque desde Instagram."
              action={
                <Button onClick={openNew}>
                  <Plus aria-hidden />
                  Agregar el primero
                </Button>
              }
            />
          ) : (
            <ol
              aria-label="Botones de la página, en orden"
              className="divide-y divide-border overflow-clip rounded-xl border border-border bg-card"
            >
              {items.map((link, index) => {
                const Icon = link.icon ? CURATED_ICONS[link.icon] : undefined
                return (
                  <li key={link.id} className="flex items-center gap-3 px-3 py-3 sm:px-4">
                    {/* Flechas apiladas con 8 px entre medio: con el dedo cada
                        una responde en 44 px sin pisar a la otra. */}
                    <div className="flex flex-col gap-2">
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        aria-label={`Subir ${link.label}`}
                        disabled={index === 0}
                        onClick={() => move(index, -1)}
                      >
                        <ArrowUp aria-hidden />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        aria-label={`Bajar ${link.label}`}
                        disabled={index === items.length - 1}
                        onClick={() => move(index, 1)}
                      >
                        <ArrowDown aria-hidden />
                      </Button>
                    </div>

                    {/* El ícono es decorativo: en el celular se va para que el
                        nombre del botón no quede cortado a «Sumate al club d…». */}
                    <span
                      aria-hidden
                      className="flex size-9 shrink-0 items-center justify-center rounded-lg border border-border bg-background text-primary max-sm:hidden"
                    >
                      {Icon ? (
                        <Icon className="size-4" />
                      ) : (
                        <Link2 className="size-4 text-muted-foreground" />
                      )}
                    </span>

                    <div className="min-w-0 flex-1">
                      <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
                        <p className="min-w-0 break-words type-body font-medium text-foreground sm:truncate">
                          {link.label}
                        </p>
                        {link.highlight ? (
                          <Badge tone="brand" icon={Star}>
                            Destacado
                          </Badge>
                        ) : null}
                        {link.active ? null : <Badge icon={EyeOff}>Oculto</Badge>}
                      </div>
                      <p className="truncate type-small text-muted-foreground">{link.url}</p>
                    </div>

                    <Switch
                      checked={link.active}
                      onCheckedChange={(value) => toggle(link, value)}
                      aria-label={`Mostrar ${link.label} en la página`}
                    />
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label={`Editar ${link.label}`}
                      onClick={() => openEdit(link)}
                    >
                      <Pencil aria-hidden />
                    </Button>
                  </li>
                )
              })}
            </ol>
          )}
        </Section>
      </div>

      {/* ── Vista previa ────────────────────────────────────── */}
      <aside
        aria-labelledby={previewTitleId}
        className="flex flex-col gap-3 lg:sticky lg:top-[calc(var(--topbar-h)+1rem)] lg:w-80 lg:shrink-0"
      >
        <h2 id={previewTitleId} className="type-label text-muted-foreground">
          Vista previa
        </h2>
        {/* Marco de celular: casi todo el que entra lo hace desde la app de
            Instagram, así que la previa tiene que verse en ese ancho. El marco
            toma la tinta del panel (se ve también en oscuro); adentro va la
            página pública tal cual (congelada, `.force-light`). */}
        <div className="overflow-hidden rounded-[2rem] border-4 border-foreground/85">
          <BrandAccent accent={brandAccent} className="force-light bg-background">
            <section
              aria-label="Cómo se ve la página de links"
              // biome-ignore lint/a11y/noNoninteractiveTabindex: una región que scrollea tiene que poder recibir el foco para bajarla con el teclado (WCAG 2.1.1)
              tabIndex={0}
              className="max-h-[34rem] overflow-y-auto rounded-[1.75rem] outline-(--ring) -outline-offset-2 focus-visible:outline-2"
            >
              <LinkPageView
                tenantName={tenantName}
                headline={headline.trim() || null}
                bio={bio.trim() || null}
                logoUrl={logoUrl}
                links={previewLinks}
                interactive={false}
              />
            </section>
          </BrandAccent>
        </div>
        {/* El estado REAL es el del server: el interruptor de arriba no persiste
            hasta guardar, y un aviso que siguiera al interruptor diría que el
            link no abre cuando sí abre (y al revés, que es peor). */}
        {page.active ? null : (
          <Callout tone="warning">La página está apagada: hoy el link no abre.</Callout>
        )}
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
