'use client'

import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react'
import { functionState } from '@/lib/ticketing/availability'
import { functionAddress, pickFunction, publicBranchLabel } from '@/lib/ticketing/branches'
import type { PublicBranch, PublicFunction } from '@/lib/ticketing/types'

/**
 * La función elegida, compartida por toda la página: los talones del primer
 * acto, la entrada y la barra fija del celular dicen siempre la misma fecha.
 *
 * Vive en la URL (?fecha=YYYY-MM-DD, con replaceState: no ensucia el Atrás),
 * así el link que llega desde la cartelera ya trae la fecha y compartir la
 * página comparte la función. Con funciones en más de una sucursal, también
 * ?sucursal= (la misma película puede ir la misma noche en las dos).
 *
 * Si la compra descubre que quedaban menos lugares (otro compró en el medio),
 * `reportSeats` corrige esa función acá mismo sin recargar.
 */

type Ctx = {
  functions: PublicFunction[]
  selected: PublicFunction | null
  select: (eventId: string) => void
  reportSeats: (eventId: string, left: number) => void
  /** Hay que decir en qué sucursal es cada función (más de una vende en la cartelera). */
  showBranches: boolean
  /** La sucursal de una función, o null si no se sabe. */
  branchOf: (fn: PublicFunction | null) => PublicBranch | null
  /** El nombre corto de la sucursal, solo si hay que decirlo (para los talones y las líneas). */
  branchLabelOf: (fn: PublicFunction | null) => string | null
  /** Dónde es una función: la dirección de su sucursal o, si no cargó, la del bar. */
  addressOf: (fn: PublicFunction | null) => string | null
}

const ExperienceContext = createContext<Ctx | null>(null)

export function ExperienceProvider({
  functions: initialFunctions,
  initialDate,
  initialBranch = null,
  branches = [],
  showBranches = false,
  venueAddress = null,
  minPartySize = 1,
  children,
}: {
  functions: PublicFunction[]
  initialDate: string | null
  /** La sucursal con la que arranca (`?sucursal=`). */
  initialBranch?: string | null
  branches?: PublicBranch[]
  showBranches?: boolean
  /** La dirección del bar, para las sucursales que no cargaron la suya. */
  venueAddress?: string | null
  /** El mínimo de personas de la película: con menos lugares, la función está agotada. */
  minPartySize?: number
  children: ReactNode
}) {
  const [functions, setFunctions] = useState(initialFunctions)
  const [selectedId, setSelectedId] = useState<string | null>(
    () =>
      pickFunction(initialFunctions, { date: initialDate, branch: initialBranch })?.eventId ?? null,
  )

  const selected = useMemo(
    () => functions.find((f) => f.eventId === selectedId) ?? null,
    [functions, selectedId],
  )

  const bySlug = useMemo(() => new Map(branches.map((b) => [b.slug, b])), [branches])
  const branchOf = useCallback(
    (fn: PublicFunction | null) => (fn?.branch ? (bySlug.get(fn.branch) ?? null) : null),
    [bySlug],
  )
  const branchLabelOf = useCallback(
    (fn: PublicFunction | null) => {
      if (!showBranches) return null
      const branch = branchOf(fn)
      return branch ? publicBranchLabel(branch) : null
    },
    [branchOf, showBranches],
  )
  const addressOf = useCallback(
    (fn: PublicFunction | null) => functionAddress(branchOf(fn), venueAddress),
    [branchOf, venueAddress],
  )

  // La URL refleja la función elegida: la fecha y, con varias sucursales, dónde.
  useEffect(() => {
    if (!selected) return
    const url = new URL(window.location.href)
    url.searchParams.set('fecha', selected.date)
    if (showBranches && selected.branch) url.searchParams.set('sucursal', selected.branch)
    else url.searchParams.delete('sucursal')
    if (url.href === window.location.href) return
    window.history.replaceState(window.history.state, '', url)
  }, [selected, showBranches])

  const select = useCallback(
    (eventId: string) => {
      const fn = functions.find((f) => f.eventId === eventId)
      if (!fn || fn.state === 'sold_out') return
      setSelectedId(eventId)
    },
    [functions],
  )

  const reportSeats = useCallback(
    (eventId: string, left: number) => {
      setFunctions((prev) =>
        prev.map((f) =>
          f.eventId === eventId
            ? {
                ...f,
                left: Math.max(0, left),
                state: functionState(left, f.capacity, minPartySize),
              }
            : f,
        ),
      )
    },
    [minPartySize],
  )

  // Si la elegida se agotó, pasar a la próxima con lugar (de la misma sucursal, si hay).
  useEffect(() => {
    if (selected?.state !== 'sold_out') return
    setSelectedId(pickFunction(functions, { date: null, branch: selected.branch })?.eventId ?? null)
  }, [functions, selected])

  const value = useMemo(
    () => ({
      functions,
      selected,
      select,
      reportSeats,
      showBranches,
      branchOf,
      branchLabelOf,
      addressOf,
    }),
    [functions, selected, select, reportSeats, showBranches, branchOf, branchLabelOf, addressOf],
  )
  return <ExperienceContext.Provider value={value}>{children}</ExperienceContext.Provider>
}

export function useExperience(): Ctx {
  const ctx = useContext(ExperienceContext)
  if (!ctx) throw new Error('useExperience fuera de <ExperienceProvider>')
  return ctx
}
