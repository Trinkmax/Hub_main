import { describe, expect, it } from 'vitest'
import { mapPgError, PG_ERROR_MESSAGES, SECTOR_NAME_TAKEN } from '@/lib/floor-plan/errors'

describe('mapPgError', () => {
  it('mapea table_has_open_session a su mensaje accionable', () => {
    expect(mapPgError({ message: 'table_has_open_session' })).toBe(
      PG_ERROR_MESSAGES.table_has_open_session,
    )
    expect(mapPgError({ message: 'table_has_open_session' })).toContain('sesión abierta')
  })

  it('mapea table_has_history', () => {
    expect(mapPgError({ message: 'P0001: table_has_history' })).toBe(
      PG_ERROR_MESSAGES.table_has_history,
    )
  })

  it('mapea area_has_active_tables', () => {
    expect(mapPgError({ message: 'area_has_active_tables' })).toBe(
      PG_ERROR_MESSAGES.area_has_active_tables,
    )
  })

  it('mapea cannot_delete_last_area', () => {
    expect(mapPgError({ message: 'cannot_delete_last_area' })).toBe(
      PG_ERROR_MESSAGES.cannot_delete_last_area,
    )
  })

  it('mapea cross_tenant_merge', () => {
    expect(mapPgError({ message: 'cross_tenant_merge' })).toBe(PG_ERROR_MESSAGES.cross_tenant_merge)
  })

  it('mapea fp_table_inactive', () => {
    expect(mapPgError({ message: 'fp_table_inactive' })).toBe(PG_ERROR_MESSAGES.fp_table_inactive)
  })

  it('mapea owner_required', () => {
    expect(mapPgError({ message: 'owner_required' })).toBe(PG_ERROR_MESSAGES.owner_required)
  })

  it('encuentra la key aunque esté embebida en un mensaje más largo de Postgres', () => {
    expect(
      mapPgError({
        message: 'new row violates check constraint, P0001: table_has_open_session at character 12',
      }),
    ).toBe(PG_ERROR_MESSAGES.table_has_open_session)
  })

  it('caso especial: violación del índice único floor_plan_elements_pt_uidx', () => {
    expect(
      mapPgError({
        message: 'duplicate key value violates unique constraint "floor_plan_elements_pt_uidx"',
      }),
    ).toBe('La mesa ya está ubicada en el plano.')
  })

  it('nombre de sector repetido: el índice único ahora es por sucursal', () => {
    expect(
      mapPgError({
        message:
          'duplicate key value violates unique constraint "floor_plan_areas_branch_name_uidx"',
      }),
    ).toBe(SECTOR_NAME_TAKEN)
    expect(SECTOR_NAME_TAKEN).toContain('Ya existe un sector con ese nombre')
  })

  it('nombre de sector repetido: también reconoce el índice viejo (por bar)', () => {
    expect(
      mapPgError({
        message:
          'duplicate key value violates unique constraint "floor_plan_areas_tenant_name_uidx"',
      }),
    ).toBe(SECTOR_NAME_TAKEN)
  })

  it('los mensajes hablan de «sector», no de «área»', () => {
    for (const message of [...Object.values(PG_ERROR_MESSAGES), SECTOR_NAME_TAKEN]) {
      expect(message.toLowerCase()).not.toContain('área')
    }
  })

  it('mensaje desconocido devuelve el genérico', () => {
    expect(mapPgError({ message: 'algo totalmente distinto' })).toBe(
      'No se pudo completar la acción. Probá de nuevo.',
    )
  })

  it('error null/undefined devuelve el genérico', () => {
    expect(mapPgError(null)).toBe('No se pudo completar la acción. Probá de nuevo.')
    expect(mapPgError(undefined)).toBe('No se pudo completar la acción. Probá de nuevo.')
    expect(mapPgError({})).toBe('No se pudo completar la acción. Probá de nuevo.')
  })
})
