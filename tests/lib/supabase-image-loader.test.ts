import { describe, expect, it } from 'vitest'
import loader from '@/lib/images/supabase-loader'

const OBJECT = 'https://ref.supabase.co/storage/v1/object/public/menu-images/tid/abc.webp'
const RENDER = 'https://ref.supabase.co/storage/v1/render/image/public/menu-images/tid/abc.webp'

describe('supabaseImageLoader', () => {
  it('reescribe object/public → render/image con width y quality', () => {
    const out = loader({ src: OBJECT, width: 640, quality: 80 })
    expect(out).toBe(`${RENDER}?width=640&quality=80`)
  })

  it('quality por defecto = 75 cuando no se pasa', () => {
    expect(loader({ src: OBJECT, width: 320 })).toBe(`${RENDER}?width=320&quality=75`)
  })

  it('preserva el cache-buster (?v=…) y le suma width/quality', () => {
    const out = loader({ src: `${OBJECT}?v=2`, width: 128, quality: 75 })
    expect(out).toBe(`${RENDER}?v=2&width=128&quality=75`)
  })

  it('clampa el width al máximo de Supabase (2500)', () => {
    const out = loader({ src: OBJECT, width: 3840, quality: 75 })
    expect(out).toBe(`${RENDER}?width=2500&quality=75`)
  })

  it('funciona para cualquier bucket público (event-covers)', () => {
    const src = 'https://ref.supabase.co/storage/v1/object/public/event-covers/x.jpg'
    expect(loader({ src, width: 750 })).toContain(
      '/render/image/public/event-covers/x.jpg?width=750',
    )
  })

  // --- passthrough: nada que optimizar o no debe transformarse ---

  it('data URL de QR → sin tocar (debe quedar nítido/escaneable)', () => {
    const src = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUg=='
    expect(loader({ src, width: 224 })).toBe(src)
  })

  it('estático de /public (ej. logo) → sin tocar', () => {
    expect(loader({ src: '/hub-logo.png', width: 200 })).toBe('/hub-logo.png')
  })

  it('SVG en Storage → sin tocar (vectorial, no rasterizar)', () => {
    const src = 'https://ref.supabase.co/storage/v1/object/public/menu-images/logo.svg'
    expect(loader({ src, width: 200 })).toBe(src)
  })

  it('video en Storage → sin tocar (no es raster)', () => {
    const src = 'https://ref.supabase.co/storage/v1/object/public/menu-images/tid/clip_v.mp4'
    expect(loader({ src, width: 640 })).toBe(src)
  })

  it('URL firmada privada (/object/sign/) → sin tocar', () => {
    const src = 'https://ref.supabase.co/storage/v1/object/sign/message-media/x.jpg?token=abc'
    expect(loader({ src, width: 400 })).toBe(src)
  })

  it('URL externa → sin tocar', () => {
    const src = 'https://cdn.partner.com/logo.png'
    expect(loader({ src, width: 96 })).toBe(src)
  })
})
