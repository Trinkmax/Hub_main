'use client'

import { ChevronRight, Pencil } from 'lucide-react'
import { useEffect, useRef } from 'react'
import { StatusPill } from '@/components/administracion/kit/status-pill'
import { Button } from '@/components/ui/button'
import { formatCuit } from '@/lib/fiscal'
import { cn } from '@/lib/utils'
import { cuitList, PARTY_KIND_WORD } from '../_lib/cobros'
import { COMMISSION_VAT_MODE_LABELS } from '../_lib/labels'
import { CHARGING_PARTY_KINDS, type RateKey, type SystemPartyRow } from '../_lib/payloads'
import { formatBp } from '../_lib/percent'

/**
 * «CUIT de tarjetas, apps, bancos y organismos»: la lista plegada al pie de
 * «Medios de cobro». Es lo que quedó de la pestaña «Plataformas» que no es de
 * un medio en particular: la CUIT de cada uno (la piden los libros de IVA) y,
 * de los organismos, nada más que eso. Están TODOS los partícipes del sistema
 * y los bancos, en el orden de siempre: nada de lo que antes se editaba quedó
 * sin lugar. «Editar» abre el mismo diálogo de siempre.
 *
 * Los que no llevan CUIT («Personal (sueldos)», «Proveedores varios», «Señas
 * de clientes»: juntan a varios, no son una empresa) van aparte, al final, y
 * no cuentan en la píldora: «8 sin CUIT» son ocho pendientes de verdad.
 *
 * Es zona de la contadora: viene plegada para el dueño y abierta para ella, o
 * cuando se llega con `?tab=participes` o `#cuit`.
 */

export type { SystemPartyRow }

const SHORT: Readonly<Record<RateKey, string>> = {
  commissionBp: 'Comisión',
  iibbWithholdingBp: 'Ingresos Brutos',
  vatWithholdingBp: 'IVA',
  incomeTaxWithholdingBp: 'Ganancias',
  sircupaBp: 'SIRCUPA',
}

/** «Comisión 1,5 % · SIRCUPA 3,5 %»: las tasas cargadas, para quien las revisa. */
function ratesLine(p: SystemPartyRow): string | null {
  const parts = (Object.keys(SHORT) as RateKey[])
    .filter((k) => p.rates[k] !== null && p.rates[k] !== undefined)
    .map((k) => `${SHORT[k]} ${formatBp(p.rates[k])}`)
  return parts.length > 0 ? parts.join(' · ') : null
}

const ANCHOR = 'cuit'

export function SystemPartiesList({
  parties,
  readOnly,
  defaultOpen,
  onEdit,
}: {
  parties: readonly SystemPartyRow[]
  readOnly: boolean
  /** Abierta de entrada: la contadora, o quien llegó por `?tab=participes`. */
  defaultOpen: boolean
  onEdit: (party: SystemPartyRow) => void
}) {
  const ref = useRef<HTMLDetailsElement>(null)

  // Con `#cuit` en la URL se abre sola y queda a la vista.
  useEffect(() => {
    const open = () => {
      if (window.location.hash === `#${ANCHOR}` && ref.current) {
        ref.current.open = true
        ref.current.scrollIntoView({ block: 'start' })
      }
    }
    open()
    window.addEventListener('hashchange', open)
    return () => window.removeEventListener('hashchange', open)
  }, [])

  if (parties.length === 0) return null
  const { expected, exempt, missing } = cuitList(parties)

  const row = (p: SystemPartyRow, expectsCuit: boolean) => {
    const charges = CHARGING_PARTY_KINDS.has(p.kind)
    const rates = charges ? ratesLine(p) : null
    return (
      <li key={p.id} className="flex items-center justify-between gap-3 py-2.5">
        <div className={cn('min-w-0', !p.active && 'opacity-60')}>
          <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm font-medium">
            <span className="min-w-0 truncate" title={p.name}>
              {p.name}
            </span>
            {p.active ? null : <StatusPill tone="muted">Apagada</StatusPill>}
          </p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {PARTY_KIND_WORD[p.kind]}
            {p.taxId ? (
              <>
                {' · '}
                <span className="tabular-nums">CUIT {formatCuit(p.taxId)}</span>
              </>
            ) : expectsCuit ? (
              ' · Sin CUIT'
            ) : null}
          </p>
          {rates ? <p className="text-xs text-muted-foreground text-pretty">{rates}</p> : null}
          {charges && p.commissionVatMode !== 'none' ? (
            <p className="text-xs text-muted-foreground">
              Factura la comisión: {COMMISSION_VAT_MODE_LABELS[p.commissionVatMode].toLowerCase()}
            </p>
          ) : null}
        </div>
        {readOnly ? null : (
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-11 shrink-0 gap-1.5 rounded-full px-3.5 md:h-9"
            aria-label={`Editar ${p.name}`}
            onClick={() => onEdit(p)}
          >
            <Pencil className="size-3.5" aria-hidden />
            Editar
          </Button>
        )}
      </li>
    )
  }

  return (
    <details
      ref={ref}
      id={ANCHOR}
      open={defaultOpen || undefined}
      className="group/cuit scroll-mt-28 rounded-2xl bg-secondary/50"
    >
      <summary className="flex min-h-12 cursor-pointer list-none flex-wrap items-center gap-x-3 gap-y-1 rounded-2xl px-4 py-2.5 outline-none focus-visible:ring-2 focus-visible:ring-ring [&::-webkit-details-marker]:hidden">
        <ChevronRight
          aria-hidden
          className="size-4 shrink-0 text-muted-foreground transition-transform group-open/cuit:rotate-90 motion-reduce:transition-none"
        />
        <span className="min-w-0 flex-1 text-sm font-medium text-pretty">
          CUIT de tarjetas, apps, bancos y organismos
        </span>
        <StatusPill tone="muted">
          {missing === 0 ? 'Todos con CUIT' : `${missing} sin CUIT`}
        </StatusPill>
      </summary>
      <div className="px-4 pb-4">
        <p className="text-sm text-muted-foreground text-pretty">
          La CUIT de cada uno la piden los libros de IVA. De los organismos solo se carga eso.
        </p>
        {expected.length > 0 ? (
          <ul className="mt-3 divide-y divide-border/60">{expected.map((p) => row(p, true))}</ul>
        ) : null}
        {exempt.length > 0 ? (
          <section aria-labelledby="aj-cuit-sin" className="mt-4 border-t border-border/60 pt-3">
            <h3 id="aj-cuit-sin" className="text-sm font-medium">
              No llevan CUIT
            </h3>
            <p className="mt-0.5 text-xs text-muted-foreground text-pretty">
              Juntan a varios (el personal, proveedores sueltos, las señas): no son una empresa.
            </p>
            <ul className="mt-1 divide-y divide-border/60">{exempt.map((p) => row(p, false))}</ul>
          </section>
        ) : null}
      </div>
    </details>
  )
}
