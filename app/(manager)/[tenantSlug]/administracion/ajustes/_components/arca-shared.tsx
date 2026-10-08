'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { type ReactNode, useCallback, useEffect, useRef, useTransition } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import {
  ACC_UNREACHABLE,
  type AccFailureState,
  type AccSimpleState,
} from '@/lib/accounting/action-state'
import { Callout } from './form-bits'

/**
 * Piezas comunes de las acciones de ARCA de la pestaña y de la guía: correr una acción con el
 * patrón del panel (pendiente, aviso, pantalla al día), el aviso de error con su arreglo
 * («Ir a Datos de la SAS», «Ir al paso 6»…), bajar un archivo de texto y un `<details>` que se
 * abre solo cuando la URL apunta a él.
 */

export const OFFLINE_FAILURE: AccFailureState = {
  ok: false,
  code: 'error',
  message: ACC_UNREACHABLE.offline,
  detail: { key: 'offline' },
}

/** La clave del error (`detail.key`), para decidir qué mostrar. */
export function failureKey(failure: AccFailureState | null | undefined): string | null {
  const key = failure?.detail?.key
  return typeof key === 'string' ? key : null
}

type RunOptions<T> = {
  onSuccess?: (data: T, message: string) => void
  /** Cualquier error: la pantalla lo muestra en su lugar (sin esto, va en un aviso). */
  onFailure?: (failure: AccFailureState) => void
  /** Sin el aviso de «Listo» (la pantalla muestra el resultado de otra forma). */
  quiet?: boolean
}

/**
 * Corre una acción de ARCA: «pendiente» mientras corre, aviso con el resultado y la pantalla al
 * día (`router.refresh`: la guía recalcula el estado de cada paso). Si otra persona cambió lo
 * mismo (`stale`), recarga para que se vea la versión nueva.
 */
export function useArcaRun() {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const run = useCallback(
    <T,>(call: () => Promise<AccSimpleState<T>>, opts: RunOptions<T> = {}) => {
      startTransition(async () => {
        let result: AccSimpleState<T>
        try {
          result = await call()
        } catch {
          if (opts.onFailure) opts.onFailure(OFFLINE_FAILURE)
          else toast.error(ACC_UNREACHABLE.offline)
          return
        }
        if (result.ok) {
          if (!opts.quiet) toast.success(result.message)
          opts.onSuccess?.(result.data, result.message)
          router.refresh()
          return
        }
        if (result.code === 'stale') router.refresh()
        if (opts.onFailure) opts.onFailure(result)
        else toast.error(result.message)
      })
    },
    [router],
  )
  return { pending, run }
}

const TITLES: Readonly<Record<string, string>> = {
  sas_cuit_missing: 'Falta la CUIT de la SAS',
  stale: 'Alguien cambió esto recién',
  rate_limited: 'Esperá un minuto',
  secrets_key_missing: 'Falta algo de nuestro lado',
  secret_unreadable: 'Falta algo de nuestro lado',
  function_unavailable: 'Todavía no está disponible',
  offline: 'Sin conexión',
  arca_not_ready: 'Falta el certificado',
  arca_key_missing: 'Falta el pedido',
  arca_voucher_in_flight: 'Hay una factura saliendo',
  forbidden: 'Sin permiso',
}

/**
 * El error de una acción de ARCA, en el lugar de la acción, con el arreglo cuando lo hay. Los
 * textos ya vienen en palabras simples del servidor; acá se suma el título y el botón.
 */
export function ArcaFailureNotice({
  failure,
  slug,
  guideHref,
  className,
}: {
  failure: AccFailureState | null
  slug: string
  /** Dónde está la guía (`''` si ya estamos en ella), para «Ir al paso N». */
  guideHref?: string
  className?: string
}) {
  if (!failure) return null
  const key = failureKey(failure)
  const base = `/${slug}/administracion`
  const guide = guideHref ?? `${base}/ajustes/arca`
  let action: ReactNode = null
  if (key === 'sas_cuit_missing') {
    action = (
      <Button asChild variant="outline" className="h-11 md:h-9">
        <Link href={`${base}/ajustes?tab=sas`}>Ir a Datos de la SAS</Link>
      </Button>
    )
  } else if (key === 'arca_not_ready') {
    action = (
      <Button asChild variant="outline" className="h-11 md:h-9">
        <GuideLink href={`${guide}#paso-6`}>Ir al paso 6</GuideLink>
      </Button>
    )
  } else if (key === 'arca_key_missing') {
    action = (
      <Button asChild variant="outline" className="h-11 md:h-9">
        <GuideLink href={`${guide}#paso-5`}>Ir al paso 5</GuideLink>
      </Button>
    )
  }
  return (
    <Callout
      tone="error"
      title={(key && TITLES[key]) ?? 'No se pudo completar'}
      action={action}
      className={className}
    >
      {failure.message}
    </Callout>
  )
}

/**
 * Un link a un paso de la guía: `#paso-N` en la misma página (el navegador salta y la guía abre
 * el paso) o `next/link` si la guía es otra página.
 */
export function GuideLink({
  href,
  className,
  children,
  ...rest
}: Omit<React.ComponentProps<'a'>, 'href'> & { href: string }) {
  if (href.startsWith('#')) {
    return (
      <a href={href} className={className} {...rest}>
        {children}
      </a>
    )
  }
  return (
    <Link href={href} className={className} {...rest}>
      {children}
    </Link>
  )
}

/**
 * Baja un archivo de texto armado en el navegador (el pedido .csr: es público). `true` si el
 * navegador lo aceptó.
 */
export function downloadTextFile(
  fileName: string,
  text: string,
  type = 'application/pkcs10',
): boolean {
  try {
    const url = URL.createObjectURL(new Blob([text], { type }))
    const link = document.createElement('a')
    link.href = url
    link.download = fileName
    link.rel = 'noopener'
    document.body.appendChild(link)
    link.click()
    link.remove()
    window.setTimeout(() => URL.revokeObjectURL(url), 10_000)
    return true
  } catch {
    return false
  }
}

/** Le da el foco a un resultado cuando aparece (para el teclado y el lector de pantalla). */
export function useFocusWhen<T extends HTMLElement>(trigger: unknown) {
  const ref = useRef<T>(null)
  useEffect(() => {
    if (trigger) ref.current?.focus({ preventScroll: false })
  }, [trigger])
  return ref
}

/**
 * Un `<details>` con estilo de tarjeta que se abre solo cuando la URL termina en su `#` (el link
 * «Pruebas (homologación)» de la guía).
 */
export function HashDetails({
  id,
  className,
  children,
}: {
  id: string
  className?: string
  children: ReactNode
}) {
  const ref = useRef<HTMLDetailsElement>(null)
  useEffect(() => {
    const open = () => {
      if (window.location.hash === `#${id}` && ref.current) {
        ref.current.open = true
        ref.current.scrollIntoView({ block: 'start' })
      }
    }
    open()
    window.addEventListener('hashchange', open)
    return () => window.removeEventListener('hashchange', open)
  }, [id])
  return (
    <details ref={ref} id={id} className={className}>
      {children}
    </details>
  )
}
