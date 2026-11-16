'use client'

import type { PrintJob } from '@/lib/pos/print/doc'
import { renderPrintJob } from '@/lib/pos/print/html'

/**
 * Manda un tique a la impresora sin sacar a nadie de la pantalla en la que está.
 *
 * El tique se arma en un marco que no se ve y se imprime ese marco: la pantalla del punto de venta no
 * se mueve. El navegador lo manda a la impresora del sistema; si Chrome se abrió con
 * `--kiosk-printing`, sale directo a la predeterminada sin preguntar (así se deja la compu de la
 * comandera). Sin eso, aparece el cuadro de imprimir y alcanza con Enter.
 *
 * La promesa se resuelve cuando el navegador terminó con el cuadro (o cuando pasó el tiempo de
 * espera: hay navegadores que no avisan).
 */

const DONE_TIMEOUT_MS = 90_000
const SETTLE_MS = 400

let chain: Promise<void> = Promise.resolve()

function printOnce(html: string): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const frame = document.createElement('iframe')
    frame.setAttribute('aria-hidden', 'true')
    frame.setAttribute('tabindex', '-1')
    frame.title = 'Tique para imprimir'
    // Fuera de la vista, pero con tamaño: un marco con `display: none` no imprime en todos los navegadores.
    frame.style.cssText =
      'position:fixed;left:-10000px;top:0;width:320px;height:400px;border:0;opacity:0;pointer-events:none'

    let finished = false
    let timer: number | undefined
    const finish = (error?: Error) => {
      if (finished) return
      finished = true
      if (timer !== undefined) window.clearTimeout(timer)
      // Sacar el marco enseguida le corta el trabajo a algunos drivers: se espera un momento.
      window.setTimeout(() => frame.remove(), SETTLE_MS)
      if (error) reject(error)
      else resolve()
    }

    frame.addEventListener('load', () => {
      const target = frame.contentWindow
      if (!target) {
        finish(new Error('print_frame_unavailable'))
        return
      }
      target.addEventListener('afterprint', () => finish(), { once: true })
      timer = window.setTimeout(() => finish(), DONE_TIMEOUT_MS)
      try {
        target.focus()
        target.print()
      } catch (error) {
        finish(error instanceof Error ? error : new Error('print_failed'))
      }
    })
    frame.srcdoc = html
    document.body.appendChild(frame)
  })
}

/** Imprime un trabajo. De a uno por vez: dos trabajos seguidos no se pisan el cuadro de imprimir. */
export function printJob(job: PrintJob): Promise<void> {
  if (job.docs.length === 0) return Promise.resolve()
  const html = renderPrintJob(job)
  const next = chain.then(
    () => printOnce(html),
    () => printOnce(html),
  )
  // La cola sigue aunque este trabajo falle.
  chain = next.catch(() => undefined)
  return next
}
