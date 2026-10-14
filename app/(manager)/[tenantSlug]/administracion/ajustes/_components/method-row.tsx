'use client'

import { type LucideIcon, Pencil } from 'lucide-react'
import { Pill } from '@/components/administracion/kit/pill'
import { StatusPill } from '@/components/administracion/kit/status-pill'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import { formatCentsShort } from '@/lib/money'
import { cn } from '@/lib/utils'
import { SAMPLE_GROSS_CENTS } from '../_lib/cobros'

/**
 * Un medio de cobro en «Medios de cobro»: su nombre, a dónde va lo cobrado
 * (con la misma flecha que en el Cierre del día) y, como gráfico, cuánto te
 * llega de cada $ 10.000 con ese medio: una barra fina, todas con la misma
 * escala y alineadas, así de un vistazo se ve cuál cuesta más.
 *
 * - `net.kind === 'whole'`: entra entero (efectivo, una transferencia directa).
 * - `'amount'`: te llegan `cents` de cada $ 10.000.
 * - `'missing'`: NO hay comisión cargada. Riel punteado, sin número y «Falta la
 *   comisión»: nunca se muestra «$ 10.000» (sin dato no es sin descuento).
 * - `'none'`: no aplica (cuenta corriente, señas).
 *
 * La comisión es una píldora que se toca (abre «Lo que te descuentan» de quien
 * paga ese medio). Quien solo lee ve el texto y ningún control.
 *
 * Cuándo NO: en «Cambiar el orden» (ahí la fila es plana, con sus flechas).
 */

export type MethodNet =
  | { kind: 'whole' }
  | { kind: 'amount'; cents: number }
  | { kind: 'missing' }
  | { kind: 'none' }

function NetMeter({ net }: { net: MethodNet }) {
  const whole = formatCentsShort(SAMPLE_GROSS_CENTS)
  if (net.kind === 'none') {
    return (
      <p className="text-sm text-muted-foreground">
        <span aria-hidden>—</span>
        <span className="sr-only">No lleva descuentos</span>
      </p>
    )
  }
  if (net.kind === 'missing') {
    return (
      <div>
        <StatusPill tone="warn">Falta la comisión</StatusPill>
        <div
          aria-hidden
          className="mt-2 h-1.5 rounded-full border border-dashed border-muted-foreground/50"
        />
      </div>
    )
  }
  const cents = net.kind === 'whole' ? SAMPLE_GROSS_CENTS : net.cents
  const percent = Math.max(0, Math.min(100, (cents / SAMPLE_GROSS_CENTS) * 100))
  return (
    <div>
      <p className="flex items-baseline gap-1.5 text-sm leading-none">
        {net.kind === 'whole' ? (
          <span className="font-medium">Llega entero</span>
        ) : (
          <>
            <span className="font-medium tabular-nums">{formatCentsShort(cents)}</span>
            <span className="text-xs text-muted-foreground">
              te llegan
              <span className="@[34rem]/medios:hidden"> de cada {whole}</span>
            </span>
          </>
        )}
      </p>
      <div aria-hidden className="mt-2 h-1.5 overflow-hidden rounded-full bg-adm-track">
        <div
          className="rail-grow h-full origin-left rounded-full bg-adm-in"
          style={{ width: `${percent}%` }}
        />
      </div>
    </div>
  )
}

