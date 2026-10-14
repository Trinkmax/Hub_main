'use client'

import { ArrowRight, ChevronRight, Landmark, Pencil, Plus } from 'lucide-react'
import Link from 'next/link'
import { useState } from 'react'
import { Amount } from '@/components/administracion/amount'
import { EmptyTeach } from '@/components/administracion/kit/empty-teach'
import { Panel } from '@/components/administracion/kit/panel'
import { WALLET_ICONS } from '@/components/administracion/kit/wallet-card'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { saveTreasuryAccount } from '@/lib/accounting/actions/master'
import type { TreasuryTone } from '@/lib/accounting/home'
import type { TreasuryAccountRow } from '@/lib/accounting/queries/treasury'
import type { TreasuryKind } from '@/lib/accounting/types'
import { treasuryTogglePayload } from '../_lib/payloads'
import { TreasuryCard, treasuryLine, treasuryMissing } from './treasury-card'
import {
  type TreasuryAfterCreate,
  TreasuryDialog,
  type TreasuryDialogTarget,
} from './treasury-dialog'
import { useMasterAction } from './use-master-action'

/**
 * Ajustes › Cajas y cuentas: el dorso de las tarjetas de la billetera. El
 * frente —cuánta plata hay y qué pasó— es la pantalla Cajas; acá se agregan y
 * se les cargan los datos: qué es cada una, su alias y su CBU, y si se usa.
 *
 * Mismas acciones y mismos envíos de siempre (`treasurySavePayload`,
 * `treasuryTogglePayload`). La contadora ve las mismas tarjetas, sin controles
 * y con el código de la cuenta del plan de cada una.
 */

const ADD_ICON_KINDS: readonly TreasuryKind[] = ['cash', 'bank', 'wallet', 'credit_card']

/** El saldo, chico: «Saldo $ X»; en la tarjeta de la empresa, «Debe $ X». Sin dato, «—». */
function Balance({ kind, cents }: { kind: TreasuryKind; cents: number | undefined }) {
  if (cents === undefined) {
    return (
      <>
        <span className="text-muted-foreground">Saldo </span>
        <Amount cents={null} />
      </>
    )
  }
  if (kind === 'credit_card') {
    return (
      <>
        <span className="text-muted-foreground">{cents < 0 ? 'A favor ' : 'Debe '}</span>
        <Amount cents={Math.abs(cents)} className="font-medium" />
      </>
    )
  }
  return (
    <>
      {cents < 0 ? null : <span className="text-muted-foreground">Saldo </span>}
      <Amount cents={cents} balance="treasury" tone="auto" />
    </>
  )
}

