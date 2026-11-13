'use server'

import { revalidatePath } from 'next/cache'
import { logAudit } from '@/lib/audit'
import { authorizeSetup } from '@/lib/pos/branches/authorize'
import { planSettingsPatch } from './patch'
import { readPosSettings, untypedClient } from './queries'
import { rowPatch, SETTINGS_COLUMNS, type SettingsRow, settingsFromRow } from './row'
import { parseSettingChanges } from './schemas'
import type { PosSettings, SettingKey, SettingsWriteResult } from './types'

/**
 * Lo que escribe «Ajustes del punto de venta». Un ajuste se guarda solo, apenas se toca, así
 * que la acción es una sola y chica: quién sos y si podés, qué mandaste, y escribir sin pisar
 * a nadie.
 *
 * Sin pisar a nadie: cada cambio trae lo que la persona veía. Se lee la fila de AHORA, se
 * decide con `planSettingsPatch` y se escribe solo si la fila no cambió entre la lectura y la
 * escritura (la versión es su `updated_at`). Si cambió, se vuelve a leer y a decidir.
 */

const INVALID = 'No pudimos leer lo que mandó la pantalla. Recargá la página y probá de nuevo.'
const READ_FAILED = 'No pudimos leer los ajustes de la base. Probá de nuevo en un momento.'
const NOT_SAVED = 'No se guardó. Revisá la conexión y probá de nuevo.'
const CHANGED =
  'Otro dueño cambió esto recién y no se guardó lo tuyo. Ya ves cómo quedó: si querés otra cosa, cambialo de nuevo.'
const BUSY = 'Alguien más está cambiando los ajustes en este momento. Probá de nuevo.'

/** Cuántas veces se reintenta cuando otra escritura se mete entre la lectura y la nuestra. */
const ATTEMPTS = 3

/** Los ajustes cuyo valor no se copia a la auditoría: pueden nombrar a una persona. */
const PRIVATE_KEYS: ReadonlySet<SettingKey> = new Set(['transferAlias', 'transferHolder'])

function auditPayload(keys: ReadonlyArray<SettingKey>, before: PosSettings, after: PosSettings) {
  const changes: Record<string, unknown> = {}
  for (const key of keys) {
    changes[key] = PRIVATE_KEYS.has(key)
      ? { set: after[key] !== null }
      : { from: before[key], to: after[key] }
  }
  return { changes }
}

export async function savePosSettings(slug: string, input: unknown): Promise<SettingsWriteResult> {
  const auth = await authorizeSetup(slug)
  if (!auth.ok) return { ok: false, code: auth.code, message: auth.message }
  const parsed = parseSettingChanges(input)
  if (!parsed.ok) return { ok: false, code: 'invalid', message: parsed.message ?? INVALID }
  const { tenantId, userId } = auth

  const supabase = await untypedClient()

  for (let attempt = 0; attempt < ATTEMPTS; attempt++) {
    let read: Awaited<ReturnType<typeof readPosSettings>>
    try {
      read = await readPosSettings(supabase, tenantId)
    } catch {
      return { ok: false, code: 'error', message: READ_FAILED }
    }
    const { settings: current, version } = read
    const plan = planSettingsPatch(current, parsed.changes)

    if (plan.kind === 'noop') return { ok: true, savedAt: Date.now(), settings: current }
    if (plan.kind === 'invalid') return { ok: false, code: 'invalid', message: plan.message }
    if (plan.kind === 'conflict') {
      return { ok: false, code: 'changed', message: CHANGED, current }
    }

    const patch = { ...rowPatch(plan.keys, plan.next), updated_by: userId }
    const write =
      version === null
        ? // El bar todavía no tenía fila: nace con lo que cambia (el resto, los de fábrica).
          supabase
            .from('pos_settings')
            .insert({ tenant_id: tenantId, ...patch })
            .select(SETTINGS_COLUMNS)
        : supabase
            .from('pos_settings')
            .update(patch)
            .eq('tenant_id', tenantId)
            .eq('updated_at', version)
            .select(SETTINGS_COLUMNS)
    const { data, error } = await write

    if (error) {
      // 23505: otro dueño creó la fila en el mismo instante. Se vuelve a leer y a decidir.
      if (error.code === '23505') continue
      console.error('[pos.settings.save]', error.code, error.message)
      // 23514: una regla de la tabla (un tope, el rojo antes del aviso). No es de conexión.
      if (error.code === '23514') return { ok: false, code: 'invalid', message: INVALID }
      return { ok: false, code: 'error', message: NOT_SAVED }
    }
    const row = ((data ?? []) as unknown as SettingsRow[])[0]
    // Nadie quedó escrito: la fila cambió entre la lectura y la escritura. Otra vuelta.
    if (!row) continue

    const savedAt = Date.now()
    const settings = settingsFromRow(row)
    await logAudit({
      tenantId,
      userId,
      action: 'pos.settings_changed',
      entity: 'pos_settings',
      payload: auditPayload(plan.keys, current, settings),
    })
    revalidatePath(`/${slug}/local/sucursales`)
    return { ok: true, savedAt, settings }
  }

  return { ok: false, code: 'error', message: BUSY }
}
