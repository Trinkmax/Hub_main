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
 * Los resultados de los exámenes que se publican como páginas. La página es HTML suelto, sin sesión:
 * guarda la nota llamando a `submit_landing_exam_result` con la clave pública. Lo que se cuida:
 *
 *   1. Que solo reciban resultados las páginas publicadas que se declaran examen
 *      (`<meta name="hub-exam">`), y que la nota salga de las respuestas.
 *   2. Que nadie sin sesión pueda leer ni escribir la tabla directo (solo por la función).
 *   3. Que los lea y los borre solo el dueño del bar: ni otro bar ni el cajero.
 */
const EXAM_HTML =
  '<!doctype html><html><head><meta name="hub-exam" content="1"></head><body>Examen</body></html>'

function payload(slug: string, overrides: Record<string, unknown> = {}) {
  return {
    p_slug: slug,
    p_submission_id: crypto.randomUUID(),
    p_name: '  Mozo   de prueba ',
    p_score: 1,
    p_total: 2,
    p_stations: [{ name: 'Cafetería', ok: 1, of: 2 }],
    p_answers: [
      { station: 'Cafetería', question: 'P1', picked: 'A', right: 'A', ok: true },
      { station: 'Cafetería', question: 'P2', picked: 'B', right: 'C', ok: false },
    ],
    p_duration_seconds: 90,
    p_left_screen: 0,
    p_attempt: 1,
    p_device_id: 'cel-prueba',
    ...overrides,
  }
}

