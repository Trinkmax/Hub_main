'use client'

import { ExternalLink, Handshake, Loader2, Pause, Pencil, Play, Plus, Trash2 } from 'lucide-react'
import Image from 'next/image'
import { useActionState, useEffect, useRef, useState, useTransition } from 'react'
import { useFormStatus } from 'react-dom'
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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { EmptyState } from '@/components/ui/empty-state'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  createPartner,
  deletePartner,
  type LoyaltyActionState,
  togglePartner,
  updatePartner,
} from '@/lib/points/actions'
import type { Partner } from '@/lib/points/queries'
import { cn } from '@/lib/utils'

const initial: LoyaltyActionState = { ok: true }

// ── Avatar del aliado ───────────────────────────────────────
function PartnerLogo({ partner }: { partner: Partner }) {
  if (partner.logo_url) {
    return (
      <div className="relative size-10 shrink-0 overflow-hidden rounded-full border border-border/60 bg-background">
        <Image
          src={partner.logo_url}
          alt=""
          fill
          sizes="40px"
          className="object-cover"
          unoptimized
        />
      </div>
    )
  }
  return (
    <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-[--cream-tint] text-sm font-semibold text-muted-foreground">
      {partner.name.charAt(0).toUpperCase()}
    </span>
  )
}

// ── Form de creación inline ─────────────────────────────────
function SubmitBtn() {
  const { pending } = useFormStatus()
  return (
    <Button type="submit" disabled={pending} size="sm" className="gap-1.5">
      <Plus className="size-3.5" />
      {pending ? 'Agregando…' : 'Agregar marca'}
    </Button>
  )
}

function NewPartnerForm({ tenantSlug }: { tenantSlug: string }) {
  const formRef = useRef<HTMLFormElement>(null)
  const [state, formAction] = useActionState(
    async (_prev: LoyaltyActionState, formData: FormData): Promise<LoyaltyActionState> =>
      createPartner(tenantSlug, {
        name: String(formData.get('name') ?? '').trim(),
        category: String(formData.get('category') ?? '').trim(),
        discount_label: String(formData.get('discount_label') ?? '').trim(),
        logo_url: String(formData.get('logo_url') ?? '').trim(),
        url: String(formData.get('url') ?? '').trim(),
        sort: Number(formData.get('sort') ?? 0),
      }),
    initial,
  )

  useEffect(() => {
    if (state.ok && state.message) {
      toast.success(state.message)
      formRef.current?.reset()
    } else if (!state.ok) {
      toast.error(state.message)
    }
  }, [state])

  return (
    <form
      ref={formRef}
      action={formAction}
      className="card-hairline rounded-xl border bg-card p-4 space-y-3"
    >
      <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
        Nueva marca aliada
      </h3>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="grid gap-1.5">
          <Label htmlFor="pn-name" className="text-[11px] text-muted-foreground">
            Nombre
          </Label>
          <Input id="pn-name" name="name" required maxLength={80} placeholder="Estudio Norte" />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="pn-category" className="text-[11px] text-muted-foreground">
            Rubro
          </Label>
          <Input id="pn-category" name="category" maxLength={40} placeholder="Estética" />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="pn-discount" className="text-[11px] text-muted-foreground">
            Descuento
          </Label>
          <Input id="pn-discount" name="discount_label" maxLength={40} placeholder="15% off" />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="pn-sort" className="text-[11px] text-muted-foreground">
            Orden
          </Label>
          <Input id="pn-sort" name="sort" type="number" defaultValue={0} className="tabular-nums" />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="pn-logo" className="text-[11px] text-muted-foreground">
            Logo (URL)
          </Label>
          <Input id="pn-logo" name="logo_url" type="url" maxLength={500} placeholder="https://…" />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="pn-url" className="text-[11px] text-muted-foreground">
            Sitio o Instagram (opcional)
          </Label>
          <Input id="pn-url" name="url" type="url" maxLength={500} placeholder="https://…" />
        </div>
      </div>
      <div className="flex items-center justify-between gap-3">
        <p className="text-[11px] text-muted-foreground">
          Se agrega como borrador. Activala cuando esté lista.
        </p>
        <SubmitBtn />
      </div>
    </form>
  )
}

