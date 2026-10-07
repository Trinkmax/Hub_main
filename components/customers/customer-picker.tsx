'use client'

import * as React from 'react'
import { z } from 'zod'
import {
  type ComboboxProps,
  type EntityOption,
  EntityPicker,
  useRouteSearch,
} from '@/components/ui/combobox'
import type { CustomerSearchResult } from '@/lib/customers/search'
import { formatNumber } from '@/lib/format/number-kind'
import { formatPhoneForDisplay } from '@/lib/phone'
import { parseServiceAlerts } from '@/lib/salon/alerts'

/*
 * Elegir un cliente del CRM (kit HUB §3.2, «Pickers de dominio»): el Combobox
 * del kit con la búsqueda asíncrona por el Route Handler GET
 * `app/api/customers/search/route.ts` (con `AbortController`: cada tecla
 * cancela la búsqueda anterior). Reemplaza a los tres buscadores escritos a
 * mano que llamaban a la Server Action `searchCustomers` (Cerrar mesa, alta de
 * reserva y «Nuevo chat» de Mensajería).
 *
 * - Desde 2 letras, debounce de 200 ms, «Buscando…» a los 300 ms y «No
 *   pudimos buscar · Reintentar» si falla (todo del Combobox).
 * - Cada opción: nombre, teléfono y puntos. `onValueChange` devuelve el
 *   cliente entero (con sus avisos de servicio) para no hacer otra ida.
 * - Teclado: una letra sobre el disparador abre la búsqueda con esa letra ya
 *   escrita, así se busca sin tocar el mouse.
 * - «Crear…»: con `onCreate` aparece «Crear «lo tipeado»» al final de la lista.
 */

/** El endpoint de la búsqueda. El bar viaja en `?slug=`. */
export const CUSTOMER_SEARCH_ENDPOINT = '/api/customers/search'

/** El cliente que devuelve la búsqueda (con los avisos de servicio ya saneados). */
export type PickedCustomer = CustomerSearchResult

/** Una opción como la arma el Route Handler. */
export type CustomerSearchOptionWire = {
  value: string
  label: string
  description: string
  data: PickedCustomer
}

/** Lo mínimo para mostrar un cliente ya elegido (formularios de edición, volver a un paso). */
export type CustomerLike = Pick<PickedCustomer, 'id' | 'first_name' | 'last_name'> &
  Partial<Pick<PickedCustomer, 'phone' | 'points_balance' | 'service_alerts'>>

const customerWireSchema = z.object({
  id: z.string().min(1),
  first_name: z.string(),
  last_name: z.string(),
  phone: z.string(),
  points_balance: z.number(),
  // Un aviso que la app no conoce no rompe la búsqueda: se descarta.
  service_alerts: z.unknown().transform(parseServiceAlerts),
})

const customerSearchResponseSchema = z.object({
  options: z
    .array(
      z.object({
        value: z.string().min(1),
        label: z.string(),
        description: z.string().optional(),
        data: customerWireSchema,
      }),
    )
    .max(200),
})

/** «Juan Pérez», o «Sin nombre» si el cliente no tiene ninguno cargado. */
export function customerLabel(customer: Pick<PickedCustomer, 'first_name' | 'last_name'>): string {
  return `${customer.first_name ?? ''} ${customer.last_name ?? ''}`.trim() || 'Sin nombre'
}

/** «120 pts»: lo que se ve a la derecha de cada opción. */
function pointsMeta(points: number | undefined): string | undefined {
  return points === undefined ? undefined : `${formatNumber(points)} pts`
}

/** Un cliente como opción del Combobox. `data` solo va si el cliente está completo. */
export function customerToOption(customer: CustomerLike): EntityOption<PickedCustomer> {
  const complete =
    customer.phone !== undefined &&
    customer.points_balance !== undefined &&
    customer.service_alerts !== undefined
  return {
    value: customer.id,
    label: customerLabel(customer),
    description: customer.phone ? formatPhoneForDisplay(customer.phone) : undefined,
    meta: pointsMeta(customer.points_balance),
    data: complete
      ? {
          id: customer.id,
          first_name: customer.first_name,
          last_name: customer.last_name,
          phone: customer.phone ?? '',
          points_balance: customer.points_balance ?? 0,
          service_alerts: customer.service_alerts ?? [],
        }
      : undefined,
  }
}

/**
 * La respuesta del Route Handler → opciones del Combobox. Tira si no valida:
 * el Combobox lo muestra como «No pudimos buscar» con «Reintentar».
 */
export function parseCustomerSearchResponse(json: unknown): EntityOption<PickedCustomer>[] {
  return customerSearchResponseSchema.parse(json).options.map((option) => ({
    value: option.value,
    label: option.label,
    description: option.description,
    meta: pointsMeta(option.data.points_balance),
    data: option.data,
  }))
}

export type CustomerPickerProps = Omit<
  ComboboxProps<PickedCustomer>,
  | 'search'
  | 'options'
  | 'multiple'
  | 'value'
  | 'defaultValue'
  | 'onValueChange'
  | 'selectedOption'
  | 'defaultOptions'
> & {
  tenantSlug: string
  /** Id del cliente elegido (controlado). `null`: ninguno. */
  value?: string | null
  defaultValue?: string | null
  /** El cliente del valor actual: le da la etiqueta al disparador y aparece primero al abrir. */
  selectedCustomer?: CustomerLike | null
  /** Con el cliente entero (puntos y avisos) si salió de la búsqueda; `null` al quitarlo. */
  onValueChange?: (customerId: string | null, customer: PickedCustomer | null) => void
}

/**
 * El Combobox de clientes. Va adentro de un `Field` (que le da etiqueta, ayuda
 * y error) o con `aria-label`. Con `name`, el id elegido viaja en un
 * `<input type="hidden">`.
 */
export function CustomerPicker({
  tenantSlug,
  value,
  defaultValue,
  selectedCustomer,
  onValueChange,
  placeholder = 'Buscá por nombre o teléfono',
  searchPlaceholder = 'Nombre, apellido o teléfono',
  ...props
}: CustomerPickerProps) {
  const search = useRouteSearch<PickedCustomer>(CUSTOMER_SEARCH_ENDPOINT, {
    params: { slug: tenantSlug },
    parse: parseCustomerSearchResponse,
  })
  const selectedOption = React.useMemo(
    () => (selectedCustomer ? customerToOption(selectedCustomer) : null),
    [selectedCustomer],
  )
  // Con la búsqueda vacía se ve el elegido: volver a él es un toque, sin tipear.
  const defaultOptions = React.useMemo(
    () => (selectedOption ? [selectedOption] : undefined),
    [selectedOption],
  )

  return (
    <EntityPicker<PickedCustomer>
      search={search}
      value={value}
      defaultValue={defaultValue}
      selectedOption={selectedOption}
      defaultOptions={defaultOptions}
      placeholder={placeholder}
      searchPlaceholder={searchPlaceholder}
      onValueChange={(next, option) => {
        const id = typeof next === 'string' ? next : null
        const picked = option && !Array.isArray(option) ? (option.data ?? null) : null
        onValueChange?.(id, picked)
      }}
      {...props}
    />
  )
}
