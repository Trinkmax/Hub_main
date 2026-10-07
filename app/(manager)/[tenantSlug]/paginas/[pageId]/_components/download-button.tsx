'use client'

import { Check, Download } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { Button, type ButtonVariant } from '@/components/ui/button'
import { downloadLandingHtml } from '@/lib/landings/download'

/**
 * Bajar el código como `.html`, con la misma confirmación que CopyButton: el
 * ícono pasa a ✓ un momento. El aviso de descarga del navegador a veces queda
 * escondido en la barra (Safari) y, sin esto, el click parece no haber hecho
 * nada y el archivo termina bajado dos veces.
 */
export function DownloadHtmlButton({
  html,
  fileName,
  label,
  showLabel = true,
  variant = 'secondary',
  size = 'md',
  onDownloaded,
}: {
  html: string
  /** Se calcula al hacer click: el nombre lleva la hora de la descarga. */
  fileName: () => string
  /** Nombre accesible y tooltip. Tiene que empezar con la palabra visible. */
  label: string
  /** Muestra "Descargar" al lado del ícono (sólo desde sm; en celular, ícono). */
  showLabel?: boolean
  variant?: ButtonVariant
  /** Con `showLabel`, el alto del botón; sin etiqueta es cuadrado del mismo alto. */
  size?: 'sm' | 'md'
  onDownloaded?: () => void
}) {
  const [done, setDone] = useState(false)
  const timeout = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(
    () => () => {
      if (timeout.current) clearTimeout(timeout.current)
    },
    [],
  )

  function download() {
    downloadLandingHtml(html, fileName())
    setDone(true)
    if (timeout.current) clearTimeout(timeout.current)
    timeout.current = setTimeout(() => setDone(false), 1800)
    onDownloaded?.()
  }

  return (
    <Button
      type="button"
      variant={variant}
      size={showLabel ? size : size === 'sm' ? 'icon-sm' : 'icon'}
      onClick={download}
      // Un archivo vacío no le sirve a nadie, y subirlo después dejaría la
      // página en blanco.
      disabled={html.trim().length === 0}
      aria-label={label}
      title={label}
      // En el celular queda solo el ícono: cuadrado, del alto del botón (si no,
      // medía 42 × 44 y no llegaba al objetivo táctil).
      className={showLabel ? 'max-sm:aspect-square' : undefined}
    >
      {done ? <Check className="text-success-text" aria-hidden /> : <Download aria-hidden />}
      {showLabel ? <span className="max-sm:hidden">Descargar</span> : null}
    </Button>
  )
}
