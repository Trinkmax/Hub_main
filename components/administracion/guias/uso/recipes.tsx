import { Clock } from 'lucide-react'
import Link from 'next/link'
import {
  GuideChecklist,
  GuideChip,
  GuideStep,
  GuideTroubles,
} from '@/components/administracion/guias/guide-step'
import { HowToFor } from '@/components/administracion/guias/onboarding/how-to-slot'
import { StepScreens } from '@/components/administracion/guias/step-screens'
import {
  GUIDE_RECIPES,
  type GuideOverview,
  type GuideRecipe,
  type GuideStatus,
  RECIPE_FREQUENCY_LABEL,
  recipeAnchor,
  recipeStatus,
} from '@/lib/accounting/guides'
import { minutesText } from '@/lib/accounting/onboarding'
import { GuideDo } from './guide-do'
import { RECIPE_ICON } from './guide-icons'
import { GuideMock } from './mock-scenes'
import { type RecipeIndexItem, RecipesShell } from './recipes-shell'

/**
 * Las recetas del día a día: una por situación («Cerré la caja de ayer»), con el mismo andamiaje
 * de la guía de ARCA (`GuideStep` en acordeón, `StepScreens` con la pantalla al lado del texto,
 * «Chequeá que…» y «Si algo sale mal»). Cada una cierra con qué queda cuando terminás y el botón
 * «Hacerlo ahora», que abre la pantalla o la hoja real.
 *
 * No se marcan a mano: las que son rutina dicen solas si estás al día, con lo que hay cargado.
 * Server component; lo interactivo son islas (el acordeón, el carrusel, la maqueta y el botón).
 */

const STEP_STATUS = { done: 'done', todo: 'todo', idle: 'pending' } as const

/** La línea de estado del encabezado: cómo venís, o el ejemplo si no hay nada que decir. */
function statusLine(recipe: GuideRecipe, status: GuideStatus | null): string {
  if (!status) return recipe.hint
  if (status.state === 'done') return 'Al día'
  return status.state === 'todo' ? `Te toca · ${status.text}` : status.text
}

function Recipe({
  recipe,
  n,
  base,
  status,
}: {
  recipe: GuideRecipe
  n: number
  base: string
  status: GuideStatus | null
}) {
  const Icon = RECIPE_ICON[recipe.id]
  const minutes = minutesText(recipe.minutes)
  return (
    <GuideStep
      id={recipe.id}
      anchor={recipeAnchor(recipe.id)}
      n={n}
      title={recipe.title}
      kicker={RECIPE_FREQUENCY_LABEL[recipe.frequency]}
      lead={
        <span
          aria-hidden="true"
          className="flex size-9 shrink-0 items-center justify-center rounded-full bg-accent text-accent-foreground"
        >
          <Icon className="size-[18px]" />
        </span>
      }
      status={status ? STEP_STATUS[status.state] : 'pending'}
      statusText={statusLine(recipe, status)}
      chips={minutes ? <GuideChip icon={<Clock aria-hidden />}>{minutes}</GuideChip> : null}
      footerLabel="Qué queda:"
      footerHow={recipe.result}
      footerAction={
        <GuideDo target={recipe.action.target} look="solid">
          {recipe.action.label}
        </GuideDo>
      }
    >
      {/* En la compu, el texto a la izquierda y la pantalla a la derecha (`StepScreens`
          devuelve primero la pantalla: se da vuelta con `order`). */}
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_342px] lg:items-start lg:[&>*:first-child]:order-2">
        <StepScreens
          seeLabel="Así se ve"
          doLabel="Paso a paso"
          // En la compu la pantalla queda al costado, no arriba.
          shownLabel="Es la pantalla que se ve"
          screens={recipe.screens.map((screen) => ({
            title: screen.title,
            mock: <GuideMock screen={screen} />,
          }))}
          instructions={recipe.steps.map((step) => ({
            content: step.text,
            screen: step.screen,
          }))}
        />
      </div>
      {recipe.howTo ? <HowToFor source={recipe.howTo} /> : null}
      <div className="grid gap-6 lg:grid-cols-2 lg:items-start">
        <GuideChecklist items={recipe.checks} />
        <GuideTroubles
          items={recipe.troubles.map((trouble) => ({
            problem: trouble.problem,
            fix: trouble.link ? (
              <>
                {trouble.fix}{' '}
                <Link
                  href={`${base}${trouble.link.path}`}
                  className="rounded-sm font-medium text-foreground underline decoration-border underline-offset-4 hover:decoration-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                >
                  {trouble.link.label}
                </Link>
              </>
            ) : (
              trouble.fix
            ),
          }))}
        />
      </div>
    </GuideStep>
  )
}

export function Recipes({ base, overview }: { base: string; overview: GuideOverview | null }) {
  const rows = GUIDE_RECIPES.map((recipe) => ({ recipe, status: recipeStatus(recipe, overview) }))
  const items: RecipeIndexItem[] = rows.map(({ recipe, status }) => ({
    id: recipe.id,
    anchor: recipeAnchor(recipe.id),
    title: recipe.title,
    due: status?.state === 'todo',
  }))
  // Abierta al entrar: la rutina que te toca o, si no hay ninguna, la de todos los días.
  const first = rows.find(({ status }) => status?.state === 'todo')?.recipe ?? GUIDE_RECIPES[0]
  return (
    <RecipesShell items={items} initialOpen={first ? [first.id] : []}>
      {rows.map(({ recipe, status }, index) => (
        <Recipe key={recipe.id} recipe={recipe} n={index + 1} base={base} status={status} />
      ))}
    </RecipesShell>
  )
}
