import { Wrench } from 'lucide-react'
import Link from 'next/link'
import { Callout } from '@/app/(manager)/[tenantSlug]/administracion/ajustes/_components/form-bits'
import { Button } from '@/components/ui/button'
import type { AccFailureState } from '@/lib/accounting/action-state'
import { arcaGuideHref } from '@/lib/arca/emit-form'

/**
 * Un problema de ARCA que devolvió una acción de emisión (`AccFailureState`):
 * el texto en palabras simples y, si hay un paso de la guía «Conectar ARCA» que
 * lo arregla (`detail.step_n`), el botón «Cómo se arregla». Server-safe.
 */
export function arcaStepOf(state: AccFailureState): number | null {
  const n = state.detail?.step_n
  return typeof n === 'number' && Number.isInteger(n) && n >= 0 && n <= 10 ? n : null
}

export function arcaTitleOf(state: AccFailureState): string | null {
  const title = state.detail?.title
  return typeof title === 'string' && title.trim() !== '' ? title : null
}

export function ArcaProblem({
  slug,
  state,
  tone = 'error',
  className,
}: {
  slug: string
  state: AccFailureState
  tone?: 'error' | 'warning'
  className?: string
}) {
  const step = arcaStepOf(state)
  return (
    <Callout
      tone={tone}
      title={arcaTitleOf(state) ?? undefined}
      className={className}
      action={
        step !== null ? (
          <Button asChild variant="outline" size="sm" className="h-11 gap-1.5 md:h-8">
            <Link href={arcaGuideHref(slug, step)}>
              <Wrench className="size-4" aria-hidden />
              Cómo se arregla
            </Link>
          </Button>
        ) : null
      }
    >
      {state.message}
    </Callout>
  )
}
