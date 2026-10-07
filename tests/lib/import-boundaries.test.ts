import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join, posix, relative, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { PUBLIC_WORKSPACE_SEGMENTS } from '@/lib/workspace'
import { LEGACY_COPIES, SCOPE } from '@/scripts/codemods/freeze-legacy-ui.mjs'

/**
 * Límites de import del congelado (kit HUB §7.a.5).
 *
 * El panel estrena el kit nuevo (`components/ui`), pero el salón y lo público
 * tienen que verse igual que antes: importan la copia congelada
 * (`components/ui-legacy`) y las vistas de dominio bifurcadas
 * (`components/legacy`). Biome lo chequea por alias en `biome.json`, pero no ve
 * los paths relativos (`salon-view` importaba `live-floor` del panel con
 * `../../../../../(manager)/…`). Este test resuelve cada import, relativo o por
 * alias, y recorre el grafo: es la guarda que no depende de los globs de Biome.
 *
 * Lee los archivos como Buffer (latin1): un NUL literal hacía que grep y rg
 * salteen un archivo en silencio; acá no se saltea nada.
 */

const ROOT = fileURLToPath(new URL('../../', import.meta.url))
const SOURCE_RE = /\.(?:tsx?|jsx?|mjs|cjs)$/
const SKIP_DIRS = new Set(['node_modules', '.next', '.git'])
const SPECIFIER_RE =
  /(?:\bfrom\s+|\bimport\s*\(\s*|\bvi\.mock\(\s*|^[ \t]*import\s+|\brequire\(\s*)(['"])([^'"\r\n]+)\1/gm

const FROZEN_DIRS = [
  'app/(salon)/',
  ...[...PUBLIC_WORKSPACE_SEGMENTS].map((segment) => `app/${segment}/`),
  'components/shell/salon/',
  'components/public-links/',
  'components/legacy/',
  'components/ui-legacy/',
]

/**
 * Lo que el congelado comparte con el panel sin copiarlo: comportamiento o
 * lógica sin estilo propio (kit §7.a, «Decisión sobre los componentes de
 * dominio compartidos»). Sumar algo acá es decidir que su cambio en el panel
 * también se ve en el salón y lo público.
 */
const SHARED_WITH_FROZEN = new Set([
  'components/media/storage-image.tsx',
  'components/shell/brand-mark.tsx',
  'components/shell/claims-refresher.tsx',
  'components/shell/refresh-on-return.tsx',
  'components/shell/sign-out-action.ts',
  'components/theme/brand-accent-provider.tsx',
  'components/icons/curated-lucide.tsx',
])

const isFrozen = (file: string) => FROZEN_DIRS.some((dir) => file.startsWith(dir))
const isUnder = (file: string, dir: string) => file.startsWith(dir)
const isRootAppFile = (file: string) => /^app\/[^/]+$/.test(file)

function listSourceFiles(dir: string, out: string[] = []): string[] {
  if (!existsSync(dir)) return out
  for (const name of readdirSync(dir)) {
    if (SKIP_DIRS.has(name)) continue
    const path = join(dir, name)
    if (statSync(path).isDirectory()) listSourceFiles(path, out)
    else if (SOURCE_RE.test(name)) out.push(relative(ROOT, path).split(sep).join('/'))
  }
  return out
}

const FILES = ['app', 'components', 'lib'].flatMap((dir) => listSourceFiles(join(ROOT, dir)))
const FILE_SET = new Set(FILES)

/** Ruta del módulo relativa a la raíz (con extensión si existe); null si es un paquete. */
function resolveImport(fromFile: string, specifier: string): string | null {
  let target: string
  if (specifier.startsWith('@/')) target = specifier.slice(2)
  else if (specifier.startsWith('./') || specifier.startsWith('../')) {
    target = posix.join(posix.dirname(fromFile), specifier)
  } else return null
  target = posix.normalize(target)
  const candidates = [target, ...['.ts', '.tsx', '.js', '.jsx', '.mjs'].map((ext) => target + ext)]
  candidates.push(`${target}/index.ts`, `${target}/index.tsx`)
  // Si no existe (import roto o archivo fuera de app/components/lib) igual se
  // devuelve la ruta: los límites se chequean por prefijo.
  return candidates.find((candidate) => FILE_SET.has(candidate)) ?? target
}

type Edge = { from: string; specifier: string; to: string }

const importCache = new Map<string, Edge[]>()
function importsOf(file: string): Edge[] {
  const cached = importCache.get(file)
  if (cached) return cached
  const source = readFileSync(join(ROOT, file)).toString('latin1')
  const edges: Edge[] = []
  for (const match of source.matchAll(SPECIFIER_RE)) {
    const specifier = match[2]
    if (!specifier) continue
    const to = resolveImport(file, specifier)
    if (to !== null) edges.push({ from: file, specifier, to })
  }
  importCache.set(file, edges)
  return edges
}

const describeEdge = (edge: Edge) => `${edge.from} → ${edge.specifier}`

const FROZEN_FILES = FILES.filter(isFrozen)
/** Panel, auth, plataforma, onboarding, API, componentes y lib: todo lo que no es congelado. */
const PANEL_FILES = FILES.filter((file) => !isFrozen(file) && !isRootAppFile(file))

describe('el recorrido ve lo que tiene que ver', () => {
  it('encuentra las superficies congeladas', () => {
    expect(FROZEN_FILES.length).toBeGreaterThan(150)
    expect(FROZEN_FILES).toContain(
      'app/(salon)/[tenantSlug]/salon/mesas/_components/salon-view.tsx',
    )
    expect(FROZEN_FILES).toContain('components/ui-legacy/button.tsx')
  })

  it('resuelve los paths relativos que entran al panel', () => {
    expect(
      resolveImport(
        'app/(salon)/[tenantSlug]/salon/mesas/_components/salon-view.tsx',
        '../../../../../(manager)/[tenantSlug]/local/mesas/_components/live-floor',
      ),
    ).toBe('app/(manager)/[tenantSlug]/local/mesas/_components/live-floor')
    expect(resolveImport('components/ui-legacy/skeleton-list.tsx', './skeleton')).toBe(
      'components/ui-legacy/skeleton.tsx',
    )
    expect(resolveImport('lib/x.ts', 'react')).toBeNull()
  })

  it('el salón ve el plano en vivo por la copia congelada', () => {
    const targets = importsOf(
      'app/(salon)/[tenantSlug]/salon/mesas/_components/salon-view.tsx',
    ).map((edge) => edge.to)
    expect(targets).toContain('components/legacy/floor-plan/live-floor.tsx')
  })
})

describe('superficies congeladas (salón, lo público y sus copias)', () => {
  const frozenEdges = FROZEN_FILES.flatMap(importsOf)

  it('no importan el kit nuevo: van a @/components/ui-legacy', () => {
    const leaks = frozenEdges.filter((edge) => isUnder(edge.to, 'components/ui/'))
    expect(leaks.map(describeEdge)).toEqual([])
  })

  it('no importan del panel (app/(manager)), ni por alias ni por path relativo', () => {
    const leaks = frozenEdges.filter((edge) => isUnder(edge.to, 'app/(manager)/'))
    expect(leaks.map(describeEdge)).toEqual([])
  })

  it('solo importan componentes congelados o los compartidos', () => {
    const leaks = frozenEdges.filter(
      (edge) =>
        isUnder(edge.to, 'components/') && !isFrozen(edge.to) && !SHARED_WITH_FROZEN.has(edge.to),
    )
    expect(leaks.map(describeEdge)).toEqual([])
  })

  it('tampoco llegan por la puerta de atrás (lib o lo compartido)', () => {
    // Recorrido completo desde lo congelado: si un módulo compartido o de lib
    // importara el kit nuevo o algo del panel, el salón lo vería igual.
    const via = new Map<string, string>()
    const queue = [...FROZEN_FILES]
    for (const file of queue) via.set(file, file)
    const leaks: string[] = []
    while (queue.length > 0) {
      const file = queue.shift() as string
      for (const edge of importsOf(file)) {
        const target = edge.to
        if (via.has(target)) continue
        via.set(target, file)
        const forbidden =
          isUnder(target, 'components/ui/') ||
          isUnder(target, 'app/(manager)/') ||
          (isUnder(target, 'components/') && !isFrozen(target) && !SHARED_WITH_FROZEN.has(target))
        if (forbidden) {
          const chain = [target]
          let step = file
          while (via.get(step) !== step) {
            chain.unshift(step)
            step = via.get(step) as string
          }
          chain.unshift(step)
          leaks.push(chain.join(' → '))
          continue
        }
        if (FILE_SET.has(target)) queue.push(target)
      }
    }
    expect(leaks).toEqual([])
  })
})

describe('panel, componentes y lib', () => {
  it('no importan las copias congeladas (ui-legacy ni legacy)', () => {
    const leaks = PANEL_FILES.flatMap(importsOf).filter(
      (edge) => isUnder(edge.to, 'components/ui-legacy/') || isUnder(edge.to, 'components/legacy/'),
    )
    expect(leaks.map(describeEdge)).toEqual([])
  })

  it('el kit nuevo (components/ui) no importa ui-legacy', () => {
    const leaks = FILES.filter((file) => isUnder(file, 'components/ui/'))
      .flatMap(importsOf)
      .filter((edge) => isUnder(edge.to, 'components/ui-legacy/'))
    expect(leaks.map(describeEdge)).toEqual([])
  })

  it('components/legacy no importa components/ui', () => {
    const leaks = FILES.filter((file) => isUnder(file, 'components/legacy/'))
      .flatMap(importsOf)
      .filter((edge) => isUnder(edge.to, 'components/ui/'))
    expect(leaks.map(describeEdge)).toEqual([])
  })
})

describe('las guardas hablan de lo mismo', () => {
  const legacyFiles = FILES.filter((file) => isUnder(file, 'components/legacy/'))
  const copies = new Set(Object.values(LEGACY_COPIES))

  it('cada copia del codemod existe y cada archivo de components/legacy está en el codemod', () => {
    for (const copy of copies) expect(FILE_SET.has(`${copy}.tsx`), copy).toBe(true)
    for (const file of legacyFiles) {
      expect(copies.has(file.replace(SOURCE_RE, '')), `${file} falta en LEGACY_COPIES`).toBe(true)
    }
  })

  it('components/legacy/README.md lista cada copia', () => {
    const readme = readFileSync(join(ROOT, 'components/legacy/README.md')).toString('utf8')
    for (const file of legacyFiles) {
      expect(readme.includes(file.slice('components/legacy/'.length)), file).toBe(true)
    }
  })

  it('el codemod congela las mismas carpetas que este test', () => {
    expect([...SCOPE].map((dir) => `${dir}/`).sort()).toEqual([...FROZEN_DIRS].sort())
  })

  it('biome.json restringe las mismas carpetas', () => {
    type Override = { includes?: string[] }
    const biome = JSON.parse(readFileSync(join(ROOT, 'biome.json')).toString('utf8')) as {
      files?: { includes?: string[] }
      overrides?: Override[]
    }
    const overrides = biome.overrides ?? []
    const routes = FROZEN_DIRS.filter(
      (dir) => dir !== 'components/legacy/' && dir !== 'components/ui-legacy/',
    )
    const frozenOverride = overrides.find((o) => o.includes?.includes('app/(salon)/**'))
    const panelOverride = overrides.find((o) => o.includes?.includes('components/**'))
    for (const dir of routes) {
      expect(frozenOverride?.includes, dir).toContain(`${dir}**`)
      expect(panelOverride?.includes, dir).toContain(`!${dir}**`)
    }
    // Las copias literales no se lintan (y el panel tampoco las puede importar).
    expect(biome.files?.includes).toContain('!components/ui-legacy')
    expect(biome.files?.includes).toContain('!components/legacy')
  })
})
