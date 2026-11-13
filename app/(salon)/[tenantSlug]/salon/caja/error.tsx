'use client'

import { LoaderCircle, RotateCcw } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useEffect, useTransition } from 'react'
import { PosTopbar } from '@/components/pos/ui/pos-topbar'
import { posFont } from '@/lib/pos/font'
import { cn } from '@/lib/utils'
import '@/components/pos/cash/cash.css'

/**
 * No se pudo leer la caja. Se dice sin asustar (no se perdió nada: los cobros viven en la base) y
 * con la salida a la vista.
 */
export default function PosCashError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  const router = useRouter()
  const [retrying, startRetry] = useTransition()

  useEffect(() => {
    console.error('[caja] boundary', error.digest ?? error.message)
  }, [error])

  return (
    <div className={cn('pos', posFont.variable)}>
      <div className="caja">
        <PosTopbar>
          <div className="caja-title">
            <b>Caja</b>
          </div>
        </PosTopbar>
        <div className="caja-gone" role="alert">
          <h1>No pude leer la caja</h1>
          <p>
            No se perdió nada: los cobros y el turno siguen como estaban. Probá de nuevo; si sigue
            así, avisale al dueño.
          </p>
          <button
            type="button"
            className="caja-go"
            disabled={retrying}
            onClick={() =>
              startRetry(() => {
                router.refresh()
                reset()
              })
            }
          >
            {retrying ? (
              <LoaderCircle className="caja-spin" aria-hidden />
            ) : (
              <RotateCcw aria-hidden strokeWidth={2.4} />
            )}
            Reintentar
          </button>
        </div>
      </div>
    </div>
  )
}
