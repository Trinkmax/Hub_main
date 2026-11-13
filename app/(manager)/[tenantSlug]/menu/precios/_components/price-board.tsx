'use client'

import {
  ChevronsDownUp,
  ChevronsUpDown,
  History,
  SearchX,
  TrendingUp,
  UtensilsCrossed,
} from 'lucide-react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import {
  useCallback,
  useDeferredValue,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { AdmHeader, AdmPage } from '@/components/administracion/kit/adm-page'
import { EmptyTeach } from '@/components/administracion/kit/empty-teach'
import { Button } from '@/components/ui/button'
import { Kbd } from '@/components/ui/kbd'
import { applyPriceChanges, setBranchAvailability } from '@/lib/menu/prices/actions'
import {
  batchStorageKey,
  buildBatch,
  invertChanges,
  type PriceBatch,
  parseStoredBatch,
  serializeBatch,
  undoSentence,
} from '@/lib/menu/prices/batch'
import { bulkChanges } from '@/lib/menu/prices/bulk'
import { checkPriceJump } from '@/lib/menu/prices/guard'
import { priceArrow } from '@/lib/menu/prices/history'
import type { PriceReason } from '@/lib/menu/prices/schemas'
import { buildSearchIndex, searchPrices } from '@/lib/menu/prices/search'
import { categoryTree } from '@/lib/menu/prices/tree'
import {
  type ApplyPricesResult,
  type PriceBranch,
  type PriceChange,
  type PriceItem,
  type PriceSnapshot,
  type PriceWriteFailure,
  pointKey,
  type SetAvailabilityResult,
  type ViewId,
} from '@/lib/menu/prices/types'
import {
  buildGroups,
  buildPriceBook,
  type Draft,
  draftDropToken,
  draftSettleAvailability,
  draftSettlePrices,
  draftStartAvailability,
  draftStartPrices,
  draftSync,
  EMPTY_DRAFT,
  liveItems,
  rowPrice,
} from '@/lib/menu/prices/view'
import { formatCentsShort } from '@/lib/money'
import { BranchDot, BranchSwitch } from './branch-switch'
import { type BulkOutcome, type BulkRequest, BulkSheet } from './bulk-sheet'
import { HistorySheet, type HistoryTarget } from './history-sheet'
import { notify } from './notify'
import {
  type CommitOutcome,
  type CommitVia,
  focusFirstPriceField,
  focusPriceField,
} from './price-field'
import { GroupedList, type ListContext, ResultList, type RowHandlers } from './price-list'
import type { GuardState } from './price-row'
import { PriceSearch } from './price-search'
import { UndoBar } from './undo-bar'

const LOST_CONNECTION =
  'No pudimos confirmar si se guardó: se cortó la conexión. Los precios que ves son los que quedaron.'

function omit<T>(record: Readonly<Record<string, T>>, key: string): Record<string, T> {
  if (!(key in record)) return record as Record<string, T>
  const { [key]: _gone, ...rest } = record
  return rest
}

