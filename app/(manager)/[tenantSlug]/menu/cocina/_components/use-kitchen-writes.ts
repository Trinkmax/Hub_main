'use client'

import { useRouter } from 'next/navigation'
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import {
  applyRoute,
  createGroup,
  createOption,
  createStations,
  deleteGroup,
  deleteOption,
  deleteStations,
  patchGroup,
  patchOption,
  patchStation,
  reorderGroups,
  reorderOptions,
  reorderStations,
  setLink,
} from '@/lib/menu/kitchen/actions'
import { byGroupOrder, byOptionOrder } from '@/lib/menu/kitchen/modifiers'
import {
  applyOp,
  buildView,
  invertOp,
  NO_PENDING,
  type Op,
  opKeys,
  type Pending,
  pendDrop,
  pendSettle,
  pendStart,
  pendSync,
  savingKeys,
} from '@/lib/menu/kitchen/ops'
import type { RequestedRoute } from '@/lib/menu/kitchen/plan'
import type { RouteReason } from '@/lib/menu/kitchen/schemas'
import {
  type ApplyRouteResult,
  type KitchenSnapshot,
  nodeKey,
  type RouteFailure,
  type SaveResult,
} from '@/lib/menu/kitchen/types'
import { notify } from './notify'

const LOST_CONNECTION =
  'No pudimos confirmar si se guardó: se cortó la conexión. Lo que ves es lo que quedó.'

/** Cuánto dura el trazo de marcador sobre lo que se acaba de marcar. */
const FLASH_MS = 520
/** Hasta cuántos cambios se pueden deshacer hacia atrás. */
const UNDO_DEPTH = 40
/** Si la pestaña estuvo escondida más que esto, al volver se relee la base. */
const STALE_AFTER_MS = 20_000

export type CommitOptions = {
  /** Qué se hizo, en pocas palabras: es el aviso de «guardado» y lo que nombra «Deshacer». */
  say?: string
  /** Sin aviso: el cambio ya se ve en pantalla. Igual se puede deshacer. */
  quiet?: boolean
  /** Para que el aviso reemplace al anterior del mismo tipo. */
  toastId?: string
  /** Por qué se marca (va a la auditoría). */
  reason?: RouteReason
  /** No entra en la lista de deshacer. */
  noUndo?: boolean
  /** Para nombrar una categoría o un producto en un aviso de error. */
  nameOf?: (node: 'category' | 'item', id: string) => string
  /** Cuando el servidor contestó: `true` si quedó guardado (aunque sea en parte). */
  onSettled?: (saved: boolean) => void
}

type UndoEntry = { token: number; label: string; op: Op }

/** Lo que se le manda al servidor, armado con lo que la persona veía ANTES del cambio. */
type OtherResult = SaveResult<{ outcome?: 'deleted' | 'deactivated' }>
type RouteJob = {
  kind: 'route'
  token: number
  op: Op
  changes: RequestedRoute[]
  options: CommitOptions
}
type OtherJob = {
  kind: 'other'
  token: number
  op: Op
  /** La operación que lo deshace, armada con cómo estaba todo antes. */
  inverse: Op | null
  send: () => Promise<OtherResult>
  options: CommitOptions
}
type Job = RouteJob | OtherJob

export type KitchenWrites = {
  /** La carta como se ve: lo último leído con lo pendiente encima. */
  view: KitchenSnapshot
  /** Las llaves de lo que se está guardando ahora. */
  saving: ReadonlySet<string>
  /** Hay algo guardándose. */
  busy: boolean
  /** El último guardado no entró. */
  stumbled: boolean
  /** Lo recién marcado (para el trazo). */
  flashed: ReadonlySet<string>
  /** Llave → por qué no se guardó. */
  errors: Readonly<Record<string, string>>
  /** Hace un cambio: se ve ya y se guarda solo. `false` si no había nada que cambiar. */
  commit: (op: Op, options?: CommitOptions) => boolean
  /** Deshace el último cambio. */
  undo: () => void
  /** Qué deshace «Deshacer», o `null` si no hay nada. */
  undoLabel: string | null
}

