// @vitest-environment node
import { describe, expect, it } from 'vitest'
import {
  applyPriceChangesSchema,
  MAX_CHANGES,
  PRICE_MAX_CENTS,
  priceHistorySchema,
  setAvailabilitySchema,
} from '@/lib/menu/prices/schemas'

/**
 * El borde de «Precios»: lo que el servidor acepta del navegador. Centavos enteros entre 0 y
 * 1e12, y nada que deje el precio de la carta vacío.
 */

const ITEM = '0d595ac3-7969-4a87-bff1-fea929cd9db1'
const OTHER = '787400f2-ee1b-46d9-a61a-ddf253020924'
const BRANCH = '6380c468-cf88-495c-a0f3-85e42279a355'

const change = (over: Record<string, unknown> = {}) => ({
  itemId: ITEM,
  branchId: null,
  priceCents: 1_390_000,
  expectedCents: 1_250_000,
  ...over,
})

const parse = (changes: unknown[], extra: Record<string, unknown> = {}) =>
  applyPriceChangesSchema.safeParse({ changes, reason: 'edit', ...extra })

describe('applyPriceChangesSchema', () => {
  it('acepta un cambio del precio de la carta', () => {
    expect(parse([change()]).success).toBe(true)
  })

  it('acepta los bordes: $ 0 y el tope de la base', () => {
    expect(parse([change({ priceCents: 0 })]).success).toBe(true)
    expect(parse([change({ priceCents: PRICE_MAX_CENTS })]).success).toBe(true)
    expect(parse([change({ priceCents: PRICE_MAX_CENTS + 1 })]).success).toBe(false)
    expect(parse([change({ priceCents: -1 })]).success).toBe(false)
  })

  it('rechaza lo que no son centavos enteros', () => {
    expect(parse([change({ priceCents: 1_390_000.5 })]).success).toBe(false)
    expect(parse([change({ priceCents: '1390000' })]).success).toBe(false)
    expect(parse([change({ priceCents: Number.NaN })]).success).toBe(false)
    expect(parse([change({ expectedCents: 12.5 })]).success).toBe(false)
  })

  it('el precio de la carta no puede quedar vacío, ni haberse visto vacío', () => {
    expect(parse([change({ priceCents: null })]).success).toBe(false)
    expect(parse([change({ expectedCents: null })]).success).toBe(false)
  })

  it('en una sucursal, vacío es «volver al precio de la carta» o «no tenía precio propio»', () => {
    expect(parse([change({ branchId: BRANCH, priceCents: null })]).success).toBe(true)
    expect(parse([change({ branchId: BRANCH, expectedCents: null })]).success).toBe(true)
  })

  it('rechaza ids que no son ids', () => {
    expect(parse([change({ itemId: 'bacon' })]).success).toBe(false)
    expect(parse([change({ branchId: 'cerro' })]).success).toBe(false)
  })

  it('rechaza el mismo precio dos veces en un pedido', () => {
    expect(parse([change(), change({ priceCents: 1_400_000 })]).success).toBe(false)
    // El de la carta y el propio de una sucursal son precios distintos.
    expect(parse([change(), change({ branchId: BRANCH })]).success).toBe(true)
    expect(parse([change(), change({ itemId: OTHER })]).success).toBe(true)
  })

  it('rechaza un pedido vacío, uno enorme y un motivo inventado', () => {
    expect(parse([]).success).toBe(false)
    const many = Array.from({ length: MAX_CHANGES + 1 }, () => change())
    expect(parse(many).success).toBe(false)
    expect(parse([change()], { reason: 'porque sí' }).success).toBe(false)
  })

  it('los datos de un aumento van acotados', () => {
    const bulk = { percentBp: 1_000, roundingCents: 10_000, scope: 'all', categoryCount: 0 }
    expect(parse([change()], { reason: 'bulk', bulk }).success).toBe(true)
    expect(
      parse([change()], { reason: 'bulk', bulk: { ...bulk, percentBp: 99_999 } }).success,
    ).toBe(false)
    expect(parse([change()], { reason: 'bulk', bulk: { ...bulk, scope: 'todo' } }).success).toBe(
      false,
    )
  })
})

describe('setAvailabilitySchema y priceHistorySchema', () => {
  it('«se vende acá» pide sucursal, productos y sí o no', () => {
    expect(
      setAvailabilitySchema.safeParse({ branchId: BRANCH, itemIds: [ITEM], available: false })
        .success,
    ).toBe(true)
    expect(
      setAvailabilitySchema.safeParse({ branchId: BRANCH, itemIds: [], available: false }).success,
    ).toBe(false)
    expect(
      setAvailabilitySchema.safeParse({ branchId: BRANCH, itemIds: [ITEM], available: 'no' })
        .success,
    ).toBe(false)
  })

  it('el historial se pide de un producto o de toda la carta', () => {
    expect(priceHistorySchema.safeParse({ itemId: ITEM }).success).toBe(true)
    expect(priceHistorySchema.safeParse({ itemId: null }).success).toBe(true)
    expect(priceHistorySchema.safeParse({ itemId: 'bacon' }).success).toBe(false)
  })
})
