import { availabilityLabel } from '@/lib/ticketing/availability'
import { centsToPesos } from '@/lib/ticketing/pricing'
import type { FunctionState, PublicFunction } from '@/lib/ticketing/types'

/**
 * Las cuentas de la pestaña Entradas: el estado de la cartelera, los precios
 * con los que arranca una película nueva y cómo se dice el lugar que le queda
 * a cada función. Puro: sin DB ni React.
 */

/** El gestor que crea la base para las reservas online (ticketing_online_manager). */
export const ONLINE_MANAGER_NAME = 'Venta online'

export type CarteleraSummary = {
  /** Películas publicadas. */
  published: number
  /** Películas apagadas (borradores). */
  drafts: number
  /** Funciones de las publicadas que todavía tienen lugar. */
  onSale: number
  /** Funciones de las publicadas sin lugar. */
  soldOut: number
}

type ExperienceForSummary = {
  published: boolean
  functions: ReadonlyArray<{ state: FunctionState }>
}

export function carteleraSummary(
  experiences: ReadonlyArray<ExperienceForSummary>,
): CarteleraSummary {
  const summary: CarteleraSummary = { published: 0, drafts: 0, onSale: 0, soldOut: 0 }
  for (const experience of experiences) {
    if (!experience.published) {
      summary.drafts += 1
      continue
    }
    summary.published += 1
    for (const fn of experience.functions) {
      if (fn.state === 'sold_out') summary.soldOut += 1
      else summary.onSale += 1
    }
  }
  return summary
}

/** Un dato del estado: el número (o «Ninguna») y el resto de la frase. */
export type SummaryPart = { value: string; label: string }

/**
 * «2 películas publicadas · 5 funciones a la venta · 1 agotada». Las funciones
 * solo se cuentan si hay algo publicado: las de una película apagada no están
 * a la venta.
 */
export function carteleraSummaryParts(summary: CarteleraSummary): SummaryPart[] {
  if (summary.published === 0) return [{ value: 'Ninguna', label: 'película publicada' }]
  const parts: SummaryPart[] = [
    {
      value: String(summary.published),
      label: summary.published === 1 ? 'película publicada' : 'películas publicadas',
    },
    summary.onSale === 0
      ? { value: 'Ninguna', label: 'función a la venta' }
      : {
          value: String(summary.onSale),
          label: summary.onSale === 1 ? 'función a la venta' : 'funciones a la venta',
        },
  ]
  if (summary.soldOut > 0) {
    parts.push({
      value: String(summary.soldOut),
      label: summary.soldOut === 1 ? 'agotada' : 'agotadas',
    })
  }
  return parts
}

/**
 * Los precios (en pesos) de la última película que se tocó: en Cine y
 * degustación cambian por edición, no por película, así que la próxima
 * arranca igual. `null` si todavía no hay ninguna.
 */
export function latestPrices(
  experiences: ReadonlyArray<{ updatedAt: string; priceCents: number; depositCents: number }>,
): { price: number; deposit: number } | null {
  let latest: (typeof experiences)[number] | null = null
  let latestAt = Number.NEGATIVE_INFINITY
  for (const experience of experiences) {
    const at = Date.parse(experience.updatedAt)
    const when = Number.isFinite(at) ? at : Number.NEGATIVE_INFINITY
    if (latest === null || when > latestAt) {
      latest = experience
      latestAt = when
    }
  }
  if (!latest) return null
  return { price: centsToPesos(latest.priceCents), deposit: centsToPesos(latest.depositCents) }
}

/** Qué parte del cupo ya se vendió (o está guardada), de 0 a 100, para la barrita. */
export function occupancyPercent(fn: Pick<PublicFunction, 'left' | 'capacity'>): number {
  if (fn.capacity <= 0) return 100
  const taken = fn.capacity - Math.max(0, fn.left)
  return Math.round(Math.min(100, Math.max(0, (taken / fn.capacity) * 100)))
}

/**
 * Lo que se lee debajo de la barrita: «Agotado», «Último lugar»,
 * «Últimos 4» o, con lugar de sobra, «Quedan 32 de 40».
 */
export function seatsText(fn: Pick<PublicFunction, 'left' | 'capacity' | 'state'>): string {
  return availabilityLabel(fn) ?? `Quedan ${fn.left} de ${fn.capacity}`
}
