#!/usr/bin/env node
/**
 * Congela el salón y lo público en el kit viejo (kit HUB §7.a, paso 3).
 *
 * El kit nuevo reescribe `components/ui/**` para el panel del dueño. El salón
 * (`app/(salon)/**`) y lo público (`/carta`, `/c`, `/m`, …) NO se rediseñan
 * ahora: tienen que verse exactamente igual. Por eso importan de la copia
 * congelada `components/ui-legacy/**` y de las vistas de dominio bifurcadas en
 * `components/legacy/**`. Este script reapunta sus imports.
 *
 * Uso (Node puro, sin dependencias):
 *   node scripts/codemods/freeze-legacy-ui.mjs           # reescribe y reporta
 *   node scripts/codemods/freeze-legacy-ui.mjs --check   # no escribe; sale con 1 si queda algo
 *   node scripts/codemods/freeze-legacy-ui.mjs --root <dir>   # otro checkout (default: el repo)
 *
 * Qué toca, SOLO adentro de las superficies congeladas (SCOPE):
 *  1. `@/components/ui/<x>` → `@/components/ui-legacy/<x>`.
 *  2. Lo que resuelve (por alias o por path relativo) a una vista bifurcada →
 *     su copia en `components/legacy/**`. Los relativos que entran a
 *     `app/(manager)/**` (salon-view importaba live-floor con
 *     `../../../../../(manager)/…`) solo se ven resolviendo la ruta: por eso el
 *     mapa va por ruta resuelta y no por texto.
 *  3. Si algo congelado importa de `app/(manager)/**` y no hay copia, lo
 *     reporta como pendiente: hay que bifurcarlo a mano (y sumarlo a
 *     LEGACY_COPIES y a components/legacy/README.md).
 *
 * Solo reemplaza especificadores de módulo en `import … from`, `export … from`,
 * `import()`, `vi.mock()` e `import '…'`. Es idempotente: una segunda corrida no
 * encuentra nada.
 *
 * Lee los archivos como Buffer y los decodifica en latin1: los reemplazos son
 * ASCII y el resto queda byte a byte. Hubo un NUL literal en el repo que hacía
 * que grep y rg salteen el archivo en silencio; acá no se saltea nada.
 */

