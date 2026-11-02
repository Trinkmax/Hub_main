import { describe, expect, it } from 'vitest'
import {
  youtubeEmbedUrl,
  youtubeThumbnailUrl,
  youtubeVideoId,
  youtubeWatchUrl,
} from '@/lib/ticketing/video'

describe('youtubeVideoId', () => {
  it('los links que se pegan desde «Compartir»', () => {
    // El de Ratatouille que mandó Nacho Badra el 02/11/2026.
    expect(youtubeVideoId('https://youtube.com/shorts/hF6H9bJ3EIo?si=2_Pl1yPE8gMI3rVb')).toBe(
      'hF6H9bJ3EIo',
    )
    expect(youtubeVideoId('https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=10s')).toBe('dQw4w9WgXcQ')
    expect(youtubeVideoId('https://youtu.be/dQw4w9WgXcQ?si=abc')).toBe('dQw4w9WgXcQ')
    expect(youtubeVideoId('https://m.youtube.com/watch?v=dQw4w9WgXcQ')).toBe('dQw4w9WgXcQ')
    expect(youtubeVideoId('https://www.youtube.com/embed/dQw4w9WgXcQ')).toBe('dQw4w9WgXcQ')
    expect(youtubeVideoId('youtube.com/shorts/hF6H9bJ3EIo')).toBe('hF6H9bJ3EIo')
    expect(youtubeVideoId('  https://www.youtube.com/live/dQw4w9WgXcQ  ')).toBe('dQw4w9WgXcQ')
  })

  it('lo que no es un video de YouTube', () => {
    expect(youtubeVideoId('')).toBeNull()
    expect(youtubeVideoId(null)).toBeNull()
    expect(youtubeVideoId('https://vimeo.com/123456')).toBeNull()
    expect(youtubeVideoId('https://www.youtube.com/@hubbarok')).toBeNull()
    expect(youtubeVideoId('https://youtube.com.ar.evil.com/shorts/hF6H9bJ3EIo')).toBeNull()
    expect(youtubeVideoId('https://www.youtube.com/watch?v=corto')).toBeNull()
    expect(youtubeVideoId('javascript:alert(1)')).toBeNull()
  })
})

describe('las direcciones del video', () => {
  it('embed sin cookies, miniatura y link para ver', () => {
    expect(youtubeEmbedUrl('hF6H9bJ3EIo')).toBe(
      'https://www.youtube-nocookie.com/embed/hF6H9bJ3EIo?autoplay=1&playsinline=1&rel=0&modestbranding=1',
    )
    expect(youtubeThumbnailUrl('hF6H9bJ3EIo')).toBe(
      'https://i.ytimg.com/vi/hF6H9bJ3EIo/maxresdefault.jpg',
    )
    expect(youtubeThumbnailUrl('hF6H9bJ3EIo', 'hq')).toBe(
      'https://i.ytimg.com/vi/hF6H9bJ3EIo/hqdefault.jpg',
    )
    expect(youtubeWatchUrl('hF6H9bJ3EIo')).toBe('https://www.youtube.com/watch?v=hF6H9bJ3EIo')
  })
})
