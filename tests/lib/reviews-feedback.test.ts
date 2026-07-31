import { describe, expect, it } from 'vitest'
import { buildFeedbackMessage, buildFeedbackWhatsappUrl } from '@/lib/reviews/feedback'

const BASE = {
  tenantName: 'HUB',
  customerName: 'Juan Pérez',
  rating: 3,
  comment: 'Tardaron 40 min en traer la birra',
} as const

describe('buildFeedbackMessage', () => {
  it('incluye bar, nombre, puntaje y comentario', () => {
    const msg = buildFeedbackMessage(BASE)
    expect(msg).toContain('HUB')
    expect(msg).toContain('Juan Pérez')
    expect(msg).toContain('3 estrellas')
    expect(msg).toContain('Tardaron 40 min en traer la birra')
  })

  it('usa el singular con 1★ y no inventa comentario cuando no hay', () => {
    const msg = buildFeedbackMessage({ ...BASE, rating: 1, comment: null })
    expect(msg).toContain('1 estrella')
    expect(msg).not.toContain('1 estrellas')
    expect(msg).toContain('Les cuento qué me pasó:')
  })

  it('cae a un genérico si el cliente no tiene nombre', () => {
    expect(buildFeedbackMessage({ ...BASE, customerName: '   ' })).toContain('un cliente')
  })
})

describe('buildFeedbackWhatsappUrl', () => {
  it('sin número cargado → null (no mostramos un botón roto)', () => {
    for (const phone of [null, undefined, '', '   ']) {
      expect(buildFeedbackWhatsappUrl({ ...BASE, phone })).toBeNull()
    }
  })

  it('arma wa.me con el número SIN + y sólo dígitos', () => {
    const url = buildFeedbackWhatsappUrl({ ...BASE, phone: '+54 9 351 283-9101' })
    expect(url).not.toBeNull()
    expect(url?.startsWith('https://wa.me/5493512839101?text=')).toBe(true)
    expect(url).not.toContain('+54')
  })

  it('urlencodea el texto (espacios, saltos de línea y acentos)', () => {
    const url = buildFeedbackWhatsappUrl({ ...BASE, phone: '+5493512839101' })
    const text = new URL(url ?? '').searchParams.get('text')
    // El decodificado debe volver a ser exactamente el mensaje original…
    expect(text).toBe(buildFeedbackMessage(BASE))
    // …y en la URL cruda no puede quedar ni un espacio ni un salto de línea.
    const raw = (url ?? '').split('?text=')[1] ?? ''
    expect(raw).not.toMatch(/[\s]/)
    expect(raw).toContain('%0A')
  })
})