export function TreasuriesPanel({
  tenantSlug,
  rows,
  balances,
  tones,
  readOnly,
  afterCreate,
}: {
  tenantSlug: string
  rows: readonly TreasuryAccountRow[]
  /** Id → saldo en el sentido de la cuenta (en la tarjeta, la deuda). Sin dato: «—». */
  balances: Readonly<Record<string, number>>
  /** Id → color de la caja (`treasuryTones`, con TODAS las cajas en uso: el del Resumen). */
  tones: Readonly<Record<string, TreasuryTone | null>>
  readOnly: boolean
  /** Qué ofrece el aviso al crear una caja (depende de los saldos iniciales). */
  afterCreate: Exclude<TreasuryAfterCreate, 'none'>
}) {
  const base = `/${tenantSlug}/administracion`
  const { pending, run } = useMasterAction()
  const [target, setTarget] = useState<TreasuryDialogTarget | null>(null)

  const toggle = (t: TreasuryAccountRow, active: boolean) =>
    run(() => saveTreasuryAccount(tenantSlug, treasuryTogglePayload(t, active)))

  const inUse = rows.filter((t) => t.active)
  const unused = rows.filter((t) => !t.active)
  const hasBank = inUse.some((t) => t.kind === 'bank')

  const card = (t: TreasuryAccountRow) => {
    const switchId = `aj-caja-${t.id}-uso`
    return (
      <li key={t.id} className="flex">
        <TreasuryCard
          className="w-full"
          name={t.name}
          kind={t.kind}
          tone={tones[t.id] ?? null}
          muted={!t.active}
          line={treasuryLine(t)}
          missing={t.active ? treasuryMissing(t) : null}
          balance={<Balance kind={t.kind} cents={balances[t.id]} />}
          accountCode={readOnly ? t.accountCode : null}
          controls={
            readOnly ? undefined : (
              <div className="flex flex-wrap items-center gap-x-3 gap-y-2 text-sm text-foreground">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-11 gap-1.5 rounded-full px-3.5 md:h-9"
                  aria-label={`Editar ${t.name}`}
                  onClick={() => setTarget({ row: t })}
                >
                  <Pencil className="size-3.5" aria-hidden />
                  Editar
                </Button>
                <Link
                  href={`${base}/cajas/${t.id}`}
                  aria-label={`Ver los movimientos de ${t.name}`}
                  className="inline-flex min-h-11 items-center gap-1 rounded-sm text-xs font-medium underline-offset-4 outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring md:min-h-9"
                >
                  Ver movimientos
                  <ArrowRight className="size-3" aria-hidden />
                </Link>
                <span className="ml-auto flex items-center gap-2">
                  <Label htmlFor={switchId} className="text-xs font-normal text-muted-foreground">
                    En uso
                  </Label>
                  <Switch
                    id={switchId}
                    checked={t.active}
                    disabled={pending}
                    onCheckedChange={(checked) => toggle(t, checked)}
                    aria-label={t.active ? `Dejar de usar ${t.name}` : `Volver a usar ${t.name}`}
                  />
                </span>
              </div>
            )
          }
        />
      </li>
    )
  }

  return (
    <div className="space-y-6">
      <ul className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {inUse.map(card)}
        {readOnly ? null : (
          <li className="flex">
            <button
              type="button"
              onClick={() => setTarget({ row: null })}
              className="press-lift flex min-h-[11.5rem] w-full flex-col items-center justify-center gap-3 rounded-2xl border border-dashed border-border bg-card/40 p-4 text-center outline-none transition-colors hover:border-primary/40 hover:bg-cream-tint focus-visible:ring-2 focus-visible:ring-ring"
            >
              <span className="flex size-11 items-center justify-center rounded-full border border-primary/20 bg-accent text-accent-foreground">
                <Plus className="size-5" aria-hidden />
              </span>
              <span className="text-sm font-medium">Agregar una caja o cuenta</span>
              <span aria-hidden className="flex items-center gap-2 text-muted-foreground">
                {ADD_ICON_KINDS.map((kind) => {
                  const Icon = WALLET_ICONS[kind]
                  return <Icon key={kind} className="size-4" />
                })}
              </span>
            </button>
          </li>
        )}
      </ul>

      {inUse.length === 0 && readOnly ? (
        <p className="text-sm text-muted-foreground">Todavía no hay ninguna caja en uso.</p>
      ) : null}

      {hasBank ? null : (
        <Panel>
          <EmptyTeach
            plain
            icon={Landmark}
            title="No hay ningún banco cargado"
            action={
              readOnly ? undefined : (
                <Button
                  type="button"
                  className="h-11 gap-2"
                  onClick={() => setTarget({ row: null, kind: 'bank' })}
                >
                  <Plus className="size-4" aria-hidden />
                  Agregar el banco
                </Button>
              )
            }
            secondary={readOnly ? undefined : 'Si el bar no tiene cuenta, dejalo así.'}
          >
            Con el banco cargado podés pasar plata de la caja al banco, pagar por transferencia y
            subir el extracto para que se cargue solo.
          </EmptyTeach>
        </Panel>
      )}

      {unused.length > 0 ? (
        <details className="group/unused rounded-2xl bg-secondary/50">
          <summary className="flex min-h-12 cursor-pointer list-none items-center gap-2 rounded-2xl px-4 text-sm font-medium outline-none focus-visible:ring-2 focus-visible:ring-ring [&::-webkit-details-marker]:hidden">
            <ChevronRight
              aria-hidden
              className="size-4 text-muted-foreground transition-transform group-open/unused:rotate-90 motion-reduce:transition-none"
            />
            Las que ya no se usan
            <span className="rounded-full bg-card px-1.5 py-px font-mono text-[11px] tabular-nums">
              {unused.length}
            </span>
          </summary>
          <ul className="grid gap-4 px-4 pb-4 sm:grid-cols-2 xl:grid-cols-3">{unused.map(card)}</ul>
        </details>
      ) : null}

      {readOnly ? null : (
        <TreasuryDialog
          tenantSlug={tenantSlug}
          target={target}
          onClose={() => setTarget(null)}
          afterCreate={afterCreate}
        />
      )}
    </div>
  )
}
