'use client'

import { Trash2 } from 'lucide-react'
import { useActionState, useEffect, useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Field, FormError } from '@/components/ui/field'
import { IconPicker } from '@/components/ui/icon-picker'
import { Input } from '@/components/ui/input'
import { SubmitButton } from '@/components/ui/submit-button'
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

  const [state, formAction] = useActionState(
    (prev: PublicLinkActionState, fd: FormData) =>
      isEdit ? updatePublicLink(tenantSlug, prev, fd) : createPublicLink(tenantSlug, prev, fd),
    INITIAL,
  )

  // Depende del OBJETO `state`, no de `state.ok`: el objeto es nuevo por cada
  // submit. Con `state.ok` en las deps, el efecto se volvía a disparar al cambiar
  // cualquier otra dep (p. ej. `isEdit`) y cerraba el diálogo con un toast de
  // éxito mentiroso. El padre además remonta este componente en cada apertura,
  // así que `state` arranca siempre en INITIAL. El error se ve en el formulario.
  useEffect(() => {
    if (state.ok) {
      toast.success(isEdit ? 'Botón actualizado.' : 'Botón agregado.')
      onOpenChange(false)
    }
  }, [state, isEdit, onOpenChange])

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{isEdit ? 'Editar botón' : 'Nuevo botón'}</DialogTitle>
          <DialogDescription>
            Cada botón es un destino de la bio. Lo que escribas acá es lo que lee la gente.
          </DialogDescription>
        </DialogHeader>

        <form
          key={link?.id ?? 'new'}
          action={formAction}
          className="flex min-h-0 flex-1 flex-col gap-4"
        >
          <DialogBody className="grid gap-4">
            <FormError message={state.ok ? null : state.message} />
            {isEdit ? <input type="hidden" name="id" value={link.id} /> : null}
            <input type="hidden" name="highlight" value={highlight ? 'true' : 'false'} />

            <Field label="Texto del botón" name="label" required>
              <Input
                maxLength={80}
                defaultValue={link?.label ?? ''}
                placeholder="Reservas, cumples y eventos"
              />
            </Field>

            <Field
              label="Link"
              name="url"
              required
              hint="Pegá la dirección tal cual. Si te olvidás el https://, lo agregamos nosotros."
            >
              <Input
                inputMode="url"
                autoComplete="url"
                defaultValue={link?.url ?? ''}
                placeholder="wa.me/5493511234567"
              />
            </Field>

            <Field label="Bajada" name="description" optional>
              <Input
                maxLength={120}
                defaultValue={link?.description ?? ''}
                placeholder="Escribinos por WhatsApp"
              />
            </Field>

            {/* Con `name` en el Field, el picker manda su valor en un hidden (vacío = sin ícono). */}
            <Field label="Ícono" name="icon" optional hint="Aparece a la izquierda del texto.">
              <IconPicker value={icon} onChange={setIcon} />
            </Field>

            <Field
              label="Destacar este botón"
              layout="toggle"
              hint="Se pinta lleno, para el destino que querés empujar."
            >
              <Switch checked={highlight} onCheckedChange={setHighlight} />
            </Field>
          </DialogBody>

          <DialogFooter className="sm:justify-between">
            {isEdit ? (
              <DeleteLinkButton
                tenantSlug={tenantSlug}
                link={link}
                onDeleted={() => onOpenChange(false)}
              />
            ) : null}
            <div className="flex flex-col-reverse gap-2 sm:ms-auto sm:flex-row">
              <Button type="button" variant="secondary" onClick={() => onOpenChange(false)}>
                Cancelar
              </Button>
              <SubmitButton pendingText="Guardando…">
                {isEdit ? 'Guardar cambios' : 'Agregar botón'}
              </SubmitButton>
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
  return (
    <ConfirmDialog
      tone="danger"
      icon={Trash2}
      title={`¿Borrar el botón «${link.label}»?`}
      description="Desaparece de la página pública. Si es algo temporal, mejor apagalo con el interruptor de la lista."
      confirmLabel="Borrar botón"
      pendingLabel="Borrando…"
      onConfirm={async () => {
        const result = await deletePublicLink(tenantSlug, link.id)
        if (!result.ok) return result
        toast.success('Botón borrado.')
        onDeleted()
      }}
      trigger={
        <Button type="button" variant="danger-ghost">
          <Trash2 aria-hidden />
          Borrar
        </Button>
      }
    />
  )
}
