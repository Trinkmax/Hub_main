'use client'

import { Plus, Search, Trash2, X } from 'lucide-react'
import { type FormEvent, useMemo, useState } from 'react'
import { StatusPill } from '@/components/administracion/kit/status-pill'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import {
  availableTemplates,
  byGroupOrder,
  type GroupReach,
  type GroupTemplate,
  groupReach,
  groupStatus,
  linkedTargets,
  nextPosition,
  optionsOf,
  productsWithChoices,
  RULES,
  type RuleId,
  ruleById,
  ruleOf,
} from '@/lib/menu/kitchen/modifiers'
import { moveBy } from '@/lib/menu/kitchen/order'
import { type CartaTree, cartaTree, pathLabel, productsLabel } from '@/lib/menu/kitchen/routing'
import {
  GROUP_NAME_MAX,
  MAX_GROUPS,
  MAX_OPTIONS,
  OPTION_LABEL_MAX,
} from '@/lib/menu/kitchen/schemas'
import { buildCartaIndex, type CartaIndex, searchCarta } from '@/lib/menu/kitchen/search'
import {
  linkKey,
  type ModifierGroup,
  type ModifierLink,
  type ModifierOption,
} from '@/lib/menu/kitchen/types'
import { cn } from '@/lib/utils'
import { ExtraPriceField, InlineText } from './inline-fields'
import { SHEET } from './route-tree'
import { DragGrip, MoveButtons, SortableList, useSortableRow } from './sortable'
import type { KitchenWrites } from './use-kitchen-writes'

const FIELD =
  'h-11 w-full min-w-0 rounded-lg border border-input bg-background/60 px-3 text-base outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/40 aria-invalid:border-destructive sm:h-10 sm:text-sm'

const clean = (text: string) => text.trim().replace(/\s+/g, ' ')
const plain = (text: string) => clean(text).toLocaleLowerCase('es')

/**
 * Las aclaraciones: lo que el mozo le puede tocar a un producto al cargarlo («Punto de la carne»,
 * «¿Qué le sacamos?», «Extras»). Cada una es una pregunta con sus opciones, y se ofrece en las
 * categorías o los productos que se elijan (una categoría la pasa a todo lo que tiene adentro).
 *
 * El mozo la ve solo si está prendida, tiene al menos una opción y está puesta en algo que se
 * vende: el estado de cada una lo dice en una palabra.
 */
