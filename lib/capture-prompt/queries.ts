import 'server-only'
import { createClient } from '@/lib/supabase/server'
import {
  type CapturePromptConfig,
  capturePromptConfigSchema,
  DEFAULT_CAPTURE_PROMPT,
} from './schemas'

export async function getCapturePromptConfig(tenantId: string): Promise<CapturePromptConfig> {
  const supabase = await createClient()
  const { data } = await supabase
    .from('tenants')
    .select('settings')
    .eq('id', tenantId)
    .maybeSingle()
  const settings = (data?.settings ?? {}) as Record<string, unknown>
  const parsed = capturePromptConfigSchema.safeParse(settings.capture_prompt)
  return parsed.success ? parsed.data : DEFAULT_CAPTURE_PROMPT
}
