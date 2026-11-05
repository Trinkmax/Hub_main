/**
 * Lo que arma Tex, contra las server actions DE VERDAD: las mismas consultas, los mismos esquemas y el
 * mismo FormData que el formulario. Lo único de mentira es la base y la salida hacia Meta: si una
 * herramienta armara algo que la acción no acepta, esto se cae. No sale ningún mensaje real.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('@/lib/supabase/server', async () => {
  const { fake, fakeClient } = await import('./tex-mensajeria-kit')
  return { createClient: async () => fakeClient(fake.db, '00000000-0000-4000-8000-0000000000cc') }
})
vi.mock('@/lib/supabase/service', async () => {
  const { fake, fakeClient } = await import('./tex-mensajeria-kit')
  return { createServiceClient: () => fakeClient(fake.db, 'service') }
})
vi.mock('@/lib/tenant', async (original) => ({
  ...(await original<typeof import('@/lib/tenant')>()),
  requireTenantAccess: vi.fn(),
}))
vi.mock('@/lib/meta/whatsapp', () => ({
  sendText: vi.fn(),
  sendTemplate: vi.fn(),
  markRead: vi.fn(),
}))
vi.mock('@/lib/meta/instagram', () => ({ sendDM: vi.fn() }))
vi.mock('@/lib/meta/templates', () => ({ syncTemplates: vi.fn() }))
vi.mock('@/lib/jobs/queue', () => ({ enqueueJob: vi.fn() }))
vi.mock('@/lib/accounting/server/post-document', () => ({
  runPreviewDocument: vi.fn(),
  runPostDocument: vi.fn(),
}))

import { enqueueJob } from '@/lib/jobs/queue'
import { sendDM } from '@/lib/meta/instagram'
import { sendTemplate, sendText } from '@/lib/meta/whatsapp'
import { requireTenantAccess } from '@/lib/tenant'
import { mensajeriaArea } from '@/lib/tex/areas/mensajeria'
import type { TexExecution, TexToolContext } from '@/lib/tex/tools/types'
import { asPrepared, rowValue, runTool, TEX_CTX } from './tex-actions-kit'
import { FakeDb, type FakeRow, fake } from './tex-mensajeria-kit'

const NOW = new Date('2026-11-05T15:00:00.000Z')
const CTX: TexToolContext = { ...TEX_CTX, today: '2026-11-05' }
const TENANT = CTX.tenantId
const uuid = (n: number) => `00000000-0000-4000-8000-1${String(n).padStart(11, '0')}`
const hoursAgo = (hours: number) => new Date(NOW.getTime() - hours * 3600_000).toISOString()

const CHANNEL = uuid(1)
const CONV_ANA = uuid(11)
const CONV_BETO = uuid(12)
const ANA = uuid(21)
const BETO = uuid(22)
const TEMPLATE = uuid(31)
const AUDIENCE = uuid(41)
const SCHEDULED = uuid(51)
const FLOW = uuid(61)
const TRIGGER_NODE = uuid(62)
const SEND_NODE = uuid(63)
const TAG_VIP = uuid(71)
const TAG_RESERVAS = uuid(72)
const TASK = uuid(81)
const ROUTINE = uuid(82)
const PHONE_ANA = '543515551234'

const everyone = { kind: 'group', op: 'AND', nodes: [] }

function tables(): Record<string, FakeRow[]> {
  return {
    channels: [
      {
        id: CHANNEL,
        tenant_id: TENANT,
        type: 'whatsapp',
        status: 'connected',
        display_name: 'HUB',
        encrypted_access_token: 'secreto',
        external_phone_number_id: 'phone',
      },
    ],
    conversations: [
      {
        id: CONV_ANA,
        tenant_id: TENANT,
        channel_id: CHANNEL,
        external_user_id: PHONE_ANA,
        customer_id: ANA,
        last_inbound_at: hoursAgo(2),
        last_message_at: hoursAgo(2),
        unread_count: 1,
        last_message_preview: 'Hola',
        last_message_direction: 'inbound',
        customer: { first_name: 'Ana', last_name: 'Pérez' },
        channel: { type: 'whatsapp' },
        tag_assignments: [],
      },
      {
        id: CONV_BETO,
        tenant_id: TENANT,
        channel_id: CHANNEL,
        external_user_id: '543515559876',
        customer_id: BETO,
        last_inbound_at: hoursAgo(40),
        last_message_at: hoursAgo(40),
        unread_count: 0,
        last_message_preview: 'gracias',
        last_message_direction: 'inbound',
        customer: { first_name: 'Beto', last_name: 'Gómez' },
        channel: { type: 'whatsapp' },
        tag_assignments: [],
      },
    ],
    customers: [
      {
        id: ANA,
        tenant_id: TENANT,
        first_name: 'Ana',
        last_name: 'Pérez',
        phone: '+5493515551234',
        opt_in_marketing: true,
        is_blocked: false,
        deleted_at: null,
      },
      {
        id: BETO,
        tenant_id: TENANT,
        first_name: 'Beto',
        last_name: 'Gómez',
        phone: '+5493515559876',
        opt_in_marketing: true,
        is_blocked: false,
        deleted_at: null,
      },
    ],
    messages: [],
    message_templates: [
      {
        id: TEMPLATE,
        tenant_id: TENANT,
        name: 'promo_finde',
        language: 'es_AR',
        category: 'MARKETING',
        status: 'approved',
        channel_id: CHANNEL,
        components: [{ type: 'BODY', text: 'Hola {{1}}, este finde hay 2x1.' }],
        variable_hints: { '1': 'first_name' },
        last_synced_at: null,
      },
    ],
    audiences: [
      {
        id: AUDIENCE,
        tenant_id: TENANT,
        name: 'Todos',
        filters: everyone,
        customer_count_cached: 2,
        last_calculated_at: null,
        updated_at: hoursAgo(1),
      },
    ],
    broadcasts: [
      {
        id: SCHEDULED,
        tenant_id: TENANT,
        name: 'Peña',
        status: 'scheduled',
        stats: {},
        scheduled_at: '2026-11-07T23:00:00.000Z',
        started_at: null,
        completed_at: null,
        audience_id: AUDIENCE,
        template_id: TEMPLATE,
        channel_id: CHANNEL,
        created_at: hoursAgo(5),
      },
    ],
    broadcast_recipients: [],
    flows: [
      {
        id: FLOW,
        tenant_id: TENANT,
        name: 'Gracias',
        trigger_type: 'after_visit',
        trigger_config: { type: 'after_visit' },
        active: false,
        updated_at: hoursAgo(1),
        steps: [{ count: 0 }],
      },
    ],
    flow_steps: [],
    flow_nodes: [
      {
        id: TRIGGER_NODE,
        flow_id: FLOW,
        kind: 'trigger',
        position: { x: 0, y: 0 },
        config: {},
        created_at: hoursAgo(2),
      },
      {
        id: SEND_NODE,
        flow_id: FLOW,
        kind: 'send_template',
        position: { x: 0, y: 1 },
        config: { channel_id: CHANNEL, template_id: TEMPLATE, variables: [] },
        created_at: hoursAgo(1),
      },
    ],
    flow_edges: [
      {
        id: uuid(64),
        flow_id: FLOW,
        source_node_id: TRIGGER_NODE,
        target_node_id: SEND_NODE,
        source_handle: null,
      },
    ],
    flow_executions: [],
    customer_tags: [],
    loyalty_tiers: [],
    scheduled_events: [],
    conversation_tags: [
      { id: TAG_VIP, tenant_id: TENANT, name: 'VIP', color: '#94a3b8' },
      { id: TAG_RESERVAS, tenant_id: TENANT, name: 'Reservas', color: '#94a3b8' },
    ],
    conversation_tag_assignments: [],
    quick_messages: [],
    marketing_tasks: [
      {
        id: TASK,
        tenant_id: TENANT,
        title: 'Flyer',
        category: 'eventos',
        kind: 'design',
        status: 'todo',
        specifications: null,
        notes: null,
        file_url: null,
        responsible_user_id: null,
        involved_user_id: null,
        ideal_date: null,
        defined_date: null,
        created_at: hoursAgo(5),
        updated_at: hoursAgo(5),
      },
    ],
    marketing_routines: [
      {
        id: ROUTINE,
        tenant_id: TENANT,
        title: 'Publicar reels',
        description: null,
        slots: 2,
        position: 1,
        active: true,
        created_at: hoursAgo(5),
      },
    ],
    marketing_routine_checks: [],
    audit_log: [],
  }
}

const run = (name: string, input: unknown) => runTool(mensajeriaArea.tools, name, input, CTX)

function execute(name: string, payload: unknown): Promise<TexExecution> {
  const found = mensajeriaArea.executors[name]
  if (!found) throw new Error(`No está el ejecutor ${name}`)
  return found.run(payload, CTX)
}

async function confirmed(tool: string, input: unknown): Promise<TexExecution> {
  const prepared = asPrepared(await run(tool, input))
  return execute(prepared.executor, prepared.payload)
}

function expectDone(execution: TexExecution) {
  if (!execution.ok) throw new Error(`No se hizo: ${JSON.stringify(execution)}`)
  return execution
}

const written = (table: string) => fake.db.writes.filter((write) => write.table === table)

let fetchSpy: ReturnType<typeof vi.spyOn>

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(NOW)
  vi.clearAllMocks()
  fake.db = new FakeDb(tables())
  // Lo que hace `evaluate_audience_query`, por lo que pide el compilador de verdad.
  fake.db.rpcResult = (name, args) => {
    if (name === 'get_marketing_team') {
      return [{ member_id: CTX.userId, member_name: 'Socia', member_role: 'owner' }]
    }
    if (name !== 'evaluate_audience_query') return []
    const where = String(args.p_where)
    const count = where.includes('c.id IN') ? 0 : 2
    return count > 0
      ? [
          { customer_id: ANA, count_total: count },
          { customer_id: BETO, count_total: count },
        ]
      : []
  }
  vi.mocked(requireTenantAccess).mockResolvedValue({
    tenant: { id: TENANT, slug: 'hub', name: 'HUB' },
    role: 'owner',
    user: { id: CTX.userId },
  } as never)
  vi.mocked(sendText).mockResolvedValue({ meta_message_id: 'wamid.1' })
  vi.mocked(sendTemplate).mockResolvedValue({ meta_message_id: 'wamid.2' })
  fetchSpy = vi.spyOn(globalThis, 'fetch')
})

afterEach(() => {
  // Nada salió a la red: Meta está de mentira, y nadie intentó saltearla.
  expect(fetchSpy).not.toHaveBeenCalled()
  expect(sendDM).not.toHaveBeenCalled()
  fetchSpy.mockRestore()
  vi.useRealTimers()
})

describe('una respuesta, con sendTextMessage de verdad', () => {
  it('llega al que corresponde y queda registrada', async () => {
    const done = expectDone(
      await confirmed('preparar_respuesta', { conversacion: 'ana', texto: 'Hola Ana' }),
    )
    expect(done.message).toContain('Ana Pérez')
    expect(sendText).toHaveBeenCalledTimes(1)
    const [channel, to, body] = vi.mocked(sendText).mock.calls[0] ?? []
    expect((channel as unknown as { id: string }).id).toBe(CHANNEL)
    expect(to).toBe(PHONE_ANA)
    expect(body).toBe('Hola Ana')
    expect(written('messages')[0]?.payload).toMatchObject({
      conversation_id: CONV_ANA,
      direction: 'outbound',
      content: 'Hola Ana',
      status: 'sent',
    })
  })

  it('el doble toque no le llega dos veces', async () => {
    const prepared = asPrepared(
      await run('preparar_respuesta', { conversacion: 'ana', texto: 'Hola Ana' }),
    )
    expectDone(await execute(prepared.executor, prepared.payload))
    const again = await execute(prepared.executor, prepared.payload)
    expect(again).toMatchObject({ ok: false, kind: 'failed' })
    expect(sendText).toHaveBeenCalledTimes(1)
  })

  it('fuera de ventana no llega ni a prepararse, y la acción no se toca', async () => {
    const result = await run('preparar_respuesta', { conversacion: 'beto', texto: 'Hola' })
    expect(result.kind).toBe('error')
    expect(sendText).not.toHaveBeenCalled()
  })

  it('si la ventana se cierra con el tique esperando, no sale', async () => {
    const prepared = asPrepared(
      await run('preparar_respuesta', { conversacion: 'ana', texto: 'Hola' }),
    )
    vi.setSystemTime(new Date(NOW.getTime() + 23 * 3600_000))
    expect(await execute(prepared.executor, prepared.payload)).toMatchObject({
      ok: false,
      kind: 'failed',
    })
    expect(sendText).not.toHaveBeenCalled()
  })

  it('si Meta dice que no, queda como fallido y lo cuenta', async () => {
    vi.mocked(sendText).mockRejectedValue(new Error('se cayó'))
    const execution = await confirmed('preparar_respuesta', {
      conversacion: 'ana',
      texto: 'Hola',
    })
    expect(execution).toMatchObject({ ok: false, kind: 'failed' })
    expect(written('messages')[0]?.payload).toMatchObject({ status: 'failed' })
  })
})

describe('una plantilla en un chat, con sendTemplateMessage de verdad', () => {
  it('sale con el nombre técnico y los datos, aunque pasaron las 24 horas', async () => {
    expectDone(
      await confirmed('preparar_plantilla_en_chat', {
        conversacion: 'beto',
        plantilla: 'promo finde',
        datos: ['Beto'],
      }),
    )
    expect(sendTemplate).toHaveBeenCalledTimes(1)
    const [, to, name, language, variables] = vi.mocked(sendTemplate).mock.calls[0] ?? []
    expect(to).toBe('543515559876')
    expect(name).toBe('promo_finde')
    expect(language).toBe('es_AR')
    expect(variables).toEqual(['Beto'])
  })

  it('sin opt-in no se prepara', async () => {
    const row = fake.db.rows('customers').find((customer) => customer.id === BETO)
    if (row) row.opt_in_marketing = false
    const result = await run('preparar_plantilla_en_chat', {
      conversacion: 'beto',
      plantilla: 'promo finde',
      datos: ['Beto'],
    })
    expect(result.kind).toBe('error')
    expect(sendTemplate).not.toHaveBeenCalled()
  })
})

describe('una difusión, con scheduleBroadcast de verdad', () => {
  it('cuenta con el compilador de verdad, solo a los que aceptan promos', async () => {
    const { ticket } = asPrepared(
      await run('preparar_difusion', {
        plantilla: 'promo finde',
        audiencia: 'todos',
        cuando: 'ahora',
      }),
    )
    expect(ticket.confirmLabel).toBe('Mandar a 2 personas')
    const wheres = fake.db.rpcs
      .filter((call) => call.name === 'evaluate_audience_query')
      .map((call) => String(call.args.p_where))
    expect(wheres).toContain('true')
    expect(wheres.some((where) => where.includes('c.opt_in_marketing IS TRUE'))).toBe(true)
    for (const call of fake.db.rpcs) {
      if (call.name === 'evaluate_audience_query') expect(call.args.p_tenant_id).toBe(TENANT)
    }
  })

  it('«ahora» queda programada para ya, y la toma el proceso de siempre', async () => {
    const done = expectDone(
      await confirmed('preparar_difusion', {
        plantilla: 'promo finde',
        audiencia: 'todos',
        cuando: 'ahora',
        nombre: 'Promo',
      }),
    )
    const [insert] = written('broadcasts')
    expect(insert?.payload).toMatchObject({
      tenant_id: TENANT,
      name: 'Promo',
      channel_id: CHANNEL,
      template_id: TEMPLATE,
      audience_id: AUDIENCE,
      status: 'scheduled',
      scheduled_at: NOW.toISOString(),
      variable_mapping: { '1': { source: 'first_name' } },
    })
    expect(done.href).toMatch(/^\/hub\/mensajeria\/difusiones\/[0-9a-f-]{36}$/)
    expect(written('audit_log')[0]?.payload).toMatchObject({ action: 'broadcast_scheduled' })
    // Tex no manda nada por su cuenta: lo manda el proceso, respetando el opt-in al enviar.
    expect(sendTemplate).not.toHaveBeenCalled()
  })

  it('programada, con la hora de Córdoba en UTC', async () => {
    expectDone(
      await confirmed('preparar_difusion', {
        plantilla: 'promo finde',
        audiencia: 'todos',
        cuando: '2026-11-07T20:30',
      }),
    )
    expect(written('broadcasts')[0]?.payload).toMatchObject({
      scheduled_at: '2026-11-07T23:30:00.000Z',
      status: 'scheduled',
    })
  })

  it('confirmar dos veces no crea dos', async () => {
    const prepared = asPrepared(
      await run('preparar_difusion', {
        plantilla: 'promo finde',
        audiencia: 'todos',
        cuando: 'ahora',
        nombre: 'Promo',
      }),
    )
    expectDone(await execute(prepared.executor, prepared.payload))
    const again = await execute(prepared.executor, prepared.payload)
    expect(again).toMatchObject({ ok: false, kind: 'failed' })
    expect(written('broadcasts')).toHaveLength(1)
  })

  it('si la plantilla dejó de estar aprobada, la acción la frena', async () => {
    const prepared = asPrepared(
      await run('preparar_difusion', {
        plantilla: 'promo finde',
        audiencia: 'todos',
        cuando: 'ahora',
      }),
    )
    const row = fake.db.rows('message_templates')[0] as { status: string }
    row.status = 'disabled'
    expect(await execute(prepared.executor, prepared.payload)).toMatchObject({
      ok: false,
      kind: 'failed',
      message: 'Template no aprobado por Meta.',
    })
    expect(written('broadcasts')).toHaveLength(0)
  })

  it('sin ser dueño, la acción no deja', async () => {
    const prepared = asPrepared(
      await run('preparar_difusion', {
        plantilla: 'promo finde',
        audiencia: 'todos',
        cuando: 'ahora',
      }),
    )
    vi.mocked(requireTenantAccess).mockResolvedValue({
      tenant: { id: TENANT, slug: 'hub', name: 'HUB' },
      role: 'host',
      user: { id: CTX.userId },
    } as never)
    expect(await execute(prepared.executor, prepared.payload)).toMatchObject({ ok: false })
    expect(written('broadcasts')).toHaveLength(0)
  })
})

describe('adelantar, cancelar y reintentar, con las acciones de verdad', () => {
  const statusOf = (id: string) => fake.db.rows('broadcasts').find((row) => row.id === id)?.status

  it('cancelar', async () => {
    expectDone(
      await confirmed('preparar_accion_difusion', { difusion: 'peña', accion: 'cancelar' }),
    )
    expect(statusOf(SCHEDULED)).toBe('cancelled')
  })

  it('adelantar', async () => {
    expectDone(
      await confirmed('preparar_accion_difusion', { difusion: 'peña', accion: 'mandar_ahora' }),
    )
    expect(fake.db.rows('broadcasts')[0]).toMatchObject({
      status: 'scheduled',
      scheduled_at: NOW.toISOString(),
    })
  })

  it('cancelar una que ya empezó no miente, aunque la acción conteste bien', async () => {
    const prepared = asPrepared(
      await run('preparar_accion_difusion', { difusion: 'peña', accion: 'cancelar' }),
    )
    const row = fake.db.rows('broadcasts')[0] as { status: string }
    row.status = 'sending'
    expect(await execute(prepared.executor, prepared.payload)).toMatchObject({
      ok: false,
      kind: 'failed',
    })
    expect(statusOf(SCHEDULED)).toBe('sending')
  })

  it('reintentar los fallidos', async () => {
    const row = fake.db.rows('broadcasts')[0] as { status: string; stats: unknown }
    row.status = 'partial'
    row.stats = { total: 2, failed: 1, sent: 1 }
    fake.db.rows('broadcast_recipients').push({
      id: uuid(52),
      broadcast_id: SCHEDULED,
      status: 'failed',
      error: 'x',
    })
    expectDone(
      await confirmed('preparar_accion_difusion', {
        difusion: 'peña',
        accion: 'reenviar_fallidos',
      }),
    )
    expect(enqueueJob).toHaveBeenCalledTimes(1)
    expect(fake.db.rows('broadcast_recipients')[0]).toMatchObject({ status: 'pending' })
  })
})

describe('una audiencia, con createAudience y updateAudience de verdad', () => {
  it('el alta pasa el esquema y la compila el motor', async () => {
    const done = expectDone(
      await confirmed('preparar_audiencia', {
        nombre: 'A reactivar',
        condiciones: [{ campo: 'dias_sin_venir', comparacion: 'mas_de', valor: 30 }],
      }),
    )
    expect(written('audiences')[0]?.payload).toMatchObject({
      tenant_id: TENANT,
      name: 'A reactivar',
      filters: { kind: 'group', op: 'AND' },
    })
    expect(done.href).toMatch(/^\/hub\/mensajeria\/audiencias\/[0-9a-f-]{36}$/)
    const wheres = fake.db.rpcs.map((call) => String(call.args.p_where))
    expect(wheres.some((where) => where.includes('c.last_visit_at'))).toBe(true)
  })

  it('la edición cambia esa y solo esa', async () => {
    expectDone(
      await confirmed('preparar_audiencia', { audiencia: 'todos', nombre: 'Toda la base' }),
    )
    expect(fake.db.rows('audiences')).toHaveLength(1)
    expect(fake.db.rows('audiences')[0]).toMatchObject({ id: AUDIENCE, name: 'Toda la base' })
  })
})

describe('prender y apagar, con toggleFlowActive de verdad', () => {
  it('prende, después de pasar las reglas del editor', async () => {
    const { ticket } = asPrepared(
      await run('preparar_prender_o_apagar_flow', { flow: 'gracias', accion: 'prender' }),
    )
    expect(rowValue(ticket, 'Qué hace')).toBe('Manda la plantilla Promo finde')
    expectDone(
      await confirmed('preparar_prender_o_apagar_flow', { flow: 'gracias', accion: 'prender' }),
    )
    expect(fake.db.rows('flows')[0]).toMatchObject({ id: FLOW, active: true })
  })

  it('apaga', async () => {
    const row = fake.db.rows('flows')[0] as { active: boolean }
    row.active = true
    expectDone(
      await confirmed('preparar_prender_o_apagar_flow', { flow: 'gracias', accion: 'apagar' }),
    )
    expect(fake.db.rows('flows')[0]).toMatchObject({ active: false })
  })
})

describe('el resto, con las acciones de verdad', () => {
  it('un mensaje rápido', async () => {
    expectDone(
      await confirmed('preparar_mensaje_rapido', {
        titulo: 'Cómo llegar',
        texto: 'Estamos en el centro',
      }),
    )
    expect(written('quick_messages')[0]?.payload).toMatchObject({
      tenant_id: TENANT,
      title: 'Cómo llegar',
      shortcut: 'como-llegar',
      body: 'Estamos en el centro',
    })
  })

  it('una etiqueta nueva', async () => {
    expectDone(await confirmed('preparar_etiqueta_nueva', { nombre: 'Quejas', color: 'rojo' }))
    expect(written('conversation_tags')[0]?.payload).toMatchObject({
      name: 'Quejas',
      color: '#f87171',
    })
  })

  it('etiquetar un chat', async () => {
    expectDone(
      await confirmed('preparar_etiquetas_de_chat', { conversacion: 'ana', poner: ['VIP'] }),
    )
    expect(written('conversation_tag_assignments')[0]?.payload).toEqual([
      { conversation_id: CONV_ANA, tag_id: TAG_VIP, assigned_by: CTX.userId },
    ])
  })

  it('una tarea nueva y su edición', async () => {
    expectDone(
      await confirmed('preparar_tarea', {
        titulo: 'Reel',
        seccion: 'promociones',
        tipo: 'grabar',
        responsable: 'yo',
        fecha_ideal: '2026-11-20',
      }),
    )
    expect(written('marketing_tasks')[0]?.payload).toMatchObject({
      tenant_id: TENANT,
      title: 'Reel',
      category: 'promociones',
      kind: 'shoot',
      status: 'todo',
      responsible_user_id: CTX.userId,
      ideal_date: '2026-11-20',
      specifications: null,
      file_url: null,
      completed_at: null,
    })
    expectDone(await confirmed('preparar_tarea', { tarea: 'flyer', comentarios: 'Con logo' }))
    expect(fake.db.rows('marketing_tasks').find((task) => task.id === TASK)).toMatchObject({
      title: 'Flyer',
      kind: 'design',
      notes: 'Con logo',
    })
  })

  it('terminar una tarea guarda cuándo y quién', async () => {
    expectDone(await confirmed('preparar_estado_tarea', { tarea: 'flyer', estado: 'terminado' }))
    expect(fake.db.rows('marketing_tasks').find((task) => task.id === TASK)).toMatchObject({
      status: 'done',
      completed_by: CTX.userId,
      completed_at: NOW.toISOString(),
    })
  })

  it('tildar una rutina de esta semana', async () => {
    expectDone(await confirmed('preparar_tilde_rutina', { rutina: 'reels' }))
    expect(written('marketing_routine_checks')[0]?.payload).toMatchObject({
      routine_id: ROUTINE,
      week_start: '2026-11-02',
      slot: 0,
    })
  })
})

describe('lo que lee Tex no se lleva un dato de más', () => {
  it('leer un chat no deja nada escrito ni lo marca como leído', async () => {
    await run('ver_conversacion', { conversacion: 'ana' })
    await run('ver_bandeja', {})
    expect(fake.db.writes).toEqual([])
  })

  it('nunca le pide el token a la base', async () => {
    await run('ver_canales', {})
    await run('preparar_respuesta', { conversacion: 'ana', texto: 'Hola' })
    await run('preparar_difusion', { plantilla: 'promo', audiencia: 'todos', cuando: 'ahora' })
    for (const select of fake.db.selects.filter((row) => row.table === 'channels')) {
      expect(select.columns).not.toContain('encrypted')
      expect(select.columns).not.toBe('*')
    }
  })
})
