import 'server-only'

import {
  IIBB_REGIME_LABELS,
  IVA_SETTLEMENT_LABELS,
  SAS_IVA_CONDITION_LABELS,
} from '@/app/(manager)/[tenantSlug]/administracion/ajustes/_lib/labels'
import { loadPostingCatalog } from '@/lib/accounting/context'
import {
  type AccountingSettings,
  getAccountingSettings,
  listSalesPoints,
} from '@/lib/accounting/queries/settings'
import { settleQuery } from '@/lib/accounting/queries/shared'
import { bpLabel, type TaxSettings } from '@/lib/accounting/taxes'
import { dayText, defineTool, noInput } from '../types'
import { compact } from './common'

const TAX_BASE_WORDS: Readonly<Record<TaxSettings['base'], string>> = {
  invoiced_net: 'Sobre lo facturado, sin IVA',
  all_sales: 'Sobre todas las ventas',
}

const OPENING_WORDS: Readonly<Record<AccountingSettings['openingStatus'], string>> = {
  pending: 'Faltan cargar',
  posted: 'Cargados',
  skipped: 'Se arrancó en cero',
}

/** Los datos del bar y los porcentajes. Sin nadie adentro: ni accesos, ni socios, ni la contadora. */
export function settingsData(
  settings: AccountingSettings | null,
  taxes: TaxSettings | null,
  points: ReadonlyArray<{ number: number; label: string }>,
) {
  return compact({
    bar: settings
      ? compact({
          razon_social: settings.legalName,
          cuit: settings.cuit,
          condicion_iva: SAS_IVA_CONDITION_LABELS[settings.ivaCondition],
          ingresos_brutos: IIBB_REGIME_LABELS[settings.iibbRegime],
          inicio_de_actividades: dayText(settings.activityStartDate),
          domicilio_fiscal: settings.fiscalAddress,
        })
      : 'Administración todavía no está configurada.',
    libros: settings
      ? {
          arrancan: dayText(settings.booksStartDate),
          saldos_iniciales: OPENING_WORDS[settings.openingStatus],
          cierre_del_ejercicio_mes: settings.fiscalYearEndMonth,
          liquidacion_de_iva: IVA_SETTLEMENT_LABELS[settings.ivaSettlementMode],
          iva_vence_el_dia: settings.ivaDueDay,
          ingresos_brutos_vence_el_dia: settings.iibbDueDay,
        }
      : null,
    impuestos: taxes
      ? {
          se_calculan_solos: taxes.auto,
          ingresos_brutos: bpLabel(taxes.iibbBp),
          comercio_e_industria: bpLabel(taxes.municipalBp),
          impuesto_al_cheque: bpLabel(taxes.bankTaxBp),
          base: TAX_BASE_WORDS[taxes.base],
        }
      : 'No se pudieron leer.',
    puntos_de_venta:
      points.length > 0
        ? points.map((point) => ({ numero: point.number, nombre: point.label }))
        : null,
  })
}

/** Los datos del bar y los impuestos. */
export const ajustesReadTools = [
  defineTool({
    name: 'ver_ajustes',
    description:
      'Datos del bar (razón social, CUIT, condición de IVA), porcentajes de impuestos (Ingresos Brutos, Comercio e Industria, cheque), desde cuándo van los libros y puntos de venta.',
    input: noInput,
    need: 'read',
    doing: () => 'Mirando los ajustes',
    done: () => 'Miré los ajustes',
    run: async (_input, ctx) => {
      const [settings, catalog, points] = await Promise.all([
        getAccountingSettings(ctx.tenantId),
        settleQuery(loadPostingCatalog(ctx.tenantId)),
        settleQuery(listSalesPoints(ctx.tenantId)),
      ])
      return {
        kind: 'data',
        data: settingsData(
          settings,
          catalog.ok ? catalog.data.settings.taxSettings : null,
          points.ok ? points.data : [],
        ),
      }
    },
  }),
]
