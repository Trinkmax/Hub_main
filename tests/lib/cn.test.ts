import { describe, expect, it } from 'vitest'
import { cn } from '@/lib/utils'

/**
 * `cn()` conoce las utilidades de tipo del kit (§2.11): sin esto, pisar el
 * tamaño de un componente con `className` andaba o no según el orden
 * alfabético del CSS (`type-caption` le ganaba a `text-sm`, `text-3xl` a
 * `type-title`).
 */
describe('cn', () => {
  it('entre un type-* y un text-{tamaño} gana el último', () => {
    expect(cn('type-body', 'text-lg')).toBe('text-lg')
    expect(cn('text-lg', 'type-body')).toBe('type-body')
    expect(cn('type-title', 'text-3xl')).toBe('text-3xl')
    expect(cn('text-sm', 'type-caption')).toBe('type-caption')
    expect(cn('type-body', 'text-[13px]')).toBe('text-[13px]')
    expect(cn('type-body', 'text-(length:--control-font)')).toBe('text-(length:--control-font)')
  })

  it('un leading-* después de un type-* lo reemplaza, y al revés', () => {
    expect(cn('type-caption', 'leading-none')).toBe('leading-none')
    expect(cn('leading-none', 'type-caption')).toBe('type-caption')
    expect(cn('text-xs leading-none', 'type-small')).toBe('type-small')
  })

  it('dos type-*: queda el último', () => {
    expect(cn('type-body', 'type-caption')).toBe('type-caption')
    expect(cn('type-section md:type-title', 'md:text-4xl')).toBe('type-section md:text-4xl')
  })

  it('el peso, el tracking y el color conviven con el type-*', () => {
    expect(cn('type-label', 'font-semibold')).toBe('type-label font-semibold')
    expect(cn('type-group', 'tracking-wide')).toBe('type-group tracking-wide')
    expect(cn('type-body', 'text-muted-foreground')).toBe('type-body text-muted-foreground')
    expect(cn('type-caption', 'text-subtle-foreground')).toBe('type-caption text-subtle-foreground')
  })

  it('type-amount no es un tamaño: convive con cualquiera', () => {
    expect(cn('type-body', 'type-amount')).toBe('type-body type-amount')
    expect(cn('type-amount', 'text-sm')).toBe('type-amount text-sm')
  })

  it('las sombras de lo que flota son sombras, no colores de sombra', () => {
    expect(cn('shadow-sm', 'shadow-float')).toBe('shadow-float')
    expect(cn('shadow-float', 'shadow-modal')).toBe('shadow-modal')
    expect(cn('shadow-float', 'shadow-none')).toBe('shadow-none')
    expect(cn('shadow-float', 'shadow-black/10')).toBe('shadow-float shadow-black/10')
  })

  it('sigue resolviendo lo de siempre', () => {
    expect(cn('px-2', 'px-4')).toBe('px-4')
    expect(cn('h-(--control-md)', 'h-11')).toBe('h-11')
    expect(cn('size-(--control-md)', 'size-7')).toBe('size-7')
    expect(cn('bg-selected', 'bg-hover')).toBe('bg-hover')
    expect(cn('shadow-sm', 'shadow-black/10')).toBe('shadow-sm shadow-black/10')
    expect(cn('a', false, undefined, null, ['b', { c: true, d: false }])).toBe('a b c')
  })
})
