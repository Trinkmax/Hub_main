import { CircleCheck, HandCoins } from 'lucide-react'
import Link from 'next/link'
import { DUE_SWATCHES } from '@/components/administracion/charts/palette'
import { SplitBar } from '@/components/administracion/charts/split-bar'
import { Explain, HeroPanel, MathRow, MoneyHero } from '@/components/administracion/kit'
import { ActionButton } from '@/components/administracion/quick-actions'
import { payablesTranches } from '@/lib/accounting/home'
import type { PartyListTotals } from '@/lib/accounting/queries/parties'
import { formatCentsShort } from '@/lib/money'
import { cn } from '@/lib/utils'
import { libretaSentence } from '../_lib/libreta'
import { comprasHref } from '../_lib/links'

const QUIET_LINK =
  'rounded-sm font-medium text-foreground underline underline-offset-4 outline-none hover:text-primary focus-visible:ring-2 focus-visible:ring-ring'

/**
 * «Le debés a proveedores»: el número que manda en la portada de la libreta.
 * Es el mismo bloque de «Lo que tenés que pagar» del Resumen, dicho con las
 * mismas palabras y partido en los mismos tres tramos (`payablesTranches`):
 * vencido · vence esta semana · más adelante.
 *
 * Reemplaza a las cuatro tarjetas sueltas de antes: «Vencido» es una parte de
 * «Le debés» (por eso va adentro de la barra) y lo que hay a favor no se resta
 * (por eso va aparte, con su oración).
 *
 * Al lado del número va la acción del momento: [Pagar lo vencido] abre «Pagar»,
 * que arranca por lo más urgente. Solo para quien carga.
 *
 * Sin deuda no muestra «$ 0»: dice «No le debés nada a nadie» y qué va a
 * aparecer. Server-safe (el número que cuenta y el botón son sus islas cliente).
 */
