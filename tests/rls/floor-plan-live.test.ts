import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  createTenant,
  createUserClient,
  deleteUser,
  getServiceClient,
  RLS_TESTS_ENABLED,
  uniqueEmail,
  uniqueSlug,
} from './setup'

const describeIfRls = RLS_TESTS_ENABLED ? describe : describe.skip

/**
 * Live floor — aislamiento RLS de getLiveFloor.
 *
 * getLiveFloor hace SELECT sobre:
 *   floor_plan_areas    (fpa_select_member)
 *   floor_plan_elements (fpe_select_member)
 *   table_sessions      (aislada por tenant_id vía RLS existente)
 *   tickets             (aislada por tenant_id vía RLS existente)
 *
 * Esta suite verifica:
 *   (a) tenant B no ve áreas ni elementos de tenant A
 *   (b) dentro del mismo tenant, solo los elementos del área solicitada son devueltos
 *   (c) el join de sesión abierta refleja correctamente la sesión de una mesa
 *
 * Las tablas se siembran con service_role. Los SELECT se hacen con los
 * clientes autenticados de cada tenant.
 */
describeIfRls('RLS — getLiveFloor (live floor isolation)', () => {
  let ownerA: Awaited<ReturnType<typeof createUserClient>>
  let ownerB: Awaited<ReturnType<typeof createUserClient>>
  let staffA: Awaited<ReturnType<typeof createUserClient>>
  let tenantA: { id: string; slug: string }
  let tenantB: { id: string; slug: string }

  // Dos áreas de A para verificar el scope por area_id.
  let areaA1: { id: string }
  let areaA2: { id: string }
  let areaB1: { id: string }

  // Mesas / elementos de A.
  let tableA1: { id: string } // mesa en areaA1 con sesión abierta
  let tableA2: { id: string } // mesa en areaA2 (para aislar por área)
  let elemA1: { id: string } // elemento de tableA1 en areaA1
  let elemA2: { id: string } // elemento de tableA2 en areaA2

  // Sesión abierta de tableA1.
  let sessionA1: { id: string }

  beforeAll(async () => {
    ownerA = await createUserClient({ email: uniqueEmail('liveA') })
    ownerB = await createUserClient({ email: uniqueEmail('liveB') })
    staffA = await createUserClient({ email: uniqueEmail('liveStaff') })

    tenantA = await createTenant({
      name: 'Live Bar A',
      slug: uniqueSlug('live-a'),
      ownerId: ownerA.userId,
    })
    tenantB = await createTenant({
      name: 'Live Bar B',
      slug: uniqueSlug('live-b'),
      ownerId: ownerB.userId,
    })

    const service = getServiceClient()

    // Staff de A (waiter) — miembro válido que también debe ver el live floor.
    await service.from('memberships').insert({
      tenant_id: tenantA.id,
      user_id: staffA.userId,
      role: 'waiter',
    })

    // Áreas.
    const { data: aAreas, error: aAreasErr } = await service
      .from('floor_plan_areas')
      .insert([
        { tenant_id: tenantA.id, name: 'Salón A1', position: 0, number_start: 1 },
        { tenant_id: tenantA.id, name: 'Terraza A2', position: 1, number_start: 101 },
      ])
      .select('id')
    if (aAreasErr || !aAreas || aAreas.length !== 2) {
      throw new Error(`seed areas A failed: ${aAreasErr?.message}`)
    }
    areaA1 = aAreas[0] as { id: string }
    areaA2 = aAreas[1] as { id: string }

    const { data: bArea, error: bAreaErr } = await service
      .from('floor_plan_areas')
      .insert({ tenant_id: tenantB.id, name: 'Salón B', position: 0, number_start: 1 })
      .select('id')
      .single()
    if (bAreaErr || !bArea) throw new Error(`seed area B failed: ${bAreaErr?.message}`)
    areaB1 = bArea

    // Mesas activas.
    const { data: ptA1, error: ptA1Err } = await service
      .from('physical_tables')
      .insert({ tenant_id: tenantA.id, label: '1' })
      .select('id')
      .single()
    if (ptA1Err || !ptA1) throw new Error(`seed tableA1 failed: ${ptA1Err?.message}`)
    tableA1 = ptA1

    const { data: ptA2, error: ptA2Err } = await service
      .from('physical_tables')
      .insert({ tenant_id: tenantA.id, label: '101' })
      .select('id')
      .single()
    if (ptA2Err || !ptA2) throw new Error(`seed tableA2 failed: ${ptA2Err?.message}`)
    tableA2 = ptA2

    // Elementos de las mesas.
    const { data: elA1, error: elA1Err } = await service
      .from('floor_plan_elements')
      .insert({
        tenant_id: tenantA.id,
        area_id: areaA1.id,
        kind: 'table',
        shape: 'rect',
        physical_table_id: tableA1.id,
        x: 100,
        y: 100,
        width: 80,
        height: 80,
        z_index: 10,
      })
      .select('id')
      .single()
    if (elA1Err || !elA1) throw new Error(`seed elemA1 failed: ${elA1Err?.message}`)
    elemA1 = elA1

    const { data: elA2, error: elA2Err } = await service
      .from('floor_plan_elements')
      .insert({
        tenant_id: tenantA.id,
        area_id: areaA2.id,
        kind: 'table',
        shape: 'rect',
        physical_table_id: tableA2.id,
        x: 200,
        y: 200,
        width: 80,
        height: 80,
        z_index: 10,
      })
      .select('id')
      .single()
    if (elA2Err || !elA2) throw new Error(`seed elemA2 failed: ${elA2Err?.message}`)
    elemA2 = elA2

    // Elemento de decoración en areaA1 (decor debe aparecer en areaA1, no en areaA2).
    await service.from('floor_plan_elements').insert({
      tenant_id: tenantA.id,
      area_id: areaA1.id,
      kind: 'wall',
      shape: 'rect',
      x: 0,
      y: 0,
      width: 200,
      height: 16,
      z_index: 0,
    })

    // Sesión abierta para tableA1.
    const { data: sess, error: sessErr } = await service
      .from('table_sessions')
      .insert({
        tenant_id: tenantA.id,
        physical_table_id: tableA1.id,
        status: 'open',
        total_cents: 125000,
        party_size: 3,
        alias: 'Mesa VIP',
      })
      .select('id')
      .single()
    if (sessErr || !sess) throw new Error(`seed session failed: ${sessErr?.message}`)
    sessionA1 = sess
  })

  afterAll(async () => {
    await deleteUser(ownerA.userId)
    await deleteUser(ownerB.userId)
    await deleteUser(staffA.userId)
  })

  // ── (a) Aislamiento por tenant ─────────────────────────────────────────

  it('tenant B no puede ver áreas de tenant A (SELECT aislado)', async () => {
    const { data: areas } = await ownerB.client
      .from('floor_plan_areas')
      .select('id')
      .eq('tenant_id', tenantA.id)
    expect(areas?.length ?? 0).toBe(0)
  })

  it('tenant B no puede ver elementos de tenant A (SELECT aislado)', async () => {
    const { data: elements } = await ownerB.client
      .from('floor_plan_elements')
      .select('id')
      .eq('tenant_id', tenantA.id)
    expect(elements?.length ?? 0).toBe(0)
  })

  it('tenant B no puede ver sesiones de tenant A (SELECT aislado)', async () => {
    const { data: sessions } = await ownerB.client
      .from('table_sessions')
      .select('id')
      .eq('tenant_id', tenantA.id)
    expect(sessions?.length ?? 0).toBe(0)
  })

  it('owner A sí ve sus propios elementos en areaA1', async () => {
    const { data, error } = await ownerA.client
      .from('floor_plan_elements')
      .select('id')
      .eq('tenant_id', tenantA.id)
      .eq('area_id', areaA1.id)
    expect(error).toBeNull()
    const ids = (data ?? []).map((r) => r.id)
    // elemA1 (mesa) + el decor que sembramos en areaA1
    expect(ids).toContain(elemA1.id)
    // elemA2 está en areaA2, no en areaA1
    expect(ids).not.toContain(elemA2.id)
  })

  // ── (b) Aislamiento por área (scope de getLiveFloor) ────────────────────

  it('los elementos de areaA2 NO aparecen en una query scopeada a areaA1', async () => {
    // getLiveFloor hace: floor_plan_elements WHERE area_id = $areaId
    // Esta prueba verifica la misma query directamente.
    const { data: elemsA1, error } = await ownerA.client
      .from('floor_plan_elements')
      .select('id, area_id')
      .eq('tenant_id', tenantA.id)
      .eq('area_id', areaA1.id)
    expect(error).toBeNull()
    const ids = (elemsA1 ?? []).map((r) => r.id)
    expect(ids).toContain(elemA1.id)
    expect(ids).not.toContain(elemA2.id)
  })

  it('los elementos de areaA1 NO aparecen en una query scopeada a areaA2', async () => {
    const { data: elemsA2, error } = await ownerA.client
      .from('floor_plan_elements')
      .select('id, area_id')
      .eq('tenant_id', tenantA.id)
      .eq('area_id', areaA2.id)
    expect(error).toBeNull()
    const ids = (elemsA2 ?? []).map((r) => r.id)
    expect(ids).toContain(elemA2.id)
    expect(ids).not.toContain(elemA1.id)
  })

  it('el área de tenant B no es accesible por owner A (scope cross-tenant)', async () => {
    // Si getLiveFloor se llamara con el areaId de B (error de programación),
    // la RLS garantiza que no se devuelven filas de B.
    const { data: bElems } = await ownerA.client
      .from('floor_plan_elements')
      .select('id')
      .eq('area_id', areaB1.id)
    expect(bElems?.length ?? 0).toBe(0)
  })

  // ── (c) Join de sesión abierta correcto ────────────────────────────────

  it('la sesión abierta de tableA1 es visible por el owner del tenant (join correcto)', async () => {
    // getLiveFloor lee table_sessions WHERE physical_table_id = el de cada elemento
    // y status = 'open'. Verificamos la query base que el TS hace.
    const { data, error } = await ownerA.client
      .from('table_sessions')
      .select('id, status, total_cents, party_size, alias, opened_at')
      .eq('tenant_id', tenantA.id)
      .eq('physical_table_id', tableA1.id)
      .eq('status', 'open')
      .limit(1)
      .single()
    expect(error).toBeNull()
    expect(data?.id).toBe(sessionA1.id)
    expect(data?.status).toBe('open')
    expect(data?.total_cents).toBe(125000)
    expect(data?.party_size).toBe(3)
    expect(data?.alias).toBe('Mesa VIP')
  })

  it('tableA2 no tiene sesión abierta (resultado null en el join)', async () => {
    const { data, error } = await ownerA.client
      .from('table_sessions')
      .select('id')
      .eq('tenant_id', tenantA.id)
      .eq('physical_table_id', tableA2.id)
      .eq('status', 'open')
    expect(error).toBeNull()
    expect(data?.length ?? 0).toBe(0)
  })

  it('staff (waiter) de tenant A también puede leer el floor y la sesión', async () => {
    // El live floor es accesible por cualquier miembro del tenant (owner + staff).
    const { data: areas, error: aErr } = await staffA.client
      .from('floor_plan_areas')
      .select('id')
      .eq('tenant_id', tenantA.id)
    expect(aErr).toBeNull()
    const areaIds = (areas ?? []).map((r) => r.id)
    expect(areaIds).toContain(areaA1.id)

    const { data: elems, error: eErr } = await staffA.client
      .from('floor_plan_elements')
      .select('id')
      .eq('tenant_id', tenantA.id)
      .eq('area_id', areaA1.id)
    expect(eErr).toBeNull()
    expect((elems ?? []).map((r) => r.id)).toContain(elemA1.id)

    const { data: sess, error: sErr } = await staffA.client
      .from('table_sessions')
      .select('id, status')
      .eq('tenant_id', tenantA.id)
      .eq('physical_table_id', tableA1.id)
      .eq('status', 'open')
      .limit(1)
      .single()
    expect(sErr).toBeNull()
    expect(sess?.id).toBe(sessionA1.id)
  })

  it('staff de tenant A NO puede ver sesiones de tenant B', async () => {
    const { data: bSessions } = await staffA.client
      .from('table_sessions')
      .select('id')
      .eq('tenant_id', tenantB.id)
    expect(bSessions?.length ?? 0).toBe(0)
  })
})
