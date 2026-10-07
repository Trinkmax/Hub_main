// @vitest-environment node
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { join, posix } from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'
import { describe, expect, it } from 'vitest'

/**
 * Usos deprecados del kit por carpeta del panel (kit HUB §3.0
 * «Compatibilidad» y riesgo 5): las props y los componentes viejos se aceptan
 * con `@deprecated` y se mapean adentro, pero esconden deuda. Este test cuenta
 * sus usos en cada carpeta de primer nivel de `app/(manager)/[tenantSlug]/` y
 * falla solo si una carpeta **sube** por encima de la línea de base
 * comprometida en `kit-deprecations.baseline.json`. Cada lote baja el número de
 * su carpeta (la definición de terminado pide cero) y los shims se borran
 * cuando la cuenta llega a cero.
 *
 * - **Qué cuenta:** cada referencia a un export deprecado (un elemento JSX, un
 *   tipo, un valor), cada prop deprecada y cada valor viejo de una prop vigente
 *   (`<Button variant="outline">`), también en ternarios y a un salto dentro
 *   del archivo (`variant={tone}` con `tone = 'outline'`, `variant={MAPA[k]}`).
 *   Solo lo que se importa del kit (y de los envoltorios registrados, como
 *   `ContactButton`): un `Button` local, el congelado (`ui-legacy`), un
 *   `Toggle variant="outline"` o un `DropdownMenuItem variant="destructive"`
 *   (su API vigente) no cuentan.
 * - **Qué no ve:** valores que llegan de más lejos (otro archivo, un spread).
 *   Esos aparecen cuando se borre el shim: `tsc` los marca.
 * - **Archivos sueltos** (`page.tsx`, `layout.tsx`…): carpeta `"."`. Una
 *   carpeta nueva (por ejemplo `administracion`) arranca en 0: nace con el kit.
 * - **Para bajar la línea de base:** el test imprime las cuentas en cada
 *   corrida (con un agente de IA, Vitest 4 usa el reporter `agent`, que esconde
 *   lo que imprime un test que pasa: sumá `--reporter=default`).
 *   `KIT_DEPRECATIONS_UPDATE=1 npx vitest run tests/lib/kit-deprecations.test.ts`
 *   reescribe el JSON solo hacia abajo (nunca sube un número ni agrega una
 *   carpeta con usos). `KIT_DEPRECATIONS_DETAIL=1` (o `=clientes,menu`)
 *   imprime qué y en qué archivo, por carpeta.
 * - **Lo que se cuenta** está en los registros de abajo; el último test exige
 *   que cada `@deprecated` de `components/ui` esté registrado.
 */

const ROOT = fileURLToPath(new URL('../../', import.meta.url))
const PANEL_DIR = 'app/(manager)/[tenantSlug]'
/** La carpeta de los archivos sueltos de `PANEL_DIR` (page, layout, loading, error, not-found). */
const ROOT_BUCKET = '.'
const BASELINE_FILE = 'tests/lib/kit-deprecations.baseline.json'
const UPDATE_ENV = 'KIT_DEPRECATIONS_UPDATE'
/** `1` imprime el detalle de todas las carpetas; `clientes,menu`, solo de esas. */
const DETAIL_ENV = 'KIT_DEPRECATIONS_DETAIL'

// ─── Registros: lo deprecado del kit ─────────────────────────────────────────

/**
 * Exports deprecados, por módulo: cuenta cada referencia. `'*'`: todo lo que
 * exporta el módulo (la ruta entera es la vieja, como `skeleton-list`).
 */
const DEPRECATED_EXPORTS: Readonly<Record<string, readonly string[] | '*'>> = {
  'components/ui/stat-card': ['StatCard'],
  'components/ui/sliding-tabs': ['SlidingTabs', 'SlidingTab'],
  'components/ui/stepper': ['Stepper', 'StepperStep', 'StepperProps'],
  'components/ui/filter-bar': ['FilterBar', 'FilterSearch'],
  'components/ui/table': [
    'Table',
    'TableBody',
    'TableCaption',
    'TableCell',
    'TableFooter',
    'TableHead',
    'TableHeader',
    'TableRow',
  ],
  'components/ui/number-ticker': ['NumberTicker'],
  'components/ui/skeleton': ['CardGridSkeleton'],
  'components/ui/skeleton-list': '*',
  'components/ui/page-header': ['Breadcrumb'],
  'components/ui/badge': ['BadgeVariant'],
  'components/ui/button': ['LegacyButtonVariant', 'LegacyButtonSize'],
  'components/ui/select': ['LegacySelectSize'],
  'components/ui/switch': ['LegacySwitchSize'],
}

