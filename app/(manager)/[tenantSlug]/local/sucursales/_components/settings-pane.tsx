'use client'

import { Check, Lock } from 'lucide-react'
import type { ReactNode } from 'react'
import { Panel } from '@/components/administracion/kit/panel'
import { Pill } from '@/components/administracion/kit/pill'
import { Switch } from '@/components/ui/switch'
import { formatCentsShort } from '@/lib/money'
import { settingsAnchor } from '@/lib/pos/branches/links'
import type { Borrowed } from '@/lib/pos/branches/types'
import { creditSurcharge } from '@/lib/pos/cash/bill'
import { METHOD_LABEL, PAY_METHODS } from '@/lib/pos/cash/types'
import { billChoices, toggleBill } from '@/lib/pos/settings/bills'
import { settingChange, toggleIn } from '@/lib/pos/settings/change'
import { APPROVER_LABEL } from '@/lib/pos/settings/describe'
import { MAX_TIP_PRESETS } from '@/lib/pos/settings/patch'
import {
  formatPercent,
  percentFieldText,
  readPercent,
  SURCHARGE_MAX_BP,
} from '@/lib/pos/settings/percent'
import { HOLDER_MAX, readAlias, readHolder } from '@/lib/pos/settings/schemas'
import {
  APPROVER_ROLES,
  type PosSettings,
  type SettingChange,
  type SettingKey,
} from '@/lib/pos/settings/types'
import { cn } from '@/lib/utils'
import { AlertRows } from './alert-rows'
import { AutosaveField, type FieldRead } from './autosave-field'

/** Las propinas que se ofrecen para elegir. */
const TIP_CHOICES = [5, 10, 15, 20]
/** La cuenta de ejemplo del recargo. */
const EXAMPLE_CENTS = 2_000_000

/** Un ajuste: qué es y para qué sirve a la izquierda, el control a la derecha (o debajo). */
function SettingRow({
  title,
  text,
  children,
  stacked = false,
}: {
  title: ReactNode
  text?: ReactNode
  children: ReactNode
  /** El control va siempre debajo (una fila de fichas no entra al lado). */
  stacked?: boolean
}) {
  return (
    <div
      className={cn(
        'flex flex-col gap-3 py-4 first:pt-0 last:pb-0',
        !stacked && '@2xl:flex-row @2xl:items-start @2xl:justify-between @2xl:gap-8',
      )}
    >
      <div className="min-w-0">
        <h3 className="text-sm font-semibold leading-snug">{title}</h3>
        {text ? (
          <p className="mt-0.5 max-w-prose text-sm text-muted-foreground text-pretty">{text}</p>
        ) : null}
      </div>
      <div className={cn('min-w-0', !stacked && '@2xl:shrink-0')}>{children}</div>
    </div>
  )
}

/** Una ficha que se prende y se apaga. Prendida va rellena y con tilde: nunca solo el color. */
function ToggleChip({
  on,
  locked = false,
  disabled = false,
  onToggle,
  children,
  testId,
}: {
  on: boolean
  /** Prendida y fija: no se puede apagar. */
  locked?: boolean
  disabled?: boolean
  onToggle?: () => void
  children: ReactNode
  testId?: string
}) {
  return (
    <Pill
      active={on}
      size="touch"
      icon={locked ? Lock : on ? Check : undefined}
      disabled={locked || disabled}
      data-testid={testId}
      onClick={onToggle}
      className={cn('sm:h-9 sm:px-3 sm:text-[13px]', locked && 'disabled:opacity-100')}
    >
      {children}
    </Pill>
  )
}

