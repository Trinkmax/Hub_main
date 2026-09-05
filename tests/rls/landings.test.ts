import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  createTenant,
  createUserClient,
  deleteUser,
  getAnonClient,
  getServiceClient,
  RLS_TESTS_ENABLED,
  uniqueEmail,
  uniqueSlug,
} from './setup'

const describeIfRls = RLS_TESTS_ENABLED ? describe : describe.skip

/**
 * Las páginas HTML son contenido de marketing sin publicar: una promo del mes
 * que viene, precios que todavía no salieron. Tres amenazas concretas:
 *
 *   1. Otro bar leyendo o pisando el HTML de este (RLS por tenant).
 *   2. Alguien del propio equipo que no es dueño (cajero/mozo/anfitrión)
 *      tocando el HTML publicado — es la cara del bar en internet.
 *   3. `anon` (cualquiera con la clave pública, que viaja en el browser)
 *      leyendo borradores. La página publicada la sirve el Route Handler con
 *      service_role, así que la tabla NO tiene ningún grant a anon.
 *
 * El último bloque cubre lo que RLS no puede: RLS filtra filas al LEER, no
 * valida valores al ESCRIBIR. Que una versión no pueda colgar de la página de
 * otro bar lo garantiza la FK compuesta (id, tenant_id).
 */