/**
 * Los valores viejos de una prop vigente salen del tipo `@deprecated` del kit:
 * si el kit suma un alias, el contador lo ve sin tocar este archivo.
 */
const LEGACY_VALUE_TYPES = {
  buttonVariant: { file: 'components/ui/button.tsx', type: 'LegacyButtonVariant' },
  buttonSize: { file: 'components/ui/button.tsx', type: 'LegacyButtonSize' },
  selectSize: { file: 'components/ui/select.tsx', type: 'LegacySelectSize' },
  switchSize: { file: 'components/ui/switch.tsx', type: 'LegacySwitchSize' },
} as const satisfies Record<string, { file: string; type: string }>

type LegacyValueKey = keyof typeof LEGACY_VALUE_TYPES
type LegacyValues = Readonly<Record<LegacyValueKey, readonly string[]>>

type PropRule = {
  module: string
  /** Un componente (atributo JSX) o una función (propiedad del objeto del primer argumento). */
  target: string
  prop: string
  /** Sin `values` la prop entera está deprecada; con `values`, solo esos valores. */
  values?: LegacyValueKey
}

const PROP_RULES: readonly PropRule[] = [
  { module: 'components/ui/page-header', target: 'PageHeader', prop: 'eyebrow' },
  { module: 'components/ui/badge', target: 'Badge', prop: 'variant' },
  { module: 'components/ui/badge', target: 'badgeVariants', prop: 'variant' },
  { module: 'components/ui/sheet', target: 'SheetContent', prop: 'showClose' },
  { module: 'components/ui/data-table', target: 'DataTableRow', prop: 'onClick' },
  { module: 'components/ui/button', target: 'Button', prop: 'variant', values: 'buttonVariant' },
  { module: 'components/ui/button', target: 'Button', prop: 'size', values: 'buttonSize' },
  {
    module: 'components/ui/button',
    target: 'buttonVariants',
    prop: 'variant',
    values: 'buttonVariant',
  },
  { module: 'components/ui/button', target: 'buttonVariants', prop: 'size', values: 'buttonSize' },
  {
    module: 'components/ui/submit-button',
    target: 'SubmitButton',
    prop: 'variant',
    values: 'buttonVariant',
  },
  {
    module: 'components/ui/submit-button',
    target: 'SubmitButton',
    prop: 'size',
    values: 'buttonSize',
  },
  {
    module: 'components/ui/copy-button',
    target: 'CopyButton',
    prop: 'variant',
    values: 'buttonVariant',
  },
  { module: 'components/ui/copy-button', target: 'CopyButton', prop: 'size', values: 'buttonSize' },
  {
    module: 'components/ui/alert-dialog',
    target: 'AlertDialogAction',
    prop: 'variant',
    values: 'buttonVariant',
  },
  {
    module: 'components/ui/data-table',
    target: 'ExportButton',
    prop: 'size',
    values: 'buttonSize',
  },
  { module: 'components/ui/select', target: 'SelectTrigger', prop: 'size', values: 'selectSize' },
  { module: 'components/ui/switch', target: 'Switch', prop: 'size', values: 'switchSize' },
  // Envoltorio de dominio que tipa sus props con `VariantProps<typeof
  // buttonVariants>` (§3.9): un valor viejo que se le pasa llega igual a Button.
  {
    module: 'components/messaging/contact-button',
    target: 'ContactButton',
    prop: 'variant',
    values: 'buttonVariant',
  },
  {
    module: 'components/messaging/contact-button',
    target: 'ContactButton',
    prop: 'size',
    values: 'buttonSize',
  },
]

/** Lo que se sigue de los imports: el kit entero y los envoltorios de las reglas. */
const TRACKED_MODULES = new Set(PROP_RULES.map((rule) => rule.module))
const isTracked = (module: string) =>
  module.startsWith('components/ui/') || TRACKED_MODULES.has(module)

