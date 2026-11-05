/**
 * Una base de mentira para las pruebas de Mensajería y Marketing: alcanza para las lecturas con la sesión
 * de la persona y para correr de punta a punta las acciones de verdad. Guarda qué columnas se pidieron y
 * qué se escribió, para poder probar lo que nunca tiene que pasar.
 */

export type FakeRow = Record<string, unknown>

type Filter = (row: FakeRow) => boolean

const asText = (value: unknown): string => String(value ?? '')

export class FakeDb {
  readonly selects: Array<{ table: string; columns: string }> = []
  readonly writes: Array<{ table: string; kind: string; payload: unknown }> = []
  readonly rpcs: Array<{ name: string; args: Record<string, unknown> }> = []
  rpcResult: (name: string, args: Record<string, unknown>) => unknown = () => []
  /** Las tablas que contestan con error. */
  readonly failing = new Set<string>()
  private sequence = 0

  constructor(readonly tables: Record<string, FakeRow[]> = {}) {}

  rows(table: string): FakeRow[] {
    this.tables[table] ??= []
    return this.tables[table] as FakeRow[]
  }

  nextId(): string {
    this.sequence += 1
    return `00000000-0000-4000-8000-${String(this.sequence).padStart(12, '0')}`
  }
}

class FakeQuery {
  private filters: Filter[] = []
  private mode: 'select' | 'insert' | 'update' | 'delete' | 'upsert' = 'select'
  private payload: unknown = null
  private wantCount = false
  private head = false
  private sort: { column: string; ascending: boolean } | null = null
  private max: number | null = null
  private window: { from: number; to: number } | null = null
  private one: 'single' | 'maybe' | null = null

  constructor(
    private readonly db: FakeDb,
    private readonly table: string,
  ) {}

  select(columns = '*', options?: { count?: string; head?: boolean }) {
    if (this.mode === 'select') this.db.selects.push({ table: this.table, columns })
    this.wantCount = Boolean(options?.count)
    this.head = Boolean(options?.head)
    return this
  }
  insert(rows: unknown) {
    this.mode = 'insert'
    this.payload = rows
    return this
  }
  upsert(rows: unknown) {
    this.mode = 'upsert'
    this.payload = rows
    return this
  }
  update(patch: unknown) {
    this.mode = 'update'
    this.payload = patch
    return this
  }
  delete() {
    this.mode = 'delete'
    return this
  }
  eq(column: string, value: unknown) {
    this.filters.push((row) => row[column] === value)
    return this
  }
  neq(column: string, value: unknown) {
    this.filters.push((row) => row[column] !== value)
    return this
  }
  in(column: string, values: readonly unknown[]) {
    this.filters.push((row) => values.includes(row[column]))
    return this
  }
  is(column: string, value: unknown) {
    this.filters.push((row) => (row[column] ?? null) === value)
    return this
  }
  gte(column: string, value: unknown) {
    this.filters.push((row) => asText(row[column]) >= asText(value))
    return this
  }
  gt(column: string, value: unknown) {
    this.filters.push((row) => Number(row[column]) > Number(value))
    return this
  }
  lte(column: string, value: unknown) {
    this.filters.push((row) => asText(row[column]) <= asText(value))
    return this
  }
  lt(column: string, value: unknown) {
    this.filters.push((row) => asText(row[column]) < asText(value))
    return this
  }
  order(column: string, options?: { ascending?: boolean }) {
    this.sort = { column, ascending: options?.ascending ?? true }
    return this
  }
  limit(max: number) {
    this.max = max
    return this
  }
  range(from: number, to: number) {
    this.window = { from, to }
    return this
  }
  maybeSingle() {
    this.one = 'maybe'
    return this
  }
  single() {
    this.one = 'single'
    return this
  }

  private matching(): FakeRow[] {
    return this.db.rows(this.table).filter((row) => this.filters.every((filter) => filter(row)))
  }

  private run(): { data: unknown; error: unknown; count: number | null } {
    if (this.db.failing.has(this.table)) {
      return { data: null, error: { message: 'falló', code: 'XX000' }, count: null }
    }
    let rows: FakeRow[]
    if (this.mode === 'insert' || this.mode === 'upsert') {
      const list = (Array.isArray(this.payload) ? this.payload : [this.payload]) as FakeRow[]
      // Lo que pone la base sola, como `default now()`.
      rows = list.map((row) => ({
        id: this.db.nextId(),
        created_at: new Date().toISOString(),
        ...row,
      }))
      this.db.rows(this.table).push(...rows)
      this.db.writes.push({ table: this.table, kind: this.mode, payload: this.payload })
    } else if (this.mode === 'update') {
      rows = this.matching()
      for (const row of rows) Object.assign(row, this.payload)
      this.db.writes.push({ table: this.table, kind: 'update', payload: this.payload })
    } else if (this.mode === 'delete') {
      rows = this.matching()
      const gone = new Set(rows)
      const left = this.db.rows(this.table).filter((row) => !gone.has(row))
      this.db.tables[this.table] = left
      this.db.writes.push({ table: this.table, kind: 'delete', payload: null })
    } else {
      rows = this.matching()
    }
    const count = rows.length
    if (this.sort) {
      const { column, ascending } = this.sort
      rows = [...rows].sort((a, b) => {
        const order = asText(a[column]).localeCompare(asText(b[column]))
        return ascending ? order : -order
      })
    }
    if (this.window) rows = rows.slice(this.window.from, this.window.to + 1)
    if (this.max !== null) rows = rows.slice(0, this.max)
    if (this.head) return { data: null, error: null, count }
    if (this.one) {
      const [first] = rows
      if (!first && this.one === 'single') {
        return { data: null, error: { message: 'sin filas' }, count: null }
      }
      return { data: first ?? null, error: null, count }
    }
    return { data: rows, error: null, count: this.wantCount ? count : null }
  }

  // biome-ignore lint/suspicious/noThenProperty: imita al cliente de Supabase, que se usa con await.
  then<R>(resolve: (value: { data: unknown; error: unknown; count: number | null }) => R) {
    return Promise.resolve(this.run()).then(resolve)
  }
}

export function fakeClient(db: FakeDb, userId: string) {
  return {
    from: (table: string) => new FakeQuery(db, table),
    rpc: async (name: string, args: Record<string, unknown>) => {
      db.rpcs.push({ name, args })
      return { data: db.rpcResult(name, args), error: null }
    },
    auth: {
      getUser: async () => ({ data: { user: { id: userId } }, error: null }),
    },
  }
}

/** El mock de `lib/supabase/*` lee de acá: cada prueba arranca con su base. */
export const fake: { db: FakeDb } = { db: new FakeDb() }

/** Lo que un resultado no puede traer, por más que esté en la base. */
export function withoutIds(text: string): string {
  return text.replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, '<id>')
}

/** Siete dígitos seguidos, con o sin separadores: un teléfono. `…1234` no llega a tanto. */
export const PHONE_LIKE = /\d(?:[\s().-]{0,2}\d){6,}/
export const MAIL_LIKE = /[\w.+-]+@[\w-]+\.[\w.]+/
