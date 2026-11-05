import { describe, expect, it } from 'vitest'
import { texReadTools } from '@/lib/tex/tools/read'
import { toInputSchema } from '@/lib/tex/tools/types'
import { uiTools } from '@/lib/tex/tools/ui'

// Lo que vale para todas las herramientas de mirar: viajan en cada pedido, así que importa cómo se
// llaman y cuánto gastan.

const EXPECTED = [
  'ver_resumen',
  'ver_pendientes',
  'ver_cajas',
  'ver_movimientos_caja',
  'ver_flujo',
  'ver_proximas_semanas',
  'buscar_participe',
  'ver_participe',
  'ver_deudas',
  'buscar_comprobantes',
  'ver_comprobante',
  'ver_plan_semana',
  'ver_gastos_fijos',
  'ver_sueldos',
  'ver_proyeccion',
  'ver_cierres_faltantes',
  'ver_por_cobrar',
  'ver_lo_que_llego',
  'ver_medios_de_cobro',
  'ver_sumas_y_saldos',
  'ver_mayor',
  'ver_diario',
  'ver_posicion_iva',
  'ver_libro_iva',
  'buscar_cuenta',
  'ver_cuentas_dudosas',
  'ver_estado_de_meses',
  'ver_ajustes',
]

describe('las herramientas de mirar', () => {
  it('están todas, y en un orden fijo (el caché de la API depende de eso)', () => {
    expect(texReadTools.map((tool) => tool.name)).toEqual(EXPECTED)
  })

  it('no se pisan con las de la pantalla', () => {
    const ui = new Set(uiTools.map((tool) => tool.name))
    for (const tool of texReadTools) expect(ui.has(tool.name), tool.name).toBe(false)
  })

  describe.each(texReadTools.map((tool) => [tool.name, tool] as const))('%s', (_name, tool) => {
    it('es de lectura', () => {
      expect(tool.need).toBe('read')
    })

    it('tiene un nombre en español con guion bajo', () => {
      expect(tool.name).toMatch(/^(ver|buscar)_[a-z_]+$/)
    })

    it('dice cuándo usarla en una o dos oraciones', () => {
      expect(tool.description.length).toBeGreaterThan(40)
      expect(tool.description.length).toBeLessThanOrEqual(240)
      expect(tool.description.split(/[.:]\s/).length).toBeLessThanOrEqual(4)
    })

    it('su entrada se convierte al esquema de la API', () => {
      const schema = toInputSchema(tool.input)
      expect(schema.type).toBe('object')
      // Un esquema enorme se paga en cada pedido.
      expect(JSON.stringify(schema).length).toBeLessThan(900)
    })

    it('dice lo que está haciendo', () => {
      // También tiene que andar con una entrada rota: se usa para redibujar una charla guardada.
      expect(tool.doing({})).toMatch(/^(Mirando|Buscando|Revisando)/)
      expect(tool.done({})).toMatch(/^(Miré|Busqué|Revisé)/)
    })
  })
})
