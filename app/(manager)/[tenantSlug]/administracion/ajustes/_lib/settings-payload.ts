/**
 * `saveSettings` recibe TODOS los datos de la SAS (un solo esquema): cada
 * pestaña de Ajustes manda lo que muestra encima de lo que ya está guardado.
 * Puro.
 */

import type { AccountingSettings } from '@/lib/accounting/queries/settings'

export type SettingsPatch = Partial<Record<string, unknown>>

export function settingsPayload(
  s: AccountingSettings,
  patch: SettingsPatch,
): Record<string, unknown> {
  return {
    expectedUpdatedAt: s.updatedAt,
    legalName: s.legalName,
    cuit: s.cuit,
    ivaCondition: s.ivaCondition,
    iibbRegime: s.iibbRegime,
    iibbNumber: s.iibbNumber,
    iibbJurisdictionCode: s.iibbJurisdictionCode || 904,
    activityStartDate: s.activityStartDate,
    fiscalAddress: s.fiscalAddress,
    booksStartDate: s.booksStartDate,
    fiscalYearEndMonth: s.fiscalYearEndMonth,
    ivaSettlementMode: s.ivaSettlementMode,
    ivaDueDay: s.ivaDueDay,
    iibbDueDay: s.iibbDueDay,
    vatToleranceCents: s.vatToleranceCents,
    bankTaxCreditComputableBp: s.bankTaxCreditComputableBp,
    bankTaxDebitComputableBp: s.bankTaxDebitComputableBp,
    uninvoicedSalesMode: s.uninvoicedSalesMode,
    closedPeriodVoidIvaMode: s.closedPeriodVoidIvaMode,
    dueSoonDays: s.dueSoonDays,
    ...patch,
  }
}
