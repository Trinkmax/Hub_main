import { treasuryToneSwatch } from '@/components/administracion/charts/palette'
import { WALLET_ICONS } from '@/components/administracion/kit/wallet-card'
import type { TreasuryTone } from '@/lib/accounting/home'
import type { TreasuryKind } from '@/lib/accounting/types'
import { cn } from '@/lib/utils'

/**
 * Los dibujos chicos de la portada de Ajustes: la miniatura del objeto de cada
 * habitación. Las llaves (`KeyDots`), el número de la factura
 * (`InvoiceNumber`) y el cable (`ArcaCable`) viven en sus archivos; acá están
 * los otros tres: las tarjetas de la billetera, la columna del cierre y la
 * hoja de la constancia.
 *
 * Son decorativos (`aria-hidden`): el dato va SIEMPRE en la oración de al
 * lado. Y llevan el dato de verdad —los colores de SUS cajas, la cantidad de
 * SUS medios, los huecos de lo que le falta a SU constancia—: un dibujo que no
 * dice nada no va.
 */

/** Hasta tres tarjetitas apiladas, con el ícono del tipo y el lomo del color de cada caja. */
export function CardStack({
  cards,
}: {
  cards: ReadonlyArray<{ id: string; kind: TreasuryKind; tone: TreasuryTone | null }>
}) {
  const shown = cards.slice(0, 3)
  // La primera caja va adelante; las otras asoman atrás, arriba y a la derecha.
  const OFFSET = ['left-0 top-[22px] z-30', 'left-[9px] top-[11px] z-20', 'left-[18px] top-0 z-10']
  if (shown.length === 0) {
    return (
      <div aria-hidden className="relative h-[62px] w-[66px]">
        <span className="absolute top-[11px] left-[9px] h-[40px] w-[48px] rounded-md border border-dashed border-border" />
      </div>
    )
  }
  return (
    <div aria-hidden className="relative h-[62px] w-[66px]">
      {shown.map((card, index) => {
        const Icon = WALLET_ICONS[card.kind]
        return (
          <span
            key={card.id}
            className={cn(
              'absolute flex h-[40px] w-[48px] flex-col overflow-hidden rounded-md border border-border/80 bg-card shadow-2xs',
              OFFSET[index],
            )}
          >
            <span className={cn('h-1.5 w-full shrink-0', treasuryToneSwatch(card.tone))} />
            <span className="flex flex-1 items-center pl-1.5 text-muted-foreground">
              <Icon className="size-3.5" />
            </span>
          </span>
        )
      })}
    </div>
  )
}

const PAPER =
  'flex h-[68px] w-[52px] flex-col rounded-[3px] border border-adm-paper-rule bg-adm-paper px-1.5 pt-1.5 text-adm-paper-ink shadow-2xs'

/** Un papelito con renglones numerados: la columna del cierre, con tantos renglones como medios. */
export function MiniColumn({ count }: { count: number }) {
  const rows = Math.max(0, Math.min(5, Math.trunc(count)))
  return (
    <div aria-hidden className={PAPER}>
      <span className="mx-auto h-1 w-6 rounded-full bg-adm-paper-ink/45" />
      <span className="mt-1 h-px w-full bg-adm-paper-rule" />
      <span className="mt-1.5 flex flex-col gap-1">
        {Array.from({ length: 5 }, (_, index) => (
          <span
            // Renglones iguales, en orden fijo.
            // biome-ignore lint/suspicious/noArrayIndexKey: lista fija, sin reordenar
            key={index}
            className="flex items-center gap-1"
          >
            <span className="w-1.5 font-mono text-[6px] leading-none tabular-nums opacity-60">
              {index + 1}
            </span>
            <span
              className={cn(
                'h-[3px] flex-1 rounded-full',
                index < rows
                  ? 'bg-adm-paper-ink/40'
                  : 'border-t border-dashed border-adm-paper-rule',
              )}
            />
          </span>
        ))}
      </span>
    </div>
  )
}

/** Una hojita con cuatro renglones: los datos de la constancia. Cada dato que falta es un hueco punteado ámbar. */
export function MiniSheet({ missing }: { missing: readonly boolean[] }) {
  return (
    <div aria-hidden className={PAPER}>
      <span className="h-1 w-7 rounded-full bg-adm-paper-ink/45" />
      <span className="mt-1 h-px w-full bg-adm-paper-rule" />
      <span className="mt-2 flex flex-col gap-[7px]">
        {[0, 1, 2, 3].map((index) =>
          missing[index] ? (
            <span
              key={index}
              className="h-[7px] w-full rounded-[2px] border border-dashed border-warning bg-warning/15"
            />
          ) : (
            <span
              key={index}
              className={cn(
                'h-[3px] rounded-full bg-adm-paper-ink/40',
                index % 2 === 0 ? 'w-full' : 'w-3/4',
              )}
            />
          ),
        )}
      </span>
    </div>
  )
}