/** Props `@deprecated` de componentes que ya cuentan enteros (cada uso del componente es la deuda). */
const COVERED_BY_COMPONENT = new Set([
  'components/ui/stat-card#StatCardProps.iconClassName',
  'components/ui/number-ticker#NumberTickerProps.durationMs',
  'components/ui/number-ticker#NumberTickerProps.startOnView',
  'components/ui/number-ticker#NumberTickerProps.delayMs',
])

// ─── El contador ─────────────────────────────────────────────────────────────

type Hit = { file: string; line: number; label: string }
type Ref = { module: string; name: string }
type Binding = { module: string; name: string | null }

function parse(file: string, source: string): ts.SourceFile {
  const kind = file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS
  return ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, kind)
}

/** `@/components/ui/button` (o un path relativo) → `components/ui/button`; null si es un paquete. */
function resolveModule(fromFile: string, specifier: string): string | null {
  let target: string
  if (specifier.startsWith('@/')) target = specifier.slice(2)
  else if (specifier.startsWith('.')) target = posix.join(posix.dirname(fromFile), specifier)
  else return null
  return posix
    .normalize(target)
    .replace(/\.(?:tsx?|jsx?)$/, '')
    .replace(/\/index$/, '')
}

/** ¿Este identificador nombra algo que ya existe (y no declara, ni es una clave, ni cierra un tag)? */
function isReference(id: ts.Identifier): boolean {
  const parent = id.parent
  if (ts.isImportClause(parent) || ts.isImportSpecifier(parent) || ts.isNamespaceImport(parent)) {
    return false
  }
  if (ts.isJsxClosingElement(parent) || ts.isJsxAttribute(parent) || ts.isBindingElement(parent)) {
    return false
  }
  if (ts.isLabeledStatement(parent) || ts.isBreakOrContinueStatement(parent)) return false
  if (ts.isPropertyAccessExpression(parent)) return parent.expression === id
  if (ts.isQualifiedName(parent)) return parent.left === id
  if (ts.isExportSpecifier(parent)) return (parent.propertyName ?? parent.name) === id
  if (
    ts.isPropertyAssignment(parent) ||
    ts.isPropertySignature(parent) ||
    ts.isPropertyDeclaration(parent) ||
    ts.isMethodDeclaration(parent) ||
    ts.isMethodSignature(parent) ||
    ts.isGetAccessorDeclaration(parent) ||
    ts.isSetAccessorDeclaration(parent) ||
    ts.isEnumMember(parent) ||
    ts.isVariableDeclaration(parent) ||
    ts.isParameter(parent) ||
    ts.isFunctionDeclaration(parent) ||
    ts.isFunctionExpression(parent) ||
    ts.isClassDeclaration(parent) ||
    ts.isClassExpression(parent) ||
    ts.isInterfaceDeclaration(parent) ||
    ts.isTypeAliasDeclaration(parent) ||
    ts.isTypeParameterDeclaration(parent) ||
    ts.isEnumDeclaration(parent) ||
    ts.isModuleDeclaration(parent)
  ) {
    return parent.name !== id
  }
  return true
}

function isDeprecatedExport(ref: Ref): boolean {
  const names = DEPRECATED_EXPORTS[ref.module]
  return names === '*' || (names?.includes(ref.name) ?? false)
}

