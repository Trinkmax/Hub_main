'use client'

import { CircleCheck } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useCallback, useEffect, useRef } from 'react'
import { toast } from 'sonner'
import {
  CARTA_CHECK_INTERVAL_MS,
  CARTA_CHECK_TIMEOUT_MS,
  CARTA_REFRESH_GRACE_MS,
  type CartaRevAnswer,
  cartaScheduleDue,
  cartaScheduleDueAt,
  decideCartaRefresh,
  readCartaRevAnswer,
  shouldCheckCarta,
} from '@/lib/menu/freshness'
import { useVisibleInterval } from '@/lib/realtime/use-visible-interval'

/**
 * Mantiene al día la carta abierta en el celular (docs/features/carta-al-dia.md).
 *
 * El problema: clientes que ya tenían la carta abierta veían precios viejos. La carta no se guarda
 * en el servidor; la copia vieja es la del celular: la pestaña queda abierta días y el navegador la
 * muestra de memoria sin volver a pedirla (y el «atrás» la devuelve del bfcache).
 *
 * Cómo se entera: le pregunta a Supabase, directo desde el navegador y sin pasar por una función de
 * Vercel, el número de versión de la carta (`carta_menu_rev`, sube solo con cualquier cambio del
 * menú o con el botón del editor). Pregunta al volver a primer plano, al restaurarse del bfcache, al
 * recuperar el foco o la señal, y cada 4 min mientras se ve. Si el número es más nuevo que el de la
 * página: `router.refresh()`, que trae la carta nueva sin perder la sección abierta ni el scroll, y
 * un aviso. Nada de la sesión del socio se toca.
 *
 * Los rubros con horario (el menú del mediodía, el del fin de semana) cambian la carta sin que nadie
 * la edite. El render dice en cuánto es el próximo cambio (`changeInMs`) y, pasado ese momento, la
 * carta se vuelve a pedir igual que si hubiera cambiado: con un reloj propio si está a la vista, o al
 * volver a mirarla. Sin aviso: no cambió nada, solo es otra hora.
 *
 * Anti-bucle (como `app/c/[token]/_components/wallet-live.tsx`): el número que se pidió queda de base
 * aunque el render nuevo traiga uno menor, la gracia de 6 s no deja preguntar de nuevo mientras llega
 * el render, y una respuesta igual o vacía nunca refresca. Sin señal no se refresca nunca: si el pedido
 * falla, Next navega de cero y el celular mostraría una página de error en vez de la carta.
 */