export function LibretaHero({
  tenantSlug,
  totals,
  debtors,
  overdueParties,
  hasSuppliers,
  openingPending = false,
  canWrite = false,
  className,
}: {
  tenantSlug: string
  /** Los totales del grupo entero (sin filtro ni búsqueda). */
  totals: PartyListTotals
  /** A cuántos se les debe algo. */
  debtors: number
  /** Cuántos tienen algo vencido. */
  overdueParties: number
  /** Ya hay algún proveedor cargado. */
  hasSuppliers: boolean
  /**
   * Los saldos iniciales siguen sin cargar (lo que el bar ya debía al arrancar): un cero
   * no es «no le debés nada» y lo cargado no es todo. Lo mismo que dice el Resumen.
   */
  openingPending?: boolean
  /** Quien carga ve [Pagar lo vencido] al lado del número. */
  canWrite?: boolean
  className?: string
}) {
  const tranches = payablesTranches(
    {
      totalCents: totals.debtCents,
      overdueCents: totals.overdueCents,
      dueWeekCents: totals.dueSoonCents,
      partiesRed: overdueParties,
    },
    { openingPending },
  )

  if (tranches?.unknown) {
    // El bar recién configurado: ni «$ 0» ni «no le debés nada» (puede deber de antes).
    return (
      <HeroPanel tone="crema" className={className}>
        <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-muted-foreground">
          Le debés a proveedores
        </p>
        <p className="mt-2 font-serif text-2xl font-semibold leading-tight tracking-tight text-balance sm:text-3xl">
          {tranches.title}
        </p>
        <p className="mt-2.5 max-w-prose text-sm leading-relaxed text-muted-foreground text-pretty">
          {tranches.sentence} Y cada compra que cargues para pagar después aparece acá, con su
          vencimiento.
        </p>
        <CreditLine tenantSlug={tenantSlug} creditCents={totals.creditCents} />
      </HeroPanel>
    )
  }

  if (!tranches || tranches.isEmpty) {
    return (
      <HeroPanel tone="crema" className={className}>
        <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-muted-foreground">
          Le debés a proveedores
        </p>
        <p className="mt-2 flex items-start gap-2.5 font-serif text-2xl font-semibold leading-tight tracking-tight text-balance sm:text-3xl">
          <CircleCheck aria-hidden className="mt-1 size-6 shrink-0 text-success" />
          No le debés nada a nadie
        </p>
        <p className="mt-2.5 max-w-prose text-sm leading-relaxed text-muted-foreground text-pretty">
          {hasSuppliers
            ? 'Cuando un proveedor te deje algo para pagar después, lo cargás y aparece acá con su fecha.'
            : 'Cuando un proveedor te deje algo para pagar después, lo cargás y acá ves a quién le debés, cuánto y desde cuándo.'}
        </p>
        <CreditLine tenantSlug={tenantSlug} creditCents={totals.creditCents} />
      </HeroPanel>
    )
  }

  const [overdue, week, later] = tranches.tranches
  const hasOverdue = (overdue?.cents ?? 0) > 0
  return (
    <HeroPanel tone="crema" className={className}>
      <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-4">
        <MoneyHero
          size="xl"
          animate
          label="Le debés a proveedores"
          cents={tranches.totalCents}
          sentence={libretaSentence(debtors, tranches)}
        />
        {canWrite ? (
          <ActionButton
            action="pagar"
            variant={hasOverdue ? 'default' : 'outline'}
            className="h-12 gap-2 rounded-full px-6 text-base max-sm:w-full"
          >
            <HandCoins className="size-4" aria-hidden />
            {hasOverdue ? 'Pagar lo vencido' : 'Pagarle a un proveedor'}
          </ActionButton>
        ) : null}
      </div>
      <SplitBar
        // La barra y su tabla, del mismo ancho: al lado de la puerta la tabla se estira hasta
        // el borde del bloque; a todo el ancho (la contadora) las dos paran en el tope de la tabla.
        className={cn('mt-5', canWrite ? '[&_table]:max-w-none' : 'max-w-[34rem]')}
        ariaLabel={`Le debés ${formatCentsShort(tranches.totalCents)}: ${tranches.tranches
          .map((t) => `${t.label.toLowerCase()} ${formatCentsShort(t.cents)}`)
          .join(', ')}`}
        segments={tranches.tranches.map((t) => ({
          key: t.key,
          label: t.label,
          cents: t.cents,
          swatch: DUE_SWATCHES[t.key],
          // Solo lo vencido tiene su filtro: los otros dos tramos son leyenda quieta.
          href:
            t.key === 'overdue' && t.cents > 0
              ? comprasHref(tenantSlug, 'proveedores', { filtro: 'vencidos' })
              : undefined,
        }))}
      />
      <CreditLine tenantSlug={tenantSlug} creditCents={totals.creditCents} />
      {tranches.note ? (
        <p className="mt-3 text-xs leading-relaxed text-muted-foreground text-pretty">
          {tranches.note}
        </p>
      ) : null}
      <Explain
        className="mt-3"
        note="Son las compras que cargaste como «lo debo» y todavía no pagaste, con IVA. Lo que tenés a favor va aparte: no se resta hasta que lo usás en un pago."
      >
        <MathRow label="Vencido" value={formatCentsShort(overdue?.cents ?? 0)} />
        <MathRow op="+" label="Vence esta semana" value={formatCentsShort(week?.cents ?? 0)} />
        <MathRow op="+" label="Más adelante" value={formatCentsShort(later?.cents ?? 0)} />
        <MathRow op="=" label="Le debés" value={formatCentsShort(tranches.totalCents)} />
      </Explain>
    </HeroPanel>
  )
}

/**
 * Lo que hay a favor va aparte de la barra: no se resta de la deuda hasta que
 * se usa. Una sola línea (el porqué está en «¿Cómo se calcula?»): es un dato al
 * margen, no puede empujar la libreta fuera de la primera pantalla.
 */
function CreditLine({ tenantSlug, creditCents }: { tenantSlug: string; creditCents: number }) {
  if (creditCents <= 0) return null
  return (
    <p className="mt-4 text-sm leading-relaxed text-muted-foreground text-pretty">
      {/* En el celular entra en UN renglón con el link: «Tenés $ X a favor. Ver con quiénes». */}
      <span className="max-sm:hidden">Aparte tenés</span>
      <span className="sm:hidden">Tenés</span>{' '}
      <strong className="font-semibold whitespace-nowrap text-foreground">
        {formatCentsShort(creditCents)} a favor
      </strong>
      <span className="max-sm:hidden">: se descuenta solo cuando les pagues</span>.{' '}
      <Link
        href={comprasHref(tenantSlug, 'proveedores', { filtro: 'a-favor' })}
        scroll={false}
        className={cn(QUIET_LINK, 'whitespace-nowrap')}
      >
        Ver con quiénes
      </Link>
    </p>
  )
}
