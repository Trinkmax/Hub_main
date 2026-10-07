'use client'

import Link from 'next/link'
import { useParams, useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { useShellInfo } from './shell-info'

/**
 * El inicio de quien mira: lo trae el shell (`homePathForRole`); fuera del
 * shell, el del bar de la URL (el proxy rutea si no le corresponde).
 */
export function useShellHomeHref(): string {
  const shell = useShellInfo()
  const params = useParams<{ tenantSlug?: string }>()
  if (shell) return shell.homeHref
  return params?.tenantSlug ? `/${params.tenantSlug}` : '/'
}

/** «Ir al Resumen»: la salida principal de un 404 o un error del panel. */
export function GoHomeButton({ label = 'Ir al Resumen' }: { label?: string }) {
  const homeHref = useShellHomeHref()
  return (
    <Button asChild>
      <Link href={homeHref}>{label}</Link>
    </Button>
  )
}

/**
 * «Volver»: a la pantalla de antes. Si la página se abrió sola (un link en
 * otra pestaña, sin historia), al inicio.
 */
export function GoBackButton() {
  const router = useRouter()
  const homeHref = useShellHomeHref()
  return (
    <Button
      type="button"
      variant="secondary"
      onClick={() => {
        if (window.history.length > 1) router.back()
        else router.push(homeHref)
      }}
    >
      Volver
    </Button>
  )
}
