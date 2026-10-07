/**
 * «La vista previa es exactamente lo que se guarda» (Sprint 1, E.7).
 *
 * 1. El formulario corre `build*(input, ctx, { clientRef })` en cada cambio y
 *    dibuja `toEntryPreview(bundle, ctx)` con `EntryPreview` del kit.
 * 2. Al guardar manda el `input` (centavos) y `previewHash = hash(bundle)`.
 * 3. La server action recarga el contexto DESDE LA BASE, corre el mismo
 *    `build*` y compara hashes: si difieren, `preview_stale` con la vista
 *    previa nueva; si coinciden, manda SU bundle a `acc_post_bundle`.
 *
 * El hash es SHA-256 (hex en minúsculas, 64 caracteres: lo que exigen el
 * esquema `previewHash` y el CHECK `abd_preview_hash`) de `canonicalize(bundle)`.
 *
 * **Por qué dos funciones de hash y cuál usar.** Web Crypto (`crypto.subtle`)
 * existe igual en el navegador y en Node 22, pero es asíncrona y solo está en
 * contextos seguros (HTTPS o `localhost`): abriendo el dev server por la IP de
 * la red (`http://192.168.x.x`, el celular del dueño) `crypto.subtle` no
 * existe. Además los `build*` son síncronos y devuelven `hash` en su
 * `PostingResult`. Por eso:
 * - `hashProposalSync`: SHA-256 en TypeScript puro (FIPS 180-4) sobre los bytes
 *   UTF-8. Determinista en cualquier runtime; es la que usan los builders.
 * - `hashProposal`: la misma cuenta con Web Crypto cuando está disponible (y la
 *   pura si no). El test compara las dos contra `node:crypto` con textos ASCII,
 *   con tildes y con emojis: dan siempre el mismo hex.
 */

import { sumSides } from './balance'
import type {
  EntryPreview,
  EntryPreviewLine,
  NewParty,
  PartyKey,
  PostingContext,
  ProposedBundle,
  ProposedDocument,
} from './types'

// ─── Forma canónica ──────────────────────────────────────────────────────────

/**
 * Claves de textos derivados o libres que NO entran al hash: descripciones,
 * leyendas, nombres, notas, el motivo de un override y los avisos aceptados.
 * Ninguna mueve plata, y algunas cambian sin que cambie nada contable (renombrar
 * un proveedor no tiene que invalidar la vista previa de otro dueño). Todo lo
 * demás entra: tipos, fechas, partícipes (ids, refs y datos fiscales de los
 * nuevos), cuentas, lados, importes, alícuotas, bases, IVA calculado, tipos de
 * impuesto, canales, cajas, medios, vencimientos, certificados y referencias,
 * identidad de los comprobantes, comprobantes fiscales, imputaciones,
 * `replaces/corrects/related` y `counted/expected`.
 */
export const HASH_EXCLUDED_KEYS: ReadonlySet<string> = new Set([
  'description',
  'memo',
  'notes',
  'name',
  'tradeName',
  'label',
  'overrideReason',
  'warningsAck',
])

/**
 * Normaliza un valor para el hash:
 * - claves ordenadas, sin las de `HASH_EXCLUDED_KEYS`;
 * - `null` / `undefined` se omiten (como en el payload de la RPC, que omite las
 *   claves en `null`), así `{ dueDate: null }` y `{}` dan lo mismo;
 * - dentro de `amounts` (columnas de un comprobante fiscal) los ceros se omiten:
 *   una columna en cero y una ausente son lo mismo;
 * - textos sin espacios en los bordes y en NFC;
 * - números enteros (los centavos lo son siempre); `-0` es `0`. Un número con
 *   decimales o no finito es un error del motor y corta con un `RangeError`.
 */
