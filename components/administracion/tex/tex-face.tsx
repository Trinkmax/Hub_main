import { type CSSProperties, memo } from 'react'

/**
 * La cara de Tex, dibujada pixel por pixel para que pueda hablar, parpadear y mirar. Es la misma de su
 * identidad visual (dos ojos con su brillo, rubor y boca), en una grilla de 25 × 12 que calza justo en
 * la cara en blanco de los sprites de `public/tex`.
 */

export const TEX_FACE_W = 25
export const TEX_FACE_H = 12

export const TEX_FACES = [
  'smile',
  'talkA',
  'talkB',
  'blink',
  'flat',
  'o',
  'happy',
  'sad',
  'sleep',
  'wink',
] as const
export type TexFaceName = (typeof TEX_FACES)[number]

const NAVY = '#06123a'
const PINK = '#ff8f94'
const TONGUE = '#ff5f6d'
const WHITE = '#ffffff'

type Sprite = readonly string[]

const INK: Readonly<Record<string, string>> = { '#': NAVY, p: TONGUE, w: WHITE, b: PINK }

const EYE_OPEN: Sprite = ['.##.', '##w#', '##w#', '####', '####', '.##.']
const EYE_BLINK: Sprite = ['....', '....', '....', '####', '....', '....']
const EYE_HAPPY: Sprite = ['....', '.##.', '#..#', '#..#', '....', '....']
const EYE_SLEEP: Sprite = ['....', '....', '#..#', '.##.', '....', '....']

const MOUTHS: Readonly<Record<string, Sprite>> = {
  smile: ['#......#', '.######.', '.##pp##.', '..####..'],
  talkA: ['.######.', '########', '##pppp##', '.######.'],
  talkB: ['...##...', '..####..', '..#pp#..', '...##...'],
  flat: ['........', '..####..', '........', '........'],
  grin: ['.######.', '#wwwwww#', '.######.', '........'],
  o: ['..####..', '.##..##.', '.#pppp#.', '..####..'],
  happy: ['########', '#pppppp#', '.#pppp#.', '..####..'],
  sad: ['........', '..####..', '.#....#.', '........'],
  sleep: ['........', '...##...', '........', '........'],
}

const FACES: Readonly<
  Record<TexFaceName, { left: Sprite; right: Sprite; mouth: Sprite; moves: boolean }>
> = {
  smile: { left: EYE_OPEN, right: EYE_OPEN, mouth: MOUTHS.smile as Sprite, moves: true },
  talkA: { left: EYE_OPEN, right: EYE_OPEN, mouth: MOUTHS.talkA as Sprite, moves: true },
  talkB: { left: EYE_OPEN, right: EYE_OPEN, mouth: MOUTHS.talkB as Sprite, moves: true },
  blink: { left: EYE_BLINK, right: EYE_BLINK, mouth: MOUTHS.grin as Sprite, moves: false },
  flat: { left: EYE_OPEN, right: EYE_OPEN, mouth: MOUTHS.flat as Sprite, moves: true },
  o: { left: EYE_OPEN, right: EYE_OPEN, mouth: MOUTHS.o as Sprite, moves: true },
  happy: { left: EYE_HAPPY, right: EYE_HAPPY, mouth: MOUTHS.happy as Sprite, moves: false },
  sad: { left: EYE_OPEN, right: EYE_OPEN, mouth: MOUTHS.sad as Sprite, moves: false },
  sleep: { left: EYE_SLEEP, right: EYE_SLEEP, mouth: MOUTHS.sleep as Sprite, moves: false },
  wink: { left: EYE_OPEN, right: EYE_BLINK, mouth: MOUTHS.smile as Sprite, moves: false },
}

const LEFT_EYE_X = 4
const RIGHT_EYE_X = 17
const EYE_Y = 1
const MOUTH_X = 9
const MOUTH_Y = 7

type Rect = { x: number; y: number; w: number; fill: string }

/** Un dibujo de texto a rectángulos: una fila, un rectángulo por tramo del mismo color. Puro. */
export function spriteRects(sprite: Sprite, originX: number, originY: number): Rect[] {
  const rects: Rect[] = []
  sprite.forEach((row, y) => {
    let x = 0
    while (x < row.length) {
      const fill = INK[row[x] as string]
      if (!fill) {
        x += 1
        continue
      }
      let end = x + 1
      while (end < row.length && INK[row[end] as string] === fill) end += 1
      rects.push({ x: originX + x, y: originY + y, w: end - x, fill })
      x = end
    }
  })
  return rects
}

export type TexLook = { x: -1 | 0 | 1; y: -1 | 0 | 1 }

export const TexFace = memo(function TexFace({
  name,
  look = { x: 0, y: 0 },
  blush = true,
  className,
  style,
}: {
  name: TexFaceName
  /** A dónde mira: un pixel para cada lado. */
  look?: TexLook
  blush?: boolean
  className?: string
  style?: CSSProperties
}) {
  const face = FACES[name]
  const dx = face.moves ? look.x : 0
  const dy = face.moves ? look.y : 0
  const rects = [
    ...spriteRects(face.left, LEFT_EYE_X + dx, EYE_Y + dy),
    ...spriteRects(face.right, RIGHT_EYE_X + dx, EYE_Y + dy),
    ...spriteRects(face.mouth, MOUTH_X, MOUTH_Y),
  ]
  return (
    <svg
      viewBox={`0 0 ${TEX_FACE_W} ${TEX_FACE_H}`}
      shapeRendering="crispEdges"
      aria-hidden="true"
      className={className}
      style={style}
    >
      {blush ? (
        <>
          <rect x={0} y={7} width={3} height={2} fill={PINK} />
          <rect x={22} y={7} width={3} height={2} fill={PINK} />
        </>
      ) : null}
      {rects.map((r) => (
        <rect
          key={`${r.x}-${r.y}-${r.fill}`}
          x={r.x}
          y={r.y}
          width={r.w}
          height={1}
          fill={r.fill}
        />
      ))}
    </svg>
  )
})
