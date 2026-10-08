import 'server-only'
import {
  type OnboardingData,
  type OnboardingState,
  onboardingState,
  parseOnboardingData,
} from '@/lib/accounting/onboarding'
import { AccQueryError, callRpc, dayOrNull, isRecord, queryError, readerClient } from './shared'

/**
 * «Cómo arrancar» (diseño §5.2.3): una llamada a `acc_report_onboarding`
 * (INVOKER, empieza con `acc_assert_reader`: la contadora también la ve) y el
 * estado de cada ítem armado en TS (`lib/accounting/onboarding.ts`). En
 * paralelo lee el día de arranque de los libros (no viene en el reporte): con
 * los libros arrancados este mes todavía no hay un mes para cerrar.
 */

export type OnboardingOverview = {
  data: OnboardingData
  state: OnboardingState
}

async function booksStartDate(tenantId: string): Promise<string | null> {
  const supabase = await readerClient()
  const { data, error } = await supabase
    .from('acc_settings')
    .select('books_start_date')
    .eq('tenant_id', tenantId)
    .maybeSingle()
  if (error) throw queryError('acc_settings', error)
  return isRecord(data) ? dayOrNull(data.books_start_date) : null
}

/**
 * Los datos y el estado de la guía. `null` mientras la función no está en la
 * base (las migraciones de ARCA e importadores todavía sin aplicar): la página
 * muestra la guía sin marcas en vez de un error.
 */
export async function getOnboarding(tenantId: string): Promise<OnboardingOverview | null> {
  let read: [unknown, string | null]
  try {
    read = await Promise.all([
      callRpc('acc_report_onboarding', { p_tenant_id: tenantId }),
      booksStartDate(tenantId),
    ])
  } catch (error) {
    if (error instanceof AccQueryError && error.key === 'function_unavailable') return null
    throw error
  }
  const [raw, startDate] = read
  const parsed = parseOnboardingData(raw)
  if (!parsed) {
    throw new AccQueryError(
      'acc_report_onboarding',
      'error',
      'No pudimos cargar esto. Probá de nuevo; si sigue, avisanos.',
    )
  }
  const data: OnboardingData = { ...parsed, booksStartDate: startDate ?? parsed.booksStartDate }
  return { data, state: onboardingState(data) }
}