function newId(): string {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`
}

type BulkMeta = {
  percentBp: number
  roundingCents: number
  scope: 'all' | 'categories'
  categoryCount: number
}

/**
 * «Precios»: se busca un producto, se toca su precio y queda guardado. Esta pieza tiene la
 * memoria de la pantalla: qué se está mirando (la carta o una sucursal), lo que se acaba de
 * cambiar y todavía se está guardando, las preguntas abiertas y la tanda del último aumento.
 */
export function PriceBoard({
  tenantSlug,
  snapshot,
  initialBranchSlug,
}: {
  tenantSlug: string
  snapshot: PriceSnapshot
  /** `?sucursal=`: con qué sucursal abrir. */
  initialBranchSlug: string | null
}) {
  const router = useRouter()

  // ── Lo cambiado y todavía no confirmado, encima de la última lectura ─────────────────────
  const [live, setLive] = useState<{ draft: Draft; loadedAt: number }>({
    draft: EMPTY_DRAFT,
    loadedAt: snapshot.loadedAt,
  })
  // Llegó una lectura nueva (después de guardar, o al volver a la pestaña): lo que esa lectura
  // ya incluye deja de hacer falta en el borrador.
  if (live.loadedAt !== snapshot.loadedAt) {
    setLive({ draft: draftSync(live.draft, snapshot.loadedAt), loadedAt: snapshot.loadedAt })
  }
  const tokens = useRef(0)

  const tree = useMemo(() => categoryTree(snapshot.categories), [snapshot.categories])
  const groups = useMemo(() => buildGroups(tree, snapshot.items), [tree, snapshot.items])
  const book = useMemo(() => buildPriceBook(snapshot, live.draft), [snapshot, live.draft])
  const itemsById = useMemo(
    () => new Map(snapshot.items.map((item) => [item.id, item])),
    [snapshot.items],
  )
  const branchesById = useMemo(
    () => new Map(snapshot.branches.map((branch) => [branch.id, branch])),
    [snapshot.branches],
  )
  const paths = useMemo(() => {
    const map = new Map<string, string>()
    for (const group of groups) for (const item of group.items) map.set(item.id, group.pathLabel)
    return map
  }, [groups])
  const index = useMemo(
    () =>
      buildSearchIndex(
        groups.flatMap((group) =>
          group.items.map((item) => ({ id: item.id, name: item.name, path: group.pathLabel })),
        ),
      ),
    [groups],
  )

  // ── Qué se está mirando ──────────────────────────────────────────────────────────────────
  // Con una sola sucursal no hay nada que elegir… salvo que esa sucursal tenga precios propios
  // o productos que no vende: ahí hay que poder verlos (es lo que cobra la caja).
  const showBranches = snapshot.branches.length > 1 || snapshot.overrides.length > 0
  const [pickedView, setPickedView] = useState<ViewId>(
    () => snapshot.branches.find((branch) => branch.slug === initialBranchSlug)?.id ?? null,
  )
  const view: ViewId =
    showBranches && pickedView !== null && branchesById.has(pickedView) ? pickedView : null
  const branch: PriceBranch | null = view === null ? null : (branchesById.get(view) ?? null)

  const changeView = (next: ViewId) => {
    setPickedView(next)
    const slug = next === null ? null : (branchesById.get(next)?.slug ?? null)
    const url = new URL(window.location.href)
    if (slug) url.searchParams.set('sucursal', slug)
    else url.searchParams.delete('sucursal')
    window.history.replaceState(null, '', url)
  }

  // ── El buscador ──────────────────────────────────────────────────────────────────────────
  const searchRef = useRef<HTMLInputElement>(null)
  const [query, setQuery] = useState('')
  const deferredQuery = useDeferredValue(query)
  const hits = useMemo(() => searchPrices(index, deferredQuery), [index, deferredQuery])
  const found = useMemo(
    () =>
      hits === null
        ? null
        : hits.flatMap((id) => {
            const item = itemsById.get(id)
            return item ? [item] : []
          }),
    [hits, itemsById],
  )

  // ── Los grupos plegados ──────────────────────────────────────────────────────────────────
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(() => new Set())
  const allCollapsed = groups.length > 0 && groups.every((group) => collapsed.has(group.id))
  const toggleGroup = useCallback((id: string) => {
    setCollapsed((current) => {
      const next = new Set(current)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }, [])

  // ── Preguntas abiertas, errores, hojas y la tanda ────────────────────────────────────────
  const [guards, setGuards] = useState<Readonly<Record<string, GuardState>>>({})
  const [errors, setErrors] = useState<Readonly<Record<string, string>>>({})
  const [bulkOpen, setBulkOpen] = useState(false)
  const [history, setHistory] = useState<HistoryTarget | null>(null)
  const [batch, setBatchState] = useState<PriceBatch | null>(null)
  const [undoing, setUndoing] = useState(false)
  const undoBarRef = useRef<HTMLElement>(null)

  // La tanda del último aumento sobrevive a recargar la página (mientras dure la sesión).
  useEffect(() => {
    try {
      setBatchState(parseStoredBatch(window.sessionStorage.getItem(batchStorageKey(tenantSlug))))
    } catch {
      // Sin acceso al almacenamiento (modo privado estricto): la tanda vive solo en la pantalla.
    }
  }, [tenantSlug])
  const setBatch = (next: PriceBatch | null) => {
    setBatchState(next)
    try {
      const key = batchStorageKey(tenantSlug)
      if (next) window.sessionStorage.setItem(key, serializeBatch(next))
      else window.sessionStorage.removeItem(key)
    } catch {
      // Igual que arriba: no poder guardarla no impide deshacer mientras la pantalla siga abierta.
    }
  }

  // ── El buscador se queda pegado arriba; el fondo aparece recién ahí ──────────────────────
  const sentinelRef = useRef<HTMLDivElement>(null)
  const [stuck, setStuck] = useState(false)
  useEffect(() => {
    const sentinel = sentinelRef.current
    if (!sentinel || typeof IntersectionObserver === 'undefined') return
    // 57 px: la barra de arriba del panel (56) y uno más.
    const observer = new IntersectionObserver(
      ([entry]) => setStuck(entry ? !entry.isIntersecting : false),
      { rootMargin: '-57px 0px 0px 0px' },
    )
    observer.observe(sentinel)
    return () => observer.disconnect()
  }, [])

  // Una hoja tiene su botón abajo, justo donde salen los avisos: al abrirla se van.
  const openBulk = () => {
    notify.clear()
    setBulkOpen(true)
  }
  const openHistory = (target: HistoryTarget) => {
    notify.clear()
    setHistory(target)
  }

  // ── Guardar ──────────────────────────────────────────────────────────────────────────────
  const labelOf = (item: PriceItem, where: PriceBranch | null) =>
    where ? `${item.name} en ${where.name}` : item.name

  /** Escribe precios: se ven ya, y cuando el servidor contesta, lo que no salió vuelve atrás. */
  const writePrices = async (
    changes: PriceChange[],
    meta: { reason: PriceReason; bulk?: BulkMeta },
  ): Promise<ApplyPricesResult> => {
    tokens.current += 1
    const token = tokens.current
    setLive((state) => ({ ...state, draft: draftStartPrices(state.draft, token, changes) }))
    let result: ApplyPricesResult
    try {
      result = await applyPriceChanges(tenantSlug, {
        changes: changes.map((change) => ({
          itemId: change.itemId,
          branchId: change.branchId,
          priceCents: change.toCents,
          expectedCents: change.fromCents,
        })),
        reason: meta.reason,
        bulk: meta.bulk,
      })
    } catch {
      // No se sabe si llegó a guardarse: se vuelve a leer la base y se dice.
      result = { ok: false, message: LOST_CONNECTION }
      router.refresh()
    }
    const settled = result
    setLive((state) => ({
      ...state,
      draft: settled.ok
        ? draftSettlePrices(state.draft, token, {
            savedAt: settled.savedAt,
            loadedAt: state.loadedAt,
            failed: settled.failed,
          })
        : draftDropToken(state.draft, token),
    }))
    return result
  }

  /** Por qué no se guardó UN precio, y qué hacer. */
  const failureText = (label: string, failure: PriceWriteFailure, shownFrom: number) => {
    if (failure.reason === 'missing') return `${label} ya no está en la carta.`
    if (failure.reason === 'changed') {
      if (failure.currentCents === undefined) {
        return `${label}: no se guardó porque alguien lo cambió recién. Mirá cómo quedó y, si hace falta, cambialo de nuevo.`
      }
      const now =
        failure.currentCents === null
          ? 'sigue el precio de la carta'
          : `cuesta ${formatCentsShort(failure.currentCents)}`
      return `${label}: no se guardó porque alguien lo cambió recién y ahora ${now}. Si querés otro precio, cambialo de nuevo.`
    }
    return `No se guardó el precio de ${label}: sigue en ${formatCentsShort(shownFrom)}. Probá de nuevo.`
  }

  const undoPrice = async (change: PriceChange, label: string, shownFrom: number) => {
    const result = await writePrices(invertChanges([change]), { reason: 'undo' })
    if (!result.ok) {
      notify.error(`${label}: no se pudo deshacer. ${result.message}`)
      return
    }
    if (result.failed.length > 0) {
      notify.error(`${label}: no se deshizo porque el precio cambió después. Quedó como está.`)
      return
    }
    notify.ok(`${label}: volvió a ${formatCentsShort(shownFrom)}`)
  }

  /** Guarda UN precio donde se está mirando. `null` = volver al precio de la carta. */
  const savePrice = async (item: PriceItem, toCents: number | null) => {
    const price = rowPrice(book, item, view)
    const key = pointKey(view, item.id)
    const change: PriceChange =
      view === null
        ? { itemId: item.id, branchId: null, fromCents: price.menuCents, toCents }
        : { itemId: item.id, branchId: view, fromCents: price.ownCents, toCents }
    const label = labelOf(item, branch)
    const shownFrom = price.effectiveCents
    const shownTo = toCents ?? price.menuCents
    setErrors((current) => omit(current, key))

    const result = await writePrices([change], { reason: toCents === null ? 'reset' : 'edit' })
    if (!result.ok) {
      setErrors((current) => ({
        ...current,
        [key]: `No se guardó. Sigue en ${formatCentsShort(shownFrom)}.`,
      }))
      notify.error(`${label}: ${result.message}`)
      return
    }
    const failure = result.failed[0]
    if (failure) {
      setErrors((current) => ({
        ...current,
        [key]:
          failure.reason === 'changed'
            ? 'No se guardó: alguien lo cambió recién. Este es el precio de ahora.'
            : `No se guardó. Sigue en ${formatCentsShort(shownFrom)}.`,
      }))
      notify.error(failureText(label, failure, shownFrom))
      if (failure.reason !== 'error') router.refresh()
      return
    }
    // Ya valía eso (otra persona lo dejó igual): no hay nada que deshacer.
    if (result.applied.length === 0) return
    notify.undoable(
      toCents === null
        ? `${label}: volvió al precio de la carta (${formatCentsShort(shownTo)})`
        : `${label}: ${priceArrow(shownFrom, shownTo)}`,
      { id: `precio:${key}`, onUndo: () => void undoPrice(change, label, shownFrom) },
    )
  }

  const saveAvailability = async (
    item: PriceItem,
    where: PriceBranch,
    available: boolean,
    undoable: boolean,
  ) => {
    tokens.current += 1
    const token = tokens.current
    const request = { branchId: where.id, itemIds: [item.id], available }
    setLive((state) => ({ ...state, draft: draftStartAvailability(state.draft, token, request) }))
    let result: SetAvailabilityResult
    try {
      result = await setBranchAvailability(tenantSlug, request)
    } catch {
      result = { ok: false, message: LOST_CONNECTION }
      router.refresh()
    }
    const settled = result
    setLive((state) => ({
      ...state,
      draft: settled.ok
        ? draftSettleAvailability(state.draft, token, {
            savedAt: settled.savedAt,
            loadedAt: state.loadedAt,
          })
        : draftDropToken(state.draft, token),
    }))
    if (!result.ok) {
      notify.error(`${item.name}: ${result.message}`)
      return
    }
    const message = available
      ? `${item.name} se vuelve a vender en ${where.name}`
      : `${item.name} ya no se vende en ${where.name}`
    if (!undoable) {
      notify.ok(message)
      return
    }
    notify.undoable(message, {
      id: `vende:${pointKey(where.id, item.id)}`,
      onUndo: () => void saveAvailability(item, where, !available, false),
    })
  }

  // ── Lo que avisa cada renglón ────────────────────────────────────────────────────────────
  const rowActions = {
    commit(itemId: string, cents: number, via: CommitVia): CommitOutcome {
      const item = itemsById.get(itemId)
      if (!item) return 'saved'
      const price = rowPrice(book, item, view)
      const key = pointKey(view, itemId)
      const jump = checkPriceJump(price.effectiveCents, cents)
      if (jump.kind === 'confirm') {
        // No se guarda sin preguntar: «¿$ 12 o $ 12.000?».
        setGuards((current) => ({
          ...current,
          [key]: { jump, oldCents: price.effectiveCents, via },
        }))
        return 'held'
      }
      // Tipeó un precio que no deja dudas: una pregunta que hubiera quedado abierta ya no va.
      setGuards((current) => omit(current, key))
      if (cents !== price.effectiveCents) void savePrice(item, cents)
      return 'saved'
    },
    cancel(itemId: string) {
      const key = pointKey(view, itemId)
      setGuards((current) => omit(current, key))
      setErrors((current) => omit(current, key))
    },
    guardPick(itemId: string, cents: number | null, byKeyboard: boolean) {
      const key = pointKey(view, itemId)
      const guard = guards[key]
      if (!guard) return
      setGuards((current) => omit(current, key))
      const item = itemsById.get(itemId)
      if (item && cents !== null && cents !== guard.oldCents) void savePrice(item, cents)
      // Con el teclado, el foco vuelve a los precios: al siguiente si venía recorriendo con Tab.
      if (byKeyboard) {
        const step = guard.via === 'next' ? 1 : guard.via === 'previous' ? -1 : undefined
        requestAnimationFrame(() => focusPriceField(itemId, { step }))
      }
    },
    history(itemId: string) {
      const item = itemsById.get(itemId)
      if (!item) return
      const menuCents = book.menu.get(item.id) ?? item.priceCents
      const own = snapshot.branches.flatMap((entry) => {
        const cents = book.overrides.get(pointKey(entry.id, item.id))?.priceCents ?? null
        return cents === null ? [] : [`En ${entry.name}, ${formatCentsShort(cents)}.`]
      })
      openHistory({
        itemId: item.id,
        name: item.name,
        summary: [`Hoy cuesta ${formatCentsShort(menuCents)}.`, ...own].join(' '),
      })
    },
    reset(itemId: string) {
      const item = itemsById.get(itemId)
      if (item) void savePrice(item, null)
    },
    available(itemId: string, available: boolean) {
      const item = itemsById.get(itemId)
      if (item && branch) void saveAvailability(item, branch, available, true)
    },
  }
  // Los renglones reciben siempre las mismas funciones (no se redibujan de más) y cada una
  // llama a la versión de este render, que ve los precios de ahora.
  const actionsRef = useRef(rowActions)
  useLayoutEffect(() => {
    actionsRef.current = rowActions
  })
  const handlers = useMemo<RowHandlers>(
    () => ({
      onCommit: (itemId, cents, via) => actionsRef.current.commit(itemId, cents, via),
      onCancel: (itemId) => actionsRef.current.cancel(itemId),
      onGuardPick: (itemId, cents, byKeyboard) =>
        actionsRef.current.guardPick(itemId, cents, byKeyboard),
      onHistory: (itemId) => actionsRef.current.history(itemId),
      onReset: (itemId) => actionsRef.current.reset(itemId),
      onAvailable: (itemId, available) => actionsRef.current.available(itemId, available),
    }),
    [],
  )
  const ctx = useMemo<ListContext>(
    () => ({
      book,
      view,
      branchName: branch?.name ?? null,
      branchColor: branch?.color ?? null,
      guards,
      errors,
      handlers,
    }),
    [book, view, branch, guards, errors, handlers],
  )

  // ── El aumento ───────────────────────────────────────────────────────────────────────────
  const itemsNow = useMemo(() => liveItems(snapshot.items, book), [snapshot.items, book])
  const overridesNow = useMemo(() => [...book.overrides.values()], [book])

  const applyBulk = async (request: BulkRequest): Promise<BulkOutcome> => {
    const changes = bulkChanges(request.lines)
    const where = branch
    const result = await writePrices(changes, {
      reason: 'bulk',
      bulk: {
        percentBp: request.percentBp,
        roundingCents: request.roundingCents,
        scope: request.scope.kind,
        categoryCount: request.scope.kind === 'categories' ? request.scope.ids.length : 0,
      },
    })
    if (!result.ok) return { ok: false, message: `No se cambió ningún precio. ${result.message}` }
    const next = buildBatch({
      id: newId(),
      at: Date.now(),
      percentBp: request.percentBp,
      roundingCents: request.roundingCents,
      branchId: where?.id ?? null,
      branchName: where?.name ?? null,
      requested: changes,
      result,
      nameOf: (failure) => {
        const name = itemsById.get(failure.itemId)?.name ?? 'Un producto'
        const own = where === null && failure.branchId !== null
        return own
          ? `${name} (${branchesById.get(failure.branchId ?? '')?.name ?? 'sucursal'})`
          : name
      },
    })
    if (!next) {
      if (result.failed.length === 0) {
        return { ok: false, message: 'Esos precios ya estaban así: no había nada para cambiar.' }
      }
      const stale = result.failed.every((failure) => failure.reason === 'changed')
      router.refresh()
      return {
        ok: false,
        message: stale
          ? 'No se cambió ningún precio: alguien los cambió mientras armabas el aumento. Ya ves los precios de ahora: revisá cómo quedan y aplicá de nuevo.'
          : 'No se cambió ningún precio: la base no los guardó. Probá de nuevo en un momento.',
      }
    }
    setBatch(next)
    setBulkOpen(false)
    const calm = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    window.scrollTo({ top: 0, behavior: calm ? 'auto' : 'smooth' })
    // El aviso con «Deshacer» recibe el foco: es lo que acaba de pasar.
    requestAnimationFrame(() => undoBarRef.current?.focus({ preventScroll: true }))
    return { ok: true }
  }

  const undoBatch = async () => {
    if (!batch || undoing) return
    setUndoing(true)
    const inverse = invertChanges(batch.changes)
    const result = await writePrices(inverse, { reason: 'bulk_undo' })
    setUndoing(false)
    if (!result.ok) {
      notify.error(`No se pudo deshacer. ${result.message}`)
      return
    }
    const sentence = undoSentence({
      undone: inverse.length - result.failed.length,
      total: inverse.length,
    })
    setBatch(null)
    if (result.failed.length === 0) notify.ok(sentence)
    else notify.warn(sentence)
  }

  // ── La pantalla ──────────────────────────────────────────────────────────────────────────
  const productCount = snapshot.items.length
  const statusText =
    found === null
      ? `${productCount} ${productCount === 1 ? 'producto' : 'productos'} en ${groups.length} ${groups.length === 1 ? 'categoría' : 'categorías'}`
      : found.length === 0
        ? 'Sin resultados'
        : `${found.length} ${found.length === 1 ? 'producto' : 'productos'} con “${deferredQuery.trim()}”`

  return (
    <AdmPage className="max-w-4xl pb-28">
      <AdmHeader
        back={{ href: `/${tenantSlug}/menu`, label: 'Carta' }}
        title="Precios"
        description="Buscá un producto y tocá su precio para cambiarlo. Se guarda solo y lo podés deshacer."
        actions={
          productCount > 0 ? (
            <>
              <Button
                type="button"
                variant="outline"
                data-testid="open-history"
                className="h-11 flex-1 sm:h-9 sm:flex-none"
                onClick={() => openHistory({ itemId: null, name: null, summary: null })}
              >
                <History aria-hidden />
                Últimos cambios
              </Button>
              <Button
                type="button"
                data-testid="open-bulk"
                className="h-11 flex-1 sm:h-9 sm:flex-none"
                onClick={openBulk}
              >
                <TrendingUp aria-hidden />
                Aumentar precios
              </Button>
            </>
          ) : null
        }
      />

      {batch ? (
        <UndoBar
          key={batch.id}
          batch={batch}
          busy={undoing}
          barRef={undoBarRef}
          onUndo={() => void undoBatch()}
          onDismiss={() => setBatch(null)}
        />
      ) : null}

      {productCount === 0 ? (
        <EmptyTeach
          icon={UtensilsCrossed}
          title="Todavía no hay productos en la carta"
          action={
            <Button asChild>
              <Link href={`/${tenantSlug}/menu`}>Ir a la carta</Link>
            </Button>
          }
        >
          Acá vas a poder buscar cualquier producto y cambiarle el precio en dos toques, o subir
          toda la carta un porcentaje. Primero cargá lo que vendés desde la carta.
        </EmptyTeach>
      ) : (
        <div>
          {/* El buscador va primero: es la manera de usar esta pantalla. */}
          <div ref={sentinelRef} aria-hidden className="h-px" />
          <div
            data-stuck={stuck ? '' : undefined}
            // Pegado, el fondo es macizo: los renglones pasan por detrás y no se tienen que leer.
            // En el celular va de borde a borde; en la compu, del ancho exacto de la lista (más
            // ancho se veía como una franja suelta sobre el fondo de la página).
            className="sticky top-14 z-[15] -mx-4 flex h-16 items-center gap-2 px-4 sm:mx-0 sm:h-[4.75rem] sm:px-0 data-stuck:bg-background"
          >
            <PriceSearch
              inputRef={searchRef}
              value={query}
              onChange={setQuery}
              onEnter={() => focusFirstPriceField()}
            />
            {stuck && branch ? (
              // Con la lista corrida ya no se ven las píldoras: acá sigue dicho dónde se está.
              <button
                type="button"
                data-testid="view-chip"
                aria-label={`Estás viendo los precios de ${branch.name}. Subir para cambiar.`}
                onClick={() => window.scrollTo({ top: 0 })}
                className="flex h-12 max-w-[40%] shrink-0 items-center gap-1.5 rounded-2xl border border-border/70 bg-card px-3 text-sm font-medium shadow-xs outline-none focus-visible:ring-2 focus-visible:ring-ring sm:h-14"
              >
                <BranchDot color={branch.color} />
                <span className="truncate">{branch.shortName ?? branch.name}</span>
              </button>
            ) : null}
          </div>

          {/* Qué precios se miran, pegado a la lista que cambia con eso. */}
          {showBranches ? (
            <div className="mt-2 mb-4">
              <BranchSwitch branches={snapshot.branches} view={view} onChange={changeView} />
            </div>
          ) : null}

          <div className="mt-1 mb-3 flex min-h-9 flex-wrap items-center justify-between gap-x-4 gap-y-1">
            <p
              aria-live="polite"
              data-testid="price-status"
              className="text-sm text-muted-foreground"
            >
              {statusText}
            </p>
            <div className="flex items-center gap-4">
              {found?.length === 0 ? null : (
                <p
                  aria-hidden
                  className="hidden items-center gap-1.5 text-xs text-muted-foreground pointer-fine:md:flex"
                >
                  <Kbd>Enter</Kbd> guarda
                  <Kbd className="ml-1.5">Tab</Kbd> pasa al siguiente
                  <Kbd className="ml-1.5">Esc</Kbd> cancela
                </p>
              )}
              {found === null && groups.length > 1 ? (
                <button
                  type="button"
                  data-testid="collapse-all"
                  onClick={() =>
                    setCollapsed(
                      allCollapsed ? new Set() : new Set(groups.map((group) => group.id)),
                    )
                  }
                  className="inline-flex min-h-9 items-center gap-1.5 rounded-md text-sm font-medium text-foreground outline-none hover:underline hover:underline-offset-4 focus-visible:ring-2 focus-visible:ring-ring pointer-coarse:min-h-11"
                >
                  {allCollapsed ? (
                    <ChevronsUpDown aria-hidden className="size-4 text-muted-foreground" />
                  ) : (
                    <ChevronsDownUp aria-hidden className="size-4 text-muted-foreground" />
                  )}
                  {allCollapsed ? 'Desplegar todo' : 'Plegar todo'}
                </button>
              ) : null}
            </div>
          </div>

          <div>
            {found === null ? (
              <GroupedList groups={groups} ctx={ctx} collapsed={collapsed} onToggle={toggleGroup} />
            ) : found.length > 0 ? (
              <ResultList items={found} paths={paths} ctx={ctx} query={deferredQuery} />
            ) : (
              <div
                data-testid="search-empty"
                className="flex flex-col items-center rounded-2xl border border-dashed border-border bg-card/50 px-5 py-10 text-center"
              >
                <span
                  aria-hidden
                  className="mb-3.5 flex size-11 items-center justify-center rounded-full border border-primary/15 bg-accent text-accent-foreground shadow-2xs"
                >
                  <SearchX className="size-5" />
                </span>
                <p className="font-serif text-lg leading-snug font-semibold tracking-tight text-balance [overflow-wrap:anywhere]">
                  No hay productos con “{deferredQuery.trim()}”
                </p>
                <p className="mt-1.5 max-w-sm text-sm text-muted-foreground text-pretty">
                  Probá con menos letras o con el nombre de la categoría: «pizza» trae todas las
                  pizzas.
                </p>
                <Button
                  type="button"
                  variant="outline"
                  className="mt-4 h-11 sm:h-9"
                  onClick={() => {
                    setQuery('')
                    searchRef.current?.focus()
                  }}
                >
                  Borrar la búsqueda
                </Button>
              </div>
            )}
          </div>
        </div>
      )}

      <BulkSheet
        open={bulkOpen}
        onOpenChange={setBulkOpen}
        tree={tree}
        items={itemsNow}
        overrides={overridesNow}
        branches={snapshot.branches}
        view={view}
        onApply={applyBulk}
      />
      <HistorySheet tenantSlug={tenantSlug} target={history} onClose={() => setHistory(null)} />
    </AdmPage>
  )
}
