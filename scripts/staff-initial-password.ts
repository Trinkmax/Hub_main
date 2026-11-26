/**
 * Pone una PRIMERA contraseña a las cuentas del equipo de un bar y las deja marcadas para que cada
 * persona elija la suya apenas entra (`app_metadata.must_change_password`; el proxy no deja pasar a
 * ninguna otra pantalla hasta que la cambie, ver `lib/auth/first-password.ts`).
 *
 *   INITIAL_PASSWORD='…' npx tsx scripts/staff-initial-password.ts <slug-del-bar> \
 *     [--roles=waiter,cashier] [--incluir-los-que-ya-entraron] [--aplicar]
 *
 * - Sin `--aplicar` es un ENSAYO: dice a quiénes les tocaría y no cambia nada.
 * - Por defecto toca solo a quien NUNCA entró: a quien ya eligió su contraseña no se le pisa.
 * - La contraseña no vive en el repo ni se imprime: llega por la variable INITIAL_PASSWORD.
 * - No muestra mails: de cada cuenta dice el rol y el nombre corto.
 * - Cada cambio queda en `audit_log` (`membership.initial_password_set`).
 *
 * Script admin: usa SUPABASE_SERVICE_ROLE_KEY de .env/.env.local y siempre trabaja sobre UN bar, el
 * del slug que se le pasa (CLAUDE.md §4).
 */

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { createClient } from '@supabase/supabase-js'

const STAFF_ROLES = ['waiter', 'cashier', 'kitchen', 'host', 'editor', 'accountant'] as const
type StaffRole = (typeof STAFF_ROLES)[number]

function loadEnv(): Record<string, string> {
  const out: Record<string, string> = {}
  for (const file of ['.env', '.env.local']) {
    try {
      const raw = readFileSync(resolve(process.cwd(), file), 'utf8')
      for (const line of raw.split('\n')) {
        const trimmed = line.trim()
        if (trimmed.length === 0 || trimmed.startsWith('#')) continue
        const eq = trimmed.indexOf('=')
        if (eq === -1) continue
        const key = trimmed.slice(0, eq).trim()
        let value = trimmed.slice(eq + 1).trim()
        if (
          (value.startsWith('"') && value.endsWith('"')) ||
          (value.startsWith("'") && value.endsWith("'"))
        ) {
          value = value.slice(1, -1)
        }
        out[key] = value
      }
    } catch {
      // archivo opcional
    }
  }
  return { ...out, ...(process.env as Record<string, string>) }
}

/** «Juan P.»: alcanza para reconocer a la persona sin dejar su mail ni su apellido en la terminal. */
function shortName(user: { email?: string | null; user_metadata?: Record<string, unknown> }) {
  const meta = user.user_metadata ?? {}
  const full = [meta.full_name, meta.name].find(
    (value): value is string => typeof value === 'string' && value.trim().length > 0,
  )
  const source = (full ?? user.email?.split('@')[0] ?? 'sin nombre').trim()
  const [first = 'sin nombre', second] = source.split(/[\s._-]+/)
  return second ? `${first} ${second.charAt(0).toUpperCase()}.` : first
}

async function main() {
  const args = process.argv.slice(2)
  const slug = args.find((arg) => !arg.startsWith('--'))
  const apply = args.includes('--aplicar')
  const everyone = args.includes('--incluir-los-que-ya-entraron')
  const rolesArg = args.find((arg) => arg.startsWith('--roles='))?.slice('--roles='.length)
  const roles = (rolesArg ?? 'waiter,cashier').split(',').map((role) => role.trim())

  if (!slug) throw new Error('Falta el slug del bar.')
  const unknown = roles.filter((role) => !(STAFF_ROLES as readonly string[]).includes(role))
  if (unknown.length > 0) {
    throw new Error(`Roles que no son del equipo: ${unknown.join(', ')} (los dueños no se tocan).`)
  }

  const env = loadEnv()
  const password = env.INITIAL_PASSWORD ?? ''
  // La misma regla que valida la app (`lib/auth/schemas.ts`).
  if (password.length < 8 || !/[a-zA-Z]/.test(password) || !/\d/.test(password)) {
    throw new Error('INITIAL_PASSWORD tiene que tener 8 caracteres o más, con letras y números.')
  }
  const url = env.NEXT_PUBLIC_SUPABASE_URL
  const serviceKey = env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !serviceKey)
    throw new Error('Faltan NEXT_PUBLIC_SUPABASE_URL o la clave de servicio.')

  const supabase = createClient(url, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  })

  const { data: tenant, error: tenantError } = await supabase
    .from('tenants')
    .select('id, name')
    .eq('slug', slug)
    .maybeSingle()
  if (tenantError) throw new Error(`tenants: ${tenantError.message}`)
  if (!tenant) throw new Error(`No existe un bar con el slug «${slug}».`)

  const { data: memberships, error: membersError } = await supabase
    .from('memberships')
    .select('id, user_id, role')
    .eq('tenant_id', tenant.id)
    .in('role', roles as StaffRole[])
    .order('role', { ascending: true })
    .order('created_at', { ascending: true })
  if (membersError) throw new Error(`memberships: ${membersError.message}`)

  console.log(`${apply ? 'APLICANDO' : 'ENSAYO'} · ${tenant.name} · roles: ${roles.join(', ')}`)
  let touched = 0
  let skipped = 0
  let failed = 0

  for (const membership of memberships ?? []) {
    const { data: found, error: userError } = await supabase.auth.admin.getUserById(
      membership.user_id,
    )
    const user = found?.user
    if (userError || !user) {
      failed += 1
      console.log(`  ✗ ${membership.role}: no pude leer la cuenta`)
      continue
    }
    const name = shortName(user)
    if (user.last_sign_in_at && !everyone) {
      skipped += 1
      console.log(`  · ${membership.role}  ${name}: ya entró alguna vez, no se toca`)
      continue
    }
    // Una cuenta que también es de otro bar no se pisa desde acá: su contraseña no es solo de este.
    const { count: elsewhere } = await supabase
      .from('memberships')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', membership.user_id)
      .neq('tenant_id', tenant.id)
    if ((elsewhere ?? 0) > 0) {
      skipped += 1
      console.log(`  · ${membership.role}  ${name}: también está en otro bar, no se toca`)
      continue
    }

    if (!apply) {
      touched += 1
      console.log(`  → ${membership.role}  ${name}: le tocaría`)
      continue
    }

    const { error: updateError } = await supabase.auth.admin.updateUserById(membership.user_id, {
      password,
      app_metadata: { must_change_password: true },
    })
    if (updateError) {
      failed += 1
      console.log(`  ✗ ${membership.role}  ${name}: ${updateError.message}`)
      continue
    }
    const { error: auditError } = await supabase.from('audit_log').insert({
      tenant_id: tenant.id,
      user_id: null,
      action: 'membership.initial_password_set',
      entity: 'membership',
      entity_id: membership.id,
      payload: { source: 'platform', role: membership.role, must_change: true },
    })
    touched += 1
    console.log(
      `  ✓ ${membership.role}  ${name}: primera contraseña puesta${auditError ? ' (sin dejar registro)' : ''}`,
    )
  }

  console.log(
    `${apply ? 'Listo' : 'Ensayo'}: ${touched} ${apply ? 'cambiadas' : 'para cambiar'}, ${skipped} sin tocar, ${failed} con error.`,
  )
  if (failed > 0) process.exitCode = 1
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error)
  process.exitCode = 1
})
