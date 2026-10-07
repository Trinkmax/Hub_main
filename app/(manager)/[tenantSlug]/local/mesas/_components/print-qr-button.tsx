'use client'

import { Printer } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'

/**
 * Abre la hoja de impresión del QR de una mesa en otra ventana (lo público se
 * abre siempre con recarga, nunca con `<Link>`: ver `components/legacy/README.md`).
 */
export function PrintQrButton({
  qrToken,
  tableLabel,
}: {
  qrToken: string
  /** Para el nombre accesible: «Imprimir QR de la mesa 4». */
  tableLabel?: string
}) {
  const handleClick = () => {
    const url = `/print/qr/${encodeURIComponent(qrToken)}`
    window.open(url, '_blank', 'width=600,height=800')
  }
  const label = tableLabel ? `Imprimir QR de la mesa ${tableLabel}` : 'Imprimir QR'

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          type="button"
          size="icon-sm"
          variant="ghost"
          onClick={handleClick}
          aria-label={label}
        >
          <Printer aria-hidden />
        </Button>
      </TooltipTrigger>
      <TooltipContent>Imprimir QR</TooltipContent>
    </Tooltip>
  )
}
