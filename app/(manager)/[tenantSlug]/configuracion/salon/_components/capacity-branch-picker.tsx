'use client'

import { usePathname, useRouter } from 'next/navigation'
import { useTransition } from 'react'
import { BranchField } from '@/components/branches/branch-field'
import { useBranchScope } from '@/components/branches/branch-scope-provider'

/**
 * De qué sucursal es el cupo que se edita. El cupo es de un lugar (no se suma entre sucursales), así que esta
 * pantalla trabaja siempre sobre UNA: mirando «Todas» arranca en la principal y acá se cambia. Cambiar es un link con
 * `?sucursal=` (no toca lo que eligió el dispositivo): la página se vuelve a pedir con esa sucursal.
 *
 * Con una sola sucursal no se ve.
 */
export function CapacityBranchPicker({ branchId }: { branchId: string }) {
  const router = useRouter()
  const pathname = usePathname()
  const context = useBranchScope()
  const [pending, startTransition] = useTransition()

  return (
    <BranchField
      value={branchId}
      label="Cupo de la sucursal"
      disabled={pending}
      onChange={(next) => {
        const slug = context?.byId.get(next)?.slug
        if (!slug || next === branchId) return
        startTransition(() => router.push(`${pathname}?sucursal=${encodeURIComponent(slug)}`))
      }}
    />
  )
}
