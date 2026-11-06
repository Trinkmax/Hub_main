import type { SupabaseClient } from '@supabase/supabase-js'
import { phoneVariants } from '@/lib/phone'

/**
 * La ficha de un teléfono en un bar, esté guardado con el 9 o sin él.
 *
 * Hasta nov 2026 las reservas guardaban «+543…» y el club, las entradas y
 * WhatsApp buscaban «+5493…»: no se encontraban y se creaba otra ficha para la
 * misma persona. Si todavía tiene las dos, gana la que tiene el 9 (la canónica).
 */
export async function findCustomerIdByPhone(
  supabase: SupabaseClient,
  tenantId: string,
  phone: string,
): Promise<string | null> {
  const variants = phoneVariants(phone)
  const { data } = await supabase
    .from('customers')
    .select('id, phone')
    .eq('tenant_id', tenantId)
    .in('phone', variants)
    .is('deleted_at', null)
    .limit(variants.length)
  const rows = (data ?? []) as { id: string; phone: string | null }[]
  return (rows.find((row) => row.phone === variants[0]) ?? rows[0])?.id ?? null
}
