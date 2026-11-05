import Link from 'next/link'
import { HeroPanel } from '@/components/administracion/kit/hero'
import { MoneyTicker } from '@/components/administracion/kit/money-ticker'
import { RetryButton } from '@/components/administracion/kit/retry-button'
import { heroState } from '@/lib/accounting/home'
import { homeErrorText } from './block-states'
import { HomeActionButton } from './home-action'
import type { HomeData } from './home-data'
import { heroAccounts, heroNumbers } from './para-hoy'

const SMALL = 'text-xs text-adm-hero-muted'
const ACCOUNT_LINK =
  'rounded-sm underline-offset-4 outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring'

/**
 * El panel verde del Resumen: **Plata hoy** en grande con las cuentas abajo y, al lado, tres números
 * que llevan a su pantalla (lo que les debés a los proveedores, lo que falta de fijos y sueldos, lo
 * vendido en el mes). Lo que dice cada uno sale de `para-hoy.ts`.
 *
 * Cuando el cero no es un dato (faltan los saldos iniciales y nada se movió, o no hay cuentas) no se
 * muestra «$ 0»: dice que todavía no sabe cuánta plata hay y ofrece el paso que lo resuelve.
 *
 * Los números van en la letra de los datos, no en Fraunces, y el mismo panel se lee en claro y en
 * oscuro: adentro del verde rigen los tokens del modo oscuro (`HeroPanel`).
 */
export async function HeroBlock({ data }: { data: HomeData }) {
  const [summaryResult, settingsResult, projection, recurring, payments, payroll] =
    await Promise.all([
      data.summary,
      data.settings,
      data.projection,
      data.recurring,
      data.payments,
      data.payroll,
    ])

  if (!summaryResult.ok) {
    return (
      <HeroPanel tone="crema" className="space-y-3">
        <h2 className="font-serif text-xl font-semibold tracking-tight text-balance">
          No pudimos cargar el resumen.
        </h2>
        <p className="max-w-prose text-sm text-muted-foreground text-pretty">
          {homeErrorText(summaryResult.message)}
        </p>
        <RetryButton />
      </HeroPanel>
    )
  }

  const summary = summaryResult.data
  const settings = settingsResult.ok ? settingsResult.data : null
  const state = heroState(summary, settings, { canWrite: data.canWrite, base: data.base })
  const { accounts, more } = heroAccounts(summary, data.base)
  const numbers = heroNumbers({
    base: data.base,
    today: data.today,
    summary,
    openingPending: settings?.openingStatus === 'pending',
    recurring: recurring.ok ? recurring.data : null,
    payments: payments.ok ? payments.data : null,
    payroll: payroll.ok ? payroll.data : null,
    projection: projection.ok ? projection.data : null,
  })

  return (
    <div className="@container">
      <HeroPanel
        tone="bosque"
        className="grid gap-x-8 gap-y-4 rounded-2xl p-4.5 sm:p-5 @min-[52rem]:grid-cols-[minmax(0,1.1fr)_minmax(0,1.5fr)] @min-[52rem]:items-center"
      >
        <div className="min-w-0">
          {state.kind === 'unknown' ? (
            <>
              <p className={SMALL}>Plata hoy</p>
              <h2 className="mt-0.5 font-serif text-xl leading-snug font-semibold tracking-tight text-balance text-adm-hero-fg">
                {state.title}
              </h2>
              <p className="mt-1 max-w-prose text-[13px] leading-snug text-pretty text-adm-hero-muted">
                {state.sentence}
              </p>
              {state.action ? (
                <HomeActionButton
                  action={state.action}
                  variant="default"
                  className="mt-3 min-h-10 px-4 font-semibold"
                />
              ) : null}
            </>
          ) : (
            <>
              <p className={SMALL}>
                {state.overdrawn ? 'Hoy estás en descubierto por' : 'Plata hoy'}
              </p>
              <p className="mt-0.5 text-3xl leading-[1.1] font-semibold tracking-[-0.025em] whitespace-nowrap tabular-nums text-adm-hero-fg @min-[52rem]:text-4xl">
                {/* Un descubierto se dice con palabras, nunca con un menos. */}
                <MoneyTicker cents={Math.abs(state.cents)} />
              </p>
            </>
          )}
          {accounts.length > 0 ? (
            <ul className="mt-2 flex flex-wrap gap-x-3.5 gap-y-1 text-[12.5px] text-adm-hero-muted">
              {accounts.map((account) => (
                <li key={account.id} className="max-w-full">
                  <Link href={account.href} className={ACCOUNT_LINK}>
                    {account.name}{' '}
                    {state.kind === 'unknown' ? (
                      <span>¿cuánto hay?</span>
                    ) : (
                      <span className="font-medium whitespace-nowrap tabular-nums text-adm-hero-fg">
                        {account.text}
                      </span>
                    )}
                  </Link>
                </li>
              ))}
              {more > 0 ? (
                <li>
                  <Link href={`${data.base}/cajas`} className={ACCOUNT_LINK}>
                    y {more} más
                  </Link>
                </li>
              ) : null}
            </ul>
          ) : null}
        </div>

        <div className="grid min-w-0 grid-cols-2 gap-3.5 @min-[32rem]:grid-cols-3">
          {numbers.map((number) => (
            <Link
              key={number.key}
              href={number.href}
              className="-mx-1.5 -my-0.5 block min-w-0 rounded-lg px-1.5 py-0.5 outline-none transition-colors hover:bg-white/8 focus-visible:ring-2 focus-visible:ring-ring motion-reduce:transition-none"
            >
              <span className={`block ${SMALL}`}>{number.label}</span>
              <span className="block text-lg leading-snug font-semibold tracking-[-0.015em] whitespace-nowrap tabular-nums text-adm-hero-fg">
                {number.cents === null ? (
                  <>
                    <span aria-hidden>—</span>
                    <span className="sr-only">Sin dato</span>
                  </>
                ) : (
                  <MoneyTicker cents={number.cents} />
                )}
              </span>
              {number.hint ? <span className={`block ${SMALL}`}>{number.hint}</span> : null}
            </Link>
          ))}
        </div>
      </HeroPanel>
    </div>
  )
}