/** Los usos deprecados del kit en un archivo. */
function scanSource(file: string, source: string, legacy: LegacyValues): Hit[] {
  const sf = parse(file, source)

  // Lo que el archivo importa del kit (y de los envoltorios): nombre local → módulo y export.
  const bindings = new Map<string, Binding>()
  for (const statement of sf.statements) {
    if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier)) {
      continue
    }
    const module = resolveModule(file, statement.moduleSpecifier.text)
    const clause = statement.importClause
    if (!module || !isTracked(module) || !clause) continue
    if (clause.name) bindings.set(clause.name.text, { module, name: 'default' })
    const named = clause.namedBindings
    if (named && ts.isNamespaceImport(named)) bindings.set(named.name.text, { module, name: null })
    else if (named) {
      for (const element of named.elements) {
        bindings.set(element.name.text, {
          module,
          name: (element.propertyName ?? element.name).text,
        })
      }
    }
  }
  if (bindings.size === 0) return []

  // Inicializadores por nombre, para seguir un salto: `const x = …`, `{ tone = 'outline' }`.
  const initializers = new Map<string, ts.Expression[]>()
  const collect = (node: ts.Node) => {
    if (
      (ts.isVariableDeclaration(node) || ts.isBindingElement(node) || ts.isParameter(node)) &&
      ts.isIdentifier(node.name) &&
      node.initializer
    ) {
      const list = initializers.get(node.name.text) ?? []
      list.push(node.initializer)
      initializers.set(node.name.text, list)
    }
    ts.forEachChild(node, collect)
  }
  collect(sf)

  /** `Button`, `UI.Button` (con `import * as UI`) o `UI.Tipo` → módulo y export del kit. */
  const resolveRef = (node: ts.Node): Ref | null => {
    if (ts.isIdentifier(node)) {
      const binding = bindings.get(node.text)
      return binding?.name ? { module: binding.module, name: binding.name } : null
    }
    const pair = ts.isPropertyAccessExpression(node)
      ? { ns: node.expression, member: node.name }
      : ts.isQualifiedName(node)
        ? { ns: node.left, member: node.right }
        : null
    if (!pair || !ts.isIdentifier(pair.ns)) return null
    const binding = bindings.get(pair.ns.text)
    return binding && binding.name === null
      ? { module: binding.module, name: pair.member.text }
      : null
  }

  const objectValues = (node: ts.Expression): ts.Expression[] => {
    let inner = node
    while (
      ts.isParenthesizedExpression(inner) ||
      ts.isAsExpression(inner) ||
      ts.isSatisfiesExpression(inner)
    ) {
      inner = inner.expression
    }
    if (!ts.isObjectLiteralExpression(inner)) return []
    return inner.properties.flatMap((p) => (ts.isPropertyAssignment(p) ? [p.initializer] : []))
  }

  /** Los literales con un valor viejo que pueden llegar a la prop: ternarios, `||`, `??` y un salto. */
  const legacyLiterals = (
    node: ts.Node,
    values: readonly string[],
    hops = 1,
  ): ts.StringLiteralLike[] => {
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
      return values.includes(node.text) ? [node] : []
    }
    if (ts.isJsxExpression(node)) {
      return node.expression ? legacyLiterals(node.expression, values, hops) : []
    }
    if (
      ts.isParenthesizedExpression(node) ||
      ts.isAsExpression(node) ||
      ts.isSatisfiesExpression(node) ||
      ts.isNonNullExpression(node) ||
      ts.isTypeAssertionExpression(node)
    ) {
      return legacyLiterals(node.expression, values, hops)
    }
    if (ts.isConditionalExpression(node)) {
      return [
        ...legacyLiterals(node.whenTrue, values, hops),
        ...legacyLiterals(node.whenFalse, values, hops),
      ]
    }
    if (ts.isBinaryExpression(node)) {
      const op = node.operatorToken.kind
      if (op === ts.SyntaxKind.AmpersandAmpersandToken) {
        return legacyLiterals(node.right, values, hops)
      }
      if (op === ts.SyntaxKind.BarBarToken || op === ts.SyntaxKind.QuestionQuestionToken) {
        return [
          ...legacyLiterals(node.left, values, hops),
          ...legacyLiterals(node.right, values, hops),
        ]
      }
      return []
    }
    if (hops === 0) return []
    if (ts.isIdentifier(node)) {
      return (initializers.get(node.text) ?? []).flatMap((init) =>
        legacyLiterals(init, values, hops - 1),
      )
    }
    if (ts.isElementAccessExpression(node) && ts.isIdentifier(node.expression)) {
      return (initializers.get(node.expression.text) ?? [])
        .flatMap(objectValues)
        .flatMap((value) => legacyLiterals(value, values, hops - 1))
    }
    return []
  }

  const hits: Hit[] = []
  const counted = new Set<ts.Node>()
  const hit = (node: ts.Node, label: string) => {
    if (counted.has(node)) return
    counted.add(node)
    const { line } = sf.getLineAndCharacterOfPosition(node.getStart(sf))
    hits.push({ file, line: line + 1, label })
  }

  const checkProp = (
    ref: Ref,
    prop: string,
    value: ts.Node | undefined,
    site: ts.Node,
    call: boolean,
  ) => {
    for (const rule of PROP_RULES) {
      if (rule.module !== ref.module || rule.target !== ref.name || rule.prop !== prop) continue
      if (!rule.values) {
        hit(site, call ? `${ref.name}({ ${prop} })` : `${ref.name} ${prop}`)
        continue
      }
      if (!value) continue
      for (const literal of legacyLiterals(value, legacy[rule.values])) {
        hit(
          literal,
          call
            ? `${ref.name}({ ${prop}: '${literal.text}' })`
            : `${ref.name} ${prop}="${literal.text}"`,
        )
      }
    }
  }

  const visit = (node: ts.Node) => {
    // 1. Referencias a exports deprecados (`<StatCard>`, `SlidingTab<…>`, `UI.Stepper`).
    const isRefSite =
      (ts.isIdentifier(node) && isReference(node)) ||
      ((ts.isPropertyAccessExpression(node) || ts.isQualifiedName(node)) &&
        !ts.isJsxClosingElement(node.parent))
    if (isRefSite) {
      const ref = resolveRef(node)
      if (ref && isDeprecatedExport(ref)) hit(node, ref.name)
    }
    // 2. Props de un componente del kit: `<PageHeader eyebrow>`, `<Button variant="outline">`.
    if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
      const ref = resolveRef(node.tagName)
      if (ref) {
        for (const attr of node.attributes.properties) {
          if (ts.isJsxAttribute(attr)) {
            checkProp(ref, attr.name.getText(sf), attr.initializer, attr, false)
          }
        }
      }
    }
    // 3. Llamadas: `buttonVariants({ variant: 'outline' })`, `badgeVariants({ variant })`.
    if (ts.isCallExpression(node)) {
      const ref = resolveRef(node.expression)
      const arg = node.arguments[0]
      if (ref && arg && ts.isObjectLiteralExpression(arg)) {
        for (const p of arg.properties) {
          if (
            ts.isPropertyAssignment(p) &&
            (ts.isIdentifier(p.name) || ts.isStringLiteral(p.name))
          ) {
            checkProp(ref, p.name.text, p.initializer, p, true)
          } else if (ts.isShorthandPropertyAssignment(p)) {
            checkProp(ref, p.name.text, p.name, p, true)
          }
        }
      }
    }
    ts.forEachChild(node, visit)
  }
  visit(sf)
  return hits
}

