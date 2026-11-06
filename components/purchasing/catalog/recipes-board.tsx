'use client'

import { AlertTriangle, BookOpen, ChevronRight, Megaphone, Plus } from 'lucide-react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import type { ReactNode } from 'react'
import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/ui/empty-state'
import { PageHeader } from '@/components/ui/page-header'
import { cn } from '@/lib/utils'
import { type FormatOption, type RecipeHeader, RecipeSheet } from './recipe-sheet'
import { useSheetUrl } from './use-sheet-url'

/** `?nuevo=1` abre «Nueva receta»; con `&formato=<templateId>`, ya con ese formato elegido. */
const SHEET_KEYS = ['nuevo', 'formato'] as const

/** Una receta como tarjeta de la lista: sus datos y cuántas líneas tiene (y cuántas revisar). */
export type RecipeSummary = RecipeHeader & {
  /** Las que se piden (no las que se hacen en el local). */
  buyLines: number
  /** Las que se hacen en el local (caldos, salsas): son recordatorios. */
  inHouseLines: number
  /** «Datos para corregir» de esta receta. */
  reviewCount: number
}

const DEFAULT_VARIANT = 'Única'

function plural(n: number, one: string, many: string) {
  return `${n.toLocaleString('es-AR')} ${n === 1 ? one : many}`
}

function byVariant(a: RecipeSummary, b: RecipeSummary) {
  if (a.active !== b.active) return a.active ? -1 : 1
  return a.variant.localeCompare(b.variant, 'es') || a.name.localeCompare(b.name, 'es')
}

/**
 * Las recetas agrupadas por formato del calendario, con los formatos que todavía no tienen receta
 * («Salen con lo de siempre») para cargarles una. Tocar una receta abre su ficha.
 */
