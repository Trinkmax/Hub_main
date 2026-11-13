'use client'

import {
  ChevronLeft,
  CornerDownLeft,
  Ellipsis,
  Minus,
  Plus,
  Repeat2,
  Search,
  WifiOff,
  X,
} from 'lucide-react'
import { useDeferredValue, useEffect, useMemo, useRef, useState } from 'react'
import { formatCentsShort } from '@/lib/money/format'
import {
  buildBrowseTree,
  categoryLabel,
  firstAddable,
  type MenuIndex,
  quickPicks,
  searchMenu,
  sectionsOf,
} from '@/lib/pos/order/menu-index'
import { type Round, roundLabel } from '@/lib/pos/order/repeat-round'
import type { MenuItem } from '@/lib/pos/types'
import { cn } from '@/lib/utils'
import { useLongPress } from './use-long-press'

/**
 * La carta para cargar: lo que hace rápida a la pantalla.
 *
 * Primero el buscador (sin acentos, por nombre o por categoría; Enter agrega el primero). Sin
 * escribir nada: lo que más sale a esta hora, repetir la última ronda de un toque y las fichas de
 * categoría para recorrer. Cada producto se agrega con un toque; mantenerlo apretado (o «⋯») lo
 * marca agotado.
 */

const QUICK_COUNT = 6
const RESULT_LIMIT = 40

type RowActions = {
  onAdd: (item: MenuItem) => void
  onDec: (item: MenuItem) => void
  /** Agotado / volvió a haber. */
  onMenu: (item: MenuItem) => void
}

type Props = RowActions & {
  index: MenuIndex
  /** Cuántos hay de cada producto en la tanda que se está armando. */
  quantities: ReadonlyMap<string, number>
  round: Round | null
  tableTitle: string
  offline: boolean
  searchRef: React.RefObject<HTMLInputElement | null>
  onRepeat: () => void
  /** Volver a la comanda (en el celular, donde la carta la tapa). */
  onClose: () => void
  /** Lo que va pegado abajo en el celular: el resumen del pedido y el botón de enviar. */
  tray: React.ReactNode
}

