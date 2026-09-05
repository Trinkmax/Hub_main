import { describe, expect, it } from 'vitest'
import { humanizeSalonError } from '@/lib/salon/humanize'
import { cakeOptionSchema } from '@/lib/salon/schemas'
import { describeCake } from '@/lib/salon/types'

const valid = {
  name: 'Opción 1',
  base: 'Bizcochuelo de vainilla',
  fillings: ['Dulce de leche', 'Crema chantilly y frutillas'],
}

describe('cakeOptionSchema', () => {
  it('la torta del HUB pasa', () => {
    const r = cakeOptionSchema.safeParse(valid)
    expect(r.success).toBe(true)
    expect(r.success && r.data.fillings).toEqual(['Dulce de leche', 'Crema chantilly y frutillas'])
  })

  it('un solo relleno llega como string suelto desde el form y termina en array', () => {
    const r = cakeOptionSchema.safeParse({ ...valid, fillings: 'Dulce de leche' })
    expect(r.success && r.data.fillings).toEqual(['Dulce de leche'])
  })

  it('las filas de relleno vacías se descartan antes de validar el largo', () => {
    const r = cakeOptionSchema.safeParse({
      ...valid,
      fillings: ['Dulce de leche', '   ', '', 'Crema y durazno'],
    })
    expect(r.success && r.data.fillings).toEqual(['Dulce de leche', 'Crema y durazno'])
  })

  it('sin ningún relleno → error (una torta sin relleno no es una opción)', () => {
    const r = cakeOptionSchema.safeParse({ ...valid, fillings: ['', '  '] })
    expect(r.success).toBe(false)
  })

  it('más de 4 rellenos → error', () => {
    const r = cakeOptionSchema.safeParse({ ...valid, fillings: ['a', 'b', 'c', 'd', 'e'] })
    expect(r.success).toBe(false)
  })

  it('sin bizcochuelo → error', () => {
    const r = cakeOptionSchema.safeParse({ ...valid, base: '  ' })
    expect(r.success).toBe(false)
  })

  it('sin nombre → error', () => {
    const r = cakeOptionSchema.safeParse({ ...valid, name: '' })
    expect(r.success).toBe(false)
  })

  it('active tolera el string del FormData: "false" es false, no truthy', () => {
    const off = cakeOptionSchema.safeParse({ ...valid, active: 'false' })
    expect(off.success && off.data.active).toBe(false)
    const on = cakeOptionSchema.safeParse({ ...valid, active: 'on' })
    expect(on.success && on.data.active).toBe(true)
    const def = cakeOptionSchema.safeParse(valid)
    expect(def.success && def.data.active).toBe(true)
  })

  it('position llega como string del form y se coacciona', () => {
    const r = cakeOptionSchema.safeParse({ ...valid, position: '3' })
    expect(r.success && r.data.position).toBe(3)
  })
})

describe('describeCake', () => {
  it('arma la frase que se le dicta al cliente por teléfono', () => {
    expect(
      describeCake({
        id: 'c',
        name: 'Opción 2',
        base: 'Bizcochuelo de chocolate',
        fillings: ['Mousse de chocolate', 'Crema y frutillas'],
      }),
    ).toBe('Opción 2 · Bizcochuelo de chocolate con Mousse de chocolate y Crema y frutillas')
  })

  it('sin rellenos no deja un "con" colgado', () => {
    expect(describeCake({ id: 'c', name: 'Opción 4', base: 'Cheesecake', fillings: [] })).toBe(
      'Opción 4 · Cheesecake',
    )
  })
})

describe('humanizeSalonError — errores del catálogo de tortas', () => {
  it('la FK ocupada explica que hay que desactivar, no borrar', () => {
    const msg = humanizeSalonError(
      'update or delete on table "cake_options" violates foreign key constraint "salon_reservations_cake_option_id_fkey" on table "salon_reservations"',
    )
    expect(msg).toContain('Desactivala')
  })

  it('la misma FK del otro lado dice "elegí otra", no "desactivala"', () => {
    // El dueño borró la Opción 3 mientras el anfitrión la tenía seleccionada en
    // otra pestaña: mandarlo a desactivar una torta que ya no existe (y que
    // además él no puede editar) sería una instrucción imposible.
    const msg = humanizeSalonError(
      'insert or update on table "salon_reservations" violates foreign key constraint "salon_reservations_cake_option_id_fkey"',
    )
    expect(msg).toContain('ya no está en el menú')
    expect(msg).not.toContain('Desactivala')
  })

  it('nombre duplicado', () => {
    expect(
      humanizeSalonError(
        'duplicate key value violates unique constraint "cake_options_name_unique"',
      ),
    ).toContain('Ya tenés una torta con ese nombre')
  })

  it('rellenos fuera de rango', () => {
    expect(
      humanizeSalonError(
        'new row for relation "cake_options" violates check constraint "cake_options_fillings_len"',
      ),
    ).toContain('entre 1 y 4 rellenos')
  })

  it('torta elegida sin tortas: mensaje propio, no el genérico de check', () => {
    const msg = humanizeSalonError(
      'new row for relation "salon_reservations" violates check constraint "salon_reservations_cake_option_needs_cake"',
    )
    expect(msg).toContain('lleva torta')
    expect(msg).not.toContain('fuera de rango')
  })
})