describeIfRls('RLS — landing_pages', () => {
  let ownerA: Awaited<ReturnType<typeof createUserClient>>
  let cashierA: Awaited<ReturnType<typeof createUserClient>>
  let ownerB: Awaited<ReturnType<typeof createUserClient>>
  let tenantA: { id: string; slug: string }
  let tenantB: { id: string; slug: string }
  let pageA: { id: string }
  let pageB: { id: string }

  beforeAll(async () => {
    ownerA = await createUserClient({ email: uniqueEmail('land-ownerA') })
    cashierA = await createUserClient({ email: uniqueEmail('land-cashier') })
    ownerB = await createUserClient({ email: uniqueEmail('land-ownerB') })

    tenantA = await createTenant({
      name: 'Bar LAND A',
      slug: uniqueSlug('land-a'),
      ownerId: ownerA.userId,
    })
    tenantB = await createTenant({
      name: 'Bar LAND B',
      slug: uniqueSlug('land-b'),
      ownerId: ownerB.userId,
    })

    const service = getServiceClient()
    await service
      .from('memberships')
      .insert({ tenant_id: tenantA.id, user_id: cashierA.userId, role: 'cashier' })

    const { data: rowA } = await service
      .from('landing_pages')
      .insert({
        tenant_id: tenantA.id,
        slug: uniqueSlug('promo-a'),
        title: 'Promo del bar A',
        html: '<!doctype html><html><body>SECRETO DE A</body></html>',
        published: false,
      })
      .select('id')
      .single()
    pageA = rowA as { id: string }

    const { data: rowB } = await service
      .from('landing_pages')
      .insert({
        tenant_id: tenantB.id,
        slug: uniqueSlug('promo-b'),
        title: 'Promo del bar B',
        html: '<!doctype html><html><body>SECRETO DE B</body></html>',
        published: true,
      })
      .select('id')
      .single()
    pageB = rowB as { id: string }
  })

  afterAll(async () => {
    const service = getServiceClient()
    await service.from('landing_pages').delete().in('id', [pageA.id, pageB.id])
    await deleteUser(ownerA.userId)
    await deleteUser(cashierA.userId)
    await deleteUser(ownerB.userId)
  })

  it('el dueño ve sólo las páginas de su bar', async () => {
    const { data, error } = await ownerA.client.from('landing_pages').select('id, title')
    expect(error).toBeNull()
    const ids = (data ?? []).map((row) => (row as { id: string }).id)
    expect(ids).toContain(pageA.id)
    expect(ids).not.toContain(pageB.id)
  })

  it('el dueño de otro bar no puede leer el HTML ni pidiéndolo por id', async () => {
    const { data } = await ownerB.client
      .from('landing_pages')
      .select('html')
      .eq('id', pageA.id)
      .maybeSingle()
    expect(data).toBeNull()
  })

  it('el dueño de otro bar no puede pisar el HTML', async () => {
    const { error } = await ownerB.client
      .from('landing_pages')
      .update({ html: '<h1>hackeado</h1>' })
      .eq('id', pageA.id)

    // La policy no falla: simplemente no matchea ninguna fila. Lo que importa
    // es que el HTML siga intacto.
    expect(error).toBeNull()
    const service = getServiceClient()
    const { data } = await service.from('landing_pages').select('html').eq('id', pageA.id).single()
    expect((data as { html: string }).html).toContain('SECRETO DE A')
  })

  it('el cajero del mismo bar no ve ni edita las páginas (son del dueño)', async () => {
    const { data } = await cashierA.client.from('landing_pages').select('id')
    expect(data ?? []).toHaveLength(0)

    const { error } = await cashierA.client.from('landing_pages').insert({
      tenant_id: tenantA.id,
      slug: uniqueSlug('cajero'),
      title: 'No debería poder',
      html: '',
    })
    expect(error).not.toBeNull()
  })

  it('anon no puede leer las páginas (ni las publicadas)', async () => {
    const anon = getAnonClient()
    const { data, error } = await anon.from('landing_pages').select('id, html')
    // Sin grant a anon: o error de permisos, o cero filas. Nunca el HTML.
    expect(error !== null || (data ?? []).length === 0).toBe(true)
  })

  it('anon no puede sumar visitas a mano', async () => {
    const anon = getAnonClient()
    const { error } = await anon.rpc('bump_landing_view', { p_page: pageB.id })
    expect(error).not.toBeNull()
  })

  it('el dueño tampoco puede llamar al contador (es sólo para el server)', async () => {
    const { error } = await ownerA.client.rpc('bump_landing_view', { p_page: pageA.id })
    expect(error).not.toBeNull()
  })

  it('una versión no puede colgar de la página de otro bar (FK compuesta)', async () => {
    const { error } = await ownerA.client.from('landing_page_versions').insert({
      tenant_id: tenantA.id,
      page_id: pageB.id, // la página es del bar B
      html: '<p>x</p>',
    })
    expect(error).not.toBeNull()
    expect(error?.code).toBe('23503')
  })

  it('el dueño sí puede guardar y leer sus propias versiones', async () => {
    const { error: insertError } = await ownerA.client.from('landing_page_versions').insert({
      tenant_id: tenantA.id,
      page_id: pageA.id,
      html: '<p>una versión</p>',
      label: 'Guardada',
    })
    expect(insertError).toBeNull()

    const { data } = await ownerA.client
      .from('landing_page_versions')
      .select('html')
      .eq('page_id', pageA.id)
    expect((data ?? []).length).toBeGreaterThan(0)
  })

  it('el dueño de otro bar no ve esas versiones', async () => {
    const { data } = await ownerB.client
      .from('landing_page_versions')
      .select('id')
      .eq('page_id', pageA.id)
    expect(data ?? []).toHaveLength(0)
  })

  it('el slug es único en TODA la plataforma, no por bar', async () => {
    const service = getServiceClient()
    const { data: existing } = await service
      .from('landing_pages')
      .select('slug')
      .eq('id', pageA.id)
      .single()

    // El bar B intenta usar el mismo slug que el bar A.
    const { error } = await service.from('landing_pages').insert({
      tenant_id: tenantB.id,
      slug: (existing as { slug: string }).slug,
      title: 'Choque de slug',
      html: '',
    })
    expect(error?.code).toBe('23505')
  })

  it('el contador de visitas no mueve la fecha de última edición', async () => {
    const service = getServiceClient()
    const { data: before } = await service
      .from('landing_pages')
      .select('updated_at, views')
      .eq('id', pageB.id)
      .single()

    await service.rpc('bump_landing_view', { p_page: pageB.id })

    const { data: after } = await service
      .from('landing_pages')
      .select('updated_at, views')
      .eq('id', pageB.id)
      .single()

    const b = before as { updated_at: string; views: number }
    const a = after as { updated_at: string; views: number }
    expect(a.views).toBe(b.views + 1)
    // Si el trigger de updated_at se disparara con cada visita, el panel diría
    // "editada hace 2 minutos" cada vez que alguien abre la página.
    expect(a.updated_at).toBe(b.updated_at)
  })
})
