'use client'

import { useCallback, useEffect, useRef } from 'react'
import { toast } from 'sonner'
import { holdReload } from '@/lib/app-version/hold'
import { refreshKitchen } from '@/lib/pos/actions'
import { comandaDocs, type DuePrint, duePrints, rememberPrinted } from '@/lib/pos/print/station'
import { usePosPoke } from '@/lib/pos/use-poke'
import { printJob } from './print-frame'
import { readPrinted, readPrinter, usePrinter, writePrinted } from './use-printer'

/**
 * La compu que tiene la comandera imprime sola cada pedido que entra.
 *
 * No dibuja nada. Vive en el marco del salón, así sigue imprimiendo mientras en esa compu se mira el
 * mapa, la caja o las reservas. Solo trabaja si en ESTE dispositivo se prendió «Imprimir las comandas
 * acá» (la hoja de la impresora); en un celular de mozo no hace nada ni abre ninguna conexión.
 *
 *   · Se entera de un pedido nuevo por el aviso en vivo y, por las dudas, mira cada quince segundos.
 *     El aviso dispara la lectura en el momento, sin temporizador: una pestaña que quedó atrás de otra
 *     ventana tiene los temporizadores frenados por el navegador, y la comanda no puede esperar.
 *   · Lo que va a imprimir lo anota ANTES de mandarlo: dos pestañas abiertas en la misma compu no
 *     imprimen dos veces. Si la impresión falla, lo desanota y lo vuelve a intentar en la próxima.
 */

type Props = {
  slug: string
  branchId: string
  timeZone: string
}

const POLL_MS = 15_000
const lockName = (branchId: string) => `hub-pos-print:${branchId}`

export function PosPrintStation(props: Props) {
  const { ready, settings } = usePrinter(props.branchId)
  if (!ready || !settings.auto) return null
  return <Runner {...props} />
}

/** Una sola pestaña por vez arma el trabajo: el candado es del navegador, compartido entre pestañas. */
async function exclusive<T>(name: string, task: () => Promise<T>): Promise<T> {
  const locks = typeof navigator !== 'undefined' ? navigator.locks : undefined
  if (!locks?.request) return task()
  return locks.request(name, task) as Promise<T>
}

function Runner({ slug, branchId, timeZone }: Props) {
  const busy = useRef(false)
  /** Llegó otro aviso mientras se estaba leyendo: al terminar se lee de nuevo. */
  const again = useRef(false)
  const failedAt = useRef(0)

  const once = useCallback(async () => {
    if (typeof navigator !== 'undefined' && navigator.onLine === false) return
    const result = await refreshKitchen(slug, branchId)
    if (!result.ok) return
    const queue = result.data
    // Los ajustes se leen recién ahora: pueden haber cambiado mientras viajaba la lectura.
    const settings = readPrinter(branchId)

    // Desde que se anota qué se imprime hasta que el papel salió, la app no se recarga sola por una versión
    // nueva (`lib/app-version`): una recarga justo ahí dejaría la comanda anotada como impresa sin haber salido.
    const release = holdReload()
    try {
      const claimed = await exclusive<DuePrint[]>(lockName(branchId), async () => {
        const log = readPrinted(branchId)
        const due = duePrints(queue, settings, log)
        if (due.length === 0) return []
        const keys = due.map((entry) => entry.key)
        writePrinted(branchId, rememberPrinted(log, keys, Date.now()))
        return due
      })
      if (claimed.length === 0) return

      try {
        await printJob({
          paper: settings.paper,
          docs: comandaDocs(claimed, {
            branch: queue.branch.name,
            timeZone,
            copies: settings.copies,
          }),
        })
      } catch (error) {
        console.error('[pos.print]', error instanceof Error ? error.message : 'unknown')
        // No salió: se desanota para que la próxima vuelta lo intente de nuevo.
        await exclusive(lockName(branchId), async () => {
          const log = readPrinted(branchId)
          for (const entry of claimed) delete log[entry.key]
          writePrinted(branchId, log)
        })
        // Un aviso por minuto alcanza: si la impresora está apagada, falla en cada vuelta.
        if (Date.now() - failedAt.current > 60_000) {
          failedAt.current = Date.now()
          toast.error('No pude mandar la comanda a la impresora', {
            description: 'Fijate que esté prendida y con papel. Lo vuelvo a intentar solo.',
          })
        }
      }
    } finally {
      release()
    }
  }, [slug, branchId, timeZone])

  const run = useCallback(async () => {
    if (busy.current) {
      again.current = true
      return
    }
    busy.current = true
    try {
      do {
        again.current = false
        await once()
      } while (again.current)
    } catch (error) {
      console.error('[pos.print.read]', error instanceof Error ? error.message : 'unknown')
    } finally {
      busy.current = false
    }
  }, [once])

  usePosPoke(branchId, (what) => {
    if (what === 'kitchen' || what === 'floor') void run()
  })

  useEffect(() => {
    void run()
    const timer = window.setInterval(() => void run(), POLL_MS)
    const onOnline = () => void run()
    window.addEventListener('online', onOnline)
    return () => {
      window.clearInterval(timer)
      window.removeEventListener('online', onOnline)
    }
  }, [run])

  return null
}