/** Un billete: prendido es papel con su tilde; apagado, un contorno punteado. */
function BillNote({
  pesos,
  on,
  disabled,
  onToggle,
}: {
  pesos: number
  on: boolean
  disabled: boolean
  onToggle: () => void
}) {
  const amount = formatCentsShort(pesos * 100)
  return (
    <button
      type="button"
      aria-pressed={on}
      aria-label={`Billete de ${amount}`}
      title={disabled ? 'Dejá al menos un billete' : undefined}
      disabled={disabled}
      data-testid={`bill-${pesos}`}
      onClick={onToggle}
      className={cn(
        'relative flex h-12 w-[5.75rem] shrink-0 items-center justify-center rounded-md border text-[15px] font-semibold tabular-nums outline-none',
        'transition-[background-color,border-color,color,transform] duration-(--duration-fast) ease-(--ease-out) motion-reduce:transition-none',
        'focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-card active:scale-[0.97] motion-reduce:active:scale-100',
        'disabled:cursor-not-allowed',
        on
          ? 'suc-bill border-primary/35 bg-accent text-accent-foreground shadow-2xs'
          : 'border-dashed border-border bg-transparent text-muted-foreground hover:border-foreground/30 hover:text-foreground',
      )}
    >
      {amount}
      {on ? (
        <Check aria-hidden className="absolute top-1 right-1 size-3 opacity-70" strokeWidth={3} />
      ) : null}
    </button>
  )
}

const readSurcharge = (text: string): FieldRead<number> => {
  const read = readPercent(text)
  if (read.kind === 'ok') return { kind: 'ok', value: read.bp }
  if (read.kind === 'empty') return { kind: 'ignore' }
  if (read.kind === 'too_high') {
    return { kind: 'error', message: `El recargo llega hasta ${formatPercent(SURCHARGE_MAX_BP)}.` }
  }
  return { kind: 'error', message: 'Escribí un porcentaje, como 10 o 12,5.' }
}

const readAliasField = (text: string): FieldRead<string | null> => {
  const read = readAlias(text)
  return read.ok ? { kind: 'ok', value: read.alias } : { kind: 'error', message: read.message }
}

const readHolderField = (text: string): FieldRead<string | null> => {
  const read = readHolder(text)
  return read.ok ? { kind: 'ok', value: read.holder } : { kind: 'error', message: read.message }
}

const orEmpty = (value: string | null) => value ?? ''

/**
 * Los ajustes del punto de venta, dichos por para qué sirven: cuándo avisa una mesa, cómo se
 * cobra, quién da el OK y con qué billetes se cuenta la caja. Valen para todo el bar.
 *
 * No hay botón de guardar: cada cambio se guarda solo y el aviso trae su «Deshacer».
 */
