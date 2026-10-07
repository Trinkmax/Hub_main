'use client'

import { type IDetectedBarcode, Scanner } from '@yudiel/react-qr-scanner'
import { CameraOff, ScanLine } from 'lucide-react'
import { useCallback, useState } from 'react'
import { Button } from '@/components/ui/button'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
import { parseQrInput } from '@/lib/sessions-waiter/qr-parse'

export function QrScannerSheet({
  open,
  onOpenChange,
  onScan,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  onScan: (qrToken: string) => void
}) {
  const [error, setError] = useState<string | null>(null)

  const handleScan = useCallback(
    (detected: IDetectedBarcode[]) => {
      const raw = detected[0]?.rawValue ?? ''
      const token = parseQrInput(raw)
      if (!token) {
        setError('Este QR no es de una mesa.')
        return
      }
      setError(null)
      onScan(token)
    },
    [onScan],
  )

  const handleError = useCallback((err: unknown) => {
    const message = err instanceof Error ? err.message : 'No se pudo acceder a la cámara.'
    setError(message)
  }, [])

  return (
    <Sheet
      open={open}
      onOpenChange={(next) => {
        if (!next) setError(null)
        onOpenChange(next)
      }}
    >
      <SheetContent side="bottom" className="h-[80vh] gap-0 p-0">
        <SheetHeader className="px-6 pt-6">
          <SheetTitle className="flex items-center gap-2 font-serif">
            <ScanLine className="size-5 text-primary" aria-hidden />
            Escanear QR
          </SheetTitle>
          <SheetDescription>Apuntá la cámara al código de la mesa para activarla.</SheetDescription>
        </SheetHeader>

        <div className="relative mx-6 mt-4 aspect-square overflow-hidden rounded-2xl bg-black">
          {open ? (
            <Scanner
              onScan={handleScan}
              onError={handleError}
              constraints={{ facingMode: 'environment' }}
              components={{ finder: true }}
              sound={false}
              styles={{
                container: { width: '100%', height: '100%' },
                video: { width: '100%', height: '100%', objectFit: 'cover' },
              }}
            />
          ) : null}
          {error ? (
            <div className="absolute inset-x-4 bottom-4 flex items-center gap-2 rounded-lg bg-destructive/95 px-3 py-2 text-sm text-destructive-foreground shadow-lg">
              <CameraOff className="size-4 shrink-0" aria-hidden />
              <span>{error}</span>
            </div>
          ) : null}
        </div>

        <div className="px-6 pb-6 pt-4">
          <Button variant="outline" onClick={() => onOpenChange(false)} className="w-full">
            Cancelar
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  )
}
