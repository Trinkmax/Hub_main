'use client'

import { Banknote } from 'lucide-react'
import Link from 'next/link'
import { useSheetData } from '@/app/(manager)/[tenantSlug]/administracion/compras/_components/use-sheet-data'
import type { AccActionState } from '@/lib/accounting/action-state'
import { linkPosCash, loadPosCash } from '@/lib/accounting/actions/pos-cash'
import { type PosCashPending, posCashWho } from '@/lib/accounting/pos-cash'
import { formatDayMonth } from '@/lib/dates'
import { formatCentsShort } from '@/lib/money'

/**
 * Lo que necesita un formulario para registrar un retiro de la caja del salón (`?retiro=<id>`): traerlo
 * al abrirse, decirlo arriba y atarlo al comprobante al guardar. Los formularios siguen siendo los de
 * siempre: esto solo les pone valores de arranque y un paso antes del envío.
 */

export type PosCashPrefill = {
  /** Todavía se está buscando: el formulario espera para arrancar ya completo. */
  loading: boolean
  /** El retiro, si sigue esperando. */
  posCash: PosCashPending | null
  /** Qué pasó si no se pudo traer (ya tiene comprobante, no se pudo leer). */
  notice: string | null
}

const NO_PREFILL: PosCashPrefill = { loading: false, posCash: null, notice: null }

/** El retiro de `?retiro=`, leído una vez al abrir la hoja. Sin `movementId` no pide nada. */
export function usePosCashPrefill(
  tenantSlug: string,
  movementId: string | undefined,
): PosCashPrefill {
  const state = useSheetData(
    movementId ? () => loadPosCash(tenantSlug, { movementId }) : null,
    movementId ?? 'ninguno',
  )
  if (!movementId) return NO_PREFILL
  if (state.status === 'loading') return { loading: true, posCash: null, notice: null }
  if (state.status === 'error') {
    return {
      loading: false,
      posCash: null,
      notice: 'No pudimos traer el retiro de la caja. Podés cargarlo a mano o volver a abrirlo.',
    }
  }
  return state.data
    ? { loading: false, posCash: state.data, notice: null }
    : {
        loading: false,
        posCash: null,
        notice: 'Ese retiro de la caja ya tiene su comprobante (o se descartó).',
      }
}

/**
 * La acción de siempre, con un paso antes: atar el retiro al `clientRef` de este envío. Si el
 * comprobante no se guarda, el retiro sigue esperando; si se guarda, deja de esperar solo. Sin retiro,
 * es la acción tal cual.
 */
export function linkingPosCash<I extends { clientRef: string }>(
  movementId: string | null | undefined,
  action: (slug: string, input: I) => Promise<AccActionState>,
): (slug: string, input: I) => Promise<AccActionState> {
  if (!movementId) return action
  return async (slug, input) => {
    const linked = await linkPosCash(slug, { movementId, clientRef: input.clientRef })
    if (!linked.ok) return linked
    return action(slug, input)
  }
}

/**
 * Arriba del formulario: de dónde viene lo que ya está cargado. `detailHref` es la salida de la hoja
 * rápida para una factura con percepciones o varios renglones: la carga completa, con el mismo retiro.
 */
export function PosCashNote({
  posCash,
  notice,
  detailHref = null,
}: {
  posCash: PosCashPending | null
  notice: string | null
  detailHref?: string | null
}) {
  if (!posCash && !notice) return null
  return (
    <p className="flex items-start gap-2 rounded-xl border border-warning/40 bg-warning/[0.07] px-3 py-2 text-sm text-pretty">
      <Banknote aria-hidden className="mt-0.5 size-4 shrink-0 text-warning-text" />
      {posCash ? (
        <span>
          <span className="font-medium">De la caja del salón:</span>{' '}
          {formatCentsShort(posCash.amountCents)} que salieron el {formatDayMonth(posCash.date)}
          {posCash.branchName ? ` (${posCash.branchName})` : ''}
          {posCash.byName ? `, anotado por ${posCash.byName}` : ''}.
          {posCash.purpose === 'supplier' && !posCash.partyId && posCash.partyName
            ? ` En la caja escribieron «${posCashWho(posCash)}»: elegí el proveedor o cargalo como nuevo.`
            : ''}
          {detailHref ? (
            <>
              {' '}
              <Link
                href={detailHref}
                className="rounded-sm font-medium underline underline-offset-4 outline-none hover:no-underline focus-visible:ring-2 focus-visible:ring-ring"
              >
                ¿Tiene percepciones o varios renglones? Cargala completa
              </Link>
              .
            </>
          ) : null}
        </span>
      ) : (
        <span>{notice}</span>
      )}
    </p>
  )
}
