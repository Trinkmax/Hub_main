import 'server-only'
import { createClient } from '@/lib/supabase/server'

// Tipos mínimos de las tablas/joins nuevos. Cuando se regenere database.ts,
// estos tipos siguen siendo compatibles (son aditivos).
export type WelcomeRewardRewardInfo = {
  id: string
  name: string
  description: string | null
  image_url: string | null
  stock: number | null
  active: boolean
  cost_points: number
}

export type WelcomeRewardConfigWithReward = {
  tenant_id: string
  enabled: boolean
  reward_id: string | null
  headline: string
  subtext: string
  updated_at: string | null
  reward: WelcomeRewardRewardInfo | null
}

const DEFAULT_HEADLINE = 'Regalo de bienvenida'
const DEFAULT_SUBTEXT = 'Registrate y llevátelo gratis'

// Lee la config del welcome reward del tenant con el reward joinado.
// Si la fila no existe, devuelve un default coherente (enabled=false, sin reward).
// Esto simplifica la UI: nunca hay caso "no existe", siempre hay un default.
export async function getWelcomeRewardConfig(
  tenantId: string,
): Promise<WelcomeRewardConfigWithReward> {
  const supabase = await createClient()
  const { data, error } = await supabase
    // biome-ignore lint/suspicious/noExplicitAny: tabla nueva sin tipos regenerados
    .from('welcome_reward_configs' as any)
    .select(
      'tenant_id, enabled, reward_id, headline, subtext, updated_at, reward:rewards(id, name, description, image_url, stock, active, cost_points)',
    )
    .eq('tenant_id', tenantId)
    .maybeSingle()

  if (error) {
    console.error('[welcome-reward.getWelcomeRewardConfig]', error.message)
    return {
      tenant_id: tenantId,
      enabled: false,
      reward_id: null,
      headline: DEFAULT_HEADLINE,
      subtext: DEFAULT_SUBTEXT,
      updated_at: null,
      reward: null,
    }
  }

  if (!data) {
    return {
      tenant_id: tenantId,
      enabled: false,
      reward_id: null,
      headline: DEFAULT_HEADLINE,
      subtext: DEFAULT_SUBTEXT,
      updated_at: null,
      reward: null,
    }
  }

  type Raw = {
    tenant_id: string
    enabled: boolean
    reward_id: string | null
    headline: string
    subtext: string
    updated_at: string | null
    reward: WelcomeRewardRewardInfo | WelcomeRewardRewardInfo[] | null
  }
  const r = data as unknown as Raw
  const reward = Array.isArray(r.reward) ? (r.reward[0] ?? null) : (r.reward ?? null)

  return {
    tenant_id: r.tenant_id,
    enabled: r.enabled,
    reward_id: r.reward_id,
    headline: r.headline,
    subtext: r.subtext,
    updated_at: r.updated_at,
    reward,
  }
}

export type WelcomeRewardMonthlyStat = {
  month: string // formato YYYY-MM
  count: number
}

// Cuenta grants por mes (últimos 6) — útil para analytics futura.
// No exhaustivo: si no hay grants devuelve [].
export async function getWelcomeRewardStats(tenantId: string): Promise<WelcomeRewardMonthlyStat[]> {
  const supabase = await createClient()
  const sixMonthsAgo = new Date()
  sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6)

  const { data, error } = await supabase
    // biome-ignore lint/suspicious/noExplicitAny: tabla nueva sin tipos regenerados
    .from('welcome_reward_grants' as any)
    .select('granted_at')
    .eq('tenant_id', tenantId)
    .gte('granted_at', sixMonthsAgo.toISOString())
    .order('granted_at', { ascending: true })

  if (error || !data) {
    if (error) console.error('[welcome-reward.getWelcomeRewardStats]', error.message)
    return []
  }

  const counts = new Map<string, number>()
  for (const row of data as unknown as Array<{ granted_at: string }>) {
    const d = new Date(row.granted_at)
    const month = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`
    counts.set(month, (counts.get(month) ?? 0) + 1)
  }

  return Array.from(counts.entries())
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([month, count]) => ({ month, count }))
}