export function ProductPicker({
  index,
  quantities,
  round,
  tableTitle,
  offline,
  searchRef,
  onAdd,
  onDec,
  onMenu,
  onRepeat,
  onClose,
  tray,
}: Props) {
  const [query, setQuery] = useState('')
  const [rootKey, setRootKey] = useState<string | null>(null)
  const [subKey, setSubKey] = useState<string | null>(null)
  const [justRepeated, setJustRepeated] = useState(false)
  const scrollRef = useRef<HTMLDivElement>(null)
  const catsRef = useRef<HTMLDivElement>(null)

  const deferred = useDeferredValue(query)
  const searching = deferred.trim().length > 0
  const results = useMemo(() => searchMenu(index, deferred, RESULT_LIMIT), [index, deferred])
  const enterTarget = useMemo(() => firstAddable(results), [results])
  const picks = useMemo(() => quickPicks(index, QUICK_COUNT), [index])
  const tree = useMemo(() => buildBrowseTree(index), [index])

  const root = tree.find((node) => node.key === rootKey) ?? null
  const sub = root?.children.find((node) => node.key === subKey) ?? null
  const shown = sub ?? root
  const sections = useMemo(() => (shown ? sectionsOf(shown) : []), [shown])

  useEffect(() => {
    if (!justRepeated) return
    const timer = window.setTimeout(() => setJustRepeated(false), 1400)
    return () => window.clearTimeout(timer)
  }, [justRepeated])

  const pinCategories = () => {
    // Las fichas suben hasta arriba y la categoría se queda con todo el alto.
    window.requestAnimationFrame(() => {
      const scroller = scrollRef.current
      const cats = catsRef.current
      if (!scroller || !cats) return
      const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches
      scroller.scrollTo({ top: cats.offsetTop, behavior: reduce ? 'auto' : 'smooth' })
    })
  }

  const chooseRoot = (key: string) => {
    setSubKey(null)
    setRootKey((current) => (current === key ? null : key))
    if (rootKey !== key) pinCategories()
    // Con el teclado abierto no se ve la categoría: se cierra.
    searchRef.current?.blur()
  }
  const chooseSub = (key: string) => {
    setSubKey((current) => (current === key ? null : key))
    pinCategories()
  }

  const submit = (event: React.FormEvent) => {
    event.preventDefault()
    // Con lo que está escrito AHORA (la lista puede venir un instante atrás de los dedos).
    const first = firstAddable(searchMenu(index, query, RESULT_LIMIT))
    if (!first) return
    onAdd(first)
    // Lo escrito queda seleccionado: lo próximo que se escriba lo reemplaza.
    searchRef.current?.select()
  }

  const clear = () => {
    setQuery('')
    searchRef.current?.focus()
  }

  const typing = () => document.activeElement === searchRef.current
  const actions: RowActions = {
    onAdd: (item) => {
      onAdd(item)
      // Si venía escribiendo, lo escrito queda seleccionado: el teclado sigue abierto y lo próximo
      // que escriba lo reemplaza (y si quería dos, vuelve a tocar el «+»).
      const input = searchRef.current
      if (input?.value && typing()) input.select()
    },
    onDec,
    onMenu,
  }

  return (
    <aside className="cmd-picker" aria-label="Carta" data-testid="picker">
      <form className="cmd-picker-head" onSubmit={submit}>
        <button
          type="button"
          className="cmd-back cmd-picker-back"
          onClick={onClose}
          aria-label={`Volver a la ${tableTitle.toLowerCase()}`}
          data-testid="picker-back"
        >
          <ChevronLeft aria-hidden strokeWidth={2.4} />
        </button>
        <label className="cmd-search">
          <Search aria-hidden strokeWidth={2.4} />
          <span className="sr-only">Buscar en la carta</span>
          <input
            ref={searchRef}
            type="search"
            value={query}
            onChange={(event) => {
              setQuery(event.target.value)
              // Al cambiar lo que se busca, la lista vuelve arriba.
              scrollRef.current?.scrollTo({ top: 0 })
            }}
            onKeyDown={(event) => {
              if (event.key !== 'Escape') return
              event.preventDefault()
              if (query) setQuery('')
              else onClose()
            }}
            placeholder="Buscar en la carta"
            enterKeyHint="go"
            autoComplete="off"
            autoCorrect="off"
            autoCapitalize="none"
            spellCheck={false}
            data-testid="picker-search"
          />
          {query ? (
            <button
              type="button"
              className="cmd-search-clear"
              onClick={clear}
              aria-label="Borrar lo escrito"
            >
              <X aria-hidden strokeWidth={2.4} />
            </button>
          ) : null}
        </label>
      </form>

      {offline ? (
        <p className="cmd-picker-off" role="status">
          <WifiOff aria-hidden />
          Sin conexión. Seguí cargando: se envía solo cuando vuelva.
        </p>
      ) : null}

      {/* biome-ignore lint/a11y/noStaticElementInteractions: no es un control; solo cuida el teclado del celular */}
      <div
        className="cmd-picker-scroll"
        ref={scrollRef}
        // Tocar un producto no le saca el foco al buscador: el teclado no se cierra y se abre en cada uno.
        onMouseDown={(event) => {
          const target = event.target instanceof Element ? event.target : null
          if (typing() && target?.closest('.cmd-prod, .cmd-tile, .cmd-round'))
            event.preventDefault()
        }}
        // Arrastrar la lista sí lo cierra, para ver lo que tapaba.
        onTouchMove={() => {
          if (typing()) searchRef.current?.blur()
        }}
      >
        {searching ? (
          results.length > 0 ? (
            <ul className="cmd-rows" aria-label="Resultados" data-testid="picker-results">
              {results.map((item) => (
                <ProductRow
                  key={item.id}
                  item={item}
                  quantity={quantities.get(item.id) ?? 0}
                  path={categoryLabel(index, item.category_id)}
                  enter={item.id === enterTarget?.id}
                  {...actions}
                />
              ))}
            </ul>
          ) : (
            <div className="cmd-hint" data-testid="picker-empty">
              <p>
                No encontré <b>«{deferred.trim()}»</b> en la carta.
              </p>
              <p>Probá con otra palabra, o borrá lo escrito para recorrerla por categoría.</p>
            </div>
          )
        ) : (
          <>
            {picks.items.length > 0 ? (
              <section className="cmd-sec" aria-labelledby="cmd-quick-h">
                <h2 className="cmd-h" id="cmd-quick-h">
                  {picks.source === 'popular' ? 'Lo que más sale ahora' : 'Para empezar'}
                </h2>
                <ul className="cmd-tiles">
                  {picks.items.map((item) => (
                    <QuickTile
                      key={item.id}
                      item={item}
                      quantity={quantities.get(item.id) ?? 0}
                      {...actions}
                    />
                  ))}
                </ul>
              </section>
            ) : null}

            {round ? (
              <button
                type="button"
                className="cmd-round"
                onClick={() => {
                  if (justRepeated) return
                  setJustRepeated(true)
                  onRepeat()
                }}
                aria-disabled={justRepeated || undefined}
                data-testid="repeat-round"
              >
                <Repeat2 aria-hidden strokeWidth={2.4} />
                <span>
                  <b>{justRepeated ? 'Ronda agregada' : 'Repetir la ronda'}</b>
                  <small>{roundLabel(round)}</small>
                </span>
                <i aria-hidden>
                  <Plus strokeWidth={2.8} />
                </i>
              </button>
            ) : null}

            {tree.length > 0 ? (
              <>
                <div className="cmd-cats" ref={catsRef}>
                  <ul className="cmd-chips" aria-label="Categorías de la carta">
                    {tree.map((node) => (
                      <li key={node.key}>
                        <button
                          type="button"
                          className="cmd-chip"
                          aria-pressed={node.key === rootKey}
                          onClick={() => chooseRoot(node.key)}
                          data-testid={`cat-${node.key}`}
                        >
                          <span>{node.name}</span>
                        </button>
                      </li>
                    ))}
                  </ul>
                  {root && root.children.length > 0 ? (
                    <ul className="cmd-chips is-sub" aria-label={`Dentro de ${root.name}`}>
                      {root.children.map((node) => (
                        <li key={node.key}>
                          <button
                            type="button"
                            className="cmd-chip"
                            aria-pressed={node.key === subKey}
                            onClick={() => chooseSub(node.key)}
                            data-testid={`cat-${node.key}`}
                          >
                            <span>{node.name}</span>
                          </button>
                        </li>
                      ))}
                    </ul>
                  ) : null}
                </div>

                <div className="cmd-cat-body">
                  {root ? (
                    sections.map((section) => (
                      <section key={section.key}>
                        {section.heading ? (
                          <h3 className="cmd-h is-sub">{section.heading}</h3>
                        ) : null}
                        <ul className="cmd-rows">
                          {section.items.map((item) => (
                            <ProductRow
                              key={item.id}
                              item={item}
                              quantity={quantities.get(item.id) ?? 0}
                              path={null}
                              enter={false}
                              {...actions}
                            />
                          ))}
                        </ul>
                      </section>
                    ))
                  ) : (
                    <p className="cmd-hint">
                      Elegí una categoría para recorrer la carta, o escribí arriba lo que piden.
                      Para marcar algo <b>agotado</b>, mantenelo apretado.
                    </p>
                  )}
                </div>
              </>
            ) : (
              <p className="cmd-hint">
                La carta de esta sucursal está vacía. Cargala desde el panel y aparece acá.
              </p>
            )}
          </>
        )}
      </div>

      {tray}
    </aside>
  )
}