/** El `type` o `interface` donde está declarada una prop (`PageHeaderProps`); `?` si es un tipo en línea. */
function ownerTypeName(node: ts.Node): string {
  for (let owner = node.parent; owner && !ts.isSourceFile(owner); owner = owner.parent) {
    if (ts.isTypeAliasDeclaration(owner) || ts.isInterfaceDeclaration(owner)) return owner.name.text
  }
  return '?'
}

/** Los miembros string de `type <nombre> = 'a' | 'b'` en un archivo del kit. */
function literalUnion(file: string, typeName: string): string[] {
  const path = join(ROOT, file)
  if (!existsSync(path)) return []
  const sf = parse(file, readFileSync(path, 'utf8'))
  for (const statement of sf.statements) {
    if (!ts.isTypeAliasDeclaration(statement) || statement.name.text !== typeName) continue
    const members = ts.isUnionTypeNode(statement.type) ? statement.type.types : [statement.type]
    return members.flatMap((member) =>
      ts.isLiteralTypeNode(member) && ts.isStringLiteral(member.literal)
        ? [member.literal.text]
        : [],
    )
  }
  return []
}

function readLegacyValues(): LegacyValues {
  const read = (key: LegacyValueKey) =>
    literalUnion(LEGACY_VALUE_TYPES[key].file, LEGACY_VALUE_TYPES[key].type)
  return {
    buttonVariant: read('buttonVariant'),
    buttonSize: read('buttonSize'),
    selectSize: read('selectSize'),
    switchSize: read('switchSize'),
  }
}

function listSourceFiles(dir: string, out: string[] = []): string[] {
  const abs = join(ROOT, dir)
  if (!existsSync(abs)) return out
  for (const name of readdirSync(abs).sort()) {
    const path = posix.join(dir, name)
    if (statSync(join(ROOT, path)).isDirectory()) listSourceFiles(path, out)
    else if (/\.tsx?$/.test(name) && !name.endsWith('.d.ts')) out.push(path)
  }
  return out
}