// ── Dialog de edición ───────────────────────────────────────
function PartnerEditDialog({
  tenantSlug,
  partner,
  open,
  onOpenChange,
}: {
  tenantSlug: string
  partner: Partner | null
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)

  const handleSubmit = (formData: FormData) => {
    if (!partner) return
    const name = String(formData.get('name') ?? '').trim()
    if (!name) {
      setError('Poné un nombre.')
      return
    }
    setError(null)

    const input = {
      id: partner.id,
      name,
      category: String(formData.get('category') ?? '').trim(),
      discount_label: String(formData.get('discount_label') ?? '').trim(),
      logo_url: String(formData.get('logo_url') ?? '').trim(),
      url: String(formData.get('url') ?? '').trim(),
      sort: Number(formData.get('sort') ?? 0),
      // Preservamos el estado activo/borrador: se cambia con el toggle, no acá.
      active: partner.active,
    }

    startTransition(async () => {
      const result = await updatePartner(tenantSlug, input)
      if (result.ok) {
        toast.success('Marca actualizada.')
        onOpenChange(false)
      } else {
        toast.error(result.message)
      }
    })
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[88vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="font-serif">Editar marca</DialogTitle>
          <DialogDescription>
            Actualizá los datos del comercio aliado. El descuento se muestra tal cual lo escribas.
          </DialogDescription>
        </DialogHeader>

        {partner ? (
          <form action={handleSubmit} className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="grid gap-1.5">
                <Label htmlFor="pn-edit-name" className="text-xs text-muted-foreground">
                  Nombre
                </Label>
                <Input
                  id="pn-edit-name"
                  name="name"
                  required
                  maxLength={80}
                  defaultValue={partner.name}
                  aria-invalid={error ? true : undefined}
                />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="pn-edit-category" className="text-xs text-muted-foreground">
                  Rubro
                </Label>
                <Input
                  id="pn-edit-category"
                  name="category"
                  maxLength={40}
                  defaultValue={partner.category ?? ''}
                  placeholder="Estética"
                />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="pn-edit-discount" className="text-xs text-muted-foreground">
                  Descuento
                </Label>
                <Input
                  id="pn-edit-discount"
                  name="discount_label"
                  maxLength={40}
                  defaultValue={partner.discount_label ?? ''}
                  placeholder="15% off"
                />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="pn-edit-sort" className="text-xs text-muted-foreground">
                  Orden
                </Label>
                <Input
                  id="pn-edit-sort"
                  name="sort"
                  type="number"
                  defaultValue={partner.sort}
                  className="tabular-nums"
                />
              </div>
            </div>

            <div className="grid gap-1.5">
              <Label htmlFor="pn-edit-logo" className="text-xs text-muted-foreground">
                Logo (URL)
              </Label>
              <Input
                id="pn-edit-logo"
                name="logo_url"
                type="url"
                maxLength={500}
                defaultValue={partner.logo_url ?? ''}
                placeholder="https://…"
              />
            </div>

            <div className="grid gap-1.5">
              <Label htmlFor="pn-edit-url" className="text-xs text-muted-foreground">
                Sitio o Instagram (opcional)
              </Label>
              <Input
                id="pn-edit-url"
                name="url"
                type="url"
                maxLength={500}
                defaultValue={partner.url ?? ''}
                placeholder="https://…"
              />
            </div>

            {error ? <p className="text-xs text-destructive">{error}</p> : null}

            <DialogFooter>
              <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
                Cancelar
              </Button>
              <Button type="submit" disabled={pending} className="min-w-[140px]">
                {pending ? (
                  <>
                    <Loader2 className="size-4 animate-spin" />
                    Guardando…
                  </>
                ) : (
                  'Guardar cambios'
                )}
              </Button>
            </DialogFooter>
          </form>
        ) : null}
      </DialogContent>
    </Dialog>
  )
}

// ── Manager principal ───────────────────────────────────────
export function PartnersManager({
  tenantSlug,
  partners,
}: {
  tenantSlug: string
  partners: Partner[]
}) {
  const [pending, startTransition] = useTransition()
  const [editing, setEditing] = useState<Partner | null>(null)
  const [pendingDelete, setPendingDelete] = useState<Partner | null>(null)

  const onToggle = (partner: Partner) => {
    startTransition(async () => {
      const result = await togglePartner(tenantSlug, partner.id, !partner.active)
      if (result.ok) {
        toast.success(partner.active ? `"${partner.name}" pausada.` : `"${partner.name}" activada.`)
      } else {
        toast.error(result.message)
      }
    })
  }

  const onConfirmDelete = () => {
    if (!pendingDelete) return
    const target = pendingDelete
    startTransition(async () => {
      const result = await deletePartner(tenantSlug, target.id)
      if (result.ok) {
        toast.success(`Marca "${target.name}" eliminada.`)
      } else {
        toast.error(result.message)
      }
      setPendingDelete(null)
    })
  }

  return (
    <div className="space-y-5">
      <NewPartnerForm tenantSlug={tenantSlug} />

      {partners.length === 0 ? (
        <EmptyState
          icon={Handshake}
          title="Todavía no hay marcas aliadas"
          description="Sumá comercios amigos que ofrezcan descuentos a tus socios. Cargá el primero con el formulario de arriba."
        />
      ) : (
        <>
          <p className="text-sm text-muted-foreground">
            {partners.length} {partners.length === 1 ? 'marca cargada' : 'marcas cargadas'}
          </p>

          <ul className="card-hairline divide-y divide-border/60 overflow-hidden rounded-xl border bg-card">
            {partners.map((partner) => (
              <li
                key={partner.id}
                className={cn('flex items-center gap-3 px-4 py-3', !partner.active && 'opacity-70')}
              >
                <PartnerLogo partner={partner} />

                <div className="min-w-0 flex-1 space-y-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="truncate font-medium text-foreground">{partner.name}</span>
                    {partner.active ? (
                      <Badge variant="success">Activa</Badge>
                    ) : (
                      <Badge variant="outline">Borrador</Badge>
                    )}
                    {partner.discount_label ? (
                      <Badge variant="secondary">{partner.discount_label}</Badge>
                    ) : null}
                  </div>
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-muted-foreground">
                    {partner.category ? <span>{partner.category}</span> : null}
                    {partner.url ? (
                      <a
                        href={partner.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 hover:text-foreground"
                      >
                        <ExternalLink className="size-3" aria-hidden />
                        Ver
                      </a>
                    ) : null}
                  </div>
                </div>

                <div className="flex shrink-0 items-center gap-1">
                  <Button
                    size="icon"
                    variant="ghost"
                    className="size-8 text-muted-foreground hover:text-foreground"
                    onClick={() => onToggle(partner)}
                    disabled={pending}
                    aria-label={
                      partner.active ? `Pausar ${partner.name}` : `Activar ${partner.name}`
                    }
                  >
                    {partner.active ? <Pause className="size-4" /> : <Play className="size-4" />}
                  </Button>
                  <Button
                    size="icon"
                    variant="ghost"
                    className="size-8 text-muted-foreground hover:text-foreground"
                    onClick={() => setEditing(partner)}
                    aria-label={`Editar ${partner.name}`}
                  >
                    <Pencil className="size-4" />
                  </Button>
                  <Button
                    size="icon"
                    variant="ghost"
                    className="size-8 text-muted-foreground hover:text-destructive"
                    onClick={() => setPendingDelete(partner)}
                    aria-label={`Borrar ${partner.name}`}
                  >
                    <Trash2 className="size-4" />
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        </>
      )}

      {/* Dialog de edición controlado: una sola instancia para todas las filas */}
      <PartnerEditDialog
        tenantSlug={tenantSlug}
        partner={editing}
        open={editing !== null}
        onOpenChange={(open) => {
          if (!open) setEditing(null)
        }}
      />

      {/* Confirmación de borrado */}
      <AlertDialog
        open={pendingDelete !== null}
        onOpenChange={(open) => {
          if (!open) setPendingDelete(null)
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Borrar la marca "{pendingDelete?.name}"?</AlertDialogTitle>
            <AlertDialogDescription>
              Dejará de mostrarse en los beneficios del club. Esta acción no se puede deshacer.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={pending}>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={(e) => {
                e.preventDefault()
                onConfirmDelete()
              }}
              disabled={pending}
            >
              {pending ? 'Borrando…' : 'Borrar'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