function ProductRow({
  item,
  quantity,
  path,
  enter,
  onAdd,
  onDec,
  onMenu,
}: RowActions & {
  item: MenuItem
  quantity: number
  /** «Comida › Pizza»: solo en los resultados de la búsqueda. */
  path: string | null
  /** Es el que agrega Enter. */
  enter: boolean
}) {
  const press = useLongPress(() => onMenu(item))
  const tap = () => {
    if (press.consume()) return
    // Lo agotado no se agrega: tocarlo abre de dónde se levanta.
    if (item.sold_out) onMenu(item)
    else onAdd(item)
  }
  return (
    <li className={cn('cmd-prod', quantity > 0 && 'has-qty', item.sold_out && 'is-out')}>
      <button
        type="button"
        className="cmd-prod-main"
        onClick={tap}
        {...press.handlers}
        data-testid={`product-${item.id}`}
      >
        <span className="cmd-prod-name">
          {item.name}
          {enter ? (
            <span className="cmd-enter" aria-hidden>
              <CornerDownLeft strokeWidth={2.6} />
              Enter
            </span>
          ) : null}
        </span>
        <span className="cmd-prod-sub">
          {item.sold_out ? (
            <em className="cmd-out">Agotado</em>
          ) : (
            <b>{formatCentsShort(item.price_cents)}</b>
          )}
          {path ? ` · ${path}` : null}
        </span>
      </button>

      {quantity > 0 ? (
        <>
          <button
            type="button"
            className="cmd-step"
            onClick={() => onDec(item)}
            aria-label={`Uno menos de ${item.name}`}
          >
            <Minus aria-hidden />
          </button>
          <span className="cmd-prod-qty cmd-bump" key={quantity}>
            {quantity}
            <span className="sr-only"> en el pedido</span>
          </span>
        </>
      ) : (
        <button
          type="button"
          className="cmd-more"
          onClick={() => onMenu(item)}
          aria-label={`Más opciones de ${item.name}`}
        >
          <Ellipsis aria-hidden />
        </button>
      )}

      {item.sold_out ? null : (
        <button
          type="button"
          className="cmd-step is-plus"
          onClick={() => onAdd(item)}
          aria-label={`Agregar ${item.name}`}
          data-testid={`plus-${item.id}`}
        >
          <Plus aria-hidden strokeWidth={2.6} />
        </button>
      )}
    </li>
  )
}