export function SettingsPane({
  settings,
  borrowed,
  multiBranch,
  saving,
  errors,
  onChange,
  onClearError,
}: {
  /** Los ajustes como se ven ahora (lo leído más lo que se está guardando). */
  settings: PosSettings
  borrowed: Borrowed
  multiBranch: boolean
  saving: (key: SettingKey) => boolean
  errors: Readonly<Partial<Record<SettingKey, string>>>
  onChange: (changes: SettingChange[]) => void
  onClearError: (key: SettingKey) => void
}) {
  const set = <K extends SettingKey>(key: K, value: PosSettings[K]) =>
    onChange([settingChange(settings, key, value)])

  const surcharge = creditSurcharge(EXAMPLE_CENTS, settings.creditSurchargeBp)
  const tipChoices = [...new Set([...TIP_CHOICES, ...settings.tipPresetsPct])].sort((a, b) => a - b)
  const bills = billChoices(settings.billDenominations)
  const canBorrowAlias =
    settings.transferAlias === null &&
    borrowed.transferAlias !== null &&
    readAlias(borrowed.transferAlias).ok

  const borrowAlias = () => {
    if (!borrowed.transferAlias) return
    const changes = [settingChange(settings, 'transferAlias', borrowed.transferAlias)]
    const holder = readHolder(borrowed.transferHolder)
    if (settings.transferHolder === null && holder.ok && holder.holder !== null) {
      changes.push(settingChange(settings, 'transferHolder', holder.holder))
    }
    onChange(changes)
  }

  return (
    <div className="@container space-y-6" data-testid="settings-pane">
      <div>
        <h2 className="font-serif text-2xl font-semibold leading-tight tracking-tight text-balance">
          Ajustes del punto de venta
        </h2>
        <p className="mt-1.5 max-w-prose text-sm text-muted-foreground text-pretty">
          {multiBranch ? 'Valen para todas las sucursales. ' : null}
          Cada cambio se guarda solo y lo podés deshacer.
        </p>
      </div>

      <Panel
        id={settingsAnchor('avisos')}
        title="Cuándo avisa una mesa"
        description="Pasado el primer tiempo, la mesa pide atención en el mapa del salón: suma al aviso de su sector y sube en la lista. Pasado el segundo, se pone roja."
      >
        <AlertRows settings={settings} saving={saving} onChange={onChange} />
      </Panel>

      <Panel id={settingsAnchor('cobro')} title="Cobrar">
        <div className="divide-y divide-border/60">
          <SettingRow
            title="Recargo con tarjeta de crédito"
            text={
              settings.creditSurchargeBp > 0
                ? `Va solo sobre la parte que se paga con crédito: de ${formatCentsShort(EXAMPLE_CENTS)}, el cliente paga ${formatCentsShort(EXAMPLE_CENTS + surcharge)}.`
                : 'Hoy no hay recargo: con crédito se paga lo mismo que con cualquier otro medio.'
            }
          >
            <AutosaveField<number>
              label="Recargo con tarjeta de crédito, en por ciento"
              hideLabel
              testId="setting-surcharge"
              value={settings.creditSurchargeBp}
              format={percentFieldText}
              read={readSurcharge}
              inputMode="decimal"
              suffix="%"
              align="right"
              size="short"
              saving={saving('creditSurchargeBp')}
              error={errors.creditSurchargeBp}
              onEdit={() => onClearError('creditSurchargeBp')}
              onCommit={(bp) => set('creditSurchargeBp', bp)}
            />
          </SettingRow>

          <SettingRow
            title="Transferencias"
            text="El alias que el mozo le muestra al cliente para que transfiera, y a nombre de quién sale."
          >
            <div className="grid w-full gap-3 @2xl:w-80">
              <AutosaveField<string | null>
                label="Alias o CBU"
                testId="setting-alias"
                value={settings.transferAlias}
                format={orEmpty}
                read={readAliasField}
                placeholder="tu.alias.mp"
                autoCapitalize="none"
                saving={saving('transferAlias')}
                error={errors.transferAlias}
                onEdit={() => onClearError('transferAlias')}
                onCommit={(alias) => set('transferAlias', alias)}
              />
              {canBorrowAlias ? (
                <button
                  type="button"
                  data-testid="borrow-alias"
                  onClick={borrowAlias}
                  className="-mt-1 inline-flex min-h-11 items-center self-start rounded-md text-left text-sm font-medium text-foreground underline decoration-foreground/30 underline-offset-4 outline-none hover:decoration-foreground focus-visible:ring-2 focus-visible:ring-ring sm:min-h-9"
                >
                  Usar «{borrowed.transferAlias}», el de las entradas online
                </button>
              ) : null}
              <AutosaveField<string | null>
                label="Titular"
                testId="setting-holder"
                value={settings.transferHolder}
                format={orEmpty}
                read={readHolderField}
                placeholder="Como figura en el banco"
                maxLength={HOLDER_MAX}
                autoCapitalize="words"
                saving={saving('transferHolder')}
                error={errors.transferHolder}
                onEdit={() => onClearError('transferHolder')}
                onCommit={(holder) => set('transferHolder', holder)}
              />
            </div>
          </SettingRow>

          <SettingRow
            stacked
            title="Propinas sugeridas"
            text={`Los botones que aparecen al cobrar. Hasta ${MAX_TIP_PRESETS}; sin ninguno, la propina se escribe a mano.`}
          >
            {/* biome-ignore lint/a11y/useSemanticElements: fichas que se prenden y apagan, no un formulario. */}
            <div role="group" aria-label="Propinas sugeridas" className="flex flex-wrap gap-2">
              {tipChoices.map((pct) => {
                const on = settings.tipPresetsPct.includes(pct)
                return (
                  <ToggleChip
                    key={pct}
                    on={on}
                    testId={`tip-${pct}`}
                    disabled={!on && settings.tipPresetsPct.length >= MAX_TIP_PRESETS}
                    onToggle={() => set('tipPresetsPct', toggleIn(settings.tipPresetsPct, pct))}
                  >
                    {formatPercent(pct * 100)}
                  </ToggleChip>
                )
              })}
            </div>
          </SettingRow>

          <SettingRow
            stacked
            title="Qué se factura"
            text="Lo que viene marcado en cada cobro si nadie dice otra cosa. Al cobrar se puede cambiar."
          >
            {/* biome-ignore lint/a11y/useSemanticElements: fichas que se prenden y apagan, no un formulario. */}
            <div role="group" aria-label="Medios que se facturan" className="flex flex-wrap gap-2">
              {PAY_METHODS.map((method) => {
                const on = settings.invoiceByMethod[method]
                return (
                  <ToggleChip
                    key={method}
                    on={on}
                    testId={`invoice-${method}`}
                    onToggle={() =>
                      set('invoiceByMethod', { ...settings.invoiceByMethod, [method]: !on })
                    }
                  >
                    {METHOD_LABEL[method]}
                  </ToggleChip>
                )
              })}
            </div>
          </SettingRow>
        </div>
      </Panel>

      <Panel
        id={settingsAnchor('permisos')}
        title="Quién da el OK"
        description="Para un descuento o una baja. Quien puede dar el OK los aplica directo; el resto los pide y le llega el pedido a quien aprueba."
      >
        <div className="divide-y divide-border/60">
          <SettingRow stacked title="Pueden dar el OK">
            {/* biome-ignore lint/a11y/useSemanticElements: fichas que se prenden y apagan, no un formulario. */}
            <div role="group" aria-label="Quién puede dar el OK" className="flex flex-wrap gap-2">
              {APPROVER_ROLES.map((role) => {
                const owner = role === 'owner'
                const on = owner || settings.approverRoles.includes(role)
                return (
                  <ToggleChip
                    key={role}
                    on={on}
                    locked={owner}
                    testId={`approver-${role}`}
                    onToggle={() => set('approverRoles', toggleIn(settings.approverRoles, role))}
                  >
                    {APPROVER_LABEL[role]}
                    {owner ? <span className="sr-only"> (siempre puede)</span> : null}
                  </ToggleChip>
                )
              })}
            </div>
          </SettingRow>

          <SettingRow
            title={<label htmlFor="setting-discount-ok">Los descuentos necesitan el OK</label>}
            text={
              settings.discountNeedsApproval
                ? 'Quien no puede aprobar pide el descuento y espera el OK.'
                : 'Cualquiera del salón aplica un descuento sin pedir permiso.'
            }
          >
            <Switch
              id="setting-discount-ok"
              data-testid="setting-discount-ok"
              checked={settings.discountNeedsApproval}
              onCheckedChange={(checked) => set('discountNeedsApproval', checked)}
            />
          </SettingRow>

          <SettingRow
            title={<label htmlFor="setting-void-ok">Las bajas necesitan el OK</label>}
            text={
              settings.voidNeedsApproval
                ? 'Para sacar de la cuenta algo que la cocina ya empezó. Lo que todavía no empezó se da de baja sin pedir nada.'
                : 'Cualquiera del salón saca algo de la cuenta, aunque la cocina ya lo haya empezado.'
            }
          >
            <Switch
              id="setting-void-ok"
              data-testid="setting-void-ok"
              checked={settings.voidNeedsApproval}
              onCheckedChange={(checked) => set('voidNeedsApproval', checked)}
            />
          </SettingRow>
        </div>
      </Panel>

      <Panel
        id={settingsAnchor('caja')}
        title="Contar la caja"
        description="Al cerrar el turno la caja se cuenta billete por billete. Tocá los que usás: los demás no aparecen al contar."
      >
        {/* biome-ignore lint/a11y/useSemanticElements: billetes que se prenden y apagan, no un formulario. */}
        <div role="group" aria-label="Billetes que se cuentan" className="flex flex-wrap gap-2.5">
          {bills.map((pesos) => {
            const on = settings.billDenominations.includes(pesos)
            return (
              <BillNote
                key={pesos}
                pesos={pesos}
                on={on}
                disabled={on && settings.billDenominations.length === 1}
                onToggle={() => {
                  const next = toggleBill(settings.billDenominations, pesos)
                  if (next) set('billDenominations', next)
                }}
              />
            )
          })}
        </div>
        {errors.billDenominations ? (
          <p role="alert" className="mt-3 text-sm text-destructive text-pretty">
            {errors.billDenominations}
          </p>
        ) : null}
      </Panel>
    </div>
  )
}
