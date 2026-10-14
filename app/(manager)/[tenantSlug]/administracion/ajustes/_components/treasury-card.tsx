import type { ReactNode } from 'react'
import { StatusPill } from '@/components/administracion/kit/status-pill'
import { WalletCard } from '@/components/administracion/kit/wallet-card'
import type { TreasuryTone } from '@/lib/accounting/home'
import type { TreasuryKind } from '@/lib/accounting/types'
import { cn } from '@/lib/utils'

/**
 * El dorso de la tarjeta de una caja: en la pantalla Cajas se ve el frente
 * (cuánta plata hay y qué pasó); acá, sus datos —qué es, su alias y su CBU, qué
 * le falta— y los controles para cambiarla.
 *
 * Se arma SOBRE `WalletCard` del kit: el mismo lomo arriba con el color de la
 * caja (el del Resumen: `treasuryTones`), el mismo ícono y la misma forma. Así
 * una caja se reconoce igual en Cajas, en el Resumen y acá.
 *
 * - El renglón monoespaciado dice el dato de la tarjeta («Alias hub.sas.mp»,
 *   «CBU ···· 4567»: solo los últimos cuatro).
 * - `controls` son los botones del pie: los pasa quien puede cargar. La
 *   contadora no recibe ninguno y ve, en gris, el código de la cuenta del plan.
 *
 * Cuándo NO: para mostrar el saldo en grande (eso es la tarjeta de Cajas) ni
 * para elegir una caja en un formulario (`TreasuryPicker`).
 */

/** Qué es cada caja, en palabras de dueño. */
export const TREASURY_KIND_WORD: Readonly<Record<TreasuryKind, string>> = {
  cash: 'Efectivo',
  bank: 'Banco',
  wallet: 'Billetera',
  credit_card: 'Tarjeta de la empresa',
  other: 'Otra',
}

export type TreasuryCardFacts = {
  kind: TreasuryKind
  bankName: string | null
  cbuCvu: string | null
  alias: string | null
}

/** «···· 4567»: nunca el CBU entero a la vista. */
export function maskedTail(value: string): string {
  const digits = value.replace(/\s/g, '')
  return `···· ${digits.slice(-4)}`
}

/** El renglón de la tarjeta: el alias y los últimos cuatro del CBU, o lo propio de su tipo. */
export function treasuryLine(t: TreasuryCardFacts): string | null {
  switch (t.kind) {
    case 'cash':
      return 'Billetes y monedas'
    case 'credit_card':
      return t.bankName ? `La emite ${t.bankName}` : 'Lo que gastás y pagás después'
    case 'bank':
    case 'wallet': {
      const word = t.kind === 'bank' ? 'CBU' : 'CVU'
      const parts = [
        t.alias ? `Alias ${t.alias}` : null,
        t.cbuCvu ? `${word} ${maskedTail(t.cbuCvu)}` : null,
      ].filter((p): p is string => p !== null)
      return parts.length > 0 ? parts.join(' · ') : null
    }
    default:
      return null
  }
}

/** Lo que le falta para reconocer sola las transferencias: «Falta el CBU» / «Falta el CVU». */
export function treasuryMissing(t: Pick<TreasuryCardFacts, 'kind' | 'cbuCvu'>): string | null {
  if (t.cbuCvu) return null
  if (t.kind === 'bank') return 'Falta el CBU'
  if (t.kind === 'wallet') return 'Falta el CVU'
  return null
}

export function TreasuryCard({
  name,
  kind,
  tone,
  line,
  missing,
  balance,
  accountCode,
  controls,
  muted = false,
  className,
}: {
  name: string
  kind: TreasuryKind
  /** `treasuryTones(cajas)[id] ?? null`: el color del Resumen. */
  tone: TreasuryTone | null
  /** El renglón monoespaciado (`treasuryLine`). */
  line: string | null
  /** «Falta el CBU» (`treasuryMissing`). */
  missing?: string | null
  /** El saldo, chico y ya armado («Saldo $ X», «Debe $ X»). */
  balance?: ReactNode
  /** El código de la cuenta del plan: solo para la contadora. */
  accountCode?: string | null
  /** Los controles del pie (editar, ver movimientos, en uso). Sin esto, la tarjeta es de solo lectura. */
  controls?: ReactNode
  /** Una caja que ya no se usa. */
  muted?: boolean
  className?: string
}) {
  return (
    <WalletCard
      kind={kind}
      tone={tone}
      muted={muted}
      detail={TREASURY_KIND_WORD[kind]}
      name={
        <span title={name} className="font-serif text-lg font-semibold tracking-tight">
          {name}
        </span>
      }
      footer={controls}
      className={cn('min-h-[11.5rem]', className)}
    >
      <div className="grid gap-2.5">
        {line ? (
          <p className="font-mono text-xs leading-snug break-words text-muted-foreground">{line}</p>
        ) : null}
        <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1.5">
          {missing ? <StatusPill tone="info">{missing}</StatusPill> : <span />}
          {balance ? <span className="text-sm whitespace-nowrap">{balance}</span> : null}
        </div>
        {accountCode ? (
          <p className="text-xs text-muted-foreground tabular-nums">Cuenta {accountCode}</p>
        ) : null}
      </div>
    </WalletCard>
  )
}