function QuickTile({
  item,
  quantity,
  onAdd,
  onDec,
  onMenu,
}: RowActions & { item: MenuItem; quantity: number }) {
  const press = useLongPress(() => onMenu(item))
  const tap = () => {
    if (press.consume()) return
    if (item.sold_out) onMenu(item)
    else onAdd(item)
  }
  return (
    <li className={cn('cmd-tile', quantity > 0 && 'has-qty', item.sold_out && 'is-out')}>
      <button
        type="button"
        className="cmd-tile-main"
        onClick={tap}
        {...press.handlers}
        data-testid={`tile-${item.id}`}
      >
        <span className="cmd-tile-name">{item.name}</span>
        {item.sold_out ? (
          <em className="cmd-out">Agotado</em>
        ) : (
          <span className="cmd-tile-price">{formatCentsShort(item.price_cents)}</span>
        )}
        {quantity > 0 ? (
          <span className="cmd-badge cmd-bump" key={quantity}>
            {quantity}
            <span className="sr-only"> en el pedido</span>
          </span>
        ) : null}
      </button>
      {quantity > 0 ? (
        <button
          type="button"
          className="cmd-tile-minus"
          onClick={() => onDec(item)}
          aria-label={`Uno menos de ${item.name}`}
        >
          <Minus aria-hidden />
        </button>
      ) : null}
    </li>
  )
}
