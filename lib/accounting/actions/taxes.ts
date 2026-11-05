'use server'

/**
 * Los impuestos que se calculan solos (reunión del 29/10/2026): los porcentajes de Ajustes ›
 * Impuestos y si una cuenta cobra el impuesto al cheque.
 *
 * Como todas las acciones de Administración: dueño con acceso (`write`) → zod → UNA RPC con la
 * sesión de la persona (vuelve a chequear el acceso y audita adentro) → error del catálogo →
 * revalidación. La contadora no llega acá: la base tampoco la deja.
 */

import { z } from 'zod'
import { authorizeAccounting } from '@/lib/accounting/access'
import { type AccSimpleState, invalidState } from '@/lib/accounting/action-state'
import {
  parseTaxSettings,
  TAX_BASES,
  type TaxSettings,
  taxSettingsPayload,
} from '@/lib/accounting/taxes'
import { createClient } from '@/lib/supabase/server'
import { revalidateAccounting, rpcFailure, unexpectedFailure } from './support'

const PERCENT_MESSAGE = 'El porcentaje va de 0 a 100.'

/** Centésimas de punto: 300 = 3 %. La base acepta de 0 a 10.000. */
const percentBp = z
  .number({ message: PERCENT_MESSAGE })
  .int(PERCENT_MESSAGE)
  .min(0, PERCENT_MESSAGE)
  .max(10_000, PERCENT_MESSAGE)

const taxSettingsSchema = z.object({
  auto: z.boolean({ message: 'Decí si se calculan solos.' }),
  iibbBp: percentBp,
  municipalBp: percentBp,
  bankTaxBp: percentBp,
  base: z.enum(TAX_BASES, { message: 'Elegí sobre qué se calculan.' }),
})

/** Ajustes › Impuestos (`acc_save_tax_settings`). Devuelve lo que quedó guardado. */
export async function saveTaxSettings(
  slug: string,
  raw: unknown,
): Promise<AccSimpleState<TaxSettings>> {
  const op = 'taxes.saveTaxSettings'
  try {
    const auth = await authorizeAccounting(slug, 'write')
    if (!auth.ok) return auth.state
    const parsed = taxSettingsSchema.safeParse(raw)
    if (!parsed.success) return invalidState(parsed.error)

    const supabase = await createClient()
    const { data, error } = await supabase.rpc('acc_save_tax_settings', {
      p_tenant_id: auth.tenantId,
      p_settings: taxSettingsPayload(parsed.data),
    })
    if (error) return rpcFailure(op, error)

    revalidateAccounting(slug)
    return { ok: true, data: parseTaxSettings(data), message: 'Impuestos guardados.' }
  } catch (error) {
    return unexpectedFailure(op, error)
  }
}

const treasuryBankTaxSchema = z.object({
  treasuryId: z.uuid({ message: 'Esa cuenta no existe. Recargá la página.' }),
  /** `null`: según el tipo de cuenta (bancos y billeteras sí, efectivo no). */
  value: z.boolean({ message: 'Decí si la cuenta cobra el impuesto.' }).nullable(),
})

export type TreasuryBankTax = z.infer<typeof treasuryBankTaxSchema>

/** El interruptor «Cobra impuesto al cheque» de una cuenta (`acc_set_treasury_bank_tax`). */
export async function setTreasuryBankTax(
  slug: string,
  raw: unknown,
): Promise<AccSimpleState<TreasuryBankTax>> {
  const op = 'taxes.setTreasuryBankTax'
  try {
    const auth = await authorizeAccounting(slug, 'write')
    if (!auth.ok) return auth.state
    const parsed = treasuryBankTaxSchema.safeParse(raw)
    if (!parsed.success) return invalidState(parsed.error)

    const supabase = await createClient()
    const { error } = await supabase.rpc('acc_set_treasury_bank_tax', {
      p_tenant_id: auth.tenantId,
      p_treasury_id: parsed.data.treasuryId,
      p_value: parsed.data.value,
    })
    if (error) return rpcFailure(op, error)

    revalidateAccounting(slug)
    return {
      ok: true,
      data: parsed.data,
      message:
        parsed.data.value === false
          ? 'Esta cuenta ya no cobra el impuesto al cheque.'
          : 'Esta cuenta cobra el impuesto al cheque.',
    }
  } catch (error) {
    return unexpectedFailure(op, error)
  }
}
