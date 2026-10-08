/**
 * La segunda fuente de «Necesita atención» del Resumen (diseño §5.2.4, WP11):
 * los avisos de ARCA, Mercado Pago, el banco y Mis Comprobantes entran en su
 * lugar por urgencia sin cambiar el orden que trae `acc_report_summary`.
 */

import { describe, expect, it } from 'vitest'
import {
  type AttentionTone,
  type AttentionView,
  integrationAttentionView,
  integrationFailedView,
  mergeAttentionViews,
} from '@/app/(manager)/[tenantSlug]/administracion/_resumen/summary-copy'
import type { IntegrationAttentionItem } from '@/lib/accounting/queries/integrations'

const BASE = '/bar-demo/administracion'

function view(key: string, tone: AttentionTone): AttentionView {
  return { key, text: key, amountCents: null, amountPrefix: null, tone, actions: [] }
}

function keys(views: readonly AttentionView[]): string[] {
  return views.map((v) => v.key)
}

const ARCA_ERROR: IntegrationAttentionItem = {
  kind: 'arca_error',
  tone: 'danger',
  label: 'ARCA dio error en la última prueba de conexión.',
  href: '/ajustes?tab=arca',
  actionLabel: 'Cómo se arregla',
  count: null,
  date: null,
}

describe('un aviso de las integraciones como fila', () => {
  it('su texto, su urgencia y un botón a la pantalla que lo resuelve', () => {
    expect(integrationAttentionView(ARCA_ERROR, BASE, 0)).toEqual({
      key: 'integracion:arca_error:0',
      text: 'ARCA dio error en la última prueba de conexión.',
      amountCents: null,
      amountPrefix: null,
      tone: 'danger',
      actions: [{ type: 'link', label: 'Cómo se arregla', href: `${BASE}/ajustes?tab=arca` }],
    })
  })

  it('si no se pudieron revisar, una fila lo dice con «Reintentar»', () => {
    expect(integrationFailedView()).toMatchObject({
      tone: 'info',
      text: 'No pudimos revisar ARCA ni los importadores.',
      actions: [{ type: 'retry', label: 'Reintentar' }],
    })
  })
})

describe('juntar las dos fuentes', () => {
  it('sin avisos nuevos, la lista del Resumen queda igual', () => {
    const summary = [view('a', 'danger'), view('b', 'warning'), view('c', 'info')]
    expect(mergeAttentionViews(summary, [])).toEqual(summary)
    expect(keys(mergeAttentionViews([], [view('x', 'info'), view('y', 'danger')]))).toEqual([
      'y',
      'x',
    ])
  })

  it('cada aviso entra antes de la primera fila menos urgente, después de las de su urgencia', () => {
    const summary = [
      view('vencida', 'danger'),
      view('vence-semana', 'warning'),
      view('cierre', 'warning'),
      view('caja', 'info'),
      view('mes', 'info'),
    ]
    const extra = [view('mc', 'info'), view('lote', 'warning'), view('arca', 'danger')]
    expect(keys(mergeAttentionViews(summary, extra))).toEqual([
      'vencida',
      'arca',
      'vence-semana',
      'cierre',
      'lote',
      'caja',
      'mes',
      'mc',
    ])
  })

  it('no reordena lo que trae la base (la CUIT que falta va al final aunque sea amarilla)', () => {
    const summary = [view('caja', 'info'), view('cuit', 'warning')]
    expect(keys(mergeAttentionViews(summary, [view('lote', 'warning')]))).toEqual([
      'lote',
      'caja',
      'cuit',
    ])
  })

  it('a igual urgencia, los avisos nuevos mantienen su orden', () => {
    const extra = [view('uno', 'warning'), view('dos', 'danger'), view('tres', 'warning')]
    expect(keys(mergeAttentionViews([view('base', 'info')], extra))).toEqual([
      'dos',
      'uno',
      'tres',
      'base',
    ])
  })
})
