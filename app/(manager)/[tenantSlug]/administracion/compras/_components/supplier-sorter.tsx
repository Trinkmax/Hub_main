'use client'

import { ArrowLeft, Check, SkipForward } from 'lucide-react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'
import { AccountCombobox } from '@/components/administracion/account-combobox'
import { useAccounting } from '@/components/administracion/accounting-provider'
import { type CategoryOption, CategoryPicker, topCategories } from '@/components/administracion/kit'
import { toastUndo } from '@/components/administracion/quick-actions'
import { Button } from '@/components/ui/button'
import { ACC_UNREACHABLE } from '@/lib/accounting/action-state'
import { saveParty } from '@/lib/accounting/actions/master'
import type { PartyKind } from '@/lib/accounting/types'
import { cn } from '@/lib/utils'
import { suggestAccount } from '../_lib/bulk'
import type { SupplierAccountOption } from '../_lib/suppliers'

/** Un proveedor de la cola: lo que hace falta para guardarle la categoría. */
export type SorterItem = {
  partyId: string
  /** Razón social: `saveParty` la pide en cada edición. */
  name: string
  /** Como se lo nombra. */
  displayName: string
  kind: PartyKind
  /** Para la concurrencia optimista de `saveParty`. */
  updatedAt: string
}

type Done = { accountId: string; label: string }

const STALE = 'Alguien cambió a este proveedor recién. Probá de nuevo.'

const QUIET =
  'inline-flex min-h-11 items-center gap-1.5 rounded-sm text-sm font-medium text-muted-foreground underline-offset-4 outline-none hover:text-foreground hover:underline focus-visible:ring-2 focus-visible:ring-ring md:min-h-9'

/** Hasta cuántas categorías se alcanzan con las teclas 1 a 9. */
const KEY_SLOTS = 9

/**
 * «Clasificar proveedores»: un mazo de fichas, un proveedor por vez y UN toque
 * por proveedor. Tocar una categoría guarda y pasa al siguiente; el aviso deja
 * «Deshacer». Es lo que hace llevadero ordenar 76 proveedores de una sentada
 * (antes era un diálogo con un combo del plan de cuentas por cada uno).
 *
 * Guarda lo mismo que el diálogo de un renglón: `saveParty` con
 * `defaultAccountId` (más `id`, `expectedUpdatedAt`, `kind` y `name`).
 *
 * La isla toma la cola AL MONTARSE y no la cambia aunque lleguen datos nuevos:
 * `saveParty` revalida la sección y la página se vuelve a dibujar después de
 * cada guardado; si la cola saliera de las props, cada proveedor clasificado
 * desaparecería y la lista saltaría bajo el dedo. De las props nuevas solo toma
 * la marca de versión (`updatedAt`) de los que todavía no tocó.
 *
 * Cada toque guarda: la contadora no lo ve. La página ya no lo monta sin
 * permiso de escritura (`?filtro=sin-clasificar` le muestra la lista común); la
 * guarda de acá es la segunda llave, por si alguien lo monta en otro lado.
 */
