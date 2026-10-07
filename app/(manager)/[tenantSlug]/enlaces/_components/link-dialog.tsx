'use client'

import { Trash2 } from 'lucide-react'
import { useActionState, useEffect, useState, useTransition } from 'react'
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
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { IconPicker } from '@/components/ui/icon-picker'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import {
  createPublicLink,
  deletePublicLink,
  type PublicLinkActionState,
  updatePublicLink,
} from '@/lib/public-links/actions'
import type { PublicLinkRow } from '@/lib/public-links/queries'

const INITIAL: PublicLinkActionState = { ok: false, message: '' }

export function LinkDialog({
  tenantSlug,
  link,
  open,
  onOpenChange,
}: {
  tenantSlug: string
  /** null = alta. */
  link: PublicLinkRow | null
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const isEdit = link !== null

  const [icon, setIcon] = useState<string | null>(link?.icon ?? null)
  const [highlight, setHighlight] = useState(link?.highlight ?? false)

  const [state, formAction, pending] = useActionState(
    (prev: PublicLinkActionState, fd: FormData) =>
      isEdit ? updatePublicLink(tenantSlug, prev, fd) : createPublicLink(tenantSlug, prev, fd),
    INITIAL,
  )

  // Depende del OBJETO `state`, no de `state.ok`: el objeto es nuevo por cada
  // submit. Con `state.ok` en las deps, el efecto se volvía a disparar al cambiar
  // cualquier otra dep (p. ej. `isEdit`) y cerraba el diálogo con un toast de
  // éxito mentiroso. El padre además remonta este componente en cada apertura,
  // así que `state` arranca siempre en INITIAL.
  useEffect(() => {
    if (state.ok) {
      toast.success(isEdit ? 'Link actualizado.' : 'Link agregado.')
      onOpenChange(false)
    } else if (state.message) {
      toast.error(state.message)
    }
  }, [state, isEdit, onOpenChange])

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92dvh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="font-serif text-xl">
            {isEdit ? 'Editar botón' : 'Nuevo botón'}
          </DialogTitle>
          <DialogDescription>
            Cada botón es un destino de la bio. Lo que escribas acá es lo que lee la gente.
          </DialogDescription>
        </DialogHeader>

        <form key={link?.id ?? 'new'} action={formAction} className="space-y-4">
          {isEdit ? <input type="hidden" name="id" value={link.id} /> : null}
          <input type="hidden" name="icon" value={icon ?? ''} />
          <input type="hidden" name="highlight" value={highlight ? 'true' : 'false'} />

          <div className="space-y-1.5">
            <Label htmlFor="label">
              Texto del botón<span className="text-destructive"> *</span>
            </Label>
            <Input
              id="label"
              name="label"
              required
              maxLength={80}
              defaultValue={link?.label ?? ''}
              placeholder="Reservas, cumples y eventos"
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="url">
              Link<span className="text-destructive"> *</span>
            </Label>
            <Input
              id="url"
              name="url"
              required
              inputMode="url"
              defaultValue={link?.url ?? ''}
              placeholder="wa.me/5493511234567"
            />
            <p className="text-xs text-muted-foreground">
              Pegá la dirección tal cual. Si te olvidás el https://, lo agregamos nosotros.
            </p>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="description">Bajada (opcional)</Label>
            <Input
              id="description"
              name="description"
              maxLength={120}
              defaultValue={link?.description ?? ''}
              placeholder="Escribinos por WhatsApp"
            />
          </div>

          <IconPicker
            value={icon}
            onChange={setIcon}
            hint="Aparece a la izquierda del texto. Opcional."
          />

          <div className="flex items-start justify-between gap-4 rounded-xl border border-border/70 bg-card/60 p-3">
            <div>
              <Label htmlFor="highlight" className="text-sm font-medium">
                Destacar este botón
              </Label>
              <p className="mt-0.5 text-xs text-muted-foreground">
                Se pinta sólido, para el destino que querés empujar.
              </p>
            </div>
            <Switch id="highlight" checked={highlight} onCheckedChange={setHighlight} />
          </div>

          <DialogFooter className="gap-2 sm:justify-between">
            {isEdit ? (
              <DeleteLinkButton
                tenantSlug={tenantSlug}
                link={link}
                onDeleted={() => onOpenChange(false)}
              />
            ) : (
              <span />
            )}
            <div className="flex items-center gap-2">
              <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
                Cancelar
              </Button>
              <Button type="submit" disabled={pending}>
                {pending ? 'Guardando…' : isEdit ? 'Guardar' : 'Agregar'}
              </Button>
            </div>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function DeleteLinkButton({
  tenantSlug,
  link,
  onDeleted,
}: {
  tenantSlug: string
  link: PublicLinkRow
  onDeleted: () => void
}) {
  const [pending, startTransition] = useTransition()

  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button type="button" variant="ghost" className="text-destructive hover:text-destructive">
          <Trash2 className="size-4" aria-hidden />
          Eliminar
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>¿Eliminar este botón?</AlertDialogTitle>
          <AlertDialogDescription>
            «{link.label}» desaparece de la página pública. Si es algo temporal, mejor apagalo con
            el interruptor.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={pending}>Cancelar</AlertDialogCancel>
          <AlertDialogAction
            disabled={pending}
            onClick={(event) => {
              event.preventDefault()
              startTransition(async () => {
                const result = await deletePublicLink(tenantSlug, link.id)
                if (result.ok) {
                  toast.success('Link eliminado.')
                  onDeleted()
                } else {
                  toast.error(result.message)
                }
              })
            }}
          >
            {pending ? 'Eliminando…' : 'Eliminar'}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
