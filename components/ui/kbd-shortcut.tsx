'use client'

import { Command, CornerDownLeft, Option } from 'lucide-react'
import type * as React from 'react'
import { useSyncExternalStore } from 'react'
import { cn } from '@/lib/utils'
import { Kbd } from './kbd'

export type KbdKey = 'mod' | 'shift' | 'alt' | 'enter' | 'up' | 'down' | 'esc' | (string & {})

export type KbdShortcutProps = Omit<React.ComponentProps<'kbd'>, 'children'> & {
  /** `mod` es ⌘ en Mac y «Ctrl» en el resto. Cualquier otro texto va tal cual («K», «/»). */
  keys: ReadonlyArray<KbdKey>
}

const subscribeNever = () => () => {}

function isApplePlatform(): boolean {
  if (typeof navigator === 'undefined') return false
  const uaData = (navigator as Navigator & { userAgentData?: { platform?: string } }).userAgentData
  return /mac|iphone|ipad|ipod/i.test(uaData?.platform || navigator.platform || '')
}

/**
 * ⌘ o Ctrl se decide después de hidratar: el server no sabe el sistema y dibuja
 * «Ctrl»; en una Mac, React vuelve a dibujar con ⌘ apenas monta. Sin error de
 * hidratación (`useSyncExternalStore` usa el valor del server para hidratar).
 */
function useIsApple(): boolean {
  return useSyncExternalStore(subscribeNever, isApplePlatform, () => false)
}

function KeyFace({ name, apple }: { name: KbdKey; apple: boolean }) {
  switch (name) {
    case 'mod':
      return apple ? (
        <>
          <Command aria-hidden="true" />
          <span className="sr-only">Comando</span>
        </>
      ) : (
        <>Ctrl</>
      )
    case 'shift':
      return <>Shift</>
    case 'alt':
      return apple ? (
        <>
          <Option aria-hidden="true" />
          <span className="sr-only">Opción</span>
        </>
      ) : (
        <>Alt</>
      )
    case 'enter':
      // Inter latin no tiene «↵»: ícono de 12 px.
      return (
        <>
          <CornerDownLeft aria-hidden="true" />
          <span className="sr-only">Enter</span>
        </>
      )
    case 'up':
      return (
        <>
          <span aria-hidden="true">↑</span>
          <span className="sr-only">flecha arriba</span>
        </>
      )
    case 'down':
      return (
        <>
          <span aria-hidden="true">↓</span>
          <span className="sr-only">flecha abajo</span>
        </>
      )
    case 'esc':
      return <>Esc</>
    default:
      return <>{name.length === 1 ? name.toUpperCase() : name}</>
  }
}

/**
 * Un atajo de teclado (§3.5): `<KbdShortcut keys={['mod', 'k']} />` → «⌘ K» en
 * Mac y «Ctrl K» en el resto. Cada tecla es un `<kbd>` adentro de otro `<kbd>`
 * (la forma de HTML para una combinación).
 */
export function KbdShortcut({ keys, className, ...props }: KbdShortcutProps) {
  const apple = useIsApple()
  return (
    <kbd
      data-slot="kbd-shortcut"
      className={cn('inline-flex items-center gap-0.5 font-sans', className)}
      {...props}
    >
      {keys.map((key, index) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: la combinación es fija y la misma tecla puede repetirse
        <Kbd key={`${index}-${key}`}>
          <KeyFace name={key} apple={apple} />
        </Kbd>
      ))}
    </kbd>
  )
}
