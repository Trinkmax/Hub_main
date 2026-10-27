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
import { firstAvailable, functionState } from '@/lib/ticketing/availability'
import type { PublicFunction } from '@/lib/ticketing/types'

/**
 * La función elegida, compartida por toda la página: los talones del primer
 * acto, la entrada y la barra fija del celular dicen siempre la misma fecha.
 *
 * Vive en la URL (?fecha=YYYY-MM-DD, con replaceState: no ensucia el Atrás),
 * así el link que llega desde la cartelera ya trae la fecha y compartir la
 * página comparte la función.
 *
 * Si la compra descubre que quedaban menos lugares (otro compró en el medio),
 * `reportSeats` corrige esa función acá mismo sin recargar.
 */

type Ctx = {
  functions: PublicFunction[]
  selected: PublicFunction | null
  select: (eventId: string) => void
  reportSeats: (eventId: string, left: number) => void
}

const ExperienceContext = createContext<Ctx | null>(null)

function pickInitial(functions: PublicFunction[], date: string | null): PublicFunction | null {
  if (date) {
    const match = functions.find((f) => f.date === date && f.state !== 'sold_out')
    if (match) return match
  }
  return firstAvailable(functions)
}

export function ExperienceProvider({
  functions: initialFunctions,
  initialDate,
  minPartySize = 1,
  children,
}: {
  functions: PublicFunction[]
  initialDate: string | null
  /** El mínimo de personas de la película: con menos lugares, la función está agotada. */
  minPartySize?: number
  children: ReactNode
}) {
  const [functions, setFunctions] = useState(initialFunctions)
  const [selectedId, setSelectedId] = useState<string | null>(
    () => pickInitial(initialFunctions, initialDate)?.eventId ?? null,
  )

  const selected = useMemo(
    () => functions.find((f) => f.eventId === selectedId) ?? null,
    [functions, selectedId],
  )

  // La URL refleja la fecha elegida.
  useEffect(() => {
    if (!selected) return
    const url = new URL(window.location.href)
    if (url.searchParams.get('fecha') === selected.date) return
    url.searchParams.set('fecha', selected.date)
    window.history.replaceState(window.history.state, '', url)
  }, [selected])

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

  // Si la elegida se agotó, pasar a la próxima con lugar.
  useEffect(() => {
    if (selected?.state !== 'sold_out') return
    setSelectedId(firstAvailable(functions)?.eventId ?? null)
  }, [functions, selected])

  const value = useMemo(
    () => ({ functions, selected, select, reportSeats }),
    [functions, selected, select, reportSeats],
  )
  return <ExperienceContext.Provider value={value}>{children}</ExperienceContext.Provider>
}

export function useExperience(): Ctx {
  const ctx = useContext(ExperienceContext)
  if (!ctx) throw new Error('useExperience fuera de <ExperienceProvider>')
  return ctx
}
