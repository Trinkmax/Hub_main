import { afterEach, describe, expect, it } from 'vitest'
import { classifyDroppedFile, importPathFor } from '@/components/administracion/drop/classify'
import {
  deliverComprobante,
  onDroppedComprobante,
  setDroppedFile,
  takeDroppedFile,
} from '@/components/administracion/drop/drop-store'

/**
 * Arrastrar un archivo a cualquier pantalla de Administración: reemplaza a «Importar» en el menú. Una
 * foto o un PDF abre la compra; lo demás se reconoce y abre su pantalla.
 */

const file = (name: string, type = '') => new File(['x'], name, { type })

describe('classifyDroppedFile', () => {
  it('una foto o un PDF es un comprobante', () => {
    expect(classifyDroppedFile(file('factura.jpg', 'image/jpeg'))).toBe('comprobante')
    expect(classifyDroppedFile(file('IMG_1234.HEIC'))).toBe('comprobante')
    expect(classifyDroppedFile(file('factura.pdf', 'application/pdf'))).toBe('comprobante')
    expect(classifyDroppedFile(file('factura.PDF'))).toBe('comprobante')
  })

  it('una planilla o un ZIP es para importar', () => {
    for (const name of [
      'mis-comprobantes.zip',
      'collection-20261029001539-137f.csv',
      'movimientos.xlsx',
      'extracto.txt',
      'reporte.html',
    ]) {
      expect(classifyDroppedFile(file(name)), name).toBe('importar')
    }
  })

  it('lo demás no se sabe', () => {
    expect(classifyDroppedFile(file('video.mp4', 'video/mp4'))).toBe('desconocido')
    expect(classifyDroppedFile(file('sin-extension'))).toBe('desconocido')
  })
})

describe('importPathFor', () => {
  it('cada origen a su pantalla', () => {
    expect(importPathFor('arca_recibidos')).toBe('/importar/arca')
    expect(importPathFor('arca_emitidos')).toBe('/importar/arca')
    expect(importPathFor('portal_iva_compras')).toBe('/importar/arca')
    expect(importPathFor('mp_release')).toBe('/importar/mercado-pago')
    expect(importPathFor('mp_settlement')).toBe('/importar/mercado-pago')
    expect(importPathFor('bank')).toBe('/importar/banco')
  })

  it('el reporte de Cobros va a Mercado Pago: esa pantalla explica qué bajar en su lugar', () => {
    expect(importPathFor('mp_collection')).toBe('/importar/mercado-pago')
  })

  it('sin saber de dónde viene, a la pregunta de /importar', () => {
    expect(importPathFor('unknown')).toBe('/importar')
    expect(importPathFor('')).toBe('/importar')
  })
})

describe('el archivo que espera su pantalla', () => {
  afterEach(() => {
    takeDroppedFile()
  })

  it('se toma una sola vez', () => {
    const dropped = file('a.jpg', 'image/jpeg')
    setDroppedFile(dropped)
    expect(takeDroppedFile()).toBe(dropped)
    expect(takeDroppedFile()).toBeNull()
  })

  it('sin nadie escuchando, la foto no se entrega y se navega a la compra', () => {
    expect(deliverComprobante(file('a.jpg', 'image/jpeg'))).toBe(false)
  })

  it('con una compra abierta, le llega ahí mismo; al salir, deja de escuchar', () => {
    const got: File[] = []
    const off = onDroppedComprobante((f) => got.push(f))
    const dropped = file('a.jpg', 'image/jpeg')
    expect(deliverComprobante(dropped)).toBe(true)
    expect(got).toEqual([dropped])
    off()
    expect(deliverComprobante(dropped)).toBe(false)
  })
})
