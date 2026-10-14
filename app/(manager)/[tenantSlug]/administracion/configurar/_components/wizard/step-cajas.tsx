'use client'

import { ChevronRight, Plus, Trash2 } from 'lucide-react'
import { ChoiceCard } from '@/components/administracion/kit/choice-card'
import { Pill } from '@/components/administracion/kit/pill'
import { WALLET_ICONS, WalletCard } from '@/components/administracion/kit/wallet-card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { treasuryTones } from '@/lib/accounting/home'
import type { TreasuryKind } from '@/lib/accounting/types'
import { cn } from '@/lib/utils'
import { describedBy, Field } from '../../../ajustes/_components/form-bits'
import { INPUT_CLASS } from '../../../ajustes/_components/inputs'
import { TREASURY_KIND_WORD } from '../../../ajustes/_components/treasury-card'
import type { WizardState, WizardTreasury } from '../../_lib/wizard'

/**
 * Paso 2 de la puesta en marcha · «¿Dónde está la plata?».
 *
 * Las tres propuestas de siempre (la caja de efectivo, Mercado Pago y el
 * banco) como tarjetas de billetera, con su interruptor: la de efectivo va
 * siempre; las otras dos se usan o no. El alias y el CBU pueden esperar: van
 * plegados. «Agregar otra» abre una tarjeta nueva con «¿Qué es?».
 *
 * Mismo estado (`WizardState.treasuries`) y mismos campos que antes: lo que
 * viaja lo arma `wizardPayload`, sin cambios.
 */

const KIND_CHOICES: ReadonlyArray<{ value: TreasuryKind; title: string; consequence: string }> = [
  { value: 'cash', title: 'Efectivo', consequence: 'Una caja con billetes' },
  { value: 'bank', title: 'Banco', consequence: 'Cuenta corriente o caja de ahorro' },
  { value: 'wallet', title: 'Billetera', consequence: 'Mercado Pago, Ualá…' },
  {
    value: 'credit_card',
    title: 'Tarjeta de la empresa',
    consequence: 'Lo que gastás y pagás después',
  },
]