export function MethodRow({
  name,
  icon: Icon,
  flow,
  net,
  rateText,
  charges,
  partyOff,
  active,
  readOnly,
  pending,
  onEdit,
  onToggle,
  onRates,
  onTurnOnParty,
}: {
  name: string
  /** El ícono del grupo, cuando el medio es el único de su grupo (como en el Cierre del día). */
  icon?: LucideIcon
  /** A dónde va lo cobrado, sin la flecha (`flowText`). */
  flow: string
  net: MethodNet
  /** «Comisión 6,29 % + IVA» (`rateLabel`); `null` si no hay nada cargado. */
  rateText: string | null
  /** El medio tiene a alguien que descuenta: lleva la píldora de la comisión. */
  charges: boolean
  /** Quien lo paga está apagado: su nombre y si se puede prender desde su formulario (las apps). */
  partyOff: { name: string; canTurnOn: boolean } | null
  active: boolean
  readOnly: boolean
  pending: boolean
  onEdit: () => void
  onToggle: (active: boolean) => void
  onRates: () => void
  onTurnOnParty: () => void
}) {
  return (
    <li
      className={cn(
        // Celular: nombre + interruptor · la barra · la píldora. Con lugar (34rem de grupo): el
        // nombre y, debajo, su píldora a la izquierda; la barra en su columna, alineada con las
        // demás; los controles al final.
        'grid grid-cols-[minmax(0,1fr)_auto] items-start gap-x-3 gap-y-2.5 py-3.5 first:pt-0 last:pb-0',
        '@[34rem]/medios:grid-cols-[minmax(0,1fr)_11.5rem_auto] @[34rem]/medios:gap-x-5 @[34rem]/medios:gap-y-2',
      )}
    >
      <div
        className={cn(
          'col-start-1 row-start-1 flex min-w-0 items-start gap-2.5',
          !active && 'opacity-60',
        )}
      >
        {Icon ? (
          <span
            aria-hidden
            className="flex size-8 shrink-0 items-center justify-center rounded-full border border-border/70 bg-card text-primary shadow-2xs"
          >
            <Icon className="size-4" />
          </span>
        ) : null}
        <div className="min-w-0">
          <p className="text-sm leading-snug font-medium">{name}</p>
          <p className="mt-0.5 text-xs leading-snug text-muted-foreground text-pretty">
            <span aria-hidden>→ </span>
            {flow}
          </p>
          {partyOff ? (
            <p className="mt-1.5 flex flex-wrap items-center gap-2">
              <StatusPill tone="warn">{partyOff.name} está apagada</StatusPill>
              {readOnly || !partyOff.canTurnOn ? null : (
                <button
                  type="button"
                  onClick={onTurnOnParty}
                  className="inline-flex min-h-11 items-center rounded-sm text-xs font-medium underline underline-offset-4 outline-none hover:text-primary focus-visible:ring-2 focus-visible:ring-ring md:min-h-0"
                >
                  Prenderla
                </button>
              )}
            </p>
          ) : null}
        </div>
      </div>

      <div className="col-start-2 row-start-1 flex items-center gap-1 @[34rem]/medios:col-start-3 @[34rem]/medios:row-span-2 @[34rem]/medios:self-center">
        {readOnly ? (
          <StatusPill tone={active ? 'ok' : 'muted'}>{active ? 'Prendido' : 'Apagado'}</StatusPill>
        ) : (
          <>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="size-11 text-muted-foreground hover:text-foreground md:size-9"
              aria-label={`Editar ${name}`}
              onClick={onEdit}
            >
              <Pencil className="size-4" />
            </Button>
            <Switch
              checked={active}
              disabled={pending}
              onCheckedChange={onToggle}
              aria-label={active ? `Apagar ${name}` : `Prender ${name}`}
            />
          </>
        )}
      </div>

      <div
        className={cn(
          'col-span-2 col-start-1 row-start-2 @[34rem]/medios:col-span-1 @[34rem]/medios:col-start-2 @[34rem]/medios:row-span-2 @[34rem]/medios:row-start-1 @[34rem]/medios:self-center',
          // Sin nada que mostrar (cuenta corriente, señas), en angosto no ocupa un renglón.
          net.kind === 'none' && 'hidden @[34rem]/medios:block',
          !active && 'opacity-60',
        )}
      >
        <NetMeter net={net} />
      </div>

      {charges ? (
        <div
          className={cn(
            'col-span-2 col-start-1 row-start-3 @[34rem]/medios:col-span-1 @[34rem]/medios:row-start-2',
            Icon && '@[34rem]/medios:pl-[2.625rem]',
          )}
        >
          {readOnly ? (
            <p className="text-xs text-muted-foreground">{rateText ?? 'Sin comisión cargada'}</p>
          ) : (
            <Pill size="touch" className="md:h-8 md:px-3 md:text-xs" onClick={onRates}>
              {rateText ? null : (
                <span aria-hidden className="mr-0.5 size-1.5 rounded-full bg-warning" />
              )}
              {rateText ?? 'Cargar la comisión'}
            </Pill>
          )}
        </div>
      ) : null}
    </li>
  )
}
