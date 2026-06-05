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
 * Floor plan editor — aislamiento RLS, owner-only en los RPC `fp_*`,
 * guardas atómicas de sesión abierta, índice 1:1 mesa↔elemento,
 * triggers de integridad cross-tenant / mesa-inactiva, y borrado de áreas.
 *
 * Las filas que el caller no podría crear por RLS (mesas, sesión abierta,
 * elementos cross-tenant) se siembran con `service_role`; los chequeos se
 * hacen siempre con el cliente con sesión correspondiente.
 */
describeIfRls('RLS — floor plan editor', () => {
  let ownerA: Awaited<ReturnType<typeof createUserClient>>
  let ownerB: Awaited<ReturnType<typeof createUserClient>>
  let cashierA: Awaited<ReturnType<typeof createUserClient>>
  let waiterA: Awaited<ReturnType<typeof createUserClient>>
  let tenantA: { id: string; slug: string }
  let tenantB: { id: string; slug: string }

  // Sembrado con service_role en beforeAll.
  let areaA1: { id: string } // primera área de A
  let areaA2: { id: string } // segunda área de A (para poder borrar áreas sin caer en "última")
  let areaB1: { id: string } // área de B (para el caso cross-tenant)
  let tableA1: { id: string } // mesa activa de A, ubicada en areaA1
  let tableB1: { id: string } // mesa activa de B
  let inactiveTableA: { id: string } // mesa inactiva de A

  beforeAll(async () => {
    ownerA = await createUserClient({ email: uniqueEmail('fpA') })
    ownerB = await createUserClient({ email: uniqueEmail('fpB') })
    cashierA = await createUserClient({ email: uniqueEmail('fpCash') })
    waiterA = await createUserClient({ email: uniqueEmail('fpWait') })

    tenantA = await createTenant({
      name: 'FP Bar A',
      slug: uniqueSlug('fp-a'),
      ownerId: ownerA.userId,
    })
    tenantB = await createTenant({
      name: 'FP Bar B',
      slug: uniqueSlug('fp-b'),
      ownerId: ownerB.userId,
    })

    const service = getServiceClient()

    // Staff de A (no-owner) para los chequeos de owner_required.
    await service.from('memberships').insert([
      { tenant_id: tenantA.id, user_id: cashierA.userId, role: 'cashier' },
      { tenant_id: tenantA.id, user_id: waiterA.userId, role: 'waiter' },
    ])

    // Áreas (A tiene 2 para no chocar con "no se puede borrar la última").
    const { data: aAreas, error: aAreasErr } = await service
      .from('floor_plan_areas')
      .insert([
        { tenant_id: tenantA.id, name: 'Planta Baja', position: 0, number_start: 1 },
        { tenant_id: tenantA.id, name: 'Planta Alta', position: 1, number_start: 101 },
      ])
      .select('id')
    if (aAreasErr || !aAreas || aAreas.length !== 2) {
      throw new Error(`seed areas A failed: ${aAreasErr?.message}`)
    }
    areaA1 = aAreas[0] as { id: string }
    areaA2 = aAreas[1] as { id: string }

    const { data: bArea, error: bAreaErr } = await service
      .from('floor_plan_areas')
      .insert({ tenant_id: tenantB.id, name: 'Salón', position: 0, number_start: 1 })
      .select('id')
      .single()
    if (bAreaErr || !bArea) throw new Error(`seed area B failed: ${bAreaErr?.message}`)
    areaB1 = bArea

    // Mesas activas.
    const { data: ptA, error: ptAErr } = await service
      .from('physical_tables')
      .insert({ tenant_id: tenantA.id, label: '1' })
      .select('id')
      .single()
    if (ptAErr || !ptA) throw new Error(`seed table A failed: ${ptAErr?.message}`)
    tableA1 = ptA

    const { data: ptB, error: ptBErr } = await service
      .from('physical_tables')
      .insert({ tenant_id: tenantB.id, label: '1' })
      .select('id')
      .single()
    if (ptBErr || !ptB) throw new Error(`seed table B failed: ${ptBErr?.message}`)
    tableB1 = ptB

    // Mesa inactiva de A (para el trigger fp_table_inactive).
    const { data: ptInactive, error: ptInactiveErr } = await service
      .from('physical_tables')
      .insert({ tenant_id: tenantA.id, label: '99', active: false })
      .select('id')
      .single()
    if (ptInactiveErr || !ptInactive) {
      throw new Error(`seed inactive table A failed: ${ptInactiveErr?.message}`)
    }
    inactiveTableA = ptInactive

    // Elemento de tableA1 ubicado en areaA1 (mesa activa ubicada → base de varios casos).
    const { error: elErr } = await service.from('floor_plan_elements').insert({
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
    if (elErr) throw new Error(`seed element A failed: ${elErr.message}`)
  })

  afterAll(async () => {
    await deleteUser(ownerA.userId)
    await deleteUser(ownerB.userId)
    await deleteUser(cashierA.userId)
    await deleteUser(waiterA.userId)
  })

  // ── (a) Aislamiento por tenant ─────────────────────────────────────────

  it('owner de B no ve áreas ni elementos de A (SELECT aislado)', async () => {
    const { data: areas } = await ownerB.client
      .from('floor_plan_areas')
      .select('id')
      .eq('tenant_id', tenantA.id)
    expect(areas?.length ?? 0).toBe(0)

    const { data: elements } = await ownerB.client
      .from('floor_plan_elements')
      .select('id')
      .eq('tenant_id', tenantA.id)
    expect(elements?.length ?? 0).toBe(0)
  })

  it('owner de B no puede INSERT un área en el tenant de A', async () => {
    const { error } = await ownerB.client
      .from('floor_plan_areas')
      .insert({ tenant_id: tenantA.id, name: 'Intrusa' })
    expect(error).not.toBeNull()
  })

  it('owner de B no puede INSERT un elemento decor en el tenant de A', async () => {
    const { error } = await ownerB.client.from('floor_plan_elements').insert({
      tenant_id: tenantA.id,
      area_id: areaA1.id,
      kind: 'wall',
      shape: 'rect',
      x: 0,
      y: 0,
      width: 200,
      height: 16,
    })
    expect(error).not.toBeNull()
  })

  it('owner de A sí ve sus propias áreas', async () => {
    const { data, error } = await ownerA.client
      .from('floor_plan_areas')
      .select('id')
      .eq('tenant_id', tenantA.id)
    expect(error).toBeNull()
    const ids = (data ?? []).map((r) => r.id)
    expect(ids).toContain(areaA1.id)
    expect(ids).toContain(areaA2.id)
  })

  // ── (b) owner_required en los RPC fp_* ─────────────────────────────────

  it('cashier no puede llamar fp_create_table (owner_required)', async () => {
    const { error } = await cashierA.client.rpc('fp_create_table', {
      p_area_id: areaA1.id,
      p_label: '50',
      p_shape: 'rect',
      p_x: 200,
      p_y: 200,
      p_capacity: 4,
    })
    expect(error?.message).toContain('owner_required')
  })

  it('waiter no puede llamar fp_set_table_active (owner_required)', async () => {
    const { error } = await waiterA.client.rpc('fp_set_table_active', {
      p_table_id: tableA1.id,
      p_active: false,
    })
    expect(error?.message).toContain('owner_required')
  })

  it('owner sí puede llamar fp_create_table y devuelve qr_token', async () => {
    const { data, error } = await ownerA.client.rpc('fp_create_table', {
      p_area_id: areaA1.id,
      p_label: '2',
      p_shape: 'rect',
      p_x: 300,
      p_y: 100,
      p_capacity: 4,
    })
    expect(error).toBeNull()
    const result = data as { table_id: string; element_id: string; qr_token: string }
    expect(result.table_id).toBeTruthy()
    expect(result.element_id).toBeTruthy()
    expect(result.qr_token).toMatch(/^[A-Za-z0-9]{16}$/)
  })

  // ── (c) Guarda atómica de sesión abierta ───────────────────────────────

  it('fp_set_table_active(false) y fp_merge_tables levantan table_has_open_session', async () => {
    const service = getServiceClient()

    // Sembrar una sesión abierta para tableA1 (status default = 'open').
    const { data: sess, error: sessErr } = await service
      .from('table_sessions')
      .insert({ tenant_id: tenantA.id, physical_table_id: tableA1.id })
      .select('id')
      .single()
    if (sessErr || !sess) throw new Error(`seed open session failed: ${sessErr?.message}`)

    try {
      // (c.1) Desactivar una mesa con sesión abierta → bloqueado.
      const { error: deactivateErr } = await ownerA.client.rpc('fp_set_table_active', {
        p_table_id: tableA1.id,
        p_active: false,
      })
      expect(deactivateErr?.message).toContain('table_has_open_session')

      // (c.2) Combinar absorbiendo una mesa con sesión abierta → bloqueado.
      // survivor = mesa libre nueva; absorbed = tableA1 (sesión abierta).
      const { data: survivor, error: survivorErr } = await service
        .from('physical_tables')
        .insert({ tenant_id: tenantA.id, label: '3' })
        .select('id')
        .single()
      if (survivorErr || !survivor) {
        throw new Error(`seed survivor failed: ${survivorErr?.message}`)
      }

      const { error: mergeErr } = await ownerA.client.rpc('fp_merge_tables', {
        p_survivor_table_id: survivor.id,
        p_absorbed_table_id: tableA1.id,
      })
      expect(mergeErr?.message).toContain('table_has_open_session')
    } finally {
      // Limpiar la sesión abierta para no contaminar otros casos.
      await service.from('table_sessions').delete().eq('id', sess.id)
    }
  })

  // ── (d) Índice 1:1 mesa↔elemento ───────────────────────────────────────

  it('insertar un 2º elemento para la misma mesa falla (floor_plan_elements_pt_uidx)', async () => {
    // tableA1 ya tiene su elemento (sembrado en beforeAll). Un segundo viola el unique.
    const { error } = await ownerA.client.from('floor_plan_elements').insert({
      tenant_id: tenantA.id,
      area_id: areaA2.id,
      kind: 'table',
      shape: 'rect',
      physical_table_id: tableA1.id,
      x: 0,
      y: 0,
      width: 80,
      height: 80,
      z_index: 10,
    })
    expect(error).not.toBeNull()
    expect(error?.message).toMatch(/floor_plan_elements_pt_uidx|duplicate key|unique/i)
  })

  // ── (e) Trigger de integridad cross-tenant ─────────────────────────────

  it('elemento con area_id de otro tenant falla (fp_tenant_mismatch_area)', async () => {
    // Decor de A apuntando a un área de B.
    const { error } = await ownerA.client.from('floor_plan_elements').insert({
      tenant_id: tenantA.id,
      area_id: areaB1.id, // área de B
      kind: 'wall',
      shape: 'rect',
      x: 0,
      y: 0,
      width: 200,
      height: 16,
    })
    expect(error).not.toBeNull()
    expect(error?.message).toContain('fp_tenant_mismatch_area')
  })

  it('elemento con physical_table_id de otro tenant falla (fp_tenant_mismatch_table)', async () => {
    // Mesa de A en área de A pero apuntando a una mesa de B.
    const { error } = await ownerA.client.from('floor_plan_elements').insert({
      tenant_id: tenantA.id,
      area_id: areaA2.id,
      kind: 'table',
      shape: 'rect',
      physical_table_id: tableB1.id, // mesa de B
      x: 0,
      y: 0,
      width: 80,
      height: 80,
      z_index: 10,
    })
    expect(error).not.toBeNull()
    expect(error?.message).toContain('fp_tenant_mismatch_table')
  })

  // ── (f) Mesa inactiva ──────────────────────────────────────────────────

  it('elemento para una mesa inactiva falla (fp_table_inactive)', async () => {
    const { error } = await ownerA.client.from('floor_plan_elements').insert({
      tenant_id: tenantA.id,
      area_id: areaA2.id,
      kind: 'table',
      shape: 'rect',
      physical_table_id: inactiveTableA.id, // mesa inactiva de A
      x: 0,
      y: 0,
      width: 80,
      height: 80,
      z_index: 10,
    })
    expect(error).not.toBeNull()
    expect(error?.message).toContain('fp_table_inactive')
  })

  // ── (g) Borrado de áreas ───────────────────────────────────────────────

  it('fp_delete_area bloquea si el área tiene una mesa activa ubicada (area_has_active_tables)', async () => {
    // areaA1 contiene el elemento de tableA1 (mesa activa).
    const { error } = await ownerA.client.rpc('fp_delete_area', { p_area_id: areaA1.id })
    expect(error?.message).toContain('area_has_active_tables')
  })

  it('fp_delete_area bloquea al intentar borrar la última área (cannot_delete_last_area)', async () => {
    const service = getServiceClient()

    // Tenant aislado con UNA sola área y sin mesas → única vía de probar la guarda.
    const ownerC = await createUserClient({ email: uniqueEmail('fpC') })
    try {
      const tenantC = await createTenant({
        name: 'FP Bar C',
        slug: uniqueSlug('fp-c'),
        ownerId: ownerC.userId,
      })
      const { data: areaC, error: areaCErr } = await service
        .from('floor_plan_areas')
        .insert({ tenant_id: tenantC.id, name: 'Salón', position: 0, number_start: 1 })
        .select('id')
        .single()
      if (areaCErr || !areaC) throw new Error(`seed area C failed: ${areaCErr?.message}`)

      const { error } = await ownerC.client.rpc('fp_delete_area', { p_area_id: areaC.id })
      expect(error?.message).toContain('cannot_delete_last_area')
    } finally {
      await deleteUser(ownerC.userId)
    }
  })

  it('fp_delete_area borra un área sin mesas activas cuando no es la última', async () => {
    const service = getServiceClient()

    // Área extra y vacía en A → borrable (A queda con ≥1 área).
    const { data: areaExtra, error: extraErr } = await service
      .from('floor_plan_areas')
      .insert({ tenant_id: tenantA.id, name: 'Terraza', position: 2, number_start: 201 })
      .select('id')
      .single()
    if (extraErr || !areaExtra) throw new Error(`seed extra area failed: ${extraErr?.message}`)

    const { data, error } = await ownerA.client.rpc('fp_delete_area', {
      p_area_id: areaExtra.id,
    })
    expect(error).toBeNull()
    expect(data).toMatchObject({ ok: true })

    // Verificar que ya no existe.
    const { data: gone } = await ownerA.client
      .from('floor_plan_areas')
      .select('id')
      .eq('id', areaExtra.id)
    expect(gone?.length ?? 0).toBe(0)
  })
})