export function StepCajas({
  state,
  errors,
  updateTreasury,
  removeTreasury,
  addTreasury,
  clearError,
}: {
  state: WizardState
  errors: Readonly<Record<string, string>>
  updateTreasury: (key: string, patch: Partial<WizardTreasury>) => void
  removeTreasury: (key: string) => void
  addTreasury: () => void
  clearError: (...fields: string[]) => void
}) {
  const err = (field: string) => errors[field] ?? null
  // El color de cada tarjeta, por tipo: el mismo que va a tener después en Cajas y en el Resumen.
  const tones = treasuryTones(
    state.treasuries.filter((t) => t.enabled).map((t) => ({ id: t.key, kind: t.kind })),
  )

  return (
    <div className="grid gap-4">
      <ul className="grid gap-4 md:grid-cols-2">
        {state.treasuries.map((t) => {
          const id = `wz-t-${t.key}`
          const nameError = err(`treasury.${t.key}.name`)
          const switchable = t.preset === 'wallet' || t.preset === 'bank'
          const bankish = t.kind === 'bank' || t.kind === 'credit_card'
          const transfers = t.kind === 'bank' || t.kind === 'wallet'
          const detailError = err(`treasury.${t.key}.alias`) ?? err(`treasury.${t.key}.cbuCvu`)
          const hasDetails = t.alias.trim() !== '' || t.cbuCvu.trim() !== ''
          return (
            <li key={t.key} className="flex">
              <WalletCard
                className="w-full"
                kind={t.kind}
                tone={tones[t.key] ?? null}
                muted={!t.enabled}
                name={
                  <span className="font-serif text-lg font-semibold tracking-tight">
                    {t.name.trim() || 'Sin nombre'}
                  </span>
                }
                detail={TREASURY_KIND_WORD[t.kind]}
                footer={
                  t.preset === 'cash' ? (
                    <span>Siempre va: tiene que haber al menos una caja de efectivo.</span>
                  ) : switchable ? (
                    <span className="flex items-center justify-between gap-3 text-foreground">
                      <Label htmlFor={`${id}-on`} className="text-sm font-normal">
                        {t.enabled ? 'La usamos' : 'No la usamos'}
                      </Label>
                      <Switch
                        id={`${id}-on`}
                        checked={t.enabled}
                        onCheckedChange={(checked) => {
                          updateTreasury(t.key, { enabled: checked })
                          clearError('methods', 'transferDestination')
                        }}
                        aria-label={`Usar ${t.name || 'esta cuenta'}`}
                      />
                    </span>
                  ) : (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="h-11 gap-1.5 px-2 text-muted-foreground hover:text-destructive md:h-9"
                      onClick={() => removeTreasury(t.key)}
                    >
                      <Trash2 className="size-3.5" aria-hidden />
                      Quitar{t.name.trim() ? ` ${t.name.trim()}` : ''}
                    </Button>
                  )
                }
              >
                {t.enabled ? (
                  <div className="grid gap-4">
                    {t.preset === null ? (
                      <fieldset className="m-0 grid min-w-0 gap-2 border-0 p-0">
                        <legend className="mb-2 p-0 text-sm font-medium">¿Qué es?</legend>
                        <div className="grid gap-2">
                          {KIND_CHOICES.map((c) => {
                            const Icon = WALLET_ICONS[c.value]
                            return (
                              <ChoiceCard
                                key={c.value}
                                name={`${id}-kind`}
                                value={c.value}
                                title={c.title}
                                consequence={c.consequence}
                                checked={t.kind === c.value}
                                onChange={() => updateTreasury(t.key, { kind: c.value })}
                                art={
                                  <span className="flex size-9 items-center justify-center rounded-full border border-border/70 bg-card text-foreground shadow-2xs">
                                    <Icon className="size-4" />
                                  </span>
                                }
                              />
                            )
                          })}
                        </div>
                        <div>
                          <Pill
                            size="touch"
                            className="md:h-9 md:px-3 md:text-[13px]"
                            active={t.kind === 'other'}
                            onClick={() => updateTreasury(t.key, { kind: 'other' })}
                          >
                            Es otra cosa
                          </Pill>
                        </div>
                      </fieldset>
                    ) : null}

                    <Field id={`${id}-name`} label="Nombre" error={nameError}>
                      <Input
                        id={`${id}-name`}
                        value={t.name}
                        maxLength={60}
                        aria-invalid={nameError ? true : undefined}
                        aria-describedby={describedBy(`${id}-name`, null, nameError)}
                        onChange={(e) => {
                          updateTreasury(t.key, { name: e.target.value })
                          clearError(`treasury.${t.key}.name`, 'treasuries')
                        }}
                        className={INPUT_CLASS}
                      />
                    </Field>

                    {/* El banco va a la vista, nunca plegado: la propuesta ya trae uno escrito y, si
                        queda, viaja y se crea como proveedor. Lo que viaja se tiene que ver. */}
                    {bankish ? (
                      <Field
                        id={`${id}-bank`}
                        label={t.kind === 'bank' ? 'Banco' : 'Banco que la emite'}
                        optional
                        hint={
                          t.kind === 'bank'
                            ? 'Queda también como proveedor: así sus comisiones y gastos van a su nombre.'
                            : undefined
                        }
                        error={err(`treasury.${t.key}.bankName`)}
                      >
                        <Input
                          id={`${id}-bank`}
                          value={t.bankName}
                          maxLength={80}
                          placeholder="Banco de la Nación Argentina"
                          aria-invalid={err(`treasury.${t.key}.bankName`) ? true : undefined}
                          aria-describedby={describedBy(
                            `${id}-bank`,
                            t.kind === 'bank',
                            err(`treasury.${t.key}.bankName`),
                          )}
                          onChange={(e) => updateTreasury(t.key, { bankName: e.target.value })}
                          className={INPUT_CLASS}
                        />
                      </Field>
                    ) : null}

                    {transfers ? (
                      <details
                        className="group/datos rounded-xl bg-secondary/50"
                        open={hasDetails || detailError !== null || undefined}
                      >
                        <summary className="flex min-h-11 cursor-pointer list-none items-center gap-2 rounded-xl px-3 text-sm font-medium outline-none focus-visible:ring-2 focus-visible:ring-ring [&::-webkit-details-marker]:hidden">
                          <ChevronRight
                            aria-hidden
                            className="size-4 shrink-0 text-muted-foreground transition-transform group-open/datos:rotate-90 motion-reduce:transition-none"
                          />
                          <span className="min-w-0">
                            {t.kind === 'bank' ? 'Alias y CBU' : 'Alias y CVU'}{' '}
                            <span className="font-normal text-muted-foreground">
                              (puede esperar)
                            </span>
                          </span>
                        </summary>
                        <div className="grid gap-3 px-3 pb-3">
                          <Field
                            id={`${id}-alias`}
                            label="Alias"
                            optional
                            error={err(`treasury.${t.key}.alias`)}
                          >
                            <Input
                              id={`${id}-alias`}
                              value={t.alias}
                              maxLength={20}
                              autoCapitalize="none"
                              spellCheck={false}
                              placeholder="mi.bar.mp"
                              aria-invalid={err(`treasury.${t.key}.alias`) ? true : undefined}
                              aria-describedby={describedBy(
                                `${id}-alias`,
                                null,
                                err(`treasury.${t.key}.alias`),
                              )}
                              onChange={(e) => {
                                updateTreasury(t.key, { alias: e.target.value })
                                clearError(`treasury.${t.key}.alias`)
                              }}
                              className={INPUT_CLASS}
                            />
                          </Field>
                          <Field
                            id={`${id}-cbu`}
                            label={t.kind === 'bank' ? 'CBU' : 'CVU'}
                            optional
                            hint="Sirve para reconocer las transferencias entre tus cuentas."
                            error={err(`treasury.${t.key}.cbuCvu`)}
                          >
                            <Input
                              id={`${id}-cbu`}
                              value={t.cbuCvu}
                              maxLength={26}
                              inputMode="numeric"
                              spellCheck={false}
                              aria-invalid={err(`treasury.${t.key}.cbuCvu`) ? true : undefined}
                              aria-describedby={describedBy(
                                `${id}-cbu`,
                                true,
                                err(`treasury.${t.key}.cbuCvu`),
                              )}
                              onChange={(e) => {
                                updateTreasury(t.key, { cbuCvu: e.target.value })
                                clearError(`treasury.${t.key}.cbuCvu`)
                              }}
                              className={cn(INPUT_CLASS, 'tabular-nums')}
                            />
                          </Field>
                        </div>
                      </details>
                    ) : null}
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground text-pretty">
                    No la sumamos: la podés agregar después en Ajustes › Cajas y cuentas.
                  </p>
                )}
              </WalletCard>
            </li>
          )
        })}
        {state.treasuries.length < 20 ? (
          <li className="flex">
            <button
              type="button"
              onClick={addTreasury}
              className="press-lift flex min-h-[9rem] w-full flex-col items-center justify-center gap-2.5 rounded-2xl border border-dashed border-border bg-card/40 p-4 text-center outline-none transition-colors hover:border-primary/40 hover:bg-cream-tint focus-visible:ring-2 focus-visible:ring-ring"
            >
              <span className="flex size-10 items-center justify-center rounded-full border border-primary/20 bg-accent text-accent-foreground">
                <Plus className="size-5" aria-hidden />
              </span>
              <span className="text-sm font-medium">Agregar otra</span>
            </button>
          </li>
        ) : null}
      </ul>
      {err('treasuries') ? (
        <p role="alert" className="text-xs text-destructive">
          {err('treasuries')}
        </p>
      ) : null}
    </div>
  )
}
