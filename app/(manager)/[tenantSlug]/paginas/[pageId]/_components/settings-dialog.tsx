'use client'

import { useRouter } from 'next/navigation'
import { useActionState, useEffect, useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Callout } from '@/components/ui/callout'
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
import { Input } from '@/components/ui/input'
import { SubmitButton } from '@/components/ui/submit-button'
import { Switch } from '@/components/ui/switch'
import { type LandingActionState, updateLandingSettings } from '@/lib/landings/actions'
import type { LandingPageDetail } from '@/lib/landings/queries'
import { checkSlugFormat, LANDING_SLUG_HINT } from '@/lib/landings/schemas'
import { SlugInput } from '../../_components/new-page-dialog'

const INITIAL: LandingActionState = { ok: false, message: '' }

export function SettingsDialog({
  tenantSlug,
  page,
  urlPrefix,
  open,
  onOpenChange,
}: {
  tenantSlug: string
  page: LandingPageDetail
  urlPrefix: string
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const router = useRouter()
  const [slug, setSlug] = useState(page.slug)
  const [indexable, setIndexable] = useState(page.indexable)

  const slugError = checkSlugFormat(slug)
  const slugChanged = slug !== page.slug

  const [state, formAction] = useActionState(
    (prev: LandingActionState, fd: FormData) => updateLandingSettings(tenantSlug, prev, fd),
    INITIAL,
  )

  // El error del server se ve adentro del formulario (FormError).
  useEffect(() => {
    if (state.ok) {
      toast.success('Ajustes guardados.')
      onOpenChange(false)
      router.refresh()
    }
  }, [state, onOpenChange, router])

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Ajustes de la página</DialogTitle>
          <DialogDescription>El nombre interno, el link y si aparece en Google.</DialogDescription>
        </DialogHeader>

        <form action={formAction} className="flex min-h-0 flex-1 flex-col gap-4">
          <DialogBody className="grid gap-4">
            <FormError message={state.ok ? null : state.message} />
            <input type="hidden" name="id" value={page.id} />
            <input type="hidden" name="indexable" value={indexable ? 'true' : 'false'} />

            <Field
              label="Nombre"
              name="title"
              required
              hint="Sólo se ve en esta lista. El título que lee la gente es el <title> del HTML."
            >
              <Input maxLength={80} defaultValue={page.title} />
            </Field>

            <Field
              label="Link público"
              name="slug"
              required
              hint={slugError ? undefined : LANDING_SLUG_HINT}
              error={slugError}
            >
              <SlugInput
                prefix={urlPrefix}
                value={slug}
                onChange={(next) => setSlug(next.toLowerCase())}
              />
            </Field>

            {/* Cambiar el link de una página publicada rompe el que ya circula:
                se avisa apenas se toca, no recién al guardar. */}
            {!slugError && slugChanged && page.published ? (
              <Callout tone="warning" title="El link anterior va a dejar de funcionar">
                La página está publicada. Si ya lo mandaste por WhatsApp o está en una historia, ese
                link se rompe.
              </Callout>
            ) : null}

            <Field
              label="Que Google la encuentre"
              layout="toggle"
              hint="Apagado, la página funciona igual pero le pedimos a los buscadores que no la indexen. Prendelo cuando esté terminada y quieras que aparezca en las búsquedas."
            >
              <Switch checked={indexable} onCheckedChange={setIndexable} />
            </Field>
          </DialogBody>

          <DialogFooter>
            <Button type="button" variant="secondary" onClick={() => onOpenChange(false)}>
              Cancelar
            </Button>
            <SubmitButton pendingText="Guardando…" disabled={slugError !== null}>
              Guardar ajustes
            </SubmitButton>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
