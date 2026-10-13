import { Panel } from '@/components/administracion/kit/panel'
import { noticeAttention } from '@/lib/accounting/home'
import { AttentionRows, type AttentionWords } from './attention-rows'
import type { HomeData } from './home-data'
import {
  attentionView,
  integrationAttentionView,
  integrationFailedView,
  mergeAttentionViews,
} from './summary-copy'

const NOTICE_WORDS: AttentionWords = {
  danger: 'Urgente',
  warning: 'Pendiente',
  info: 'Para revisar',
}

/**
 * «Avisos»: lo que queda de los avisos del resumen y de las integraciones
 * (ARCA, Mercado Pago, el banco, Mis Comprobantes) una vez sacado lo que ya se
 * cuenta en otro lado de la pantalla, para no decir dos veces lo mismo:
 *
 * - lo de pagar está en «Lo que tenés que pagar»;
 * - lo que ya es una tarjeta de «Hoy te toca» (los cierres que faltan, el
 *   gasto fijo por vencer, lo importado para revisar…) lo dice esa tarjeta;
 * - el CUIT que falta está en la franja de la puesta en marcha.
 *
 * Sin avisos el bloque no se dibuja: «Hoy te toca» ya dice cómo está el día
 * (antes acá decía «Está todo al día» aunque faltaran los saldos iniciales).
 */
export async function NoticesBlock({ data }: { data: HomeData }) {
  const [summaryResult, agenda, integrationResult] = await Promise.all([
    data.summary,
    data.agenda,
    data.integration,
  ])
  const { base, today } = data
  const covered = new Set(agenda.today.flatMap((item) => item.covers))
  const cuitInSetup =
    !agenda.setup.complete && agenda.setup.steps.some((s) => s.id === 'sas_data' && !s.done)

  const items = summaryResult.ok
    ? noticeAttention(summaryResult.data.attention).filter(
        (item) => !covered.has(item.kind) && !(cuitInSetup && item.kind === 'sas_cuit_missing'),
      )
    : []
  const integration = integrationResult?.ok
    ? integrationResult.data.filter((item) => !covered.has(item.kind))
    : []
  const integrationFailed = integrationResult !== null && !integrationResult.ok

  const views = mergeAttentionViews(
    items.map((item, index) => attentionView(item, today, base, index)),
    [
      ...integration.map((item, index) => integrationAttentionView(item, base, index)),
      ...(integrationFailed ? [integrationFailedView()] : []),
    ],
  )
  if (views.length === 0) return null

  return (
    <Panel
      title={views.length === 1 ? 'Hay 1 aviso' : `Hay ${views.length} avisos`}
      description="Lo que no es de todos los días, lo más urgente primero."
    >
      <AttentionRows views={views} words={NOTICE_WORDS} />
    </Panel>
  )
}
