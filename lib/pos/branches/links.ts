/**
 * A dónde lleva cada paso de la lista de apertura — PURO.
 *
 * Cada enlace ya va parado en la sucursal: el plano de ESA sucursal, sus precios, su tele.
 */

import { planHref } from '@/lib/floor-plan/branches'
import type { OpeningStep, StepId } from './checklist'

/** Esta pantalla, parada en una sucursal. */
export function branchHref(tenantSlug: string, branchSlug?: string | null): string {
  const base = `/${tenantSlug}/local/sucursales`
  return branchSlug ? `${base}?sucursal=${encodeURIComponent(branchSlug)}` : base
}

/** Los ajustes del punto de venta, en esta misma pantalla. `group` = el bloque al que saltar. */
export function settingsHref(tenantSlug: string, group?: SettingsGroupId): string {
  const base = `/${tenantSlug}/local/sucursales?ver=ajustes`
  return group ? `${base}#${settingsAnchor(group)}` : base
}

export type SettingsGroupId = 'avisos' | 'cobro' | 'permisos' | 'caja'

/** El ancla de cada bloque de ajustes. */
export function settingsAnchor(group: SettingsGroupId): string {
  return `ajustes-${group}`
}

/** El ancla de cada paso de la lista, para saltar desde la oración de arriba. */
export function stepAnchor(step: StepId): string {
  return `paso-${step}`
}

/** La pantalla de cocina de una sucursal: lo que se abre en la tele. */
export function kitchenScreenPath(tenantSlug: string, branchSlug: string): string {
  return `/${tenantSlug}/salon/tele?sucursal=${encodeURIComponent(branchSlug)}`
}

/** El link entero, para copiar o para el QR. `origin` sin barra al final. */
export function kitchenScreenUrl(origin: string, tenantSlug: string, branchSlug: string): string {
  return `${origin.replace(/\/+$/, '')}${kitchenScreenPath(tenantSlug, branchSlug)}`
}

export type StepLink = {
  label: string
  href: string
  /** Se abre aparte: es otra pantalla de trabajo (el salón). */
  newTab?: boolean
}

/**
 * Los enlaces de un paso: el primero es EL del paso (lo que hay que hacer para tildarlo); los
 * demás, atajos. La cocina no lleva enlaces acá: su link es para la tele, y se copia o se
 * escanea.
 */
export function stepLinks(
  step: Pick<OpeningStep, 'id' | 'state' | 'issue'>,
  ctx: { tenantSlug: string; branchSlug: string },
): StepLink[] {
  const { tenantSlug, branchSlug } = ctx
  const here = encodeURIComponent(branchSlug)
  switch (step.id) {
    case 'plan':
      return [
        {
          label: step.state === 'done' ? 'Abrir el plano' : 'Dibujar el plano',
          href: planHref(tenantSlug, branchSlug),
        },
      ]
    case 'menu': {
      const carta: StepLink = { label: 'Ir a la carta', href: `/${tenantSlug}/menu` }
      const prices: StepLink = {
        label: 'Precios de acá',
        href: `/${tenantSlug}/menu/precios?sucursal=${here}`,
      }
      const stations: StepLink = {
        label: 'Estaciones de cocina',
        href: `/${tenantSlug}/menu/cocina`,
      }
      if (step.issue === 'empty_menu') return [carta]
      if (step.issue === 'nothing_sold') return [prices, stations]
      if (step.issue === 'unassigned') return [stations, prices]
      return [prices, stations]
    }
    case 'kitchen':
      return []
    case 'cash':
      return step.state === 'soon'
        ? []
        : [
            {
              label: 'Abrir la caja',
              href: `/${tenantSlug}/salon/caja?sucursal=${here}`,
              newTab: true,
            },
          ]
    case 'team':
      return [
        {
          label: step.state === 'done' ? 'Ver el equipo' : 'Sumar al equipo',
          href: `/${tenantSlug}/configuracion/equipo`,
        },
      ]
    case 'charge':
      return [
        {
          label: step.state === 'done' ? 'Ver los ajustes' : 'Cargar el alias',
          href: settingsHref(tenantSlug, 'cobro'),
        },
      ]
  }
}
