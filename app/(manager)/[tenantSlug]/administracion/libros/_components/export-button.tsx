'use client'

import { Download, Loader2 } from 'lucide-react'
import { type ComponentProps, useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { ACC_ERRORS, isAccErrorKey } from '@/lib/accounting/errors'
import { cn } from '@/lib/utils'

/**
 * «Exportar» de los libros (F.15): pide el CSV a `/api/administracion/export`
 * y lo baja con su nombre. Si el servidor no lo puede armar (falta el CUIT de
 * la SAS, es demasiado grande, la sesión venció) se dice por qué en un aviso,
 * en vez de bajar un archivo con un error adentro.
 */

const DOWNLOAD_FAILED = 'No pudimos armar el archivo. Probá de nuevo en unos minutos.'
const OFFLINE = 'Sin conexión: no pudimos bajar el archivo. Probá de nuevo.'

type ExportOutcome = { ok: true } | { ok: false; message: string }

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

/** Baja un exporte. Nunca tira: devuelve el texto del problema. */
export async function downloadExport(href: string, fallbackName: string): Promise<ExportOutcome> {
  let response: Response
  try {
    response = await fetch(href, { credentials: 'same-origin', cache: 'no-store' })
  } catch {
    return { ok: false, message: OFFLINE }
  }
  if (!response.ok) return { ok: false, message: await errorMessage(response) }
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
    return { ok: true }
  } catch {
    return { ok: false, message: DOWNLOAD_FAILED }
  }
}

export function ExportButton({
  href,
  fileName,
  label = 'Exportar',
  pendingLabel = 'Preparando…',
  variant = 'outline',
  size,
  className,
}: {
  href: string
  /** Nombre si el servidor no manda uno (`libro-diario.csv`). */
  fileName: string
  label?: string
  pendingLabel?: string
  variant?: ComponentProps<typeof Button>['variant']
  size?: ComponentProps<typeof Button>['size']
  className?: string
}) {
  const [pending, setPending] = useState(false)

  async function run() {
    if (pending) return
    setPending(true)
    const outcome = await downloadExport(href, fileName)
    setPending(false)
    if (!outcome.ok) toast.error(outcome.message)
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
      {pending ? pendingLabel : label}
    </Button>
  )
}

/**
 * «Descargar todos» del Paquete del mes: los baja uno por uno (el `.zip` queda
 * para más adelante). Si alguno falla, sigue con los demás y al final dice
 * cuáles no se bajaron.
 */
export function ExportAllButton({
  files,
  className,
}: {
  files: ReadonlyArray<{ href: string; fileName: string; title: string }>
  className?: string
}) {
  const [progress, setProgress] = useState<number | null>(null)

  async function run() {
    if (progress !== null || files.length === 0) return
    const failed: string[] = []
    let firstError: string | null = null
    for (let i = 0; i < files.length; i += 1) {
      const file = files[i]
      if (!file) continue
      setProgress(i + 1)
      const outcome = await downloadExport(file.href, file.fileName)
      if (!outcome.ok) {
        failed.push(file.title)
        firstError ??= outcome.message
      }
      // Un respiro entre archivos: algunos navegadores frenan descargas seguidas.
      await new Promise((resolve) => window.setTimeout(resolve, 350))
    }
    setProgress(null)
    if (failed.length === 0) {
      toast.success(
        files.length === 1
          ? 'Listo, se bajó el archivo.'
          : `Listo, se bajaron los ${files.length} archivos.`,
      )
    } else if (failed.length === files.length) {
      toast.error(firstError ?? DOWNLOAD_FAILED)
    } else {
      toast.error(`No se bajaron: ${failed.join(', ')}.`, { description: firstError ?? undefined })
    }
  }

  return (
    <Button
      type="button"
      className={cn('gap-2', className)}
      aria-busy={progress !== null}
      disabled={files.length === 0}
      onClick={() => void run()}
    >
      {progress !== null ? (
        <Loader2 className="size-4 animate-spin" aria-hidden />
      ) : (
        <Download className="size-4" aria-hidden />
      )}
      {progress !== null ? `Bajando ${progress} de ${files.length}…` : 'Descargar todos'}
    </Button>
  )
}
