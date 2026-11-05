'use server'

/**
 * Los movimientos del panel lateral de una cuenta: se piden al abrirlo, no al entrar a Caja (casi
 * nadie abre todas). La misma lectura que la ficha (`/cajas/[id]`), con la puerta de siempre:
 * sesión, bar y acceso de lectura; la base vuelve a filtrar por bar.
 *
 * Nunca tira: `{ ok: true, data }` o `{ ok: false, message }`, para mostrar el error con «Reintentar».
 */

import { z } from 'zod'
import { authorizeAccounting } from '@/lib/accounting/access'
import { getSubledger } from '@/lib/accounting/queries/books'
import { type QueryOutcome, REPORT_PAGE_LIMIT, settleQuery } from '@/lib/accounting/queries/shared'
import { TREASURY_KINDS } from '@/lib/accounting/types'
import { addDays, todayInCordoba } from '@/lib/dates'
import { accountMovements } from './activity'
import { ACCOUNT_SHEET_DAYS, type AccountMovements } from './wallet-view'

const schema = z.object({
  treasuryId: z.uuid({ message: 'Esa cuenta no existe. Recargá la página.' }),
  kind: z.enum(TREASURY_KINDS, { message: 'Esa cuenta no existe. Recargá la página.' }),
})

/** Lo de los últimos días de una cuenta, con lo más nuevo arriba. */
export async function fetchAccountMovements(
  slug: string,
  raw: unknown,
): Promise<QueryOutcome<AccountMovements>> {
  const parsed = schema.safeParse(raw)
  if (!parsed.success) {
    return {
      ok: false,
      code: 'invalid',
      message: parsed.error.issues[0]?.message ?? 'Revisá los datos.',
    }
  }
  const auth = await authorizeAccounting(slug, 'read')
  if (!auth.ok) return { ok: false, code: auth.state.code, message: auth.state.message }

  const today = todayInCordoba()
  return settleQuery(
    getSubledger(auth.tenantId, {
      kind: 'treasury',
      treasuryId: parsed.data.treasuryId,
      from: addDays(today, -(ACCOUNT_SHEET_DAYS - 1)),
      to: today,
      limit: REPORT_PAGE_LIMIT,
    }).then((page) => ({
      movements: page.nextCursor ? [] : accountMovements(page.rows, parsed.data.kind),
      tooMany: page.nextCursor !== null,
    })),
  )
}
