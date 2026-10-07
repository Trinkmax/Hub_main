'use client'

import { Download, Loader2 } from 'lucide-react'
import { type ComponentProps, useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { ACC_ERRORS, isAccErrorKey } from '@/lib/accounting/errors'
import { cn } from '@/lib/utils'

/**
 * «Exportar» (F.15): pide el CSV a `/api/administracion/export` y lo baja con
 * su nombre. Si el servidor no lo puede armar (la sesión venció, es demasiado
 * grande, un reporte que todavía no está) se dice por qué en un aviso, en vez
 * de bajar un archivo con un error adentro. Igual que «Exportar» de Libros.
 */

const DOWNLOAD_FAILED = 'No pudimos armar el archivo. Probá de nuevo en unos minutos.'
const OFFLINE = 'Sin conexión: no pudimos bajar el archivo. Probá de nuevo.'

function filenameFrom(disposition: string | null, fallback: string): string {
  if (!disposition) return fallback
  const star = /filename\*\s*=\s*(?:UTF-8'')?([^;]+)/i.exec(disposition)
  if (star?.[1]) {
    try {
      return decodeURIComponent(star[1].trim().replace(/^"|"$/g, ''))
    } catch {
      // Si no se decodifica, se prueba con `filename=`.
    }
  }
  const plain = /filename\s*=\s*"?([^";]+)"?/i.exec(disposition)
  return plain?.[1]?.trim() || fallback
}

async function errorMessage(response: Response): Promise<string> {
  if (response.status === 401) return ACC_ERRORS.unauthenticated.message
  if (response.status === 403) return ACC_ERRORS.forbidden.message
  try {
    const body: unknown = await response.json()
    const key =
      typeof body === 'object' && body !== null && 'error' in body
        ? (body as { error: unknown }).error
        : null
    if (isAccErrorKey(key)) return ACC_ERRORS[key].message
  } catch {
    // Sin cuerpo JSON: va el texto genérico.
  }
  if (response.status === 413) return ACC_ERRORS.export_too_large.message
  if (response.status === 400) return 'Revisá el período elegido y probá de nuevo.'
  return DOWNLOAD_FAILED
}

async function download(href: string, fallbackName: string): Promise<string | null> {
  let response: Response
  try {
    response = await fetch(href, { credentials: 'same-origin', cache: 'no-store' })
  } catch {
    return OFFLINE
  }
  if (!response.ok) return errorMessage(response)
  try {
    const blob = await response.blob()
    const name = filenameFrom(response.headers.get('content-disposition'), fallbackName)
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = name
    anchor.rel = 'noopener'
    document.body.appendChild(anchor)
    anchor.click()
    anchor.remove()
    window.setTimeout(() => URL.revokeObjectURL(url), 2000)
    return null
  } catch {
    return DOWNLOAD_FAILED
  }
}

export function ExportButton({
  href,
  fileName,
  label = 'Exportar',
  variant = 'outline',
  size,
  className,
}: {
  href: string
  /** Nombre si el servidor no manda uno. */
  fileName: string
  label?: string
  variant?: ComponentProps<typeof Button>['variant']
  size?: ComponentProps<typeof Button>['size']
  className?: string
}) {
  const [pending, setPending] = useState(false)

  async function run() {
    if (pending) return
    setPending(true)
    const problem = await download(href, fileName)
    setPending(false)
    if (problem) toast.error(problem)
  }

  return (
    <Button
      type="button"
      variant={variant}
      size={size}
      className={cn('gap-2', className)}
      aria-busy={pending}
      onClick={() => void run()}
    >
      {pending ? (
        <Loader2 className="size-4 animate-spin" aria-hidden />
      ) : (
        <Download className="size-4" aria-hidden />
      )}
      {pending ? 'Preparando…' : label}
    </Button>
  )
}
