import { describe, expect, it } from 'vitest'
import { resolveNavGroups } from '@/components/shell/nav-config'
import { type FeatureKey, getTenantFeatures, type TenantFeatures } from '@/lib/platform/features'

const SLUG = 'hub'
const allOff: TenantFeatures = getTenantFeatures({ feature_flags: {} })
const withFeature = (key: FeatureKey): TenantFeatures => ({ ...allOff, [key]: true })

function labels(groups: ReturnType<typeof resolveNavGroups>): string[] {
  return groups.map((g) => g.label)
}
function group(groups: ReturnType<typeof resolveNavGroups>, label: string) {
  return groups.find((g) => g.label === label)
}
function itemLabels(groups: ReturnType<typeof resolveNavGroups>, groupLabel: string): string[] {
  return group(groups, groupLabel)?.items.map((i) => i.label) ?? []
}

describe('resolveNavGroups — rol + feature + superadmin', () => {
  it('owner sin features y sin ser admin NO ve el grupo Salón', () => {
    const groups = resolveNavGroups('owner', SLUG, allOff, false)
    expect(group(groups, 'Salón')).toBeUndefined()
    // Pero sí ve lo loyalty-first.
    expect(labels(groups)).toContain('Hoy')
    expect(itemLabels(groups, 'Hoy')).toContain('Resumen')
  })

  it('habilitar una feature revela su item en el grupo Salón', () => {
    const groups = resolveNavGroups('owner', SLUG, withFeature('kitchen'), false)
    expect(itemLabels(groups, 'Salón')).toEqual(['Cocina'])
  })

  it('un superadmin ve TODOS los items del grupo Salón aunque las features estén OFF', () => {
    const groups = resolveNavGroups('owner', SLUG, allOff, true)
    const salon = itemLabels(groups, 'Salón')
    expect(salon).toEqual(
      expect.arrayContaining(['Salón en vivo', 'Cocina', 'Plano y QRs de mesa', 'Auto-aceptación']),
    )
  })

  it('el filtro de rol sigue aplicando: un cashier no ve grupos owner-only', () => {
    const groups = resolveNavGroups('cashier', SLUG, allOff, false)
    expect(group(groups, 'Crecimiento')).toBeUndefined() // Marketing/Menú/Club son owner
    expect(group(groups, 'Negocio')).toBeUndefined() // Estadísticas/Config son owner
    expect(labels(groups)).toEqual(expect.arrayContaining(['Hoy', 'Agenda', 'Clientes']))
    // QR del club (owner) se filtra; Acreditar (todos) queda.
    expect(itemLabels(groups, 'Clientes')).not.toContain('QR del club')
    expect(itemLabels(groups, 'Clientes')).toContain('Acreditar')
  })

  it('resuelve hrefs con el slug y mantiene la anidación de Personas', () => {
    const groups = resolveNavGroups('owner', SLUG, allOff, false)
    const hoy = group(groups, 'Hoy')
    expect(hoy?.items.find((i) => i.label === 'Resumen')?.href).toBe('/hub')

    const personas = group(groups, 'Clientes')?.items.find((i) => i.label === 'Personas')
    expect(personas?.href).toBe('/hub/clientes')
    expect(personas?.children?.map((c) => c.label)).toEqual(['Reservas', 'Walk-in'])
    expect(personas?.children?.[0]?.href).toBe('/hub/clientes?segment=reserva')
  })

  it('un padre owner-only con todos los hijos owner-only se cae para cashier', () => {
    const groups = resolveNavGroups('cashier', SLUG, allOff, false)
    // Marketing y su subárbol son owner-only → no debería existir el item.
    const allItemLabels = groups.flatMap((g) => g.items.map((i) => i.label))
    expect(allItemLabels).not.toContain('Marketing')
  })
})
