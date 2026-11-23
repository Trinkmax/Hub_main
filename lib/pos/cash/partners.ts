/**
 * Quiénes son los socios de un bar — PURO y testeado (`tests/lib/pos-cash-blind.test.ts`).
 *
 * La misma regla que decide quién ve los números del salón (`seesSalonNumbers`), mirada desde el bar:
 * los dueños con acceso completo a Administración. Si el bar no usa Administración (o todavía no dio
 * ningún acceso completo), todos los dueños: un cierre de caja nunca se queda sin destinatario.
 */
export function pickPartners(input: {
  /** Los dueños del bar (rol `owner`). */
  ownerIds: ReadonlyArray<string>
  /** El bar tiene Administración prendida y configurada. */
  accountingOn: boolean
  /** Los accesos vigentes a Administración. `scope` vacío = completo. */
  grants: ReadonlyArray<{ userId: string; scope: string | null }>
}): string[] {
  const owners = [...new Set(input.ownerIds)]
  if (!input.accountingOn) return owners
  const full = new Set(
    input.grants
      .filter((grant) => grant.scope === null || grant.scope === 'full')
      .map((grant) => grant.userId),
  )
  const partners = owners.filter((id) => full.has(id))
  return partners.length > 0 ? partners : owners
}
