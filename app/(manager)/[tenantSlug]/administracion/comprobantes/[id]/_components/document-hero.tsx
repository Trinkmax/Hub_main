import Link from 'next/link'
import { Meter } from '@/components/administracion/charts/meter'
import { SplitBar } from '@/components/administracion/charts/split-bar'
import { Explain, MathRow } from '@/components/administracion/kit/explain'
import { HeroPanel, MoneyHero } from '@/components/administracion/kit/hero'
import { ActionButton } from '@/components/administracion/quick-actions'
import { VoucherText } from '@/components/administracion/voucher-text'
import { formatCents } from '@/lib/money'
import { cn } from '@/lib/utils'
import {
  type DocumentHero as DocumentHeroData,
  type Rich,
  richText,
} from '../../_lib/document-story'

/**
 * ① «Qué pasó con la plata»: el número del comprobante con la etiqueta que
 * dice lo que movió («Le debés a…», «Salieron de Caja»), UNA oración que lo
 * explica y, al lado, el botón del momento («Pagar», «Me entró plata»). Lo que
 * falta manda sobre el total; el estado va en la píldora del encabezado, nunca
 * en un número rojo.
 *
 * Solo cuando tocan: la línea de ayuda de quien pagó y no lo anotó, el avance
 * de un pago parcial, el reparto de un cierre (en caja · ya llegó · en camino)
 * y «¿Cómo se calcula?».
 *
 * Todo llega resuelto de `documentHero()`; acá solo se dibuja. El botón no se
 * dibuja en solo lectura (`ActionButton` ya lo decide, y la historia tampoco
 * lo manda).
 */

const FOCUS = 'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring'
// En el celular el link suma área de toque hacia arriba y hacia abajo (es `inline`: no mueve el renglón).
const INLINE_LINK = cn(
  'rounded-sm font-medium text-foreground underline decoration-border underline-offset-4 hover:decoration-foreground pointer-coarse:py-2.5',
  FOCUS,
)

/** Una oración que puede nombrar otro comprobante: el nombre es un link a su ficha. */
export function RichLine({ rich, base }: { rich: Rich; base: string }) {
  return rich.map((part, index) =>
    typeof part === 'string' ? (
      // biome-ignore lint/suspicious/noArrayIndexKey: las partes de una oración no se reordenan
      <span key={index}>{part}</span>
    ) : (
      <Link key={part.id} href={`${base}/comprobantes/${part.id}`} className={INLINE_LINK}>
        <VoucherText text={part.text} />
      </Link>
    ),
  )
}

export function DocumentHero({
  hero,
  base,
  arcaPending = false,
}: {
  hero: DocumentHeroData
  /** `/<bar>/administracion`. */
  base: string
  /** La factura quedó a medio autorizar en ARCA: se avisa acá y se resuelve en su nodo. */
  arcaPending?: boolean
}) {
  const sentence = richText(hero.sentence)
  return (
    <HeroPanel tone="crema">
      <h2 className="sr-only">Qué pasó con la plata</h2>
      <div className="grid gap-x-6 gap-y-4 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
        <div className="min-w-0">
          <MoneyHero
            size="lg"
            cents={hero.cents}
            label={hero.label}
            sentence={
              hero.sentence.length > 0 ? <RichLine rich={hero.sentence} base={base} /> : null
            }
            // Anulado: se apaga el número (el segundo renglón), no la oración que lo explica.
            className={hero.muted ? '[&>p:nth-of-type(2)]:opacity-55' : undefined}
          />
          {hero.help ? (
            <p className="mt-2 max-w-prose text-sm text-foreground text-pretty">{hero.help}</p>
          ) : null}
          {arcaPending ? (
            <p className="mt-2 text-sm text-warning-text text-pretty">
              ARCA todavía no la terminó de autorizar:{' '}
              <a href="#arca" className={cn('rounded-sm underline underline-offset-4', FOCUS)}>
                mirá abajo
              </a>
              .
            </p>
          ) : null}
        </div>
        {hero.action ? (
          <ActionButton
            action={hero.action.action}
            params={hero.action.params}
            className="h-12 w-full px-6 text-base sm:w-auto sm:min-w-40"
          >
            {hero.action.label}
          </ActionButton>
        ) : null}
      </div>

      {hero.meter ? (
        <div className="mt-5 flex items-center gap-3">
          <Meter
            className="flex-1"
            valueCents={hero.meter.valueCents}
            totalCents={hero.meter.totalCents}
            label={hero.meter.label}
            tone={hero.meter.tone}
          />
          <p className="shrink-0 text-sm font-medium tabular-nums">{hero.meter.text}</p>
        </div>
      ) : null}

      {hero.split && hero.split.length > 0 ? (
        <SplitBar
          className="mt-5"
          segments={hero.split.map((segment) => ({
            key: segment.key,
            label: segment.label,
            cents: segment.cents,
            swatch: segment.swatch,
            hatched: segment.hatched,
          }))}
          ariaLabel={sentence}
        />
      ) : null}

      {hero.explain ? (
        <Explain className="mt-3" note={hero.explain.note}>
          {hero.explain.rows.map((row) => (
            <MathRow
              key={row.key}
              label={<VoucherText text={row.label} />}
              value={formatCents(row.cents)}
              op={row.op}
            />
          ))}
        </Explain>
      ) : null}
    </HeroPanel>
  )
}
