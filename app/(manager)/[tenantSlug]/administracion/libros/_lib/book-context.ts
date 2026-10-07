import 'server-only'

import {
  type AccountingSettings,
  type FiscalYearRow,
  getAccountingSettings,
  listFiscalYears,
  settleQuery,
} from '@/lib/accounting/queries'
import { monthOf } from '@/lib/dates'
import { fiscalYearToDate } from './periods'

export type BookContext = {
  /** `null` si no se pudo leer (el libro igual se muestra). */
  settings: AccountingSettings | null
  years: FiscalYearRow[]
  /** Primer mes con libros (`yyyy-MM`), para no dejar ir más atrás. */
  minMonth: string | null
  /** «Ejercicio a la fecha»: del inicio del ejercicio en curso a hoy. */
  fiscalYear: { from: string; to: string } | null
}

/**
 * Lo que necesita cualquier libro además de sus filas: los datos de la SAS
 * (inicio de los libros, CUIT) y los ejercicios. Si alguno falla, el libro
 * igual se muestra (sin el atajo de «Ejercicio a la fecha»).
 */
export async function loadBookContext(tenantId: string, today: string): Promise<BookContext> {
  const [settings, years] = await Promise.all([
    settleQuery(getAccountingSettings(tenantId)),
    settleQuery(listFiscalYears(tenantId)),
  ])
  const s = settings.ok ? settings.data : null
  const list = years.ok ? years.data : []
  return {
    settings: s,
    years: list,
    minMonth: s ? monthOf(s.booksStartDate) : null,
    fiscalYear: fiscalYearToDate(list, today),
  }
}