function folderOf(file: string): string {
  const rest = file.slice(PANEL_DIR.length + 1)
  const slash = rest.indexOf('/')
  return slash === -1 ? ROOT_BUCKET : rest.slice(0, slash)
}

type FolderReport = { total: number; byLabel: Map<string, number>; byFile: Map<string, number> }

function countPanel(legacy: LegacyValues): Map<string, FolderReport> {
  const folders = new Map<string, FolderReport>()
  for (const file of listSourceFiles(PANEL_DIR)) {
    const folder = folderOf(file)
    const report = folders.get(folder) ?? { total: 0, byLabel: new Map(), byFile: new Map() }
    folders.set(folder, report)
    for (const { label } of scanSource(file, readFileSync(join(ROOT, file), 'utf8'), legacy)) {
      report.total += 1
      report.byLabel.set(label, (report.byLabel.get(label) ?? 0) + 1)
      const short = file.slice(PANEL_DIR.length + 1)
      report.byFile.set(short, (report.byFile.get(short) ?? 0) + 1)
    }
  }
  return folders
}

type Baseline = Record<string, number>

function readBaseline(): Baseline | null {
  const path = join(ROOT, BASELINE_FILE)
  if (!existsSync(path)) return null
  const data: unknown = JSON.parse(readFileSync(path, 'utf8'))
  if (typeof data !== 'object' || data === null || Array.isArray(data)) {
    throw new Error(`${BASELINE_FILE} tiene que ser un objeto { carpeta: cuenta }`)
  }
  const entries: Array<[string, unknown]> = Object.entries(data)
  const baseline: Baseline = {}
  for (const [folder, value] of entries) {
    if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) {
      throw new Error(`${BASELINE_FILE}: «${folder}» tiene que ser un entero ≥ 0`)
    }
    baseline[folder] = value
  }
  return baseline
}

const toJson = (baseline: Baseline) => `${JSON.stringify(baseline, null, 2)}\n`

const sortedEntries = <V>(map: Map<string, V>) =>
  [...map].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))

function describeCounts(folders: Map<string, FolderReport>, baseline: Baseline | null): string {
  const width = Math.max(...[...folders.keys()].map((folder) => folder.length), 'total'.length)
  const lines = [`Usos deprecados del kit en ${PANEL_DIR}/ (actual / línea de base):`]
  let total = 0
  let baseTotal = 0
  for (const [folder, report] of sortedEntries(folders)) {
    const base = baseline?.[folder] ?? 0
    total += report.total
    baseTotal += base
    const trend = report.total > base ? '  SUBIÓ' : report.total < base ? '  (se puede bajar)' : ''
    const top = [...report.byLabel]
      .sort(([la, a], [lb, b]) => b - a || (la < lb ? -1 : 1))
      .slice(0, 4)
      .map(([label, n]) => `${label} ×${n}`)
      .join(', ')
    lines.push(
      `  ${folder.padEnd(width)} ${String(report.total).padStart(4)} / ${String(base).padStart(4)}${trend}${top ? `   ${top}` : ''}`,
    )
  }
  lines.push(
    `  ${'total'.padEnd(width)} ${String(total).padStart(4)} / ${String(baseTotal).padStart(4)}`,
  )
  return lines.join('\n')
}

/** Qué y dónde, de una carpeta: cada etiqueta y cada archivo con su cuenta. */
function describeFolder(folder: string, report: FolderReport, base: number): string {
  const labels = sortedEntries(report.byLabel).map(([label, n]) => `    ${label} ×${n}`)
  const files = sortedEntries(report.byFile).map(([file, n]) => `    ${file} ×${n}`)
  return [
    `${folder}: ${report.total} (línea de base ${base})`,
    ...labels,
    '  archivos:',
    ...files,
  ].join('\n')
}

// ─── Tests ───────────────────────────────────────────────────────────────────

const LEGACY = readLegacyValues()

