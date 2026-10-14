import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * Las palabras que Libros, Fin de mes y el Plan de cuentas NO pueden decir.
 *
 * - Un solo libro: lo que va sin factura queda registrado igual. Nada de «en
 *   negro», «en blanco» ni «fuera de los libros».
 * - Ventas menos compras no es ganancia: nada de «ganancia» ni «ganaste». (El
 *   impuesto se llama «Ganancias», en plural: ese sí.)
 * - Los quince archivos del mes son el «Paquete del mes», no una «carpeta».
 * - El vocabulario de la sección: «contar la caja» (no «ajustar saldo»), «Fin de
 *   mes» como nombre de la pantalla.
 *
 * Se mira el texto que llega a la pantalla (cadenas y JSX), no los comentarios.
 */

const ADM = 'app/(manager)/[tenantSlug]/administracion'
const AREA = [`${ADM}/libros`, `${ADM}/asientos`, `${ADM}/plan-de-cuentas`]

function files(dir: string): string[] {
  const full = join(process.cwd(), dir)
  return readdirSync(full).flatMap((name) => {
    const child = join(dir, name)
    if (statSync(join(process.cwd(), child)).isDirectory()) return files(child)
    return /\.tsx?$/.test(name) ? [child] : []
  })
}

/** El archivo sin comentarios (de bloque, de JSX y de línea), para mirar solo lo que se ve. */
function visibleText(path: string): string {
  return readFileSync(join(process.cwd(), path), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:'"`\\])\/\/[^\n]*/g, '$1')
}

const SOURCES = AREA.flatMap(files).map((path) => ({ path, text: visibleText(path) }))

function offenders(pattern: RegExp, allow: (hit: { path: string; line: string }) => boolean) {
  const found: string[] = []
  for (const { path, text } of SOURCES) {
    for (const line of text.split('\n')) {
      if (!pattern.test(line)) continue
      if (allow({ path, line })) continue
      found.push(`${path}: ${line.trim().slice(0, 120)}`)
    }
  }
  return found
}

const never = () => false

describe('las palabras de Libros, Fin de mes y Plan de cuentas', () => {
  it('se miran todos los archivos del área', () => {
    expect(SOURCES.length).toBeGreaterThan(60)
    expect(SOURCES.some((s) => s.path.endsWith('libros/cierres/page.tsx'))).toBe(true)
    expect(
      SOURCES.some((s) => s.path.endsWith('plan-de-cuentas/_components/category-list.tsx')),
    ).toBe(true)
  })

  it('un solo libro: nada queda «en negro», «en blanco» ni «fuera de los libros»', () => {
    expect(offenders(/en negro/i, never)).toEqual([])
    expect(offenders(/en blanco/i, never)).toEqual([])
    expect(offenders(/fuera de los libros/i, never)).toEqual([])
    expect(offenders(/afuera de los libros/i, never)).toEqual([])
  })

  it('nunca «ganancia» ni «ganaste» (el impuesto «Ganancias» sí)', () => {
    expect(offenders(/ganaste/i, never)).toEqual([])
    // En singular es «lo que te quedó», que la pantalla no afirma. El plural es el impuesto.
    const singular = offenders(/ganancia(?!s)/i, ({ path, line }) => {
      // Conocido y fuera del alcance de este rediseño: el «para qué se usa» de la cuenta de
      // resultado del ejercicio, que lee la contadora en «Cuentas del sistema».
      return (
        path.endsWith('plan-de-cuentas/_lib/system-uses.ts') &&
        line.includes('la refundición la ganancia o la pérdida')
      )
    })
    expect(singular).toEqual([])
  })

  it('los quince archivos son el «Paquete del mes», nunca una «carpeta»', () => {
    expect(offenders(/carpeta/i, never)).toEqual([])
  })

  it('«contar la caja», no «ajustar saldo»', () => {
    expect(offenders(/ajustar saldo/i, never)).toEqual([])
    expect(offenders(/sin ajustar/i, never)).toEqual([])
  })

  it('la pantalla se llama «Fin de mes» y los libros de IVA piden «la CUIT del bar»', () => {
    const page = SOURCES.find((s) => s.path.endsWith('libros/cierres/page.tsx'))?.text ?? ''
    expect(page).toContain("metadata = { title: 'Fin de mes' }")
    expect(page).toContain('title="Fin de mes"')
    expect(offenders(/CUIT de la SAS/i, never)).toEqual([])
    expect(offenders(/el CUIT/i, never)).toEqual([])
  })

  it('«sin factura» siempre dice que queda registrado', () => {
    const iva = SOURCES.find((s) => s.path.endsWith('libros/posicion-iva/page.tsx'))?.text ?? ''
    expect(iva).toContain('Lo que va sin factura queda registrado igual en los libros')
    const book = SOURCES.find((s) => s.path.endsWith('libros/_components/iva-book.tsx'))?.text ?? ''
    expect(book).toContain('Lo que')
    expect(book).toContain('compraste sin factura queda registrado igual')
    const send =
      SOURCES.find((s) => s.path.endsWith('libros/cierres/_components/send-step.tsx'))?.text ?? ''
    expect(send).toContain('Los libros llevan todo, con factura y sin factura.')
  })

  it('los dos «vendido» del mes dicen de dónde sale cada uno', () => {
    // El papel de Fin de mes suma los cierres del día; «El IVA del mes» suma además las facturas
    // cargadas aparte. Son dos números distintos a un clic de distancia: cada uno lo aclara.
    const cover =
      SOURCES.find((s) => s.path.endsWith('libros/cierres/_components/month-cover.tsx'))?.text ?? ''
    expect(cover).toContain('label="Vendido en los cierres del día"')
    expect(cover).toContain('hint="sin las facturas cargadas aparte"')
    const iva = SOURCES.find((s) => s.path.endsWith('libros/posicion-iva/page.tsx'))?.text ?? ''
    expect(iva).toContain('contando las facturas cargadas aparte')
  })

  it('«Ver cómo queda en los libros» es el único nombre del plegable del asiento', () => {
    // «Ver asiento» es el nombre de fábrica de la pieza: en las pantallas del área va siempre el
    // de la sección, también en el asiento manual (antes, uno en Sueldos y otro en la grilla).
    for (const file of ['manual-entry-form.tsx', 'payroll-steps.tsx']) {
      const text =
        SOURCES.find((s) => s.path.endsWith(`libros/asiento-manual/_components/${file}`))?.text ??
        ''
      expect(text, file).toContain('label="Ver cómo queda en los libros"')
    }
    expect(offenders(/para ver el asiento\./i, never)).toEqual([])
  })

  it('fuera de un ticket no hay letra de máquina en pastillas ni contadores', () => {
    const exportButton =
      SOURCES.find((s) => s.path.endsWith('libros/_components/export-button.tsx'))?.text ?? ''
    expect(exportButton).not.toContain('font-mono')
    const index =
      SOURCES.find((s) => s.path.endsWith('libros/_components/book-index.tsx'))?.text ?? ''
    expect(index).not.toContain('font-mono')
    const list =
      SOURCES.find((s) => s.path.endsWith('plan-de-cuentas/_components/category-list.tsx'))?.text ??
      ''
    expect(list).not.toContain('font-mono')
  })
})