export function ChoicesPane({ writes }: { writes: KitchenWrites }) {
  const { view, commit } = writes
  const groups = useMemo(() => [...view.groups].sort(byGroupOrder), [view.groups])
  const ids = groups.map((group) => group.id)
  const reach = useMemo(() => groupReach(view), [view])
  const tree = useMemo(() => cartaTree(view.categories, view.items), [view.categories, view.items])
  const index = useMemo(() => buildCartaIndex(tree), [tree])
  const withChoices = productsWithChoices(view, reach)
  const templates = availableTemplates(view.groups)
  const full = groups.length >= MAX_GROUPS

  const [name, setName] = useState('')
  const [problem, setProblem] = useState<string | null>(null)

  const taken = (candidate: string, exceptId?: string) =>
    groups.some((group) => group.id !== exceptId && plain(group.name) === plain(candidate))

  const create = (label: string, rule: RuleId, optionLabels: ReadonlyArray<string>) => {
    const text = clean(label)
    if (text === '') return 'Escribí la pregunta: «Punto de la carne», «Extras»…'
    if (text.length > GROUP_NAME_MAX) return `Entra en ${GROUP_NAME_MAX} letras.`
    if (taken(text)) return `Ya hay una que se llama «${text}».`
    if (full) return `Entran hasta ${MAX_GROUPS}.`
    const chosen = ruleById(rule)
    const group: ModifierGroup = {
      id: crypto.randomUUID(),
      name: text,
      selection: chosen.selection,
      required: chosen.required,
      position: nextPosition(view.groups),
      active: true,
    }
    const options: ModifierOption[] = optionLabels.map((optionLabel, position) => ({
      id: crypto.randomUUID(),
      groupId: group.id,
      label: optionLabel,
      priceDeltaCents: 0,
      position,
      active: true,
    }))
    commit(
      { type: 'group.create', group, options, links: [] },
      { say: `Nueva: ${text}. Ahora elegí en qué productos se ofrece` },
    )
    return null
  }

  const submit = (event: FormEvent) => {
    event.preventDefault()
    const why = create(name, 'many_optional', [])
    setProblem(why)
    if (why === null) setName('')
  }

  const addTemplate = (template: GroupTemplate) =>
    setProblem(create(template.name, template.rule, template.options))

  return (
    <div className="space-y-6" data-testid="aclaraciones">
      <p className="max-w-prose text-pretty">
        <span className="font-serif text-4xl font-semibold leading-none tracking-tight tabular-nums">
          {withChoices}
        </span>{' '}
        <span className="text-lg font-medium">
          {withChoices === 1 ? 'producto tiene' : 'productos tienen'} algo para aclarar.
        </span>
        <span className="mt-1 block text-sm text-muted-foreground">
          Es lo que el mozo toca al cargarlo, y lo que cocina lee en la comanda.
        </span>
      </p>

      {groups.length > 0 ? (
        <SortableList
          id="aclaraciones"
          ids={ids}
          nameOf={(id) => groups.find((group) => group.id === id)?.name ?? 'la aclaración'}
          onReorder={(next) =>
            commit(
              { type: 'group.order', ids: next },
              { say: 'Aclaraciones reordenadas', toastId: 'orden-grupos' },
            )
          }
        >
          <ul className="space-y-4">
            {groups.map((group, position) => (
              <GroupCard
                key={group.id}
                group={group}
                writes={writes}
                reach={reach}
                index={index}
                canUp={position > 0}
                canDown={position < groups.length - 1}
                nameTaken={(candidate) => taken(candidate, group.id)}
                onMove={(delta) =>
                  commit(
                    { type: 'group.order', ids: moveBy(ids, group.id, delta) },
                    { say: 'Aclaraciones reordenadas', toastId: 'orden-grupos' },
                  )
                }
                tree={tree}
              />
            ))}
          </ul>
        </SortableList>
      ) : null}

      <section className={cn(SHEET, 'space-y-3 p-4 sm:p-5')}>
        <h2 className="font-serif text-lg font-semibold leading-snug tracking-tight">
          {groups.length === 0 ? 'La primera aclaración' : 'Agregar otra'}
        </h2>
        {templates.length > 0 && !full ? (
          <div className="space-y-2">
            <p className="text-sm text-muted-foreground">Las que casi todo bar pregunta:</p>
            <div className="flex flex-wrap gap-2">
              {templates.map((template) => (
                <button
                  key={template.key}
                  type="button"
                  title={template.hint}
                  onClick={() => addTemplate(template)}
                  data-testid={`plantilla-${template.key}`}
                  className="inline-flex min-h-11 flex-col items-start justify-center rounded-xl border border-border px-3.5 py-2 text-left outline-none transition-colors hover:bg-secondary focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <span className="text-sm font-medium">{template.name}</span>
                  <span className="text-xs text-muted-foreground">
                    {template.options.join(' · ')}
                  </span>
                </button>
              ))}
            </div>
          </div>
        ) : null}
        <form onSubmit={submit} className="space-y-2">
          <label htmlFor="aclaracion-nueva" className="text-sm font-medium">
            O escribí la tuya
          </label>
          <div className="flex gap-2">
            <input
              id="aclaracion-nueva"
              value={name}
              onChange={(event) => {
                setName(event.target.value)
                if (problem) setProblem(null)
              }}
              maxLength={GROUP_NAME_MAX}
              autoComplete="off"
              disabled={full}
              placeholder="Por ejemplo: Gusto del licuado"
              aria-invalid={problem ? true : undefined}
              aria-describedby={problem ? 'aclaracion-nueva-error' : undefined}
              data-testid="aclaracion-nueva"
              className={FIELD}
            />
            <Button type="submit" disabled={full} data-testid="aclaracion-agregar">
              <Plus aria-hidden className="size-4" />
              Agregar
            </Button>
          </div>
          {problem ? (
            <p id="aclaracion-nueva-error" role="alert" className="text-sm text-destructive">
              {problem}
            </p>
          ) : null}
        </form>
      </section>
    </div>
  )
}

