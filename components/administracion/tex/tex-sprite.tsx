'use client'

import { type CSSProperties, useEffect, useRef, useState } from 'react'
import { cn } from '@/lib/utils'
import { TEX_FACE_H, TEX_FACE_W, TexFace, type TexFaceName, type TexLook } from './tex-face'

/**
 * El cuerpo de Tex, a pixel limpio: los sprites tienen la grilla real del dibujo, así se ven nítidos a
 * cualquier escala entera. La cara va encima (`TexFace`), salvo con anteojos, que ya la trae.
 */

export const TEX_POSES = {
  wave: { w: 55, h: 44, face: { x: 19, y: 13 } },
  support: { w: 58, h: 51, face: { x: 19, y: 17 } },
  goals: { w: 71, h: 58, face: { x: 18, y: 20 } },
  analytics: { w: 60, h: 48, face: null },
  head: { w: 40, h: 28, face: { x: 8, y: 4 } },
} as const
export type TexPose = keyof typeof TEX_POSES

export function TexSprite({
  pose = 'wave',
  face = 'smile',
  look,
  scale = 2,
  className,
  style,
}: {
  pose?: TexPose
  face?: TexFaceName
  look?: TexLook
  scale?: number
  className?: string
  style?: CSSProperties
}) {
  const def = TEX_POSES[pose]
  const faceBox = def.face
  return (
    <span
      aria-hidden="true"
      className={cn('relative inline-block shrink-0 select-none', className)}
      style={{ width: def.w * scale, height: def.h * scale, ...style }}
    >
      {/* biome-ignore lint/performance/noImgElement: es pixel art de unos KB; el optimizador de imágenes lo arruinaría. */}
      <img
        src={`/tex/${pose}.png`}
        alt=""
        width={def.w * scale}
        height={def.h * scale}
        draggable={false}
        className="tex-pixel absolute inset-0 size-full"
      />
      {faceBox ? (
        <TexFace
          name={face}
          look={look}
          className="absolute"
          style={{
            left: faceBox.x * scale,
            top: faceBox.y * scale,
            width: TEX_FACE_W * scale,
            height: TEX_FACE_H * scale,
          }}
        />
      ) : null}
    </span>
  )
}

/** Una parte suelta del cuerpo, para cuando Tex se agranda. */
export function TexPart({
  name,
  w,
  h,
  scale = 3,
  className,
  style,
}: {
  name: 'cap' | 'hand-left' | 'hand-right' | 'legs' | 'tail'
  w: number
  h: number
  scale?: number
  className?: string
  style?: CSSProperties
}) {
  return (
    // biome-ignore lint/performance/noImgElement: pixel art de unos KB, ver `TexSprite`.
    <img
      src={`/tex/${name}.png`}
      alt=""
      aria-hidden="true"
      width={w * scale}
      height={h * scale}
      draggable={false}
      className={cn('tex-pixel pointer-events-none absolute select-none', className)}
      style={style}
    />
  )
}

function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false)
  useEffect(() => {
    const query = window.matchMedia('(prefers-reduced-motion: reduce)')
    const update = () => setReduced(query.matches)
    update()
    query.addEventListener('change', update)
    return () => query.removeEventListener('change', update)
  }, [])
  return reduced
}

/**
 * Qué cara pone Tex: habla mientras llega texto, parpadea cada tanto y, si no se le habla por un buen
 * rato, se duerme. Respeta «reducir movimiento»: ahí se queda con la cara quieta.
 */
export function useTexFace({
  talking,
  mood,
}: {
  talking: boolean
  mood: 'listening' | 'thinking' | 'reading' | 'working' | 'happy' | 'sad'
}): TexFaceName {
  const reduced = useReducedMotion()
  const [frame, setFrame] = useState<TexFaceName>('smile')

  useEffect(() => {
    if (reduced) return
    if (talking) {
      const sequence: TexFaceName[] = ['talkA', 'talkB', 'smile', 'talkA', 'o', 'talkB']
      let index = 0
      const timer = setInterval(() => {
        index = (index + 1) % sequence.length
        setFrame(sequence[index] as TexFaceName)
      }, 130)
      return () => clearInterval(timer)
    }
    setFrame('smile')
    let closing: ReturnType<typeof setTimeout>
    let next: ReturnType<typeof setTimeout>
    const blink = () => {
      next = setTimeout(
        () => {
          setFrame('blink')
          closing = setTimeout(() => {
            setFrame('smile')
            blink()
          }, 130)
        },
        2500 + Math.random() * 3500,
      )
    }
    blink()
    return () => {
      clearTimeout(next)
      clearTimeout(closing)
    }
  }, [talking, reduced])

  if (mood === 'happy') return 'happy'
  if (mood === 'sad') return 'sad'
  if (talking) return reduced ? 'smile' : frame
  if (mood === 'thinking' || mood === 'reading') return frame === 'blink' ? 'blink' : 'flat'
  return frame
}

/** Los ojos siguen al puntero: un pixel para cada lado alcanza para que se sienta vivo. */
export function useTexLook(): { ref: React.RefObject<HTMLElement | null>; look: TexLook } {
  const ref = useRef<HTMLElement | null>(null)
  const [look, setLook] = useState<TexLook>({ x: 0, y: 0 })
  useEffect(() => {
    let raf = 0
    const onMove = (event: PointerEvent) => {
      cancelAnimationFrame(raf)
      raf = requestAnimationFrame(() => {
        const box = ref.current?.getBoundingClientRect()
        if (!box) return
        const dx = event.clientX - (box.left + box.width / 2)
        const dy = event.clientY - (box.top + box.height / 2)
        const next: TexLook = {
          x: Math.abs(dx) < 60 ? 0 : dx < 0 ? -1 : 1,
          y: Math.abs(dy) < 60 ? 0 : dy < 0 ? -1 : 1,
        }
        setLook((prev) => (prev.x === next.x && prev.y === next.y ? prev : next))
      })
    }
    window.addEventListener('pointermove', onMove, { passive: true })
    return () => {
      window.removeEventListener('pointermove', onMove)
      cancelAnimationFrame(raf)
    }
  }, [])
  return { ref, look }
}