export function SupplierSorter({
  tenantSlug,
  queue,
  options,
  featured,
  usage,
  accounts,
  backHref,
  listHref,
}: {
  tenantSlug: string
  /** Los que no tienen categoría, en el orden de la libreta. */
  queue: readonly SorterItem[]
  /** Las categorías que van como botones. */
  options: readonly CategoryOption[]
  /** «Mercadería». */
  featured: readonly string[]
  /** Cuántos proveedores tienen ya cada categoría: de ahí salen «Las que más usás». */
  usage: ReadonlyArray<readonly [accountId: string, count: number]>
  /** El plan completo, para «Ver el plan completo». */
  accounts: readonly SupplierAccountOption[]
  /** La libreta. */
  backHref: string
  /** La libreta común filtrada por «sin categoría». */
  listHref: string
}) {
  const router = useRouter()
  const { readOnly } = useAccounting()
  const uid = useId()
  const cardRef = useRef<HTMLDivElement>(null)
  const queueRef = useRef<HTMLOListElement>(null)
  // La cola, congelada: lo que había al entrar.
  const [items] = useState<readonly SorterItem[]>(() => queue)
  const [done, setDone] = useState<ReadonlyMap<string, Done>>(() => new Map())
  const [index, setIndex] = useState(0)
  const [picked, setPicked] = useState<readonly string[]>([])
  const [error, setError] = useState<string | null>(null)
  const [fullPlan, setFullPlan] = useState(false)
  /** La versión de cada ficha: la que vino, o la que devolvió el último guardado. */
  const stamps = useRef(new Map(queue.map((item) => [item.partyId, item.updatedAt])))
  const mine = useRef(new Set<string>())

  // Con cada redibujo de la página llegan versiones nuevas de los que no se tocaron.
  useEffect(() => {
    for (const item of queue) {
      if (!mine.current.has(item.partyId)) stamps.current.set(item.partyId, item.updatedAt)
    }
  }, [queue])

  const current = items[index] ?? null
  const finished = items.length > 0 && done.size === items.length

  const pinned = useMemo(() => {
    const counts = new Map(usage)
    for (const id of picked) counts.set(id, (counts.get(id) ?? 0) + 1)
    return topCategories(counts, 6, new Set(featured))
  }, [usage, picked, featured])

  const suggestedId = useMemo(
    () => (current ? suggestAccount(current.name, options) : null),
    [current, options],
  )

  /** Las de arriba, en el orden en que se ven: para las teclas 1 a 9. */
  const shortcuts = useMemo(() => {
    const ids = [
      suggestedId && !featured.includes(suggestedId) ? suggestedId : null,
      ...featured,
      ...pinned,
    ].filter((id): id is string => id !== null && options.some((o) => o.id === id))
    return [...new Set(ids)].slice(0, KEY_SLOTS)
  }, [suggestedId, featured, pinned, options])

  /** El próximo sin categoría después de `from`, dando la vuelta. `-1` si no queda ninguno. */
  const nextIndex = useCallback(
    (from: number, ready: ReadonlyMap<string, Done>): number => {
      for (let step = 1; step <= items.length; step += 1) {
        const candidate = (from + step) % items.length
        const item = items[candidate]
        if (item && !ready.has(item.partyId)) return candidate
      }
      return -1
    },
    [items],
  )

  const focusCard = () => requestAnimationFrame(() => cardRef.current?.focus())

  const bringBack = (partyId: string) => {
    setDone((prev) => {
      const next = new Map(prev)
      next.delete(partyId)
      return next
    })
    const at = items.findIndex((item) => item.partyId === partyId)
    if (at >= 0) setIndex(at)
    focusCard()
  }

  const persist = async (item: SorterItem, accountId: string, label: string) => {
    try {
      const result = await saveParty(tenantSlug, {
        id: item.partyId,
        expectedUpdatedAt: stamps.current.get(item.partyId) ?? item.updatedAt,
        kind: item.kind,
        name: item.name,
        defaultAccountId: accountId,
      })
      if (!result.ok) {
        const stale = result.code === 'stale'
        bringBack(item.partyId)
        setError(stale ? STALE : (result.fieldErrors?.defaultAccountId ?? result.message))
        if (stale) {
          // La versión nueva llega con el redibujo: deja de ser «mía».
          mine.current.delete(item.partyId)
          router.refresh()
        }
        return
      }
      if (result.data.updatedAt) stamps.current.set(item.partyId, result.data.updatedAt)
      toastUndo(`${item.displayName} → ${label}`, {
        onUndo: async () => {
          try {
            const undone = await saveParty(tenantSlug, {
              id: item.partyId,
              expectedUpdatedAt: stamps.current.get(item.partyId) ?? item.updatedAt,
              kind: item.kind,
              name: item.name,
              defaultAccountId: null,
            })
            if (!undone.ok) {
              toast.error(undone.code === 'stale' ? STALE : undone.message)
              return
            }
            if (undone.data.updatedAt) stamps.current.set(item.partyId, undone.data.updatedAt)
            bringBack(item.partyId)
          } catch {
            toast.error(ACC_UNREACHABLE.offline)
          }
        },
      })
    } catch {
      bringBack(item.partyId)
      setError(ACC_UNREACHABLE.offline)
    }
  }

  const choose = (accountId: string | null, option: CategoryOption | null) => {
    if (!current || accountId === null) return
    const item = current
    const label =
      option?.shortName ?? accounts.find((a) => a.id === accountId)?.name ?? 'esa categoría'
    const ready = new Map(done).set(item.partyId, { accountId, label })
    mine.current.add(item.partyId)
    setDone(ready)
    setPicked((prev) => [...prev, accountId])
    setError(null)
    setFullPlan(false)
    const next = nextIndex(index, ready)
    if (next >= 0) setIndex(next)
    focusCard()
    void persist(item, accountId, label)
  }

  const skip = () => {
    const next = nextIndex(index, done)
    if (next >= 0 && next !== index) setIndex(next)
    setError(null)
    setFullPlan(false)
    focusCard()
  }

  const back = () => {
    // El anterior de la cola que todavía no tiene categoría.
    for (let at = index - 1; at >= 0; at -= 1) {
      const item = items[at]
      if (item && !done.has(item.partyId)) {
        setIndex(at)
        setError(null)
        setFullPlan(false)
        focusCard()
        return
      }
    }
  }

  // Teclado: 1–9 eligen las de arriba, S saltea, ← vuelve. No mientras se escribe en un campo.
  // biome-ignore lint/correctness/useExhaustiveDependencies: se rearma con lo que cambia lo que hacen las teclas
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (readOnly || event.metaKey || event.ctrlKey || event.altKey || finished || !current) return
      const target = event.target
      if (target instanceof HTMLElement) {
        if (
          target.closest('input, textarea, select, [role="combobox"], [role="dialog"], [cmdk-root]')
        ) {
          return
        }
      }
      if (/^[1-9]$/.test(event.key)) {
        const id = shortcuts[Number(event.key) - 1]
        const option = id ? options.find((o) => o.id === id) : undefined
        if (id && option) {
          event.preventDefault()
          choose(id, option)
        }
      } else if (event.key === 's' || event.key === 'S') {
        event.preventDefault()
        skip()
      } else if (event.key === 'ArrowLeft' && !(target instanceof HTMLButtonElement)) {
        event.preventDefault()
        back()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [current, finished, shortcuts, options, index, done, readOnly])

  // El actual, siempre a la vista en la cola.
  // biome-ignore lint/correctness/useExhaustiveDependencies: solo al cambiar de ficha
  useEffect(() => {
    queueRef.current
      ?.querySelector<HTMLElement>('[aria-current="true"]')
      ?.scrollIntoView({ block: 'nearest' })
  }, [index])

  if (readOnly || items.length === 0) return null

  const progress = Math.round((done.size / items.length) * 100)

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <p className="text-sm font-medium tabular-nums" aria-live="polite">
          Vas {done.size} de {items.length}
        </p>
        <div
          aria-hidden
          className="h-2 min-w-32 flex-1 overflow-hidden rounded-full bg-adm-track sm:max-w-sm"
        >
          <div
            className="h-full rounded-full bg-primary transition-[width] duration-(--duration-fast) ease-(--ease-out) motion-reduce:transition-none"
            style={{ width: `${progress}%` }}
          />
        </div>
        <Link href={listHref} className={cn(QUIET, 'ml-auto')}>
          Ver como lista
        </Link>
      </div>

      <div className="grid gap-5 lg:grid-cols-[17rem_minmax(0,1fr)] lg:items-start">
        {/* La cola: en el orden de la libreta y SIN reordenarse. Solo en la compu. */}
        <aside className="card-hairline hidden rounded-2xl border bg-card shadow-xs lg:block">
          <h2 className="border-b border-border/60 px-4 py-3 text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
            Sin categoría
          </h2>
          <ol ref={queueRef} className="max-h-[32rem] overflow-y-auto p-1.5">
            {items.map((item, at) => {
              const ready = done.get(item.partyId)
              const isCurrent = !finished && at === index
              return (
                <li key={item.partyId}>
                  <button
                    type="button"
                    disabled={Boolean(ready)}
                    aria-current={isCurrent ? 'true' : undefined}
                    onClick={() => {
                      setIndex(at)
                      setError(null)
                      setFullPlan(false)
                    }}
                    className={cn(
                      'flex w-full items-start gap-2.5 rounded-xl px-2.5 py-2 text-left outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring',
                      isCurrent ? 'bg-accent' : 'hover:bg-secondary/60',
                      ready && 'hover:bg-transparent',
                    )}
                  >
                    <span
                      aria-hidden
                      className={cn(
                        'mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full border',
                        ready
                          ? 'border-success/40 bg-success/12 text-success'
                          : isCurrent
                            ? 'border-primary bg-primary'
                            : 'border-border bg-card',
                      )}
                    >
                      {ready ? <Check className="size-3" strokeWidth={3} /> : null}
                    </span>
                    <span className="min-w-0">
                      <span
                        className={cn(
                          'block truncate text-sm',
                          isCurrent ? 'font-semibold' : ready ? 'text-muted-foreground' : '',
                        )}
                      >
                        {item.displayName}
                      </span>
                      {ready ? (
                        <span className="block truncate text-xs text-muted-foreground">
                          {ready.label}
                        </span>
                      ) : null}
                    </span>
                  </button>
                </li>
              )
            })}
          </ol>
        </aside>

        {finished ? (
          <div className="card-hairline flex flex-col items-start gap-4 rounded-2xl border bg-card p-5 shadow-xs sm:p-8">
            <span className="flex size-14 items-center justify-center rounded-full bg-success/12 text-success">
              <svg viewBox="0 0 24 24" aria-hidden="true" className="size-8" fill="none">
                <path
                  d="M5 12.5l4.5 4.5L19 7.5"
                  stroke="currentColor"
                  strokeWidth="2.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  className="adm-tick adm-tick-draw"
                />
              </svg>
            </span>
            <div>
              <p className="font-serif text-2xl font-semibold leading-tight tracking-tight text-balance">
                Listo: todos tus proveedores tienen categoría.
              </p>
              <p className="mt-1.5 max-w-prose text-sm leading-relaxed text-muted-foreground text-pretty">
                Cada vez que les cargues algo, ya sale solo en qué fue. Si te equivocaste con
                alguno, lo cambiás desde su renglón de la libreta.
              </p>
            </div>
            <Button asChild className="h-12 rounded-full px-6">
              <Link href={backHref}>
                <ArrowLeft aria-hidden className="size-4" />
                Volver a la libreta
              </Link>
            </Button>
          </div>
        ) : current ? (
          <div
            ref={cardRef}
            tabIndex={-1}
            className="card-hairline rounded-2xl border bg-card p-5 shadow-xs outline-none sm:p-6"
          >
            <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-muted-foreground">
              Proveedor {index + 1} de {items.length}
            </p>
            <h2 className="mt-1 font-serif text-2xl font-semibold leading-tight tracking-tight text-balance [overflow-wrap:anywhere]">
              {current.displayName}
            </h2>
            <p
              id={`${uid}-pregunta`}
              className="mt-4 font-serif text-lg font-semibold tracking-tight"
            >
              ¿En qué le comprás?
            </p>
            <p className="mt-0.5 text-sm text-muted-foreground text-pretty">
              Tocá una y pasamos al siguiente. Queda en su ficha.
            </p>
            <div className="mt-4">
              <CategoryPicker
                key={current.partyId}
                id={`${uid}-categoria`}
                aria-labelledby={`${uid}-pregunta`}
                size="touch"
                options={options}
                featured={featured}
                pinned={pinned}
                suggestedId={suggestedId}
                value={null}
                invalid={Boolean(error)}
                onChange={choose}
                onOpenFullPlan={() => setFullPlan(true)}
              />
            </div>
            {fullPlan ? (
              <div className="mt-3 grid gap-1.5 rounded-xl bg-secondary/50 p-3">
                <p className="text-xs text-muted-foreground">
                  El plan completo, para una cuenta que no está entre los botones.
                </p>
                <AccountCombobox
                  id={`${uid}-plan`}
                  aria-label="Buscar en el plan completo"
                  value={null}
                  onValueChange={(id) => choose(id, null)}
                  accounts={accounts}
                  placeholder="Buscar una cuenta"
                />
              </div>
            ) : null}
            {error ? (
              <p role="alert" className="mt-3 text-sm text-destructive">
                {error}
              </p>
            ) : null}
            <div className="mt-5 flex flex-wrap items-center justify-between gap-x-4 gap-y-1 border-t border-border/60 pt-3">
              <button type="button" onClick={skip} className={QUIET}>
                <SkipForward aria-hidden className="size-3.5" />
                Saltear
              </button>
              <p className="hidden text-xs text-muted-foreground lg:block">
                Con el teclado: 1 a 9 eligen las de arriba · S saltea · ← vuelve
              </p>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  )
}