export function RecipesBoard({
  tenantSlug,
  recipes,
  formats,
  defaultGuests,
}: {
  tenantSlug: string
  recipes: readonly RecipeSummary[]
  formats: readonly FormatOption[]
  defaultGuests: number
}) {
  const router = useRouter()
  const { params, open: openSheet, close: closeSheet } = useSheetUrl(SHEET_KEYS)
  const formatById = new Map(formats.map((format) => [format.id, format]))

  const creating = params.get('nuevo') === '1'
  const presetParam = params.get('formato')
  const preset = presetParam && formatById.has(presetParam) ? presetParam : null

  const byFormat = new Map<string, RecipeSummary[]>()
  const loose: RecipeSummary[] = []
  for (const recipe of recipes) {
    const format = recipe.templateId ? formatById.get(recipe.templateId) : undefined
    if (!format) {
      loose.push(recipe)
      continue
    }
    const list = byFormat.get(format.id) ?? []
    list.push(recipe)
    byFormat.set(format.id, list)
  }
  const groups = formats
    .filter((format) => byFormat.has(format.id))
    .map((format) => ({ format, recipes: [...(byFormat.get(format.id) ?? [])].sort(byVariant) }))
  const withoutRecipe = formats.filter((format) => format.active && !byFormat.has(format.id))
  const toReview = recipes.filter(
    (recipe) =>
      recipe.active &&
      (recipe.reviewCount > 0 || (recipe.buyLines + recipe.inHouseLines === 0 && !recipe.notes)),
  ).length

  const recipeHref = (id: string) => `/${tenantSlug}/compras/recetas/${id}`

  return (
    <>
      <PageHeader
        eyebrow="Compras"
        title="Recetas"
        description={
          <>
            Lo que lleva cada formato del calendario, escrito para {defaultGuests} personas. Si una
            fecha tiene más reservas, se multiplica.
            {toReview ? (
              <span className="text-foreground">
                {' '}
                {toReview === 1
                  ? '1 receta tiene algo para revisar.'
                  : `${toReview} recetas tienen algo para revisar.`}
              </span>
            ) : null}
          </>
        }
        actions={
          <Button
            type="button"
            onClick={() => openSheet({ nuevo: '1' })}
            className="h-11 flex-1 sm:flex-none md:h-10"
          >
            <Plus className="size-4" aria-hidden />
            Nueva receta
          </Button>
        }
      />

      {recipes.length === 0 ? (
        <EmptyState
          icon={BookOpen}
          title="Todavía no hay recetas"
          description="Cada formato del calendario puede tener la suya: lo que lleva para una noche, en cantidades. Las fechas de ese formato suman esos insumos al pedido."
          action={
            <Button
              type="button"
              onClick={() => openSheet({ nuevo: '1' })}
              className="h-11 md:h-10"
            >
              <Plus className="size-4" aria-hidden />
              Nueva receta
            </Button>
          }
        />
      ) : (
        <div className="space-y-8">
          {groups.map(({ format, recipes: list }) => (
            <RecipeGroup
              key={format.id}
              id={format.id}
              title={format.name}
              note={
                format.active
                  ? list.length > 1
                    ? `${list.length} variantes: cada fecha elige cuál va.`
                    : null
                  : 'El formato está desactivado en el calendario.'
              }
            >
              {list.map((recipe) => (
                <RecipeCard
                  key={recipe.id}
                  recipe={recipe}
                  groupName={format.name}
                  href={recipeHref(recipe.id)}
                />
              ))}
            </RecipeGroup>
          ))}
          {loose.length ? (
            <RecipeGroup
              id="sin-formato"
              title="Sin formato del calendario"
              note="No suman insumos a ninguna fecha hasta que les elijas un formato."
            >
              {[...loose].sort(byVariant).map((recipe) => (
                <RecipeCard
                  key={recipe.id}
                  recipe={recipe}
                  groupName={null}
                  href={recipeHref(recipe.id)}
                />
              ))}
            </RecipeGroup>
          ) : null}
        </div>
      )}

      {withoutRecipe.length ? (
        <section aria-labelledby="sin-receta" className="space-y-3">
          <header className="space-y-0.5 px-1">
            <h2 id="sin-receta" className="font-serif text-lg font-semibold tracking-tight">
              Salen con lo de siempre
            </h2>
            <p className="text-sm text-muted-foreground text-pretty">
              Estos formatos no tienen receta: sus fechas no suman insumos al pedido.
            </p>
          </header>
          <ul className="card-hairline divide-y divide-border/60 rounded-xl border bg-card shadow-xs">
            {withoutRecipe.map((format) => (
              <li
                key={format.id}
                className="flex items-center justify-between gap-3 py-2 pr-2 pl-4"
              >
                <span className="min-w-0 truncate font-medium">{format.name}</span>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => openSheet({ nuevo: '1', formato: format.id })}
                  className="h-11 shrink-0 md:h-9"
                  aria-label={`Cargar receta para ${format.name}`}
                >
                  <Plus className="size-4" aria-hidden />
                  Cargar receta
                </Button>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <RecipeSheet
        tenantSlug={tenantSlug}
        open={creating}
        recipe={null}
        formats={formats}
        variants={recipes}
        defaultGuests={defaultGuests}
        presetTemplateId={preset}
        onClose={closeSheet}
        onSaved={(id) => {
          // Reemplaza la entrada de «Nueva receta»: «atrás» desde la ficha vuelve a la lista.
          router.replace(recipeHref(id))
        }}
      />
    </>
  )
}

function RecipeGroup({
  id,
  title,
  note,
  children,
}: {
  id: string
  title: string
  note: string | null
  children: ReactNode
}) {
  return (
    <section aria-labelledby={`formato-${id}`} className="space-y-3">
      <header className="space-y-0.5 px-1">
        <h2
          id={`formato-${id}`}
          className="font-serif text-lg font-semibold tracking-tight text-balance"
        >
          {title}
        </h2>
        {note ? <p className="text-sm text-muted-foreground text-pretty">{note}</p> : null}
      </header>
      <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{children}</ul>
    </section>
  )
}

function RecipeCard({
  recipe,
  groupName,
  href,
}: {
  recipe: RecipeSummary
  /** El nombre del formato del grupo: si la receta se llama igual, no se repite. */
  groupName: string | null
  href: string
}) {
  const hasVariant = recipe.variant !== DEFAULT_VARIANT
  const title = hasVariant ? recipe.variant : recipe.name
  const subtitle = hasVariant && recipe.name !== groupName ? recipe.name : null
  const totalLines = recipe.buyLines + recipe.inHouseLines
  const noticeOnly = totalLines === 0 && Boolean(recipe.notes)
  // Ni insumos ni aviso: es un «Dato para corregir» (en una activa, que es la que suma).
  const empty = totalLines === 0 && !recipe.notes && recipe.active
  const meta =
    totalLines === 0
      ? `Sin insumos · para ${recipe.baseGuests} personas`
      : [
          plural(recipe.buyLines, 'insumo', 'insumos'),
          recipe.inHouseLines ? `${recipe.inHouseLines} del local` : null,
          `para ${recipe.baseGuests} personas`,
        ]
          .filter(Boolean)
          .join(' · ')

  return (
    <li className="min-w-0">
      <Link
        href={href}
        className={cn(
          'card-hairline flex h-full flex-col gap-2 rounded-xl border bg-card p-4 shadow-xs transition-colors',
          'hover:bg-cream-tint focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none',
          !recipe.active && 'text-muted-foreground',
        )}
      >
        <span className="flex items-start justify-between gap-2">
          <span className="min-w-0">
            <span className="block font-serif text-lg leading-tight font-semibold text-pretty">
              {title}
            </span>
            {subtitle ? (
              <span className="mt-0.5 block truncate text-sm text-muted-foreground">
                {subtitle}
              </span>
            ) : null}
          </span>
          <ChevronRight className="mt-1 size-4 shrink-0 text-muted-foreground" aria-hidden />
        </span>
        <span className="text-sm text-muted-foreground">{meta}</span>
        {recipe.reviewCount || noticeOnly || empty || !recipe.active ? (
          <span className="flex flex-wrap gap-1.5">
            {empty ? (
              <span className="inline-flex items-center gap-1 rounded-full bg-warning/15 px-2 py-0.5 text-xs font-medium text-warning-text">
                <AlertTriangle className="size-3" aria-hidden />
                Para cargar
              </span>
            ) : null}
            {recipe.reviewCount ? (
              <span className="inline-flex items-center gap-1 rounded-full bg-warning/15 px-2 py-0.5 text-xs font-medium text-warning-text">
                <AlertTriangle className="size-3" aria-hidden />
                {recipe.reviewCount === 1 ? '1 para revisar' : `${recipe.reviewCount} para revisar`}
              </span>
            ) : null}
            {noticeOnly ? (
              <span className="inline-flex rounded-full bg-secondary px-2 py-0.5 text-xs font-medium text-secondary-foreground">
                Solo aviso
              </span>
            ) : null}
            {recipe.active ? null : (
              <span className="inline-flex rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">
                Desactivada
              </span>
            )}
          </span>
        ) : null}
        {recipe.notes ? (
          <span className="mt-auto flex items-start gap-2 pt-1 text-sm text-muted-foreground">
            <Megaphone className="mt-0.5 size-3.5 shrink-0" aria-hidden />
            <span className="line-clamp-2 text-pretty">{recipe.notes}</span>
          </span>
        ) : null}
      </Link>
    </li>
  )
}
