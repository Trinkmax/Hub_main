'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { kitchenMove, kitchenSeen, refreshKitchen } from '@/lib/pos/actions'
import { normalizeView } from '@/lib/pos/kitchen/board'
import { applyItemsMove, type ItemsChange } from '@/lib/pos/kitchen/cards'
import { stationParam } from '@/lib/pos/kitchen/stations'
import type { KitchenQueue } from '@/lib/pos/types'
import { usePosPoke } from '@/lib/pos/use-poke'
import { useDebouncedRefresh } from '@/lib/realtime/use-debounced-refresh'
import { useVisibleInterval } from '@/lib/realtime/use-visible-interval'
import { PrinterButton } from '../print/printer-button'
import type { PosBrandInfo } from '../ui/pos-brand'
import { type KitchenFailure, type KitchenMove, PassScreen } from './pass-screen'

/**
 * La pantalla de cocina hablando con el servidor.
 *
 *   · Lee la cola cuando llega un aviso en vivo y, por las dudas, cada cinco segundos.
 *   · Al mover una comanda (avanzar, volver atrás, tildar un renglón, pasarla a otra estación) la cambia
 *     al instante y después le avisa a la base, en un solo viaje por movimiento (`pos_kitchen_move`). Si
 *     la base dice que no, la vuelve atrás y lo dice en grande.
 *   · Si se queda sin forma de saber qué pasa (se cayó la red, o el servidor no contesta), lo grita.
 *   · Recuerda en el dispositivo qué estaciones muestra, y lo deja en la dirección.
 */

type Props = {
  slug: string
  initial: KitchenQueue
  timeZone: string
  /** `?estaciones=` de la dirección; `null` si no vino (se usa lo guardado en el dispositivo). */
  stationParam: string[] | null
  /** Quien mira entró con el usuario de la cocina. */
  isKitchen: boolean
  /** El bar, para la marca de abajo. */
  brand?: PosBrandInfo
}

/** Algo que se tocó y la base todavía no confirmó (o confirmó, pero aún no se volvió a leer). */
type Pending = {
  op: number
  itemIds: ReadonlySet<string>
  change: ItemsChange
  at: string
  /** Número de la última lectura empezada cuando la base confirmó. `null` = todavía en viaje. */
  settledAt: number | null
}

const POLL_MS = 5000
const POKE_DEBOUNCE_MS = 200
const READ_TIMEOUT_MS = 12_000
const viewKey = (branchId: string) => `hub:pos:kitchen:stations:${branchId}`

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = window.setTimeout(() => reject(new Error('timeout')), ms)
    promise.then(
      (value) => {
        window.clearTimeout(timer)
        resolve(value)
      },
      (error: unknown) => {
        window.clearTimeout(timer)
        reject(error)
      },
    )
  })
}

