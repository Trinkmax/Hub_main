'use client'

import { useRouter } from 'next/navigation'
import { useActionState, useEffect } from 'react'
import { toast } from 'sonner'
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
}: {
  tenantSlug: string
  options: AudienceBuilderOptions
  audienceId?: string
  initialName?: string
  initialFilters?: AudienceFilter
}) {
  const router = useRouter()
  const action = audienceId
    ? updateAudience.bind(null, tenantSlug)
    : createAudience.bind(null, tenantSlug)
  const [state, formAction, pending] = useActionState(action, initial)

  useEffect(() => {
    if (state.ok && state.id) {
      toast.success(audienceId ? 'Audiencia actualizada.' : 'Audiencia creada.')
      router.push(`/${tenantSlug}/audiencias`)
      router.refresh()
    } else if (!state.ok && state.message) {
      toast.error(state.message)
    }
  }, [state, audienceId, router, tenantSlug])

  return (
    <form action={formAction} className="space-y-4">
      <AudienceBuilder
        tenantSlug={tenantSlug}
        options={options}
        initialName={initialName}
        initialFilters={initialFilters}
        hiddenIdField={audienceId}
        submitLabel={pending ? 'Guardando…' : 'Guardar'}
      />
    </form>
  )
}
