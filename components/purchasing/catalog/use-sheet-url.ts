'use client'

import { useSearchParams } from 'next/navigation'
import { useCallback, useEffect } from 'react'

/**
 * Las hojas del catálogo de Compras viajan en la URL (`?editar=<id>`, `?nuevo=1`, `?zonas=1`): otras
 * pantallas linkean directo a «corregí este insumo» y el «atrás» del celular cierra la hoja.
 *
 * Se escriben con el History API nativo (`pushState` / `replaceState`), que Next sigue con
 * `useSearchParams`: abrir o cerrar una hoja no le vuelve a pedir la página al servidor (con 270
 * insumos, cada vuelta se notaba).
 *
 * - Si la hoja la abrió esta pantalla, se agregó una entrada al historial: cerrar es volver atrás.
 * - Si se llegó con el link ya armado (desde Pedidos, un link compartido), cerrar reemplaza la URL:
 *   «atrás» no tiene que sacarte de la pantalla.
 */

/** La URL que agregó esta pantalla al abrir una hoja. Hay una sola hoja abierta a la vez. */
let pushedHref: string | null = null

function hereHref(): string {
  return `${window.location.pathname}${window.location.search}`
}

function hrefWith(keys: readonly string[], params: Readonly<Record<string, string>>): string {
  const search = new URLSearchParams(window.location.search)
  for (const key of keys) search.delete(key)
  for (const [key, value] of Object.entries(params)) search.set(key, value)
  const qs = search.toString()
  return qs ? `${window.location.pathname}?${qs}` : window.location.pathname
}

function hasAny(search: URLSearchParams, keys: readonly string[]): boolean {
  return keys.some((key) => search.has(key))
}

/**
 * `keys`: los parámetros que son de las hojas de esta pantalla. Tiene que ser una constante del
 * módulo (no un array armado en el render).
 */
export function useSheetUrl(keys: readonly string[]) {
  const params = useSearchParams()

  useEffect(() => {
    // Con «atrás» o «adelante» la entrada que habíamos agregado ya no es la actual.
    const onPop = () => {
      if (!hasAny(new URLSearchParams(window.location.search), keys)) pushedHref = null
    }
    window.addEventListener('popstate', onPop)
    return () => window.removeEventListener('popstate', onPop)
  }, [keys])

  const open = useCallback(
    (next: Readonly<Record<string, string>>) => {
      const href = hrefWith(keys, next)
      if (hasAny(new URLSearchParams(window.location.search), keys)) {
        // De una hoja a otra: se reemplaza, así cerrar vuelve a la pantalla y no a la anterior.
        if (pushedHref === hereHref()) pushedHref = href
        window.history.replaceState(null, '', href)
        return
      }
      window.history.pushState(null, '', href)
      pushedHref = href
    },
    [keys],
  )

  const close = useCallback(() => {
    if (pushedHref !== null && pushedHref === hereHref()) {
      pushedHref = null
      window.history.back()
      return
    }
    pushedHref = null
    window.history.replaceState(null, '', hrefWith(keys, {}))
  }, [keys])

  return { params, open, close }
}
