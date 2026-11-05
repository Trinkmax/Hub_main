/**
 * El catálogo que lee `loadPostingCatalog`, armado con el contexto de prueba del motor: para probar las
 * herramientas de Tex de punta a punta sin base.
 */

import type { PostingCatalog } from '@/lib/accounting/context'
import type { CoreFixture } from './accounting-core-context'

export function catalogOf(f: CoreFixture, tenantId: string): PostingCatalog {
  return {
    tenantId,
    today: f.ctx.today,
    settings: {
      ...f.ctx.settings,
      iibbJurisdictionCode: 904,
    } as unknown as PostingCatalog['settings'],
    accounts: [...f.ctx.accounts.values()].map((a) => ({
      ...a,
      parentId: null,
      level: 4,
      manualSelectable: true,
      sort: 0,
    })),
    parties: [...f.ctx.parties.values()].map((p) => ({
      ...p,
      systemKey: p.systemKey ?? null,
      defaultAccountId: null,
      defaultVoucherType: null,
      updatedAt: '2026-10-01T12:00:00+00:00',
    })),
    treasuries: [...f.ctx.treasuries.values()].map((t, sort) => ({
      ...t,
      accountCode: '',
      bankName: null,
      cbuCvu: null,
      alias: null,
      accountNumber: null,
      lastCheckedOn: null,
      sort,
      systemKey: null,
      updatedAt: null,
    })),
    methods: [...f.ctx.methods.values()].map((m) => ({
      ...m,
      active: true,
      systemKey: null,
      updatedAt: null,
    })),
    salesPoints: [...f.ctx.salesPoints.values()].map((s, i) => ({
      ...s,
      id: `00000000-0000-4000-8000-00000000050${i}`,
      active: true,
      updatedAt: null,
    })),
  }
}