function normalize(value: unknown, path: string, parentKey: string | null): unknown {
  if (value === null || value === undefined) return undefined
  if (typeof value === 'string') return value.trim().normalize('NFC')
  if (typeof value === 'number') {
    if (!Number.isFinite(value) || !Number.isInteger(value)) {
      throw new RangeError(`Número no entero en la propuesta (${path}): ${value}`)
    }
    return value === 0 ? 0 : value
  }
  if (typeof value === 'boolean') return value
  if (typeof value === 'bigint') return Number(value)
  if (Array.isArray(value)) {
    return value.map((item, i) => normalize(item, `${path}[${i}]`, null) ?? null)
  }
  if (typeof value === 'object') {
    const out: Record<string, unknown> = {}
    const keys = Object.keys(value as Record<string, unknown>).sort()
    for (const key of keys) {
      if (HASH_EXCLUDED_KEYS.has(key)) continue
      const raw = (value as Record<string, unknown>)[key]
      if (parentKey === 'amounts' && raw === 0) continue
      const normalized = normalize(raw, `${path}.${key}`, key)
      if (normalized !== undefined) out[key] = normalized
    }
    return out
  }
  throw new RangeError(`Valor que no se puede firmar en la propuesta (${path}): ${typeof value}`)
}

/** JSON sin espacios y con las claves en el orden de inserción (ya ordenadas por `normalize`). */
function serialize(value: unknown): string {
  if (value === null) return 'null'
  if (typeof value === 'string') return JSON.stringify(value)
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  if (Array.isArray(value)) return `[${value.map(serialize).join(',')}]`
  const entries = Object.entries(value as Record<string, unknown>)
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${serialize(v)}`).join(',')}}`
}

/**
 * La forma canónica de un bundle: lo que firma el hash. El `clientRef` no
 * entra (es la clave de idempotencia, no contenido): el mismo asiento armado
 * en dos aperturas del formulario da el mismo hash.
 */
export function canonicalize(bundle: ProposedBundle): string {
  const { clientRef: _clientRef, ...content } = bundle
  return serialize(normalize(content, 'bundle', null))
}

// ─── SHA-256 ─────────────────────────────────────────────────────────────────

const K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
])

const H0 = [
  0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
] as const

function rotr(x: number, n: number): number {
  return (x >>> n) | (x << (32 - n))
}

function toHex(bytes: Uint8Array): string {
  let out = ''
  for (const b of bytes) out += b.toString(16).padStart(2, '0')
  return out
}

/**
 * SHA-256 (FIPS 180-4) en TypeScript puro. `string` se firma como UTF-8
 * (`TextEncoder`, igual en Node y en el navegador). Devuelve hex en minúsculas.
 */
export function sha256Hex(input: string | Uint8Array): string {
  const bytes = typeof input === 'string' ? new TextEncoder().encode(input) : input
  const length = bytes.length
  const padded = Math.ceil((length + 9) / 64) * 64
  const buffer = new Uint8Array(padded)
  buffer.set(bytes)
  buffer[length] = 0x80
  const view = new DataView(buffer.buffer)
  const bitLength = length * 8
  view.setUint32(padded - 8, Math.floor(bitLength / 0x1_0000_0000))
  view.setUint32(padded - 4, bitLength >>> 0)

  const h = Uint32Array.from(H0)
  const w = new Uint32Array(64)
  for (let offset = 0; offset < padded; offset += 64) {
    for (let i = 0; i < 16; i++) w[i] = view.getUint32(offset + i * 4)
    for (let i = 16; i < 64; i++) {
      const w15 = w[i - 15] ?? 0
      const w2 = w[i - 2] ?? 0
      const s0 = rotr(w15, 7) ^ rotr(w15, 18) ^ (w15 >>> 3)
      const s1 = rotr(w2, 17) ^ rotr(w2, 19) ^ (w2 >>> 10)
      w[i] = ((w[i - 16] ?? 0) + s0 + (w[i - 7] ?? 0) + s1) >>> 0
    }
    let a = h[0] ?? 0
    let b = h[1] ?? 0
    let c = h[2] ?? 0
    let d = h[3] ?? 0
    let e = h[4] ?? 0
    let f = h[5] ?? 0
    let g = h[6] ?? 0
    let hh = h[7] ?? 0
    for (let i = 0; i < 64; i++) {
      const S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25)
      const ch = (e & f) ^ (~e & g)
      const t1 = (hh + S1 + ch + (K[i] ?? 0) + (w[i] ?? 0)) >>> 0
      const S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22)
      const maj = (a & b) ^ (a & c) ^ (b & c)
      const t2 = (S0 + maj) >>> 0
      hh = g
      g = f
      f = e
      e = (d + t1) >>> 0
      d = c
      c = b
      b = a
      a = (t1 + t2) >>> 0
    }
    h[0] = ((h[0] ?? 0) + a) >>> 0
    h[1] = ((h[1] ?? 0) + b) >>> 0
    h[2] = ((h[2] ?? 0) + c) >>> 0
    h[3] = ((h[3] ?? 0) + d) >>> 0
    h[4] = ((h[4] ?? 0) + e) >>> 0
    h[5] = ((h[5] ?? 0) + f) >>> 0
    h[6] = ((h[6] ?? 0) + g) >>> 0
    h[7] = ((h[7] ?? 0) + hh) >>> 0
  }

  const out = new Uint8Array(32)
  const outView = new DataView(out.buffer)
  for (let i = 0; i < 8; i++) outView.setUint32(i * 4, h[i] ?? 0)
  return toHex(out)
}

