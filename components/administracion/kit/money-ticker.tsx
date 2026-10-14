'use client'

import { useLayoutEffect, useRef } from 'react'
import { formatCents } from '@/lib/money'
import { cn } from '@/lib/utils'

/**
 * La plata que «llega»: cuenta hasta el valor al aparecer y, si después el
 * valor cambia (el total de un ticket que se va armando), cuenta desde lo que
 * se veía hasta lo nuevo.
 *
 * Sin salto de hidratación: el server y el primer render pintan el valor FINAL
 * con `formatCents` (sin `Intl`), así que sin JavaScript el número igual está
 * bien. Recién al montar retrocede a ~92 % y cuenta con `requestAnimationFrame`
 * escribiendo el nodo de texto a mano: React no vuelve a renderizar por cuadro.
 * Una copia invisible del valor final reserva el ancho, así lo de al lado no
 * tiembla mientras cambian los dígitos.
 *
 * Un número a mitad de camino es un número FALSO, así que nunca queda quieto
 * en pantalla: la primera cuenta no escribe nada hasta que el navegador
 * entrega su segundo cuadro, y si los cuadros se cortan (pestaña al fondo,
 * captura sin interfaz) un reloj lo lleva al valor final en 150 ms.
 *
 * No anima con `prefers-reduced-motion`, con la pestaña oculta, ni si el valor
 * no cambió.
 *
 * Cuándo NO: en tablas y listas (muchos números contando a la vez es ruido:
 * ahí va `Amount`), ni para algo que no sea plata, ni con un dato que puede
 * faltar (`null` no es cero: mostrá «—» con `Amount` o el estado vacío).
 */
export function MoneyTicker({
  cents,
  decimals = 0,
  durationMs = 700,
  currency = true,
  align = 'start',
  className,
}: {
  /** Centavos. La pantalla muestra pesos. */
  cents: number
  /** 0 (por defecto) para números héroe y tableros; 2 para lo contable. */
  decimals?: 0 | 2
  durationMs?: number
  /** `false` saca el «$» (cuando va aparte, chico, como en `MoneyHero`). */
  currency?: boolean
  /** `end` en columnas alineadas a la derecha: el número crece hacia la izquierda. */
  align?: 'start' | 'end'
  className?: string
}) {
  const liveRef = useRef<HTMLSpanElement>(null)
  // Lo último que se dibujó de verdad (puede ser un valor a mitad de camino).
  // `null` = todavía no se escribió nada a mano: se ve lo que pintó React.
  const shownRef = useRef<number | null>(null)
  // El valor al que apuntaba la corrida anterior, para saber si cambió.
  const targetRef = useRef<number | null>(null)

  const text = formatCents(cents, { decimals, currency: currency ? 'ARS' : false })

  // Layout effect y no effect: cuando `cents` cambia, el valor viejo se repone
  // antes de que el navegador pinte. Con `useEffect` se veía un cuadro con el
  // valor nuevo y recién después arrancaba la cuenta desde el viejo.
  useLayoutEffect(() => {
    const node = liveRef.current
    if (!node) return

    const paint = (value: number) => {
      const next = formatCents(value, { decimals, currency: currency ? 'ARS' : false })
      const child = node.firstChild
      // Se toca el nodo de texto que React ya conoce: si se reemplazara con
      // `textContent`, el próximo render de React escribiría sobre uno suelto.
      if (child && child.nodeType === Node.TEXT_NODE) child.nodeValue = next
      else node.textContent = next
      shownRef.current = value
    }

    const previousTarget = targetRef.current
    targetRef.current = cents
    // Primera cuenta (o el mismo valor otra vez, como hace StrictMode en
    // desarrollo): arranca en ~92 %. Si el valor cambió, desde lo que se veía.
    const arriving =
      shownRef.current === null && (previousTarget === null || previousTarget === cents)
    const from = arriving ? Math.round(cents * 0.92) : (shownRef.current ?? previousTarget ?? cents)

    const still =
      from === cents ||
      durationMs <= 0 ||
      document.visibilityState === 'hidden' ||
      window.matchMedia('(prefers-reduced-motion: reduce)').matches

    if (still) {
      paint(cents)
      return
    }

    let frame = 0
    let watchdog = 0
    let startedAt: number | null = null
    const finish = () => {
      cancelAnimationFrame(frame)
      paint(cents)
    }
    const step = (now: number) => {
      window.clearTimeout(watchdog)
      if (startedAt === null) {
        // El primer cuadro solo pone en marcha el reloj: recién con el segundo
        // hay prueba de que el navegador está dibujando.
        startedAt = now
      } else {
        const t = Math.min(1, (now - startedAt) / durationMs)
        // Sale rápido y frena al llegar: el final se lee, no pasa de largo.
        const eased = 1 - (1 - t) ** 3
        paint(t >= 1 ? cents : Math.round(from + (cents - from) * eased))
        if (t >= 1) return
      }
      watchdog = window.setTimeout(finish, 150)
      frame = requestAnimationFrame(step)
    }

    if (!arriving) {
      // El valor cambió con la pantalla a la vista: se repone el anterior ya
      // mismo (React acaba de escribir el nuevo) y se cuenta desde ahí.
      paint(from)
      watchdog = window.setTimeout(finish, 150)
    }
    frame = requestAnimationFrame(step)

    return () => {
      cancelAnimationFrame(frame)
      window.clearTimeout(watchdog)
    }
  }, [cents, decimals, currency, durationMs])

  return (
    <span
      data-slot="money-ticker"
      className={cn('relative inline-block whitespace-nowrap', className)}
    >
      {/* Reserva el ancho del valor final. `invisible` también lo saca de los lectores. */}
      <span aria-hidden className="invisible">
        {text}
      </span>
      <span
        ref={liveRef}
        className={cn('absolute inset-y-0', align === 'end' ? 'right-0' : 'left-0')}
      >
        {text}
      </span>
    </span>
  )
}
