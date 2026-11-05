import { randomUUID } from 'node:crypto'
import type { SupabaseClient } from '@supabase/supabase-js'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { getAnonClient, getServiceClient, RLS_TESTS_ENABLED, uniqueSlug } from './setup'

/**
 * Las automatizaciones de tiempo entran una vez por ocasión (migración 20261105140000): antes, quien terminaba y seguía
 * cumpliendo volvía a entrar cada 15 minutos y le volvía a llegar el mensaje. Corre contra el Supabase local del job
 * `rls`; las funciones solo las ejecuta `service_role`, como el cron.
 */

const describeIfRls = RLS_TESTS_ENABLED ? describe : describe.skip

describeIfRls('Automatizaciones de tiempo: una vez por ocasión', () => {
  let service: SupabaseClient
  let tenantId: string
  let customerId: string
  const flows: Record<'birthday' | 'inactive' | 'event' | 'visit', string> = {
    birthday: '',
    inactive: '',
    event: '',
    visit: '',
  }

  const flow = async (name: string, trigger_type: string, trigger_config: object) => {
    const { data, error } = await service
      .from('flows')
      .insert({ tenant_id: tenantId, name, trigger_type, trigger_config, active: true })
      .select('id')
      .single()
    if (error || !data) throw new Error(`flow ${name}: ${error?.message}`)
    return (data as { id: string }).id
  }

  const start = async (flowId: string, context: object = {}) => {
    const { data, error } = await service.rpc('start_flow_for_customer', {
      p_flow_id: flowId,
      p_customer_id: customerId,
      p_context: context,
    })
    if (error) throw new Error(`start_flow_for_customer: ${error.message}`)
    return data as string | null
  }

  const finish = async (executionId: string, startedAt?: string) => {
    const { error } = await service
      .from('flow_executions')
      .update({
        status: 'completed',
        completed_at: new Date().toISOString(),
        ...(startedAt ? { started_at: startedAt } : {}),
      })
      .eq('id', executionId)
    if (error) throw new Error(`finish: ${error.message}`)
  }

  const candidates = async (fn: string, args: Record<string, unknown>) => {
    const { data, error } = await service.rpc(fn, args)
    if (error) throw new Error(`${fn}: ${error.message}`)
    return ((data ?? []) as Array<{ customer_id: string }>).some(
      (r) => r.customer_id === customerId,
    )
  }

  const daysAgo = (days: number) => new Date(Date.now() - days * 86_400_000).toISOString()

  beforeAll(async () => {
    service = getServiceClient()
    const { data: tenant, error } = await service
      .from('tenants')
      .insert({ name: 'Bar de las automatizaciones', slug: uniqueSlug('flows-tiempo') })
      .select('id')
      .single()
    if (error || !tenant) throw new Error(`tenant: ${error?.message}`)
    tenantId = (tenant as { id: string }).id
    const today = new Date().toISOString().slice(0, 10)
    const { data: customer, error: customerError } = await service
      .from('customers')
      .insert({
        tenant_id: tenantId,
        first_name: 'Ana',
        last_name: 'Cumple',
        phone: `+54935100${String(Date.now()).slice(-5)}`,
        birthdate: `1996${today.slice(4)}`,
        opt_in_marketing: true,
        last_visit_at: daysAgo(40),
      })
      .select('id')
      .single()
    if (customerError || !customer) throw new Error(`customer: ${customerError?.message}`)
    customerId = (customer as { id: string }).id
    flows.birthday = await flow('Cumpleaños', 'birthday', { type: 'birthday', offset_days: 0 })
    flows.inactive = await flow('Te extrañamos', 'customer_inactive', {
      type: 'customer_inactive',
      days: 30,
    })
    flows.event = await flow('Se acerca', 'event_starting', {
      type: 'event_starting',
      hours_before: 24,
    })
    flows.visit = await flow('Gracias por venir', 'after_visit', { type: 'after_visit' })
  })

  afterAll(async () => {
    await service.from('tenants').delete().eq('id', tenantId)
  })

  it('cumpleaños: entra una vez, y al año siguiente otra vez', async () => {
    const args = { p_flow_id: flows.birthday }
    expect(await candidates('customers_for_birthday_flow', args)).toBe(true)
    const execution = await start(flows.birthday)
    expect(execution).not.toBeNull()
    await finish(execution as string)
    expect(await candidates('customers_for_birthday_flow', args)).toBe(false)
    expect(await start(flows.birthday)).toBeNull()
    await finish(execution as string, daysAgo(365))
    expect(await candidates('customers_for_birthday_flow', args)).toBe(true)
  })

  it('hace tiempo que no viene: una vez cada vez que deja de venir', async () => {
    const args = { p_flow_id: flows.inactive, p_days: 30 }
    expect(await candidates('customers_for_inactive_flow', args)).toBe(true)
    const execution = await start(flows.inactive)
    expect(execution).not.toBeNull()
    await finish(execution as string)
    expect(await candidates('customers_for_inactive_flow', args)).toBe(false)
    expect(await start(flows.inactive)).toBeNull()
    // Volvió después de aquella vez y de nuevo dejó de venir: le corresponde otra.
    await finish(execution as string, daysAgo(90))
    await service
      .from('customers')
      .update({ last_visit_at: daysAgo(45) })
      .eq('id', customerId)
    expect(await candidates('customers_for_inactive_flow', args)).toBe(true)
  })

  it('se acerca un evento: una vez por evento', async () => {
    const eventA = { scheduled_event_id: randomUUID() }
    const eventB = { scheduled_event_id: randomUUID() }
    const execution = await start(flows.event, eventA)
    expect(execution).not.toBeNull()
    await finish(execution as string)
    expect(await start(flows.event, eventA)).toBeNull()
    expect(await start(flows.event, eventB)).not.toBeNull()
  })

  it('después de una visita: cada vez, salvo que todavía esté adentro', async () => {
    const execution = await start(flows.visit)
    expect(execution).not.toBeNull()
    expect(await start(flows.visit)).toBeNull()
    await finish(execution as string)
    expect(await start(flows.visit)).not.toBeNull()
  })

  it('nadie más que el servidor corre estas funciones', async () => {
    const { error } = await getAnonClient().rpc('flow_already_enrolled', {
      p_flow_id: flows.visit,
      p_customer_id: customerId,
    })
    expect(error).not.toBeNull()
  })
})
