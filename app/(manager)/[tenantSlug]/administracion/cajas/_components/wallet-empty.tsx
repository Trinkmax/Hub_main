import { ArrowRight, ChartLine, Wallet as WalletIcon } from 'lucide-react'
import Link from 'next/link'
import { ChartSilhouette } from '@/components/administracion/charts/chart-parts'
import { EmptyTeach, StepCard, WalletCard } from '@/components/administracion/kit'
import { Button } from '@/components/ui/button'
import type { WalletView } from '../_lib/wallet-view'

/** Los pasos que todavía no tocan: se ven, pero un escalón atrás. */
const LATER = 'border-dashed bg-transparent shadow-none'

/**
 * La billetera de un bar que recién arranca: faltan los saldos iniciales y
 * todavía no se movió nada. Es lo primero que ve un bar nuevo, así que tiene
 * que enseñar el camino: decir cuánto hay → cargar el cierre de cada día →
 * contar una vez por semana.
 *
 * Ningún «$ 0» (cero no es «todavía no lo cargué») y UN solo botón: «Cargar lo
 * que hay». No aconseja contar la caja para acomodar los saldos: sin saldo
 * inicial eso anotaría un sobrante que no existe.
 *
 * Los textos del título y de la acción son los del Resumen (`heroState`).
 */
export function WalletEmpty({
  view,
  canWrite,
}: {
  view: Extract<WalletView, { kind: 'opening_pending' }>
  canWrite: boolean
}) {
  const closeText = [
    view.cashName
      ? `El efectivo entra solo a ${view.cashName}.`
      : 'El efectivo entra solo a la caja.',
    view.walletName
      ? 'Lo que cobrás con QR o transferencia queda en camino hasta que decís «ya me entró».'
      : null,
  ]
    .filter(Boolean)
    .join(' ')
  const countText =
    'Comparás lo que dice el sistema con lo que hay de verdad. Si no coincide, queda anotado.'

  // Cada tarjeta muestra un «¿cuánto hay?» con forma de campo: se toca y lleva al mismo lugar que
  // el botón. No es otra parada de Tab (el botón de abajo es el único).
  const target = canWrite ? view.action : null
  const slots = (
    <ul aria-label="Tus cajas" className="grid gap-3 sm:grid-cols-2">
      {view.slots.map((slot) => {
        const card = (
          <WalletCard
            empty
            size="sm"
            className="w-full"
            name={slot.name}
            kind={slot.kind}
            detail={slot.detail}
            tone={slot.tone}
          />
        )
        return (
          <li key={slot.id} className="flex">
            {target ? (
              <Link
                href={target.href}
                tabIndex={-1}
                aria-label={`¿Cuánto hay en ${slot.name}?`}
                className="press-lift flex w-full rounded-2xl outline-none"
              >
                {card}
              </Link>
            ) : (
              card
            )}
          </li>
        )
      })}
    </ul>
  )
  // «¿Usás una cuenta de banco o una tarjeta?»: solo lo que todavía no está.
  const hasBank = view.slots.some((slot) => slot.kind === 'bank')
  const hasCard = view.slots.some((slot) => slot.kind === 'credit_card')
  const missing =
    !hasBank && !hasCard
      ? 'una cuenta de banco o una tarjeta de la empresa'
      : !hasBank
        ? 'una cuenta de banco'
        : !hasCard
          ? 'una tarjeta de la empresa'
          : 'otra cuenta'

  return (
    <section aria-label="La billetera" className="space-y-6">
      <div className="max-w-2xl">
        <h2 className="font-serif text-3xl font-semibold leading-[1.08] tracking-tight text-balance sm:text-[2.6rem]">
          {view.title}
        </h2>
        <p className="mt-3 text-sm leading-relaxed text-muted-foreground text-pretty sm:text-base">
          {view.sentence}
        </p>
      </div>

      {canWrite ? (
        <div className="space-y-3">
          <StepCard open n={1} state="current" title="Decime cuánto hay hoy en cada caja">
            <div className="space-y-4">
              {slots}
              {view.action ? (
                <Button
                  asChild
                  className="h-12 w-full gap-2 px-6 text-base font-semibold sm:w-auto"
                >
                  <Link href={view.action.href}>
                    {view.action.label}
                    <ArrowRight className="size-4" aria-hidden />
                  </Link>
                </Button>
              ) : null}
              <p className="text-sm text-muted-foreground text-pretty">
                Es una sola vez. ¿Usás {missing}?{' '}
                <Link
                  href={view.addHref}
                  className="rounded-sm font-medium text-foreground underline decoration-border underline-offset-4 outline-none hover:decoration-foreground focus-visible:ring-2 focus-visible:ring-ring max-sm:py-3"
                >
                  Agregala
                </Link>{' '}
                antes, así también cuenta.
              </p>
            </div>
          </StepCard>
          <StepCard
            open
            n={2}
            state="todo"
            title="Cargá el cierre de cada día"
            summary={closeText}
            className={LATER}
          />
          <StepCard
            open
            n={3}
            state="todo"
            title="Una vez por semana, contá"
            summary={countText}
            className={LATER}
          />
        </div>
      ) : (
        // Quien solo lee ve las cajas que esperan su monto y cómo va a funcionar, sin botones.
        <div className="space-y-4">
          {slots}
          <ul className="space-y-2 text-sm text-muted-foreground">
            <li className="text-pretty">
              <span className="font-medium text-foreground">Con el cierre de cada día: </span>
              {closeText}
            </li>
            <li className="text-pretty">
              <span className="font-medium text-foreground">Una vez por semana, el conteo: </span>
              {countText}
            </li>
          </ul>
        </div>
      )}

      <EmptyTeach
        icon={ChartLine}
        title="Acá vas a ver cómo se mueve la plata"
        illustration={<ChartSilhouette kind="area" />}
      >
        Con el primer cierre aparece lo que hay en cada caja día por día, y lo que entró y lo que
        salió.
      </EmptyTeach>
    </section>
  )
}

/** No hay ninguna caja cargada: se agrega la primera en Ajustes. */
export function WalletNoTreasuries({
  view,
}: {
  view: Extract<WalletView, { kind: 'no_treasuries' }>
}) {
  return (
    <EmptyTeach
      icon={WalletIcon}
      title={view.title}
      action={
        view.action ? (
          <Button asChild className="h-12 gap-2 px-6 text-base font-semibold">
            <Link href={view.action.href}>
              {view.action.label}
              <ArrowRight className="size-4" aria-hidden />
            </Link>
          </Button>
        ) : undefined
      }
    >
      {view.sentence}
    </EmptyTeach>
  )
}
