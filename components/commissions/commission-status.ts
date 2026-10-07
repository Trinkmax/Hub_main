import { Check } from 'lucide-react'
import type { StatusMap } from '@/components/ui/status-badge'

/**
 * Estado de una comisión (una fila del ledger): pagada o pendiente.
 *
 * Dos mapas porque cada lado lo dice con su verbo: el dueño ve si la gestora ya
 * la **cobró**; la gestora, en «Mis números», si ya se la **pagaron** (es lo que
 * explica «¿Cómo se calcula?»: de «Pendiente» a «Pagado»). Mismo tono y mismo
 * ícono en los dos, así se lee igual de un vistazo.
 *
 * Vive acá (y no en `lib/commissions`) mientras el lote D no puede tocar `lib`:
 * pendiente de mudarse a `lib/commissions/status-meta.ts`.
 */
export type CommissionStatus = 'paid' | 'pending'

/** `paid_at` → estado. */
export function commissionStatusOf(paidAt: string | null | undefined): CommissionStatus {
  return paidAt ? 'paid' : 'pending'
}

/** Liquidación del dueño: «Cobrada» / «Pendiente». */
export const COMMISSION_STATUS_OWNER: StatusMap<CommissionStatus> = {
  paid: { label: 'Cobrada', tone: 'success', icon: Check },
  pending: { label: 'Pendiente', tone: 'warning', description: 'Todavía no se liquidó' },
}

/** «Mis números» de la gestora: «Pagado» / «Pendiente». */
export const COMMISSION_STATUS_MANAGER: StatusMap<CommissionStatus> = {
  paid: { label: 'Pagado', tone: 'success', icon: Check },
  pending: {
    label: 'Pendiente',
    tone: 'warning',
    description: 'El dueño todavía no te lo liquidó',
  },
}