/** Saca de un cambio de varios campos los que ya valen eso. `null` si no queda ninguno. */
function changedFields<Row extends object>(row: Row | undefined, patch: Partial<Row>) {
  if (!row) return null
  const entries = (Object.keys(patch) as Array<keyof Row>).filter(
    (key) => patch[key] !== undefined && patch[key] !== row[key],
  )
  if (entries.length === 0) return null
  const next: Partial<Row> = {}
  const cas: { [Key in keyof Row]?: { from: Row[Key]; to: Row[Key] } } = {}
  for (const key of entries) {
    next[key] = patch[key]
    cas[key] = { from: row[key], to: patch[key] as Row[typeof key] }
  }
  return { patch: next, cas }
}

const stationOrder = (view: KitchenSnapshot) =>
  [...view.stations]
    .sort((a, b) => a.position - b.position || a.name.localeCompare(b.name, 'es'))
    .map((station) => station.id)
const groupOrder = (view: KitchenSnapshot) => [...view.groups].sort(byGroupOrder).map((g) => g.id)
const optionOrder = (view: KitchenSnapshot, groupId: string) =>
  view.options
    .filter((option) => option.groupId === groupId)
    .sort(byOptionOrder)
    .map((option) => option.id)

/**
 * La memoria de lo que se cambia en «Cocina y aclaraciones»: cada cambio se ve en el momento,
 * se guarda solo, en orden, y se puede deshacer. Si el servidor dice que no, vuelve a verse lo
 * que hay en la base y se avisa qué pasó.
 */