/** El hash de la vista previa, síncrono (lo que devuelven los `build*` en `hash`). */
export function hashProposalSync(bundle: ProposedBundle): string {
  return sha256Hex(canonicalize(bundle))
}

/** Web Crypto si el runtime la tiene (navegador en contexto seguro, Node ≥ 19); si no, `undefined`. */
function webSubtle(): SubtleCrypto | undefined {
  const c: Crypto | undefined =
    typeof globalThis.crypto === 'undefined' ? undefined : globalThis.crypto
  return c?.subtle ?? undefined
}

/**
 * El hash de la vista previa con Web Crypto (asíncrono). Mismo resultado que
 * `hashProposalSync`; sin `crypto.subtle` (http por IP de red) usa la versión pura.
 */
export async function hashProposal(bundle: ProposedBundle): Promise<string> {
  const text = canonicalize(bundle)
  const subtle = webSubtle()
  if (!subtle) return sha256Hex(text)
  const digest = await subtle.digest('SHA-256', new TextEncoder().encode(text))
  return toHex(new Uint8Array(digest))
}

/** Forma del hash que aceptan el esquema y la base. */
export const PREVIEW_HASH_RE = /^[0-9a-f]{64}$/

// ─── Lo que dibuja EntryPreview ──────────────────────────────────────────────

function partyName(
  key: PartyKey | null,
  ctx: Pick<PostingContext, 'parties'>,
  newParties: readonly NewParty[],
): string | null {
  if (key === null) return null
  if ('id' in key) {
    const p = ctx.parties.get(key.id)
    return p ? (p.tradeName ?? p.name) : null
  }
  const np = newParties.find((n) => n.ref === key.ref)
  return np ? (np.tradeName ?? np.name) : null
}

function previewOf(
  doc: ProposedDocument,
  ctx: Pick<PostingContext, 'accounts' | 'parties'>,
  newParties: readonly NewParty[],
): EntryPreview {
  const lines: EntryPreviewLine[] = doc.lines.map((line) => {
    const account = ctx.accounts.get(line.accountId)
    return {
      id: `${doc.ref}:${line.lineNo}`,
      lineNo: line.lineNo,
      role: line.role,
      accountId: line.accountId,
      accountCode: account?.code ?? '?',
      accountName: account?.name ?? 'Cuenta desconocida',
      partyName: partyName(line.partyRef, ctx, newParties),
      debitCents: line.side === 'debit' ? line.amountCents : null,
      creditCents: line.side === 'credit' ? line.amountCents : null,
      dueDate: line.dueDate,
      note: line.memo.trim() === '' ? null : line.memo,
    }
  })
  // Como el libro diario: primero el Debe y después el Haber, cada lado por `line_no`.
  lines.sort((a, b) => {
    const sa = a.debitCents !== null ? 0 : 1
    const sb = b.debitCents !== null ? 0 : 1
    return sa !== sb ? sa - sb : a.lineNo - b.lineNo
  })
  const sums = sumSides(doc.lines)
  return {
    documentRef: doc.ref,
    kind: doc.kind,
    entryKind: doc.entryKind,
    date: doc.accountingDate,
    description: doc.description,
    lines,
    debitCents: Number(sums.debit),
    creditCents: Number(sums.credit),
    diffCents: Number(sums.diff),
    balanced: sums.diff === 0n && sums.debit > 0n,
  }
}

/** Un asiento por documento del bundle, en el orden del bundle. */
export function toEntryPreview(
  bundle: ProposedBundle,
  ctx: Pick<PostingContext, 'accounts' | 'parties'>,
): EntryPreview[] {
  return bundle.documents.map((doc) => previewOf(doc, ctx, bundle.newParties))
}