describe('el contador de usos deprecados', () => {
  it('lee los valores viejos de los tipos @deprecated del kit', () => {
    expect(LEGACY.buttonVariant).toEqual(
      expect.arrayContaining(['default', 'outline', 'destructive', 'success']),
    )
    expect(LEGACY.buttonVariant).not.toContain('secondary')
    expect(LEGACY.buttonSize).toEqual(expect.arrayContaining(['default', 'xl']))
    expect(LEGACY.selectSize).toEqual(['default'])
    expect(LEGACY.switchSize).toEqual(['default'])
  })

  it('cuenta lo deprecado del kit, y solo eso', () => {
    const fixture = [
      "import * as Header from '@/components/ui/page-header'",
      "import { ContactButton } from '@/components/messaging/contact-button'",
      "import { Badge, badgeVariants } from '@/components/ui/badge'",
      "import { Button as Btn, buttonVariants } from '@/components/ui/button'",
      "import { DropdownMenuItem } from '@/components/ui/dropdown-menu'",
      "import { SelectTrigger } from '@/components/ui/select'",
      "import type { SlidingTab } from '@/components/ui/sliding-tabs'",
      "import { StatCard } from '@/components/ui/stat-card'",
      "import { Toggle } from '@/components/ui/toggle'",
      "import { Button as FrozenButton } from '@/components/ui-legacy/button'",
      "import { StatCard as LocalStatCard } from './stat-card'",
      '',
      "const TABS: SlidingTab<'a'>[] = []",
      "const TONE = { on: 'default', off: 'ghost' } as const",
      '',
      "export function Fixture({ tone = 'outline', on }: { tone?: 'outline' | 'ghost'; on: boolean }) {",
      '  return (',
      '    <>',
      '      <Btn variant="outline">uno</Btn>',
      '      <Btn variant="secondary" size="sm">cero</Btn>',
      "      <Btn variant={on ? 'default' : 'destructive'}>dos</Btn>",
      '      <Btn variant={tone}>uno: el valor por defecto de la prop</Btn>',
      "      <Btn variant={TONE[on ? 'on' : 'off']}>uno: del mapa</Btn>",
      '      <Btn size="xl">uno</Btn>',
      '      <SelectTrigger size="default" />',
      '      <FrozenButton variant="outline">congelado: cero</FrozenButton>',
      '      <Toggle variant="outline">no es Button: cero</Toggle>',
      '      <DropdownMenuItem variant="destructive">su API vigente: cero</DropdownMenuItem>',
      '      <ContactButton tenantSlug="hub" phone="351" variant="outline" />',
      '      <LocalStatCard label="local: cero" />',
      '      <Badge variant="secondary">uno</Badge>',
      '      <Badge tone="brand">cero</Badge>',
      '      <StatCard label="uno (el cierre no cuenta)" value={1}></StatCard>',
      '      <Header.PageHeader title="t" eyebrow="uno" />',
      "      <span className={buttonVariants({ variant: 'outline', size: 'default' })} />",
      "      <span className={badgeVariants({ variant: 'outline' })} />",
      '    </>',
      '  )',
      '}',
    ].join('\n')
    const file = `${PANEL_DIR}/fixture/fixture.tsx`
    const hits = scanSource(file, fixture, LEGACY)
    expect(hits.map((h) => h.label).sort()).toEqual(
      [
        'SlidingTab',
        'Button variant="outline"',
        'Button variant="default"',
        'Button variant="destructive"',
        'Button variant="outline"',
        'Button variant="default"',
        'Button size="xl"',
        'SelectTrigger size="default"',
        'ContactButton variant="outline"',
        'Badge variant',
        'StatCard',
        'PageHeader eyebrow',
        "buttonVariants({ variant: 'outline' })",
        "buttonVariants({ size: 'default' })",
        'badgeVariants({ variant })',
      ].sort(),
    )
    const lineOf = (text: string) => fixture.split('\n').findIndex((l) => l.includes(text)) + 1
    expect(hits.find((h) => h.label === 'StatCard')?.line).toBe(lineOf('<StatCard label'))
    // El valor por defecto cuenta una vez, en su línea, aunque lo usen varios botones.
    expect(hits.filter((h) => h.line === lineOf('export function Fixture'))).toHaveLength(1)
  })

  it('cada @deprecated de components/ui está registrado en el contador', () => {
    const unregistered: string[] = []
    for (const name of readdirSync(join(ROOT, 'components/ui')).sort()) {
      if (!/\.tsx?$/.test(name)) continue
      const file = `components/ui/${name}`
      const module = file.replace(/\.tsx?$/, '')
      const sf = parse(file, readFileSync(join(ROOT, file), 'utf8'))
      const visit = (node: ts.Node) => {
        const deprecated = () => ts.getJSDocTags(node).some((t) => t.tagName.text === 'deprecated')
        let host: string | null = null
        if (ts.isExportDeclaration(node) && node.moduleSpecifier && deprecated()) host = '*'
        else if (
          (ts.isFunctionDeclaration(node) ||
            ts.isVariableDeclaration(node) ||
            ts.isTypeAliasDeclaration(node) ||
            ts.isInterfaceDeclaration(node) ||
            ts.isClassDeclaration(node)) &&
          node.name &&
          ts.isIdentifier(node.name) &&
          deprecated()
        ) {
          host = node.name.text
        } else if (ts.isPropertySignature(node) && ts.isIdentifier(node.name) && deprecated()) {
          host = `${ownerTypeName(node)}.${node.name.text}`
        }
        if (host !== null) {
          const exportsOf = DEPRECATED_EXPORTS[module]
          const prop = host.includes('.') ? host.slice(host.indexOf('.') + 1) : null
          const registered =
            exportsOf === '*' ||
            (prop === null
              ? (exportsOf?.includes(host) ?? false)
              : PROP_RULES.some((r) => r.module === module && r.prop === prop && !r.values) ||
                COVERED_BY_COMPONENT.has(`${module}#${host}`))
          if (!registered) unregistered.push(`${module}#${host}`)
        }
        ts.forEachChild(node, visit)
      }
      visit(sf)
    }
    // Si esto falla: sumá lo nuevo a DEPRECATED_EXPORTS, PROP_RULES o
    // COVERED_BY_COMPONENT (arriba en este archivo) para que se cuente.
    expect(unregistered).toEqual([])
  })
})

