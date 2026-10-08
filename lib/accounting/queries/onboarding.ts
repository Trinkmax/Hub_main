import 'server-only'
import {
  type OnboardingData,
  type OnboardingState,
  onboardingState,
  parseOnboardingData,
} from '@/lib/accounting/onboarding'
import { AccQueryError, callRpc } from './shared'

/**
 * «Cómo arrancar» (diseño §5.2.3): una llamada a `acc_report_onboarding`
 * (INVOKER, empieza con `acc_assert_reader`: la contadora también la ve) y el
 * estado de cada ítem armado en TS (`lib/accounting/onboarding.ts`).
 */

export type OnboardingOverview = {
  data: OnboardingData
  state: OnboardingState
}

/**
 * Los datos y el estado de la guía. `null` mientras la función no está en la
 * base (las migraciones de ARCA e importadores todavía sin aplicar): la página
 * muestra la guía sin marcas en vez de un error.
 */
export async function getOnboarding(tenantId: string): Promise<OnboardingOverview | null> {
  let raw: unknown
  try {
    raw = await callRpc('acc_report_onboarding', { p_tenant_id: tenantId })
  } catch (error) {
    if (error instanceof AccQueryError && error.key === 'function_unavailable') return null
    throw error
  }
  const data = parseOnboardingData(raw)
  if (!data) {
    throw new AccQueryError(
      'acc_report_onboarding',
      'error',
      'No pudimos cargar esto. Probá de nuevo; si sigue, avisanos.',
    )
  }
  return { data, state: onboardingState(data) }
}
