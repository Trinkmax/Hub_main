'use client'

import { useRouter } from 'next/navigation'
import { useActionState, useEffect } from 'react'
import { toast } from 'sonner'
import { FormError } from '@/components/ui/field'
import { type AudienceActionState, createAudience, updateAudience } from '@/lib/audiences/actions'
import type { AudienceBuilderOptions } from '@/lib/audiences/queries'
import type { AudienceFilter } from '@/lib/audiences/schemas'
import { AudienceBuilder } from './builder'

const initial: AudienceActionState = { ok: true }

export function AudienceForm({
  tenantSlug,
  options,
  audienceId,
  initialName,
  initialFilters,
  cancelHref,
}: {
  tenantSlug: string
  options: AudienceBuilderOptions
  audienceId?: string
  initialName?: string
  initialFilters?: AudienceFilter
  /** Adónde vuelve «Cancelar» (la lista de audiencias). */
  cancelHref: string
}) {
  const router = useRouter()
  const action = audienceId
    ? updateAudience.bind(null, tenantSlug)
    : createAudience.bind(null, tenantSlug)
  const [state, formAction] = useActionState(action, initial)

  useEffect(() => {
    if (state.ok && state.id) {
      toast.success(audienceId ? 'Audiencia actualizada.' : 'Audiencia creada.')
      router.push(`/${tenantSlug}/mensajeria/audiencias`)
      router.refresh()
    }
  }, [state, audienceId, router, tenantSlug])

  return (
    <form action={formAction} className="flex flex-col gap-8">
      {/* El error del envío queda en la página (y recibe el foco), no en un aviso que se va. */}
      <FormError
        title="No se pudo guardar la audiencia"
        message={state.ok ? null : state.message}
      />
      <AudienceBuilder
        tenantSlug={tenantSlug}
        options={options}
        initialName={initialName}
        initialFilters={initialFilters}
        hiddenIdField={audienceId}
        submitLabel={audienceId ? 'Guardar cambios' : 'Crear audiencia'}
        cancelHref={cancelHref}
      />
    </form>
  )
}
