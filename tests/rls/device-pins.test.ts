import { createHash, randomBytes, randomUUID } from 'node:crypto'
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

/** Un equipo: su id y su secreto, como los arma la app (`lib/auth/pin-server.ts`). */
const device = () => {
  const secret = randomBytes(32).toString('base64url')
  return { id: randomUUID(), secret, hash: createHash('sha256').update(secret).digest('hex') }
}

/**
 * El PIN de ingreso por equipo (`20261126213014_ingreso_pin_por_equipo`).
 *
 * La tabla no se toca desde ningún navegador; cada persona pone y quita su PIN por funciones; y
 * comprobar un PIN (que es lo que abre una sesión) solo lo puede hacer la app con la clave de servicio.
 */
describeIfRls('Ingreso — el PIN por equipo', () => {
  let ana: Awaited<ReturnType<typeof createUserClient>>
  let beto: Awaited<ReturnType<typeof createUserClient>>
  let otro: Awaited<ReturnType<typeof createUserClient>>
  let tenantA: { id: string }
  const caja = device()
  const service = () => getServiceClient()

  const setPin = (
    who: { client: (typeof ana)['client'] },
    where: { id: string; hash: string },
    pin: string,
  ) =>
    who.client.rpc('device_pin_set', {
      p_device_id: where.id,
      p_secret_hash: where.hash,
      p_pin: pin,
    })

  const verify = async (pinId: string, pin: string, secret = caja.secret) => {
    const { data, error } = await service().rpc('device_pin_verify', {
      p_device_id: caja.id,
      p_secret: secret,
      p_pin_id: pinId,
      p_pin: pin,
    })
    if (error) throw new Error(`verify failed: ${error.message}`)
    return data as { ok: boolean; reason?: string; left?: number; user_id?: string; email?: string }
  }

  beforeAll(async () => {
    ana = await createUserClient({ email: uniqueEmail('pinAna') })
    beto = await createUserClient({ email: uniqueEmail('pinBeto') })
    otro = await createUserClient({ email: uniqueEmail('pinOtro') })
    tenantA = await createTenant({ name: 'Pin A', slug: uniqueSlug('pin-a'), ownerId: ana.userId })
    const { error } = await service()
      .from('memberships')
      .insert({ tenant_id: tenantA.id, user_id: beto.userId, role: 'waiter' })
    if (error) throw new Error(`membership failed: ${error.message}`)
    await createTenant({ name: 'Pin B', slug: uniqueSlug('pin-b'), ownerId: otro.userId })
  })

  afterAll(async () => {
    for (const user of [ana, beto, otro]) {
      if (user) await deleteUser(user.userId)
    }
  })

  it('cada persona elige su PIN, y en el mismo equipo pueden convivir varios', async () => {
    const first = await setPin(ana, caja, '4827')
    expect(first.error).toBeNull()
    expect(typeof first.data).toBe('string')
    const second = await setPin(beto, caja, '1593')
    expect(second.error).toBeNull()

    const status = await ana.client.rpc('device_pin_status', { p_device_id: caja.id })
    expect(status.data).toEqual({ exists: true, locked: false })
    // Quien no tiene PIN en ese equipo no ve el de los demás.
    const stranger = await otro.client.rpc('device_pin_status', { p_device_id: caja.id })
    expect(stranger.data).toEqual({ exists: false, locked: false })
  })

  it('no acepta un PIN fácil, ni uno con otra forma, ni otro secreto para un equipo ya usado', async () => {
    const mine = device()
    expect((await setPin(ana, mine, '1111')).error?.message).toContain('weak_pin')
    expect((await setPin(ana, mine, '1234')).error?.message).toContain('weak_pin')
    expect((await setPin(ana, mine, '12')).error?.message).toContain('invalid_pin')
    expect((await setPin(ana, mine, '12a4')).error?.message).toContain('invalid_pin')
    const forged = await setPin(otro, { id: caja.id, hash: device().hash }, '2580')
    expect(forged.error?.message).toContain('invalid_device')
  })

  it('la tabla no se lee ni se escribe a mano, con sesión o sin ella', async () => {
    for (const client of [ana.client, getAnonClient()]) {
      const read = await client.from('device_pins').select('id').limit(1)
      expect(read.error).not.toBeNull()
      const write = await client.from('device_pins').insert({
        tenant_id: tenantA.id,
        user_id: ana.userId,
        device_id: randomUUID(),
        secret_hash: 'a'.repeat(64),
        pin_hash: 'x',
      })
      expect(write.error).not.toBeNull()
      const wipe = await client.from('device_pins').delete().eq('user_id', ana.userId)
      expect(wipe.error).not.toBeNull()
    }
  })

  it('comprobar un PIN y listar las cuentas de un equipo no es para quien tiene sesión', async () => {
    for (const client of [ana.client, getAnonClient()]) {
      const check = await client.rpc('device_pin_verify', {
        p_device_id: caja.id,
        p_secret: caja.secret,
        p_pin_id: randomUUID(),
        p_pin: '4827',
      })
      expect(check.error).not.toBeNull()
      const list = await client.rpc('device_pin_accounts', {
        p_device_id: caja.id,
        p_secret: caja.secret,
      })
      expect(list.error).not.toBeNull()
    }
  })

  it('la app, con el secreto del equipo, ve quiénes pueden entrar ahí (sin mails) y comprueba el PIN', async () => {
    const list = await service().rpc('device_pin_accounts', {
      p_device_id: caja.id,
      p_secret: caja.secret,
    })
    expect(list.error).toBeNull()
    const accounts = list.data as { id: string; name: string; locked: boolean }[]
    expect(accounts).toHaveLength(2)
    expect(JSON.stringify(accounts)).not.toContain('@')

    // Sin el secreto de ese equipo no hay nadie.
    const blind = await service().rpc('device_pin_accounts', {
      p_device_id: caja.id,
      p_secret: 'otro-secreto',
    })
    expect(blind.data).toEqual([])

    const { data: rows } = await service()
      .from('device_pins')
      .select('id, user_id')
      .eq('device_id', caja.id)
    const pinOf = (userId: string) => (rows ?? []).find((row) => row.user_id === userId)?.id ?? ''

    const right = await verify(pinOf(ana.userId), '4827')
    expect(right).toMatchObject({ ok: true, user_id: ana.userId, email: ana.email })
    // El PIN de un compañero del mismo equipo no abre la cuenta de otra persona.
    expect(await verify(pinOf(ana.userId), '1593')).toEqual({ ok: false, reason: 'wrong', left: 4 })
    // Con otro secreto ni se cuenta el intento.
    expect(await verify(pinOf(ana.userId), '4827', 'otro-secreto')).toEqual({
      ok: false,
      reason: 'gone',
    })
    // Acertar pone la cuenta de errores en cero.
    expect((await verify(pinOf(ana.userId), '4827')).ok).toBe(true)
    expect(await verify(pinOf(ana.userId), '0002')).toEqual({ ok: false, reason: 'wrong', left: 4 })
  })

  it('al quinto error seguido se bloquea, y elegir uno nuevo lo destraba', async () => {
    const { data: rows } = await service()
      .from('device_pins')
      .select('id')
      .eq('device_id', caja.id)
      .eq('user_id', beto.userId)
    const pinId = rows?.[0]?.id ?? ''

    for (let attempt = 1; attempt <= 4; attempt++) {
      expect(await verify(pinId, '0007')).toEqual({ ok: false, reason: 'wrong', left: 5 - attempt })
    }
    expect(await verify(pinId, '0007')).toEqual({ ok: false, reason: 'locked' })
    // Bloqueado, ni el correcto.
    expect(await verify(pinId, '1593')).toEqual({ ok: false, reason: 'locked' })
    expect((await beto.client.rpc('device_pin_status', { p_device_id: caja.id })).data).toEqual({
      exists: true,
      locked: true,
    })

    expect((await setPin(beto, caja, '2580')).error).toBeNull()
    expect((await verify(pinId, '2580')).ok).toBe(true)
  })

  it('cada uno quita solo el suyo, y a quien se va del bar se le borra', async () => {
    const removed = await ana.client.rpc('device_pin_remove', { p_device_id: caja.id })
    expect(removed.data).toBe(true)
    expect((await ana.client.rpc('device_pin_remove', { p_device_id: caja.id })).data).toBe(false)

    const before = await service().from('device_pins').select('id').eq('user_id', beto.userId)
    expect(before.data).toHaveLength(1)
    const gone = await service()
      .from('memberships')
      .delete()
      .eq('tenant_id', tenantA.id)
      .eq('user_id', beto.userId)
    expect(gone.error).toBeNull()
    const after = await service().from('device_pins').select('id').eq('user_id', beto.userId)
    expect(after.data).toHaveLength(0)
  })
})