export function CartaFreshness({
  tenantId,
  rev,
  renderedAt,
  changeInMs = null,
}: {
  tenantId: string
  /** Versión de la carta con la que se armó esta página. */
  rev: number
  /** Cuándo se armó en el servidor (ms). */
  renderedAt: number
  /**
   * En cuánto aparece o se va un rubro con horario, contado desde que se armó la página (ms). `null`
   * si ninguno tiene horario.
   */
  changeInMs?: number | null
}): null {
  const router = useRouter()
  // Todo en refs: los chequeos salen de eventos del navegador y un render nuevo no tiene que
  // reiniciarlos ni perder la base.
  /** La versión más nueva que esta página ya tiene o ya pidió. */
  const baselineRef = useRef(rev)
  const renderedAtRef = useRef(renderedAt)
  /** Cuándo vio este celular el render actual (su reloj): ver `decideCartaRefresh`. */
  const seenAtRef = useRef<number | null>(null)
  const refreshingRef = useRef(false)
  const graceRef = useRef(0)
  /** Cuándo vence el horario de este render (reloj del celular), o `null`. Se usa una sola vez. */
  const scheduleDueAtRef = useRef<number | null>(null)
  const scheduleTimerRef = useRef(0)
  const inFlightSinceRef = useRef<number | null>(null)
  const lastAnswerAtRef = useRef<number | null>(null)
  /** El último render que se mostró: para avisar una sola vez por versión nueva. */
  const shownRef = useRef({ tenantId, rev })
  const checkRef = useRef<() => void>(() => {})

  // Llegó un render (el primero, el del refresh o el de cualquier otro, como la billetera).
  useEffect(() => {
    const shown = shownRef.current
    const sameBar = shown.tenantId === tenantId
    // Nunca para atrás: si el render no pudo leer su número (0), la base sigue siendo la que se pidió.
    baselineRef.current = sameBar ? Math.max(baselineRef.current, rev) : rev
    renderedAtRef.current = renderedAt
    const seenAt = Date.now()
    seenAtRef.current = seenAt
    refreshingRef.current = false
    window.clearTimeout(graceRef.current)
    // El próximo cambio de horario de ESTE render: un reloj para cuando la carta está a la vista (si
    // el celular lo congela, lo ven los chequeos de volver a mirarla).
    const dueAt = cartaScheduleDueAt(changeInMs, seenAt)
    scheduleDueAtRef.current = dueAt
    window.clearTimeout(scheduleTimerRef.current)
    if (dueAt !== null) {
      scheduleTimerRef.current = window.setTimeout(
        () => checkRef.current(),
        Math.max(0, dueAt - seenAt),
      )
    }
    if (sameBar && rev > shown.rev) {
      // Una píldora chica y clara (no la barra oscura de los avisos del panel): el aviso
      // vive afuera del `force-light` de la carta, así que lo lleva puesto él.
      toast.custom(
        () => (
          <div className="force-light mx-auto flex w-fit items-center gap-2 rounded-full border border-border bg-card px-3.5 py-2 text-sm font-medium text-foreground shadow-lg">
            <CircleCheck className="size-4 text-success" aria-hidden />
            Carta actualizada
          </div>
        ),
        { id: 'carta-al-dia', position: 'top-center', duration: 2_600 },
      )
    }
    shownRef.current = { tenantId, rev }
  }, [tenantId, rev, renderedAt, changeInMs])

  useEffect(() => {
    let cancelled = false

    const refreshNow = () => {
      refreshingRef.current = true
      window.clearTimeout(graceRef.current)
      graceRef.current = window.setTimeout(() => {
        refreshingRef.current = false
      }, CARTA_REFRESH_GRACE_MS)
      router.refresh()
    }

    const check = async () => {
      const startedAt = Date.now()
      const canCheck = shouldCheckCarta({
        now: startedAt,
        hidden: document.hidden,
        offline: navigator.onLine === false,
        refreshing: refreshingRef.current,
        inFlightSince: inFlightSinceRef.current,
        lastAnswerAt: lastAnswerAtRef.current,
        // Pasó la hora de un rubro: no se espera el mínimo entre preguntas.
        minGapMs: cartaScheduleDue(scheduleDueAtRef.current, startedAt) ? 0 : undefined,
      })
      if (!canCheck) return
      inFlightSinceRef.current = startedAt

      const controller = new AbortController()
      const timeout = window.setTimeout(() => controller.abort(), CARTA_CHECK_TIMEOUT_MS)
      let answer: CartaRevAnswer
      try {
        // supabase-js se baja recién acá, en el primer chequeo (al volver a mirar la carta): la carta
        // de quien no es socio no lo traía y no tiene por qué cargarlo de entrada.
        const { createClient } = await import('@/lib/supabase/browser')
        const res = await createClient()
          .rpc('carta_menu_rev', { p_tenant: tenantId })
          .abortSignal(controller.signal)
        answer = readCartaRevAnswer(res)
      } catch {
        answer = { kind: 'unreachable' }
      } finally {
        window.clearTimeout(timeout)
        if (inFlightSinceRef.current === startedAt) inFlightSinceRef.current = null
      }

      if (cancelled) return
      if (answer.kind !== 'unreachable') lastAnswerAtRef.current = Date.now()
      // Se fue de la pestaña mientras preguntaba, o ya hay un refresh en camino: el próximo chequeo decide.
      if (document.hidden || refreshingRef.current) return

      const latestRev = answer.kind === 'rev' ? answer.rev : null
      const decision = decideCartaRefresh({
        renderedRev: baselineRef.current,
        latestRev,
        renderedAt: renderedAtRef.current,
        seenAt: seenAtRef.current,
        now: Date.now(),
        unreachable: answer.kind === 'unreachable',
        scheduleDue: cartaScheduleDue(scheduleDueAtRef.current, Date.now()),
      })
      if (decision !== 'refresh') return
      // Una sola vez por versión: ese número queda de base, llegue el render que llegue.
      if (latestRev !== null) baselineRef.current = latestRev
      // Y una sola vez por horario: el render nuevo trae el suyo.
      scheduleDueAtRef.current = null
      // Y la red de seguridad por edad no se repite hasta dentro de 12 h.
      seenAtRef.current = Date.now()
      refreshNow()
    }

    checkRef.current = () => {
      void check()
    }

    // Volver con el «atrás» restaura la página entera del bfcache: preguntar al toque.
    const onPageShow = (event: PageTransitionEvent) => {
      if (event.persisted) void check()
    }
    const onWake = () => {
      void check()
    }
    window.addEventListener('pageshow', onPageShow)
    window.addEventListener('focus', onWake)
    window.addEventListener('online', onWake)

    return () => {
      cancelled = true
      checkRef.current = () => {}
      window.clearTimeout(graceRef.current)
      window.clearTimeout(scheduleTimerRef.current)
      window.removeEventListener('pageshow', onPageShow)
      window.removeEventListener('focus', onWake)
      window.removeEventListener('online', onWake)
    }
  }, [tenantId, router])

  // Cada 4 min mientras se ve, y una vez al volver a primer plano (`visibilitychange`). Los eventos
  // que llegan juntos con ese los frena `shouldCheckCarta` (mínimo de 15 s entre respuestas).
  const tick = useCallback(() => checkRef.current(), [])
  useVisibleInterval(tick, CARTA_CHECK_INTERVAL_MS)

  return null
}