function GroupCard({
  group,
  writes,
  reach,
  index,
  canUp,
  canDown,
  nameTaken,
  onMove,
  tree,
}: {
  group: ModifierGroup
  writes: KitchenWrites
  reach: GroupReach
  index: CartaIndex
  canUp: boolean
  canDown: boolean
  nameTaken: (candidate: string) => boolean
  onMove: (delta: -1 | 1) => void
  tree: CartaTree
}) {
  const { view, commit } = writes
  const row = useSortableRow(group.id)
  const options = optionsOf(view.options, group.id)
  const optionIds = options.map((option) => option.id)
  const status = groupStatus(group, view.options, reach)
  const rule = ruleOf(group)
  const targets = linkedTargets(view, group.id)
  const [asking, setAsking] = useState(false)
  const [label, setLabel] = useState('')
  const [optionProblem, setOptionProblem] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const fullOptions = options.length >= MAX_OPTIONS

  const addOption = (event: FormEvent) => {
    event.preventDefault()
    const text = clean(label)
    if (text === '') return
    if (text.length > OPTION_LABEL_MAX) {
      setOptionProblem(`Entra en ${OPTION_LABEL_MAX} letras.`)
      return
    }
    if (options.some((option) => plain(option.label) === plain(text))) {
      setOptionProblem(`«${text}» ya está en la lista.`)
      return
    }
    commit(
      {
        type: 'option.create',
        option: {
          id: crypto.randomUUID(),
          groupId: group.id,
          label: text,
          priceDeltaCents: 0,
          position: nextPosition(options),
          active: true,
        },
      },
      { say: `${group.name}: se sumó «${text}»`, toastId: `opcion:${group.id}` },
    )
    setLabel('')
    setOptionProblem(null)
  }

  const setLinked = (link: ModifierLink, linked: boolean, targetName: string) =>
    commit(
      { type: 'link.set', link, linked },
      {
        say: linked
          ? `${group.name} se ofrece en ${targetName}`
          : `${group.name} ya no se ofrece en ${targetName}`,
        toastId: `enganche:${group.id}`,
      },
    )

  const hits = useMemo(() => searchCarta(index, query), [index, query])
  const suggestions = useMemo(() => {
    if (!hits) return []
    const linked = new Set(
      view.links.filter((link) => link.groupId === group.id).map((link) => linkKey(link)),
    )
    const categoryById = new Map(view.categories.map((category) => [category.id, category]))
    const itemById = new Map(view.items.map((item) => [item.id, item]))
    const out: Array<{ link: ModifierLink; name: string; context: string }> = []
    for (const id of hits.categories) {
      const category = categoryById.get(id)
      if (!category) continue
      out.push({
        link: { groupId: group.id, target: 'category', targetId: id },
        name: category.name,
        context: category.parentId ? pathLabel(tree, category.parentId) : '',
      })
    }
    for (const id of hits.items) {
      const item = itemById.get(id)
      if (!item) continue
      out.push({
        link: { groupId: group.id, target: 'item', targetId: id },
        name: item.name,
        context: pathLabel(tree, item.categoryId) || 'Sin categoría',
      })
    }
    return out.filter((entry) => !linked.has(linkKey(entry.link))).slice(0, 8)
  }, [hits, view.categories, view.items, view.links, group.id, tree])

  return (
    <li
      ref={row.setNodeRef}
      style={row.style}
      data-testid={`aclaracion-${group.name}`}
      className={cn(SHEET, 'space-y-4 p-3 sm:p-5', row.dragging && 'shadow-md')}
    >
      <div className="flex items-center gap-1.5">
        <DragGrip row={row} label={`Reordenar ${group.name}`} />
        <InlineText
          value={group.name}
          label={`Nombre de la aclaración ${group.name}`}
          maxLength={GROUP_NAME_MAX}
          check={(next) => (nameTaken(next) ? `Ya hay una que se llama «${next}».` : null)}
          error={writes.errors[`group:${group.id}`]}
          onCommit={(next) =>
            commit(
              { type: 'group.patch', id: group.id, patch: { name: next } },
              { say: `${group.name} ahora se llama ${next}` },
            )
          }
          className="min-w-0 flex-1"
        />
        <Switch
          checked={group.active}
          aria-label={`${group.name} prendida`}
          onCheckedChange={(active) =>
            commit(
              { type: 'group.patch', id: group.id, patch: { active } },
              {
                say: active
                  ? `${group.name}: el mozo la vuelve a ver`
                  : `${group.name} quedó apagada: el mozo no la ve`,
              },
            )
          }
        />
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {status.kind === 'ready' ? (
          <StatusPill tone="ok">La ven {productsLabel(status.products)}</StatusPill>
        ) : status.kind === 'off' ? (
          <StatusPill tone="muted">Apagada</StatusPill>
        ) : status.kind === 'no_options' ? (
          <StatusPill tone="warn">Le faltan opciones</StatusPill>
        ) : (
          <StatusPill tone="warn">Todavía no se ofrece en nada</StatusPill>
        )}
        <MoveButtons name={group.name} canUp={canUp} canDown={canDown} onMove={onMove} />
      </div>

      <fieldset>
        <legend className="text-sm font-medium">¿Cómo se elige?</legend>
        <div className="mt-2 flex flex-wrap gap-2">
          {RULES.map((option) => {
            const chosen = option.id === rule.id
            return (
              <button
                key={option.id}
                type="button"
                aria-pressed={chosen}
                onClick={() => {
                  if (chosen) return
                  commit(
                    {
                      type: 'group.patch',
                      id: group.id,
                      patch: { selection: option.selection, required: option.required },
                    },
                    { say: `${group.name}: ${option.label.toLocaleLowerCase('es')}` },
                  )
                }}
                className={cn(
                  'inline-flex h-9 items-center rounded-full border px-3 text-sm outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring pointer-coarse:h-11',
                  chosen
                    ? 'border-foreground bg-foreground text-background'
                    : 'border-border hover:bg-secondary',
                )}
              >
                {option.label}
              </button>
            )
          })}
        </div>
        <p className="mt-2 text-sm text-muted-foreground text-pretty">{rule.hint}</p>
      </fieldset>

      <div className="space-y-2">
        <h3 className="text-sm font-medium">Opciones</h3>
        {options.length > 0 ? (
          <SortableList
            id={`opciones-${group.id}`}
            ids={optionIds}
            nameOf={(id) => options.find((option) => option.id === id)?.label ?? 'la opción'}
            onReorder={(next) =>
              commit(
                { type: 'option.order', groupId: group.id, ids: next },
                {
                  say: `${group.name}: opciones reordenadas`,
                  toastId: `orden-opciones:${group.id}`,
                },
              )
            }
          >
            <ul className="divide-y divide-border/60 rounded-xl border border-border/70">
              {options.map((option, position) => (
                <OptionRow
                  key={option.id}
                  option={option}
                  error={writes.errors[`option:${option.id}`]}
                  canUp={position > 0}
                  canDown={position < options.length - 1}
                  labelTaken={(candidate) =>
                    options.some(
                      (other) => other.id !== option.id && plain(other.label) === plain(candidate),
                    )
                  }
                  onLabel={(next) =>
                    commit(
                      { type: 'option.patch', id: option.id, patch: { label: next } },
                      { say: `«${option.label}» ahora es «${next}»` },
                    )
                  }
                  onPrice={(cents) =>
                    commit(
                      { type: 'option.patch', id: option.id, patch: { priceDeltaCents: cents } },
                      {
                        say:
                          cents === 0
                            ? `«${option.label}» ya no suma al precio`
                            : `«${option.label}»: precio extra guardado`,
                        toastId: `precio:${option.id}`,
                      },
                    )
                  }
                  onMove={(delta) =>
                    commit(
                      {
                        type: 'option.order',
                        groupId: group.id,
                        ids: moveBy(optionIds, option.id, delta),
                      },
                      {
                        say: `${group.name}: opciones reordenadas`,
                        toastId: `orden-opciones:${group.id}`,
                      },
                    )
                  }
                  onDelete={() =>
                    commit(
                      { type: 'option.delete', id: option.id },
                      { say: `${group.name}: se sacó «${option.label}»` },
                    )
                  }
                />
              ))}
            </ul>
          </SortableList>
        ) : (
          <p className="text-sm text-muted-foreground">
            Sin opciones el mozo no la ve. Agregá la primera.
          </p>
        )}
        <form onSubmit={addOption} className="flex gap-2">
          <input
            value={label}
            onChange={(event) => {
              setLabel(event.target.value)
              if (optionProblem) setOptionProblem(null)
            }}
            maxLength={OPTION_LABEL_MAX}
            autoComplete="off"
            disabled={fullOptions}
            placeholder="Agregar una opción"
            aria-label={`Agregar una opción a ${group.name}`}
            aria-invalid={optionProblem ? true : undefined}
            data-testid="opcion-nueva"
            className={FIELD}
          />
          <Button type="submit" variant="outline" disabled={fullOptions || clean(label) === ''}>
            <Plus aria-hidden className="size-4" />
            Sumar
          </Button>
        </form>
        {optionProblem ? (
          <p role="alert" className="text-sm text-destructive">
            {optionProblem}
          </p>
        ) : null}
      </div>

      <div className="space-y-2">
        <h3 className="text-sm font-medium">Se ofrece en</h3>
        {targets.length > 0 ? (
          <ul className="flex flex-wrap gap-2">
            {targets.map((target) => (
              <li
                key={`${target.target}:${target.id}`}
                className="inline-flex items-center gap-1 rounded-full border border-border py-1 pl-3 pr-1 text-sm"
              >
                <span className="min-w-0">
                  <span className="font-medium">{target.name}</span>
                  <span className="ml-1.5 text-xs text-muted-foreground">
                    {target.target === 'category' ? 'toda la categoría' : target.context}
                    {target.paused ? ' · en pausa' : ''}
                  </span>
                </span>
                <button
                  type="button"
                  aria-label={`Dejar de ofrecer ${group.name} en ${target.name}`}
                  onClick={() =>
                    setLinked(
                      { groupId: group.id, target: target.target, targetId: target.id },
                      false,
                      target.name,
                    )
                  }
                  className="flex size-7 items-center justify-center rounded-full text-muted-foreground outline-none hover:bg-secondary hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring pointer-coarse:size-9"
                >
                  <X aria-hidden className="size-3.5" />
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-muted-foreground">
            En ningún lado todavía. Buscá una categoría (vale para todo lo que tiene adentro) o un
            producto suelto.
          </p>
        )}
        <div className="relative">
          <Search
            aria-hidden
            className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
          />
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Buscar una categoría o un producto"
            aria-label={`Buscar dónde ofrecer ${group.name}`}
            data-testid="enganche-buscar"
            className={cn(FIELD, 'pl-9 [&::-webkit-search-cancel-button]:hidden')}
          />
        </div>
        {hits ? (
          suggestions.length > 0 ? (
            <ul className="divide-y divide-border/60 rounded-xl border border-border/70">
              {suggestions.map((entry) => (
                <li key={linkKey(entry.link)}>
                  <button
                    type="button"
                    onClick={() => {
                      setLinked(entry.link, true, entry.name)
                      setQuery('')
                    }}
                    className="flex min-h-11 w-full items-center justify-between gap-3 px-3 py-2 text-left text-sm outline-none hover:bg-secondary focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
                  >
                    <span className="min-w-0">
                      <span className="font-medium">{entry.name}</span>
                      <span className="ml-2 text-xs text-muted-foreground">
                        {entry.link.target === 'category'
                          ? `Categoría${entry.context ? ` · ${entry.context}` : ''}`
                          : entry.context}
                      </span>
                    </span>
                    <Plus aria-hidden className="size-4 shrink-0 text-muted-foreground" />
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-muted-foreground">
              Nada más con ese nombre (o ya está en la lista).
            </p>
          )
        ) : null}
      </div>

      <div className="flex items-center justify-end gap-2 border-t border-border/60 pt-3">
        {asking ? (
          <>
            <span className="mr-auto text-sm text-muted-foreground text-pretty">
              Se borra con sus opciones. Las comandas viejas conservan lo que se eligió.
            </span>
            <Button
              variant="destructive"
              size="sm"
              onClick={() => {
                setAsking(false)
                commit({ type: 'group.delete', id: group.id }, { say: `${group.name} se borró` })
              }}
              data-testid="aclaracion-borrar-si"
            >
              Sí, borrar
            </Button>
            <Button variant="ghost" size="sm" onClick={() => setAsking(false)}>
              No
            </Button>
          </>
        ) : (
          <Button variant="ghost" size="sm" onClick={() => setAsking(true)}>
            <Trash2 aria-hidden className="size-4" />
            Borrar
          </Button>
        )}
      </div>
    </li>
  )
}

function OptionRow({
  option,
  error,
  canUp,
  canDown,
  labelTaken,
  onLabel,
  onPrice,
  onMove,
  onDelete,
}: {
  option: ModifierOption
  error: string | undefined
  canUp: boolean
  canDown: boolean
  labelTaken: (candidate: string) => boolean
  onLabel: (next: string) => void
  onPrice: (cents: number) => void
  onMove: (delta: -1 | 1) => void
  onDelete: () => void
}) {
  const row = useSortableRow(option.id)
  return (
    <li
      ref={row.setNodeRef}
      style={row.style}
      className={cn(
        'flex flex-wrap items-center gap-1.5 bg-card px-1.5 py-2',
        row.dragging && 'shadow-md',
      )}
    >
      <DragGrip row={row} label={`Reordenar ${option.label}`} />
      <InlineText
        value={option.label}
        label={`Opción ${option.label}`}
        maxLength={OPTION_LABEL_MAX}
        check={(next) => (labelTaken(next) ? `«${next}» ya está en la lista.` : null)}
        error={error}
        onCommit={onLabel}
        className="min-w-[9rem] flex-1"
      />
      <ExtraPriceField cents={option.priceDeltaCents} name={option.label} onCommit={onPrice} />
      <MoveButtons name={option.label} canUp={canUp} canDown={canDown} onMove={onMove} />
      <button
        type="button"
        aria-label={`Sacar ${option.label}`}
        onClick={onDelete}
        className="flex size-9 shrink-0 items-center justify-center rounded-md text-muted-foreground outline-none hover:bg-secondary hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring pointer-coarse:size-11"
      >
        <X aria-hidden className="size-4" />
      </button>
    </li>
  )
}