export function KitchenLive({
  slug,
  initial,
  timeZone,
  stationParam: fromUrl,
  isKitchen,
  brand,
}: Props) {
  const branchId = initial.branch.id
  const [server, setServer] = useState(initial)
  const [pending, setPending] = useState<Pending[]>([])
  const [failure, setFailure] = useState<KitchenFailure | null>(null)
  /** `false` = se lee bien · `null` = no hay conexión · texto = el servidor dijo por qué no. */
  const [problem, setProblem] = useState<string | null | false>(false)
  const [lastOk, setLastOk] = useState({ ms: Date.parse(initial.now), startedAt: 0 })
  const [droppedAt, setDroppedAt] = useState<number | null>(null)
  const [chosen, setChosen] = useState<string[]>(() =>
    normalizeView(fromUrl ?? [], initial.stations),
  )

  // ── Estaciones de esta pantalla ────────────────────────────────────────────
  const view = useMemo(() => normalizeView(chosen, server.stations), [chosen, server.stations])

  const reflect = useCallback(
    (next: string[]) => {
      try {
        window.localStorage.setItem(viewKey(branchId), JSON.stringify(next))
      } catch {
        // sin almacenamiento (modo privado): vale para esta vez
      }
      const url = new URL(window.location.href)
      const value = stationParam(next)
      if (value) url.searchParams.set('estaciones', value)
      else url.searchParams.delete('estaciones')
      // Las comas van tal cual: la dirección se copia para armar el monitor de la barra.
      window.history.replaceState(null, '', url.toString().replace(/%2C/gi, ','))
    },
    [branchId],
  )

  // La dirección manda (es como se arma una pantalla nueva). Si no dice nada, lo último que se eligió acá.
  const restored = useRef(false)
  useEffect(() => {
    if (restored.current) return
    restored.current = true
    if (fromUrl !== null) {
      reflect(normalizeView(fromUrl, initial.stations))
      return
    }
    try {
      const saved: unknown = JSON.parse(window.localStorage.getItem(viewKey(branchId)) ?? '[]')
      if (!Array.isArray(saved)) return
      const ids = normalizeView(
        saved.filter((id): id is string => typeof id === 'string'),
        initial.stations,
      )
      if (ids.length === 0) return
      setChosen(ids)
      reflect(ids)
    } catch {
      // nada guardado o ilegible: todas las estaciones
    }
  }, [fromUrl, branchId, initial.stations, reflect])

  const changeView = useCallback(
    (next: string[]) => {
      setChosen(next)
      reflect(next)
    },
    [reflect],
  )

  // ── Leer la cola ───────────────────────────────────────────────────────────
  const reading = useRef(false)
  const readAgain = useRef(false)
  const readCount = useRef(0)

  const reload = useCallback(async (): Promise<void> => {
    if (reading.current) {
      readAgain.current = true
      return
    }
    reading.current = true
    const number = ++readCount.current
    const startedAt = performance.now()
    try {
      const result = await withTimeout(refreshKitchen(slug, branchId), READ_TIMEOUT_MS)
      if (result.ok) {
        setServer(result.data)
        setLastOk({ ms: Date.parse(result.data.now), startedAt })
        setProblem(false)
        // Lo que la base confirmó antes de que empezara esta lectura ya viene adentro.
        setPending((prev) => {
          const next = prev.filter((p) => p.settledAt === null || p.settledAt >= number)
          return next.length === prev.length ? prev : next
        })
      } else {
        setProblem(result.message)
      }
    } catch {
      setProblem(null)
    } finally {
      reading.current = false
      if (readAgain.current) {
        readAgain.current = false
        void reload()
      }
    }
  }, [slug, branchId])

  const reloadSoon = useDebouncedRefresh(reload, POKE_DEBOUNCE_MS)
  // La carta no cambia la cola; todo lo demás (una tanda que sale, un renglón servido o anulado) sí.
  const live = usePosPoke(branchId, (what) => {
    if (what !== 'menu') reloadSoon()
  })
  useVisibleInterval(reload, POLL_MS)
  // Al entrar, leer YA (la página puede venir de la copia que guarda el navegador).
  // biome-ignore lint/correctness/useExhaustiveDependencies: una vez, al entrar a la cocina
  useEffect(() => {
    void reload()
  }, [])

  // Al entrar a la página de nuevo (volver de otra pestaña) el servidor manda una cola fresca.
  useEffect(() => {
    setServer((prev) => (Date.parse(initial.now) > Date.parse(prev.now) ? initial : prev))
  }, [initial])

  // Si el canal en vivo se cae, lo primero es saber si todavía se puede leer.
  useEffect(() => {
    if (live === 'offline') {
      setDroppedAt(performance.now())
      void reload()
    } else if (live === 'live') {
      setDroppedAt(null)
    }
  }, [live, reload])

  // ── Mover: primero acá, después la base ────────────────────────────────────
  const opCount = useRef(0)
  const chain = useRef<Promise<void>>(Promise.resolve())
  /**
   * Los movimientos que esperan su turno, con sus renglones, y los que ya no hay que mandar. Cuando uno
   * falla, lo que se tocó DESPUÉS sobre esos mismos renglones y todavía está en la fila se descarta: si
   * no, el segundo Enter de «Empezar, Listo» llegaba solo a la base con el primero perdido, y al mozo le
   * avisaba «para retirar» algo que la pantalla mostraba como nuevo.
   */
  const queued = useRef(new Map<number, Set<string>>())
  const cancelled = useRef(new Set<number>())
  const skew = useRef(Date.parse(initial.now) - Date.now())
  useEffect(() => {
    skew.current = Date.parse(server.now) - Date.now()
  }, [server.now])

  const move = useCallback(
    (request: KitchenMove) => {
      const op = ++opCount.current
      const change: ItemsChange = { to: request.to, stationId: request.stationId }
      const itemIds = new Set(request.itemIds)
      const at = new Date(Date.now() + skew.current).toISOString()
      setPending((prev) => [...prev, { op, itemIds, change, at, settledAt: null }])
      queued.current.set(op, itemIds)

      // De a uno y en orden: dos toques seguidos sobre la misma comanda llegan a la base como se dieron.
      chain.current = chain.current.then(async () => {
        queued.current.delete(op)
        // Venía detrás de un movimiento que falló sobre estos mismos renglones: ya se volvió atrás en la
        // pantalla junto con aquel, así que no sale.
        if (cancelled.current.delete(op)) return
        let result: { ok: true } | { ok: false; message: string }
        try {
          result = await kitchenMove(slug, {
            itemIds: request.itemIds,
            to: request.to,
            stationId: request.stationId,
          })
        } catch {
          result = { ok: false, message: 'No hay conexión. Cuando vuelva, probá de nuevo.' }
        }
        if (result.ok) {
          const settledAt = readCount.current
          setPending((prev) => prev.map((p) => (p.op === op ? { ...p, settledAt } : p)))
        } else {
          // Vuelve atrás esto y lo que se haya tocado después sobre los mismos renglones; lo que de eso
          // todavía esperaba en la fila no se manda.
          for (const [later, ids] of queued.current) {
            if ([...ids].some((id) => itemIds.has(id))) cancelled.current.add(later)
          }
          setPending((prev) =>
            prev.filter((p) => p.op < op || ![...p.itemIds].some((id) => itemIds.has(id))),
          )
          setFailure({
            key: op,
            station: request.station,
            cardId: request.cardId,
            title: `No se pudo ${request.what}`,
            detail: result.message,
          })
        }
        void reload()
      })
    },
    [slug, reload],
  )

  const shown = useCallback(
    async (ticketIds: string[]): Promise<boolean> => {
      try {
        return (await kitchenSeen(slug, ticketIds)).ok
      } catch {
        return false
      }
    },
    [slug],
  )

  const dismissFailure = useCallback(() => setFailure(null), [])

  // ── Lo que se muestra ──────────────────────────────────────────────────────
  const queue = useMemo(
    () => pending.reduce((acc, p) => applyItemsMove(acc, p.itemIds, p.change, p.at), server),
    [server, pending],
  )

  // El canal caído solo es «sin conexión» hasta que una lectura posterior demuestre que se puede leer.
  const unverified = live === 'offline' && (droppedAt === null || lastOk.startedAt < droppedAt)
  const down = problem !== false || unverified

  return (
    <PassScreen
      backHref={`/${slug}/salon`}
      queue={queue}
      view={view}
      onView={changeView}
      onMove={move}
      onShown={shown}
      isKitchen={isKitchen}
      link={{
        live,
        down,
        reason: typeof problem === 'string' ? problem : null,
        lastOkMs: lastOk.ms,
      }}
      failure={failure}
      onDismissFailure={dismissFailure}
      timeZone={timeZone}
      brand={brand}
      tools={
        <PrinterButton
          variant="kitchen"
          slug={slug}
          branchId={branchId}
          branchName={server.branch.name}
          timeZone={timeZone}
        />
      }
    />
  )
}