describe('usos deprecados del kit por carpeta del panel: solo pueden bajar', () => {
  it('ninguna carpeta supera su línea de base', () => {
    const folders = countPanel(LEGACY)
    const baseline = readBaseline()
    const summary = describeCounts(folders, baseline)
    console.log(summary)
    const detail = process.env[DETAIL_ENV]
    if (detail) {
      const wanted = new Set(detail.split(',').map((folder) => folder.trim()))
      for (const [folder, report] of sortedEntries(folders)) {
        if (detail === '1' || wanted.has(folder)) {
          console.log(describeFolder(folder, report, baseline?.[folder] ?? 0))
        }
      }
    }

    const current: Baseline = Object.fromEntries(
      sortedEntries(folders).map(([folder, report]) => [folder, report.total]),
    )
    if (baseline === null) {
      throw new Error(
        `Falta ${BASELINE_FILE}. Con las cuentas de hoy sería:\n${toJson(current)}\n${summary}`,
      )
    }

    // Lo que se puede fijar: cada carpeta que existe, con el mínimo entre hoy y
    // su línea de base (una carpeta nueva arranca en 0). Nunca sube.
    const lowered: Baseline = Object.fromEntries(
      Object.entries(current).map(([folder, total]) => [
        folder,
        Math.min(total, baseline[folder] ?? 0),
      ]),
    )
    if (toJson(lowered) !== toJson(baseline)) {
      if (process.env[UPDATE_ENV] === '1') {
        writeFileSync(join(ROOT, BASELINE_FILE), toJson(lowered))
        console.log(`${BASELINE_FILE} actualizado (solo hacia abajo).`)
      } else {
        console.log(
          `La línea de base se puede bajar: ${UPDATE_ENV}=1 npx vitest run tests/lib/kit-deprecations.test.ts`,
        )
      }
    }

    const risen = sortedEntries(folders).filter(
      ([folder, report]) => report.total > (baseline[folder] ?? 0),
    )
    const details = risen.map(([folder, report]) =>
      describeFolder(folder, report, baseline[folder] ?? 0),
    )
    expect(
      details,
      `Subieron los usos deprecados del kit. Usá el reemplazo que dice el @deprecated (kit §3.9).\n\n${summary}`,
    ).toEqual([])
  })
})
