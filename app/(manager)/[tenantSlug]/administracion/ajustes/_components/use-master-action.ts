'use client'

import { useRouter } from 'next/navigation'
import { useCallback, useTransition } from 'react'
import { toast } from 'sonner'
import {
  ACC_UNREACHABLE,
  type AccFailureState,
  type AccSimpleState,
} from '@/lib/accounting/action-state'

export type MasterRunOptions<T> = {
  onSuccess?: (data: T, message: string) => void
  /**
   * Cualquier error (campos, conflicto, permiso): el formulario lo muestra en
   * su lugar. Sin esto, va en un aviso.
   */
  onFailure?: (state: AccFailureState) => void
  /** Sin el aviso de «Guardado» (la pantalla ya lo muestra de otra forma). */
  quiet?: boolean
}

/**
 * Corre una acción de datos maestros (Ajustes, plan de cuentas, accesos) con
 * el patrón del panel: «Guardando…» mientras corre, aviso con el resultado y
 * la pantalla al día. Si otra persona cambió lo mismo (`stale`), se recarga
 * para que se vea la versión nueva.
 */
export function useMasterAction() {
  const router = useRouter()
  const [pending, startTransition] = useTransition()

  const run = useCallback(
    <T>(call: () => Promise<AccSimpleState<T>>, opts: MasterRunOptions<T> = {}) => {
      startTransition(async () => {
        let result: AccSimpleState<T>
        try {
          result = await call()
        } catch {
          toast.error(ACC_UNREACHABLE.offline)
          return
        }
        if (result.ok) {
          if (!opts.quiet) toast.success(result.message)
          opts.onSuccess?.(result.data, result.message)
          router.refresh()
          return
        }
        if (result.code === 'stale') router.refresh()
        if (opts.onFailure) opts.onFailure(result)
        else toast.error(result.message)
      })
    },
    [router],
  )

  return { pending, run }
}
