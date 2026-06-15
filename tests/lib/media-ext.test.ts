import { describe, expect, it } from 'vitest'
import { extForMime } from '@/lib/meta/media'

describe('extForMime', () => {
  it('image/jpeg → jpg', () => {
    expect(extForMime('image/jpeg')).toBe('jpg')
  })

  it('image/jpg → jpg (alias)', () => {
    expect(extForMime('image/jpg')).toBe('jpg')
  })

  it('image/png → png', () => {
    expect(extForMime('image/png')).toBe('png')
  })

  it('video/mp4 → mp4', () => {
    expect(extForMime('video/mp4')).toBe('mp4')
  })

  it('audio/ogg → ogg', () => {
    expect(extForMime('audio/ogg')).toBe('ogg')
  })

  it('application/pdf → pdf', () => {
    expect(extForMime('application/pdf')).toBe('pdf')
  })

  it('tipo desconocido → bin', () => {
    expect(extForMime('application/x-unknown-type')).toBe('bin')
  })

  it('respeta mayúsculas (normaliza a lowercase)', () => {
    expect(extForMime('Image/JPEG')).toBe('jpg')
  })

  it('ignora parámetros extra en el mime (ej. charset)', () => {
    expect(extForMime('text/plain; charset=utf-8')).toBe('txt')
  })

  it('audio/mpeg → mp3', () => {
    expect(extForMime('audio/mpeg')).toBe('mp3')
  })

  it('image/webp → webp', () => {
    expect(extForMime('image/webp')).toBe('webp')
  })

  it('cadena vacía → bin', () => {
    expect(extForMime('')).toBe('bin')
  })
})
