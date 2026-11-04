'use client'

import { useEffect, useMemo, useRef } from 'react'

const CAMERA_DENIED_KEY = 'hub_salon_camera_denied'

export function rememberCameraDenied() {
  try {
    localStorage.setItem(CAMERA_DENIED_KEY, '1')
  } catch {}
}

export function forgetCameraDenied() {
  try {
    localStorage.removeItem(CAMERA_DENIED_KEY)
  } catch {}
}

/**
 * Si la última vez la cámara fue denegada, no volvemos a disparar el prompt solo:
 * mostramos el estado y que quien escanea decida.
 *
 * Pero la marca guardada no alcanza para creerle: hasta el 02/10/2026 el propio
 * sitio bloqueaba la cámara en Chrome (`Permissions-Policy: camera=()`, ver
 * next.config.ts), así que todos los Android quedaron con la marca puesta sin que
 * nadie hubiera negado nada. Donde el navegador sabe decir el estado real del
 * permiso, manda ese: solo `denied` muestra la pantalla de "sin acceso"; `prompt`
 * o `granted` borran la marca y la cámara arranca sola.
 *
 * `onDenied` se llama como mucho una vez, al montar.
 */
export function useCameraGuard(onDenied: () => void, enabled = true) {
  const denied = useRef(onDenied)
  denied.current = onDenied

  useEffect(() => {
    if (!enabled) return
    let marked = false
    try {
      marked = localStorage.getItem(CAMERA_DENIED_KEY) === '1'
    } catch {
      // localStorage bloqueado (modo privado): seguimos con la cámara.
    }
    if (!marked) return

    let cancelled = false
    const query = navigator.permissions?.query?.bind(navigator.permissions)
    if (!query) {
      denied.current()
      return
    }
    // `camera` no está en el tipo PermissionName de todos los lib.dom, y
    // Firefox tira TypeError con ese nombre: ahí vale la marca, como antes.
    query({ name: 'camera' as PermissionName })
      .then((status) => {
        if (cancelled) return
        if (status.state === 'denied') denied.current()
        else forgetCameraDenied()
      })
      .catch(() => {
        if (!cancelled) denied.current()
      })
    return () => {
      cancelled = true
    }
  }, [enabled])
}

/**
 * Al volver a la cámara el escáner arranca de cero: si el QR que recién se validó
 * sigue en cuadro, se leería de nuevo y saldría «Ya entraron» atrás del verde (o,
 * en un grupo a medias, otro «Pasan» que invita a contar de más). Por unos segundos
 * la cámara ignora ese código. Escribirlo a mano no pasa por acá.
 */
export function useRecentCode(ms = 10_000) {
  const last = useRef<{ code: string; at: number } | null>(null)
  return useMemo(
    () => ({
      remember(code: string) {
        last.current = { code, at: Date.now() }
      },
      isRecent(code: string) {
        return last.current?.code === code && Date.now() - last.current.at < ms
      },
    }),
    [ms],
  )
}