export function useKitchenWrites(tenantSlug: string, snapshot: KitchenSnapshot): KitchenWrites {
  const router = useRouter()

  // ── Lo pendiente, encima de la última lectura ────────────────────────────────────────────
  const [live, setLive] = useState<{ log: ReadonlyArray<Pending>; loadedAt: number }>({
    log: NO_PENDING,
    loadedAt: snapshot.loadedAt,
  })
  // Llegó una lectura nueva (después de guardar, o al volver a la pestaña): lo que esa lectura
  // ya incluye deja de hacer falta.
  if (live.loadedAt !== snapshot.loadedAt) {
    setLive({ log: pendSync(live.log, snapshot.loadedAt), loadedAt: snapshot.loadedAt })
  }
  const view = useMemo(() => buildView(snapshot, live.log), [snapshot, live.log])
  const saving = useMemo(() => savingKeys(live.log), [live.log])

  // Dos cambios seguidos en el mismo instante: el segundo tiene que partir de cómo quedó el
  // primero, sin esperar a que la pantalla se vuelva a dibujar.
  const viewRef = useRef(view)
  useLayoutEffect(() => {
    viewRef.current = view
  })

  const tokens = useRef(0)
  // El aviso de «Deshacer» y los atajos llaman siempre a la versión del último render.
  const commitRef = useRef<(op: Op, options?: CommitOptions) => boolean>(() => false)
  const [errors, setErrors] = useState<Readonly<Record<string, string>>>({})
  const [stumbled, setStumbled] = useState(false)
  const [undoStack, setUndoStack] = useState<ReadonlyArray<UndoEntry>>([])
  const undoRef = useRef(undoStack)
  useLayoutEffect(() => {
    undoRef.current = undoStack
  })

  // ── El trazo sobre lo recién marcado ─────────────────────────────────────────────────────
  const [flashed, setFlashed] = useState<ReadonlySet<string>>(() => new Set())
  const flashTimers = useRef(new Set<ReturnType<typeof setTimeout>>())
  useEffect(() => {
    const timers = flashTimers.current
    return () => {
      for (const timer of timers) clearTimeout(timer)
    }
  }, [])
  const flash = (keys: ReadonlyArray<string>) => {
    setFlashed((current) => new Set([...current, ...keys]))
    const timer = setTimeout(() => {
      flashTimers.current.delete(timer)
      setFlashed((current) => {
        const next = new Set(current)
        for (const key of keys) next.delete(key)
        return next
      })
    }, FLASH_MS)
    flashTimers.current.add(timer)
  }

  const clearErrors = (keys: ReadonlyArray<string>) =>
    setErrors((current) => {
      if (!keys.some((key) => key in current)) return current
      const next = { ...current }
      for (const key of keys) delete next[key]
      return next
    })
  const setError = (keys: ReadonlyArray<string>, message: string) =>
    setErrors((current) => {
      const next = { ...current }
      for (const key of keys) next[key] = message
      return next
    })

  // ── La cola: los guardados salen de a uno, en el orden en que se hicieron ────────────────
  const queue = useRef<Job[]>([])
  const running = useRef(false)

  const pushUndo = (job: Job, op: Op | null) => {
    if (!op || job.options.noUndo || !job.options.say) return
    const entry: UndoEntry = { token: job.token, label: job.options.say, op }
    setUndoStack((stack) => [...stack.slice(-(UNDO_DEPTH - 1)), entry])
  }

  /** Deshace un cambio puntual (el del aviso) o el último. */
  const undoEntry = (token: number | null) => {
    const stack = undoRef.current
    const entry = token === null ? stack[stack.length - 1] : stack.find((e) => e.token === token)
    if (!entry) return
    const rest = stack.filter((each) => each.token !== entry.token)
    undoRef.current = rest
    setUndoStack(rest)
    commitRef.current(entry.op, {
      say: `Deshecho: ${entry.label}`,
      toastId: 'undo',
      reason: 'undo',
      noUndo: true,
    })
  }

  const announce = (job: Job, inverse: Op | null, override?: string) => {
    const message = override ?? job.options.say
    if (!message || (job.options.quiet && !override)) return
    const id = job.options.toastId ?? `cambio:${job.token}`
    if (inverse && !job.options.noUndo) {
      notify.undoable(message, { id, onUndo: () => undoEntry(job.token) })
    } else notify.ok(message, id)
  }

  const failureText = (job: Job, failures: ReadonlyArray<RouteFailure>): string => {
    const [first] = failures
    if (failures.length === 1 && first) {
      const name = job.options.nameOf?.(first.node, first.id) ?? 'Eso'
      if (first.reason === 'missing') return `${name} ya no está en la carta.`
      if (first.reason === 'station_gone') return `${name}: esa estación ya no existe.`
      if (first.reason === 'changed') {
        return `${name}: no se cambió porque alguien lo tocó recién. Ya ves cómo quedó; si hace falta, marcalo de nuevo.`
      }
      return `${name}: no se guardó. Probá de nuevo.`
    }
    const stale = failures.filter((failure) => failure.reason === 'changed').length
    return stale === failures.length
      ? `${failures.length} cosas no se cambiaron porque alguien las tocó recién. Ya ves cómo quedaron.`
      : `${failures.length} cosas no se guardaron. Ya ves cómo quedaron: probá de nuevo con esas.`
  }

  const sendRoutes = async (batch: RouteJob[]) => {
    // Varias marcas seguidas viajan juntas. Si una cosa se marcó dos veces, vale la última, y
    // lo que la persona veía es lo de antes de la primera.
    const merged = new Map<string, RequestedRoute>()
    for (const job of batch) {
      for (const change of job.changes) {
        const key = nodeKey(change.node, change.id)
        const prior = merged.get(key)
        merged.set(key, prior ? { ...change, expected: prior.expected } : change)
      }
    }
    const reasons = [...new Set(batch.map((job) => job.options.reason ?? 'mark'))]
    const reason: RouteReason = reasons.length === 1 ? (reasons[0] ?? 'mark') : 'mark'
    let result: ApplyRouteResult
    try {
      result = await applyRoute(tenantSlug, { changes: [...merged.values()], reason })
    } catch {
      // No se sabe si llegó a guardarse: se vuelve a leer la base y se dice.
      result = { ok: false, message: LOST_CONNECTION }
      router.refresh()
    }

    if (!result.ok) {
      const message = result.message
      setLive((state) => {
        let log = state.log
        for (const job of batch) log = pendDrop(log, job.token)
        return { ...state, log }
      })
      setError(
        batch.flatMap((job) => opKeys(job.op)),
        'No se guardó. Quedó como estaba.',
      )
      setStumbled(true)
      notify.error(`No se guardó. ${message}`)
      for (const job of batch) job.options.onSettled?.(false)
      return
    }

    const { savedAt, failed } = result
    const failedKeys = new Map(
      failed.map((failure) => [nodeKey(failure.node, failure.id), failure]),
    )
    const settled = batch.map((job) => {
      const kept = job.changes.filter((c) => !failedKeys.has(nodeKey(c.node, c.id)))
      const lost = job.changes.flatMap((c) => failedKeys.get(nodeKey(c.node, c.id)) ?? [])
      return { job, kept, lost }
    })
    setLive((state) => {
      let log = state.log
      for (const { job, kept } of settled) {
        log = pendSettle(log, job.token, {
          savedAt,
          loadedAt: state.loadedAt,
          op:
            kept.length === job.changes.length
              ? undefined
              : kept.length === 0
                ? null
                : { type: 'route', changes: kept.map(({ node, id, to }) => ({ node, id, to })) },
        })
      }
      return { ...state, log }
    })

    setStumbled(failed.length > 0)
    for (const { job, kept, lost } of settled) {
      if (lost.length > 0) {
        setError(
          lost.map((failure) => nodeKey(failure.node, failure.id)),
          lost.every((failure) => failure.reason === 'changed')
            ? 'No se cambió: alguien lo tocó recién. Así quedó.'
            : 'No se guardó. Quedó como estaba.',
        )
        notify.error(failureText(job, lost))
      }
      if (kept.length > 0) {
        // Deshacer devuelve solo lo que de verdad entró.
        const inverse: Op = {
          type: 'route',
          changes: kept.map((change) => ({
            node: change.node,
            id: change.id,
            to: change.expected,
          })),
        }
        pushUndo(job, inverse)
        if (lost.length === 0) announce(job, inverse)
      }
      job.options.onSettled?.(kept.length > 0)
    }
    // Lo que tocó otra persona: se relee para mostrar la verdad.
    if (failed.some((failure) => failure.reason !== 'error')) router.refresh()
  }

  const sendOne = async (job: OtherJob) => {
    const { inverse } = job
    let result: OtherResult
    try {
      result = await job.send()
    } catch {
      result = { ok: false, message: LOST_CONNECTION, code: 'error' }
      router.refresh()
    }
    if (!result.ok) {
      const { message, code } = result
      setLive((state) => ({ ...state, log: pendDrop(state.log, job.token) }))
      setError(
        opKeys(job.op),
        code === 'changed' ? 'Alguien lo cambió recién. Así quedó.' : message,
      )
      setStumbled(true)
      notify.error(message)
      if (code !== 'error') router.refresh()
      job.options.onSettled?.(false)
      return
    }

    const { savedAt } = result
    // Una opción que ya salió en pedidos no se borra: el servidor la apaga y acá se muestra así.
    const kept =
      job.op.type === 'option.delete' && result.outcome === 'deactivated'
        ? ({ type: 'option.patch', id: job.op.id, patch: { active: false } } satisfies Op)
        : undefined
    setLive((state) => ({
      ...state,
      log: pendSettle(state.log, job.token, { savedAt, loadedAt: state.loadedAt, op: kept }),
    }))
    setStumbled(false)
    if (kept) {
      const back: Op = { type: 'option.patch', id: kept.id, patch: { active: true } }
      pushUndo(job, back)
      announce(
        job,
        back,
        'Esa opción ya salió en pedidos, así que no se borra: quedó apagada y el mozo ya no la ve.',
      )
    } else {
      pushUndo(job, inverse)
      announce(job, inverse)
    }
    job.options.onSettled?.(true)
  }

  const run = async () => {
    if (running.current) return
    running.current = true
    try {
      for (let job = queue.current.shift(); job; job = queue.current.shift()) {
        if (job.kind === 'route') {
          const batch = [job]
          for (let next = queue.current[0]; next?.kind === 'route'; next = queue.current[0]) {
            queue.current.shift()
            batch.push(next)
          }
          await sendRoutes(batch)
        } else {
          await sendOne(job)
        }
      }
    } finally {
      running.current = false
    }
  }

  const commit = (op: Op, options: CommitOptions = {}): boolean => {
    const before = viewRef.current
    const slug = tenantSlug
    tokens.current += 1
    const token = tokens.current
    const other = (next: Op, send: () => Promise<OtherResult>): OtherJob => ({
      kind: 'other',
      token,
      op: next,
      inverse: invertOp(before, next),
      send,
      options,
    })

    let job: Job | null = null
    switch (op.type) {
      case 'route': {
        const categories = new Map(before.categories.map((row) => [row.id, row.stationId]))
        const items = new Map(before.items.map((row) => [row.id, row.stationId]))
        const changes: RequestedRoute[] = []
        for (const change of op.changes) {
          const was = (change.node === 'category' ? categories : items).get(change.id)
          if (was === undefined || was === change.to) continue
          changes.push({ ...change, expected: was })
        }
        if (changes.length === 0) return false
        job = {
          kind: 'route',
          token,
          op: { type: 'route', changes: changes.map(({ node, id, to }) => ({ node, id, to })) },
          changes,
          options,
        }
        flash(changes.map((change) => nodeKey(change.node, change.id)))
        break
      }
      case 'station.create':
        job = other(op, () => createStations(slug, { stations: op.stations }))
        break
      case 'station.patch': {
        const fields = changedFields(
          before.stations.find((row) => row.id === op.id),
          op.patch,
        )
        if (!fields) return false
        const { id } = op
        job = other({ type: 'station.patch', id, patch: fields.patch }, () =>
          patchStation(slug, { id, patch: fields.cas }),
        )
        break
      }
      case 'station.delete':
        job = other(op, () => deleteStations(slug, { ids: op.ids }))
        break
      case 'station.order': {
        const expected = stationOrder(before)
        if (op.ids.every((id, index) => id === expected[index])) return false
        job = other(op, () => reorderStations(slug, { ids: op.ids, expected }))
        break
      }
      case 'group.create':
        job = other(op, () =>
          createGroup(slug, {
            group: op.group,
            options: op.options.map(({ groupId: _groupId, ...option }) => option),
            links: op.links.map(({ target, targetId }) => ({ target, targetId })),
          }),
        )
        break
      case 'group.patch': {
        const fields = changedFields(
          before.groups.find((row) => row.id === op.id),
          op.patch,
        )
        if (!fields) return false
        const { id } = op
        job = other({ type: 'group.patch', id, patch: fields.patch }, () =>
          patchGroup(slug, { id, patch: fields.cas }),
        )
        break
      }
      case 'group.delete':
        job = other(op, () => deleteGroup(slug, { id: op.id }))
        break
      case 'group.order': {
        const expected = groupOrder(before)
        if (op.ids.every((id, index) => id === expected[index])) return false
        job = other(op, () => reorderGroups(slug, { ids: op.ids, expected }))
        break
      }
      case 'option.create': {
        const { groupId, ...option } = op.option
        job = other(op, () => createOption(slug, { groupId, option }))
        break
      }
      case 'option.patch': {
        const fields = changedFields(
          before.options.find((row) => row.id === op.id),
          op.patch,
        )
        if (!fields) return false
        const { id } = op
        job = other({ type: 'option.patch', id, patch: fields.patch }, () =>
          patchOption(slug, { id, patch: fields.cas }),
        )
        break
      }
      case 'option.delete':
        job = other(op, () => deleteOption(slug, { id: op.id }))
        break
      case 'option.order': {
        const expected = optionOrder(before, op.groupId)
        if (op.ids.every((id, index) => id === expected[index])) return false
        job = other(op, () => reorderOptions(slug, { groupId: op.groupId, ids: op.ids, expected }))
        break
      }
      case 'link.set':
        if (invertOp(before, op) === null) return false
        job = other(op, () =>
          setLink(slug, {
            groupId: op.link.groupId,
            target: op.link.target,
            targetId: op.link.targetId,
            linked: op.linked,
          }),
        )
        break
    }

    const effective = job.op
    viewRef.current = applyOp(before, effective)
    clearErrors(opKeys(effective))
    setLive((state) => ({ ...state, log: pendStart(state.log, token, effective) }))
    queue.current.push(job)
    void run()
    return true
  }
  useLayoutEffect(() => {
    commitRef.current = commit
  })
  const stableCommit = useCallback(
    (op: Op, options?: CommitOptions) => commitRef.current(op, options),
    [],
  )
  const undoLatest = useRef(() => undoEntry(null))
  useLayoutEffect(() => {
    undoLatest.current = () => undoEntry(null)
  })
  const undo = useCallback(() => undoLatest.current(), [])

  // ── Otra persona pudo haber cambiado algo mientras la pestaña estaba escondida ───────────
  useEffect(() => {
    let hiddenAt: number | null = null
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') {
        hiddenAt = Date.now()
        return
      }
      if (hiddenAt !== null && Date.now() - hiddenAt > STALE_AFTER_MS) router.refresh()
      hiddenAt = null
    }
    document.addEventListener('visibilitychange', onVisibility)
    return () => document.removeEventListener('visibilitychange', onVisibility)
  }, [router])

  const busy = saving.size > 0
  // Cerrar la pestaña con un guardado en el aire: el navegador pregunta antes.
  useEffect(() => {
    if (!busy) return
    const warn = (event: BeforeUnloadEvent) => event.preventDefault()
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [busy])

  const last = undoStack[undoStack.length - 1]
  return {
    view,
    saving,
    busy,
    stumbled,
    flashed,
    errors,
    commit: stableCommit,
    undo,
    undoLabel: last ? last.label : null,
  }
}
