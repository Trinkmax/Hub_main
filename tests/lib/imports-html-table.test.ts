import { describe, expect, it } from 'vitest'
import { decodeHtmlEntities, looksLikeHtmlTable, readHtmlTable } from '@/lib/imports/html-table'
import { IMPORT_FIXTURES, importFixture } from '@/tests/fixtures/imports/fixtures'
import { OWN_CBU } from '@/tests/fixtures/imports/synth'

describe('readHtmlTable', () => {
  it('el «.xls» que es HTML: dos tablas, colspan, entidades y celdas vacías', () => {
    const html = new TextDecoder().decode(importFixture(IMPORT_FIXTURES.bankHtml))
    expect(looksLikeHtmlTable(html)).toBe(true)
    const rows = readHtmlTable(html)
    expect(rows[0]).toEqual(['Banco de la Nación Argentina', ''])
    expect(rows[1]).toEqual(['CBU', OWN_CBU])
    expect(rows[2]).toEqual(['Fecha', 'Concepto', 'Débitos', 'Créditos', 'Saldo'])
    expect(rows[3]).toEqual([
      '06/10/2026',
      'COMISION PAQUETES',
      '69.000,00',
      '',
      expect.any(String),
    ])
  })

  it('HTML tolerante: sin cerrar td/tr, comentarios, script/style y tablas anidadas', () => {
    const html = `<html><head><title>x</title><script>var a = "<td>no</td>"</script></head><body>
      <!-- <tr><td>comentario</td></tr> -->
      <table>
        <tr><th>Fecha<th>Detalle
        <tr><td>01/10/2026<td>TRANSF<br>RECIBIDA &amp; c&iacute;a&#46;
        <tr><td>02/10/2026</td><td>afuera <table><tr><td>adentro</td></tr></table> fin</td></tr>
      </table></body></html>`
    expect(readHtmlTable(html)).toEqual([
      ['Fecha', 'Detalle'],
      ['01/10/2026', 'TRANSF RECIBIDA & cía.'],
      ['adentro'],
      ['02/10/2026', 'afuera fin'],
    ])
  })

  it('una página sin tablas', () => {
    expect(readHtmlTable('<html><body><p>hola</p></body></html>')).toEqual([])
    expect(looksLikeHtmlTable('Fecha;Importe')).toBe(false)
  })
})

describe('decodeHtmlEntities', () => {
  it('nombradas, numéricas y desconocidas', () => {
    expect(decodeHtmlEntities('D&eacute;bito &ntilde; &#241; &#xF1; &nbsp;&euro;')).toBe(
      'Débito ñ ñ ñ  €',
    )
    expect(decodeHtmlEntities('AT&T &foo; &#0;')).toBe('AT&T &foo; &#0;')
  })
})