describeIfRls('RLS — landing_exam_results', () => {
  let ownerA: Awaited<ReturnType<typeof createUserClient>>
  let cashierA: Awaited<ReturnType<typeof createUserClient>>
  let ownerB: Awaited<ReturnType<typeof createUserClient>>
  let tenantA: { id: string; slug: string }
  let tenantB: { id: string; slug: string }
  const pages: Record<'exam' | 'plain' | 'draft' | 'examB', { id: string; slug: string }> = {
    exam: { id: '', slug: '' },
    plain: { id: '', slug: '' },
    draft: { id: '', slug: '' },
    examB: { id: '', slug: '' },
  }

  beforeAll(async () => {
    ownerA = await createUserClient({ email: uniqueEmail('exam-ownerA') })
    cashierA = await createUserClient({ email: uniqueEmail('exam-cashier') })
    ownerB = await createUserClient({ email: uniqueEmail('exam-ownerB') })
    tenantA = await createTenant({
      name: 'Bar EXAM A',
      slug: uniqueSlug('exam-a'),
      ownerId: ownerA.userId,
    })
    tenantB = await createTenant({
      name: 'Bar EXAM B',
      slug: uniqueSlug('exam-b'),
      ownerId: ownerB.userId,
    })

    const service = getServiceClient()
    await service
      .from('memberships')
      .insert({ tenant_id: tenantA.id, user_id: cashierA.userId, role: 'cashier' })

    const make = async (tenantId: string, prefix: string, html: string, published: boolean) => {
      const slug = uniqueSlug(prefix)
      const { data, error } = await service
        .from('landing_pages')
        .insert({ tenant_id: tenantId, slug, title: prefix, html, published })
        .select('id')
        .single()
      if (error) throw error
      return { id: (data as { id: string }).id, slug }
    }
    pages.exam = await make(tenantA.id, 'examen-a', EXAM_HTML, true)
    pages.plain = await make(tenantA.id, 'promo-a', '<!doctype html><p>Promo</p>', true)
    pages.draft = await make(tenantA.id, 'borrador-a', EXAM_HTML, false)
    pages.examB = await make(tenantB.id, 'examen-b', EXAM_HTML, true)
  })

  afterAll(async () => {
    const service = getServiceClient()
    await service
      .from('landing_pages')
      .delete()
      .in(
        'id',
        Object.values(pages).map((page) => page.id),
      )
    await deleteUser(ownerA.userId)
    await deleteUser(cashierA.userId)
    await deleteUser(ownerB.userId)
  })

  it('la página del examen guarda el resultado sin sesión, en el bar de la página', async () => {
    const { data: id, error } = await getAnonClient().rpc(
      'submit_landing_exam_result',
      payload(pages.exam.slug),
    )
    expect(error).toBeNull()
    expect(typeof id).toBe('string')

    const { data } = await getServiceClient()
      .from('landing_exam_results')
      .select('tenant_id, page_id, taker_name, score, total')
      .eq('id', id as string)
      .single()
    expect(data).toMatchObject({
      tenant_id: tenantA.id,
      page_id: pages.exam.id,
      taker_name: 'Mozo de prueba',
      score: 1,
      total: 2,
    })
  })

  it('el mismo envío dos veces (un reintento) deja una sola fila', async () => {
    const once = payload(pages.exam.slug)
    const first = await getAnonClient().rpc('submit_landing_exam_result', once)
    const second = await getAnonClient().rpc('submit_landing_exam_result', once)
    expect(first.error).toBeNull()
    expect(second.data).toBe(first.data)

    const { count } = await getServiceClient()
      .from('landing_exam_results')
      .select('id', { count: 'exact', head: true })
      .eq('submission_id', once.p_submission_id)
    expect(count).toBe(1)
  })

  it('una página que no es examen, o que está apagada, no recibe resultados', async () => {
    const plain = await getAnonClient().rpc('submit_landing_exam_result', payload(pages.plain.slug))
    expect(plain.error).not.toBeNull()
    const draft = await getAnonClient().rpc('submit_landing_exam_result', payload(pages.draft.slug))
    expect(draft.error).not.toBeNull()
  })

  it('la nota tiene que salir de las respuestas', async () => {
    const { error } = await getAnonClient().rpc(
      'submit_landing_exam_result',
      payload(pages.exam.slug, { p_score: 2 }),
    )
    expect(error).not.toBeNull()
  })

  it('sin sesión no se puede leer ni escribir la tabla directo', async () => {
    const anon = getAnonClient()
    const read = await anon.from('landing_exam_results').select('id')
    expect(read.error !== null || (read.data ?? []).length === 0).toBe(true)

    const write = await anon.from('landing_exam_results').insert({
      tenant_id: tenantA.id,
      page_id: pages.exam.id,
      submission_id: crypto.randomUUID(),
      taker_name: 'Colado',
      score: 10,
      total: 10,
      duration_seconds: 1,
    })
    expect(write.error).not.toBeNull()
  })

  it('el dueño ve los de su bar; el dueño de otro bar y el cajero, no', async () => {
    await getAnonClient().rpc('submit_landing_exam_result', payload(pages.examB.slug))

    const mine = await ownerA.client.from('landing_exam_results').select('id, page_id')
    expect(mine.error).toBeNull()
    const pageIds = new Set((mine.data ?? []).map((row) => (row as { page_id: string }).page_id))
    expect(pageIds.has(pages.exam.id)).toBe(true)
    expect(pageIds.has(pages.examB.id)).toBe(false)

    const other = await ownerB.client
      .from('landing_exam_results')
      .select('id')
      .eq('page_id', pages.exam.id)
    expect(other.data ?? []).toHaveLength(0)

    const cashier = await cashierA.client.from('landing_exam_results').select('id')
    expect(cashier.data ?? []).toHaveLength(0)
  })

  it('el dueño puede borrar un intento; el de otro bar y el cajero, no', async () => {
    const { data: id } = await getAnonClient().rpc(
      'submit_landing_exam_result',
      payload(pages.exam.slug),
    )
    const service = getServiceClient()
    const exists = async () =>
      (
        await service
          .from('landing_exam_results')
          .select('id')
          .eq('id', id as string)
      ).data?.length ?? 0

    await ownerB.client
      .from('landing_exam_results')
      .delete()
      .eq('id', id as string)
    await cashierA.client
      .from('landing_exam_results')
      .delete()
      .eq('id', id as string)
    expect(await exists()).toBe(1)

    const { error } = await ownerA.client
      .from('landing_exam_results')
      .delete()
      .eq('id', id as string)
    expect(error).toBeNull()
    expect(await exists()).toBe(0)
  })

  it('nadie con sesión puede cambiar una nota', async () => {
    const { data: id } = await getAnonClient().rpc(
      'submit_landing_exam_result',
      payload(pages.exam.slug),
    )
    // Según el proyecto, el UPDATE choca con los permisos (sin grant de update) o pasa sin tocar
    // ninguna fila (los proyectos viejos dan todos los permisos por defecto, pero no hay policy de
    // update). Lo que importa es lo mismo en los dos: la nota sigue igual.
    await ownerA.client
      .from('landing_exam_results')
      .update({ score: 2 })
      .eq('id', id as string)
    const { data } = await getServiceClient()
      .from('landing_exam_results')
      .select('score')
      .eq('id', id as string)
      .single()
    expect((data as { score: number }).score).toBe(1)
  })
})