import {
  existsSync,
  readdirSync,
  readFileSync,
  realpathSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { join, posix, relative, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

/** Primer segmento de las rutas públicas (mismo set que `PUBLIC_WORKSPACE_SEGMENTS`). */
export const PUBLIC_SEGMENTS = ['carta', 'c', 'm', 'r', 'v', 'l', 'p', 'print', 'capture']

/** Carpetas congeladas, relativas a la raíz del repo. */
export const SCOPE = [
  'app/(salon)',
  ...PUBLIC_SEGMENTS.map((segment) => `app/${segment}`),
  'components/shell/salon',
  'components/public-links',
  'components/legacy',
  'components/ui-legacy',
]

/**
 * Vista de dominio original (ruta sin extensión) → su copia congelada. Van las
 * rutas de antes y de después de las mudanzas de la ola 0 (0.7), así el script
 * sirve en cualquier orden y sigue siendo una guarda después.
 */
export const LEGACY_COPIES = {
  'components/reservations/cake-chip': 'components/legacy/reservations/cake-chip',
  'components/reservations/guest-count-stepper':
    'components/legacy/reservations/guest-count-stepper',
  'components/reservations/service-alert-chips':
    'components/legacy/reservations/service-alert-chips',
  'components/reservations/segment-meter': 'components/legacy/reservations/segment-meter',
  'components/loyalty/award-form': 'components/legacy/loyalty/award-form',
  'components/loyalty/customer-header': 'components/legacy/loyalty/customer-header',
  'components/loyalty/punch-stamper': 'components/legacy/loyalty/punch-stamper',
  'components/loyalty/redemption-panel': 'components/legacy/loyalty/redemption-panel',
  'app/(manager)/[tenantSlug]/acreditar/_components/punch-stamper':
    'components/legacy/loyalty/punch-stamper',
  'app/(manager)/[tenantSlug]/acreditar/_components/redemption-panel':
    'components/legacy/loyalty/redemption-panel',
  'components/floor-plan/move-table-sheet': 'components/legacy/floor-plan/move-table-sheet',
  'components/floor-plan/table-glyph': 'components/legacy/floor-plan/table-glyph',
  'components/floor-plan/live-floor': 'components/legacy/floor-plan/live-floor',
  'components/floor-plan/live-table-card': 'components/legacy/floor-plan/live-table-card',
  'components/floor-plan/pan-zoom-stage': 'components/legacy/floor-plan/pan-zoom-stage',
  'app/(manager)/[tenantSlug]/local/mesas/_components/live-floor':
    'components/legacy/floor-plan/live-floor',
  'app/(manager)/[tenantSlug]/local/mesas/_components/live-table-card':
    'components/legacy/floor-plan/live-table-card',
  'app/(manager)/[tenantSlug]/local/mesas/_components/pan-zoom-stage':
    'components/legacy/floor-plan/pan-zoom-stage',
}

const SOURCE_EXT_RE = /\.(?:tsx?|jsx?|mjs|cjs)$/
const SKIP_DIRS = new Set(['node_modules', '.next', '.git'])

// El patrón del kit (§7.a): `(from\s+|import\(\s*|vi\.mock\(\s*)(['"])@/components/ui/(x)\2`,
// generalizado a cualquier especificador para poder resolver también los relativos.
const SPECIFIER_RE =
  /(\bfrom\s+|\bimport\s*\(\s*|\bvi\.mock\(\s*|^[ \t]*import\s+)(['"])([^'"\r\n]+)\2/gm
const KIT_ALIAS_RE = /^@\/components\/ui\/([a-z0-9-]+)$/

/** Ruta del módulo, relativa a la raíz y sin extensión ni `/index`; null si es un paquete. */
export function resolveModulePath(fileRel, specifier) {
  let target
  if (specifier.startsWith('@/')) target = specifier.slice(2)
  else if (specifier.startsWith('./') || specifier.startsWith('../')) {
    target = posix.join(posix.dirname(fileRel), specifier)
  } else return null
  return posix
    .normalize(target)
    .replace(SOURCE_EXT_RE, '')
    .replace(/\/index$/, '')
}

/** Especificador nuevo, `null` si queda como está, o `{ pending }` si no tiene arreglo. */
export function freezeSpecifier(fileRel, specifier) {
  const kit = KIT_ALIAS_RE.exec(specifier)
  if (kit) return `@/components/ui-legacy/${kit[1]}`

  const target = resolveModulePath(fileRel, specifier)
  if (target === null) return null
  const copy = LEGACY_COPIES[target]
  if (copy) return `@/${copy}`
  if (target.startsWith('components/ui/')) {
    return `@/components/ui-legacy/${target.slice('components/ui/'.length)}`
  }
  if (target.startsWith('app/(manager)/')) {
    return { pending: `importa ${target} del panel y no tiene copia congelada` }
  }
  return null
}

function lineAt(source, offset) {
  let line = 1
  for (let i = 0; i < offset; i++) if (source.charCodeAt(i) === 10) line++
  return line
}

/** Reescribe un archivo congelado. `fileRel` usa `/` y es relativo a la raíz. */
export function transformSource(source, fileRel) {
  const changes = []
  const pending = []
  const output = source.replace(SPECIFIER_RE, (whole, lead, quote, specifier, offset) => {
    const next = freezeSpecifier(fileRel, specifier)
    if (next === null) return whole
    if (typeof next === 'object') {
      pending.push({ line: lineAt(source, offset), specifier, reason: next.pending })
      return whole
    }
    if (next === specifier) return whole
    changes.push({ line: lineAt(source, offset), from: specifier, to: next })
    return `${lead}${quote}${next}${quote}`
  })
  return { output, changes, pending }
}

function listSourceFiles(dir, out = []) {
  for (const name of readdirSync(dir)) {
    if (SKIP_DIRS.has(name)) continue
    const path = join(dir, name)
    if (statSync(path).isDirectory()) listSourceFiles(path, out)
    else if (SOURCE_EXT_RE.test(name)) out.push(path)
  }
  return out
}

function main(argv) {
  const check = argv.includes('--check')
  const rootFlag = argv.indexOf('--root')
  const root =
    rootFlag !== -1 && argv[rootFlag + 1]
      ? argv[rootFlag + 1]
      : fileURLToPath(new URL('../..', import.meta.url))

  let filesChanged = 0
  let specifiersChanged = 0
  let pendingCount = 0
  let scanned = 0

  for (const scopeDir of SCOPE) {
    const absDir = join(root, scopeDir)
    if (!existsSync(absDir)) continue
    for (const absFile of listSourceFiles(absDir)) {
      scanned++
      const fileRel = relative(root, absFile).split(sep).join('/')
      const source = readFileSync(absFile).toString('latin1')
      const { output, changes, pending } = transformSource(source, fileRel)
      if (changes.length === 0 && pending.length === 0) continue

      console.log(fileRel)
      for (const c of changes) console.log(`  L${c.line}  ${c.from}  →  ${c.to}`)
      for (const p of pending) console.log(`  L${p.line}  PENDIENTE ${p.specifier}: ${p.reason}`)

      pendingCount += pending.length
      if (changes.length > 0) {
        filesChanged++
        specifiersChanged += changes.length
        if (!check) writeFileSync(absFile, Buffer.from(output, 'latin1'))
      }
    }
  }

  const verb = check ? 'por reapuntar' : 'reapuntados'
  console.log(
    `\n${scanned} archivos congelados revisados · ${filesChanged} archivos y ${specifiersChanged} imports ${verb} · ${pendingCount} pendientes sin copia`,
  )
  if (pendingCount > 0) {
    console.log(
      'Hay imports del panel sin copia congelada: bifurcalos a components/legacy/ a mano.',
    )
  }
  if (check && (specifiersChanged > 0 || pendingCount > 0)) return 1
  if (pendingCount > 0) return 2
  return 0
}

// Corre solo si se lo invoca directo (no cuando lo importa el test de límites).
// Por ruta real: invocado por un symlink, `argv[1]` y `import.meta.url` difieren.
function invokedDirectly() {
  if (!process.argv[1]) return false
  try {
    return realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))
  } catch {
    return false
  }
}

if (invokedDirectly()) {
  process.exitCode = main(process.argv.slice(2))
}
