'use client'

import { useRouter, useSearchParams } from 'next/navigation'
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  useTransition,
} from 'react'
import { toast } from 'sonner'
import { setBranchScope } from '@/lib/branches/actions'
import type { BranchFilter } from '@/lib/branches/filter'
import type { BranchRef, BranchScopeClient, BranchSurface } from '@/lib/branches/types'

/**
 * La sucursal que se mira, del lado del navegador: la resolvió el servidor para este pedido (`getBranchScope`) y la
 * leen el selector, las etiquetas y los campos para elegir sucursal. Cambiar de sucursal guarda la cookie del
 * dispositivo y vuelve a pedir la pantalla; las otras pestañas abiertas del mismo bar se enteran solas.
 */

type BranchScopeValue = {
  slug: string
  scope: BranchScopeClient
  current: BranchRef | null
  /** La sucursal de cada id, para las etiquetas. */
  byId: ReadonlyMap<string, BranchRef>
  /** El filtro con el que se dibujó la pantalla: lo que el navegador manda al pedir datos de nuevo. */
  filter: BranchFilter
  /** Cambiando de sucursal (mientras llega la pantalla nueva). */
  switching: boolean
  /** A dónde se está cambiando, para dibujarlo antes de que llegue. */
  pendingChoice: string | null
  switchTo: (choice: string, surface?: BranchSurface) => void
}

const BranchScopeContext = createContext<BranchScopeValue | null>(null)

const CHANNEL = 'hub-branch'

export function BranchScopeProvider({
  slug,
  scope,
  children,
}: {
  slug: string
  scope: BranchScopeClient
  children: ReactNode
}) {
  const router = useRouter()
  const searchParams = useSearchParams()
  const [switching, startTransition] = useTransition()
  const [pendingChoice, setPendingChoice] = useState<string | null>(null)

  const byId = useMemo(
    () => new Map(scope.branches.map((branch) => [branch.id, branch])),
    [scope.branches],
  )
  const current = scope.currentId ? (byId.get(scope.currentId) ?? null) : null
  const filter = useMemo<BranchFilter>(
    () => ({ ids: scope.isAll && scope.unrestricted ? null : [...scope.ids] }),
    [scope.ids, scope.isAll, scope.unrestricted],
  )

  // Otra pestaña del mismo bar cambió de sucursal: esta se pone al día (la cookie es una sola por dispositivo).
  useEffect(() => {
    if (typeof BroadcastChannel === 'undefined') return
    const channel = new BroadcastChannel(CHANNEL)
    channel.onmessage = (event: MessageEvent<{ slug?: string }>) => {
      if (event.data?.slug === slug) router.refresh()
    }
    return () => channel.close()
  }, [router, slug])

  const switchTo = useCallback(
    (choice: string, surface: BranchSurface = 'view') => {
      setPendingChoice(choice)
      startTransition(async () => {
        const result = await setBranchScope(slug, choice, surface)
        if (!result.ok) {
          setPendingChoice(null)
          toast.error(result.message)
          return
        }
        // Un link con ?sucursal= manda sobre lo elegido: se lo saca para que se vea lo que se acaba de elegir.
        if (searchParams.has('sucursal')) {
          const params = new URLSearchParams(searchParams.toString())
          params.delete('sucursal')
          const query = params.toString()
          router.replace(`${window.location.pathname}${query ? `?${query}` : ''}`, {
            scroll: false,
          })
        }
        router.refresh()
        if (typeof BroadcastChannel !== 'undefined') {
          const channel = new BroadcastChannel(CHANNEL)
          channel.postMessage({ slug })
          channel.close()
        }
      })
    },
    [router, searchParams, slug],
  )

  // Cuando llega la pantalla nueva, lo pendiente ya es lo actual.
  // biome-ignore lint/correctness/useExhaustiveDependencies: se limpia cada vez que el servidor manda un alcance nuevo
  useEffect(() => {
    setPendingChoice(null)
  }, [scope.currentId, scope.isAll])

  const value = useMemo<BranchScopeValue>(
    () => ({ slug, scope, current, byId, filter, switching, pendingChoice, switchTo }),
    [byId, current, filter, pendingChoice, scope, slug, switchTo, switching],
  )

  return <BranchScopeContext.Provider value={value}>{children}</BranchScopeContext.Provider>
}

/** El alcance de sucursal de la pantalla. Fuera del panel (páginas públicas) devuelve `null`. */
export function useBranchScope(): BranchScopeValue | null {
  return useContext(BranchScopeContext)
}
