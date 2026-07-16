import { describe, expect, it } from 'vitest'
import { isStorageUrl, posterUrlFor, thumbUrlFor } from '@/lib/menu/media-urls'

const STORAGE_BASE = 'https://xyz.supabase.co/storage/v1/object/public/menu-images'

describe('isStorageUrl', () => {
  it('true para URLs públicas del bucket menu-images', () => {
    expect(isStorageUrl(`${STORAGE_BASE}/tenant-1/abc.webp`)).toBe(true)
  })

  it('false para otros hosts/paths', () => {
    expect(isStorageUrl('https://cdn.example.com/foto.webp')).toBe(false)
    expect(isStorageUrl('https://xyz.supabase.co/storage/v1/object/public/otros/abc.webp')).toBe(
      false,
    )
  })
})

describe('thumbUrlFor', () => {
  it('inserta _t antes de la extensión', () => {
    expect(thumbUrlFor(`${STORAGE_BASE}/t1/abc123.webp`)).toBe(`${STORAGE_BASE}/t1/abc123_t.webp`)
  })

  it('preserva el querystring', () => {
    expect(thumbUrlFor(`${STORAGE_BASE}/t1/abc123.webp?v=2`)).toBe(
      `${STORAGE_BASE}/t1/abc123_t.webp?v=2`,
    )
  })

  it('preserva el hash', () => {
    expect(thumbUrlFor(`${STORAGE_BASE}/t1/abc123.jpg#frag`)).toBe(
      `${STORAGE_BASE}/t1/abc123_t.jpg#frag`,
    )
  })

  it('funciona con URLs no-storage (transformación pura de string)', () => {
    expect(thumbUrlFor('https://cdn.example.com/foto.png')).toBe(
      'https://cdn.example.com/foto_t.png',
    )
  })

  it('sin extensión reconocible devuelve la URL original', () => {
    expect(thumbUrlFor(`${STORAGE_BASE}/t1/sin-extension`)).toBe(`${STORAGE_BASE}/t1/sin-extension`)
  })

  it('no confunde puntos del dominio con extensión', () => {
    expect(thumbUrlFor('https://cdn.example.com/carpeta.rara/archivo')).toBe(
      'https://cdn.example.com/carpeta.rara/archivo',
    )
  })
})

describe('posterUrlFor', () => {
  it('mapea ..._v.{ext} → ..._vp.webp', () => {
    expect(posterUrlFor(`${STORAGE_BASE}/t1/abc_v.mp4`)).toBe(`${STORAGE_BASE}/t1/abc_vp.webp`)
    expect(posterUrlFor(`${STORAGE_BASE}/t1/abc_v.mov`)).toBe(`${STORAGE_BASE}/t1/abc_vp.webp`)
    expect(posterUrlFor(`${STORAGE_BASE}/t1/abc_v.webm`)).toBe(`${STORAGE_BASE}/t1/abc_vp.webp`)
  })

  it('preserva el querystring', () => {
    expect(posterUrlFor(`${STORAGE_BASE}/t1/abc_v.mp4?v=3`)).toBe(
      `${STORAGE_BASE}/t1/abc_vp.webp?v=3`,
    )
  })

  it('null si la URL no sigue la convención _v.{ext}', () => {
    expect(posterUrlFor(`${STORAGE_BASE}/t1/abc.mp4`)).toBeNull()
    expect(posterUrlFor(`${STORAGE_BASE}/t1/abc.webp`)).toBeNull()
    expect(posterUrlFor('https://cdn.example.com/video.mp4')).toBeNull()
  })
})
