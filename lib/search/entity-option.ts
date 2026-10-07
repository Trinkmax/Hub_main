/**
 * El contrato de las búsquedas asíncronas del kit (Combobox / EntityPicker,
 * §3.2 y decisión 19): un Route Handler GET
 * `/api/[tenantSlug]/search/<entidad>?q=` que responde `{ options: [...] }`.
 *
 * Vive acá y no en `components/ui/combobox.tsx` porque lo importan los dos
 * lados: el Route Handler (server) arma la respuesta y valida `q` con
 * `searchQuerySchema`, y el hook del cliente valida lo que llega con
 * `entitySearchResponseSchema`. Un módulo `'use client'` no se puede importar
 * desde un Route Handler (sus exports pasan a ser referencias de cliente).
 *
 * Por qué GET y no una Server Action: las acciones se encolan de a una («Server
 * Actions are queued. Using them for data fetching introduces sequential
 * execution», doc de Next 16 empaquetada). Tipear rápido encolaría búsquedas y
 * el «Guardar» que viniera después esperaría detrás de ellas. Un GET con
 * `AbortController` cancela de verdad la búsqueda anterior.
 */

import { z } from 'zod'

/** Una opción como viaja por la red: lo serializable de `EntityOption` (sin `meta` ni `data`). */
export const entityOptionWireSchema = z.object({
  value: z.string().min(1),
  label: z.string(),
  description: z.string().optional(),
  keywords: z.array(z.string()).optional(),
  group: z.string().optional(),
  disabled: z.boolean().optional(),
})

export type EntityOptionWire = z.infer<typeof entityOptionWireSchema>

/** La respuesta del Route Handler de búsqueda. */
export const entitySearchResponseSchema = z.object({
  options: z.array(entityOptionWireSchema).max(200),
})

export type EntitySearchResponse = z.infer<typeof entitySearchResponseSchema>

/** Lo más largo que se acepta en `?q=`: más que esto no es una búsqueda de un nombre o un CUIT. */
export const SEARCH_QUERY_MAX = 80

/**
 * `?q=` validado en el Route Handler: recortado, de 2 a 80 caracteres (el
 * mínimo es el `minQueryLength` del EntityPicker). El mensaje va en
 * rioplatense porque zod sin mensaje propio contesta en inglés.
 */
export const searchQuerySchema = z
  .string()
  .trim()
  .min(2, 'Escribí al menos 2 letras para buscar.')
  .max(SEARCH_QUERY_MAX, `La búsqueda puede tener hasta ${SEARCH_QUERY_MAX} caracteres.`)
