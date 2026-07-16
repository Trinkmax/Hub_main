/**
 * Backfill de variantes de media del bucket `menu-images`.
 *
 * Genera los thumbnails `_t.{ext}` (lado mayor 320px) que faltan para las
 * imágenes ya subidas antes del pipeline nuevo (lib/menu/upload-image.ts), y
 * opcionalmente detecta/borra objetos huérfanos no referenciados por la DB.
 * Convención de sufijos en lib/menu/media-urls.ts.
 *
 * Uso (NUNCA corre nada contra Storage sin --apply):
 *   npx tsx scripts/backfill-menu-media.ts                     # dry-run: imprime qué haría
 *   npx tsx scripts/backfill-menu-media.ts --apply             # genera y sube los thumbs
 *   npx tsx scripts/backfill-menu-media.ts --prune-orphans     # además lista huérfanos
 *   npx tsx scripts/backfill-menu-media.ts --apply --prune-orphans  # ...y los borra
 *
 * Script admin: usa SUPABASE_SERVICE_ROLE_KEY de .env.local (cross-tenant
 * justificado — mantenimiento del bucket completo, CLAUDE.md §4).
 */

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import sharp from 'sharp'
import type { Database } from '../types/database'

const BUCKET = 'menu-images'
const THUMB_DIMENSION = 320
const FULL_DIMENSION = 1600
const CACHE_CONTROL = '31536000'

const APPLY = process.argv.includes('--apply')
const PRUNE = process.argv.includes('--prune-orphans')

// ---------------------------------------------------------------------------
// Env: parse manual de .env.local (sin dotenv). process.env pisa al archivo.
// ---------------------------------------------------------------------------

function loadEnvLocal(): Record<string, string> {
  const out: Record<string, string> = {}
  // Este repo usa .env (no .env.local); probamos ambos, .env.local gana.
  for (const file of ['.env', '.env.local']) {
    try {
      const raw = readFileSync(resolve(process.cwd(), file), 'utf8')
      for (const line of raw.split('\n')) {
        const trimmed = line.trim()
        if (trimmed.length === 0 || trimmed.startsWith('#')) continue
        const eq = trimmed.indexOf('=')
        if (eq === -1) continue
        const key = trimmed.slice(0, eq).trim()
        let value = trimmed.slice(eq + 1).trim()
        if (
          (value.startsWith('"') && value.endsWith('"')) ||
          (value.startsWith("'") && value.endsWith("'"))
        ) {
          value = value.slice(1, -1)
        }
        out[key] = value
      }
    } catch {
      // archivo ausente: seguimos
    }
  }
  return out
}

const fileEnv = loadEnvLocal()
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? fileEnv.NEXT_PUBLIC_SUPABASE_URL ?? ''
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? fileEnv.SUPABASE_SERVICE_ROLE_KEY ?? ''

if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error('Faltan NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY en .env.local')
  process.exit(1)
}

const MARKER = `/storage/v1/object/public/${BUCKET}/`

type Db = SupabaseClient<Database>
const supabase: Db = createClient<Database>(SUPABASE_URL, SERVICE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
})

// ---------------------------------------------------------------------------
// Helpers de paths / clasificación
// ---------------------------------------------------------------------------

const IMAGE_EXTS = new Set(['webp', 'avif', 'jpg', 'jpeg', 'png'])
const VIDEO_SUFFIX = /_v\.[a-z0-9]+$/i
const POSTER_SUFFIX = /_vp\.[a-z0-9]+$/i
const THUMB_SUFFIX = /_t\.[a-z0-9]+$/i

function extOf(path: string): string {
  const dot = path.lastIndexOf('.')
  return dot > path.lastIndexOf('/') ? path.slice(dot + 1).toLowerCase() : ''
}

function baseOf(path: string): string {
  const dot = path.lastIndexOf('.')
  return dot > path.lastIndexOf('/') ? path.slice(0, dot) : path
}

function pathFromPublicUrl(url: string): string | null {
  const idx = url.indexOf(MARKER)
  if (idx === -1) return null
  const path = url.slice(idx + MARKER.length).split('?')[0]
  return path && path.length > 0 ? path : null
}

function publicUrlFor(path: string): string {
  return `${SUPABASE_URL.replace(/\/$/, '')}${MARKER}${path}`
}

const isDerived = (p: string): boolean =>
  THUMB_SUFFIX.test(p) || POSTER_SUFFIX.test(p) || VIDEO_SUFFIX.test(p)

const isBaseImage = (p: string): boolean => !isDerived(p) && IMAGE_EXTS.has(extOf(p))

// ---------------------------------------------------------------------------
// Listado completo del bucket (top-level = carpetas por tenant, con paginación)
// ---------------------------------------------------------------------------

async function listAllPaths(): Promise<string[]> {
  const paths: string[] = []
  const queue: string[] = ['']
  while (queue.length > 0) {
    const prefix = queue.shift() as string
    let offset = 0
    for (;;) {
      const { data, error } = await supabase.storage.from(BUCKET).list(prefix, {
        limit: 1000,
        offset,
        sortBy: { column: 'name', order: 'asc' },
      })
      if (error) throw new Error(`storage.list('${prefix}') falló: ${error.message}`)
      if (!data || data.length === 0) break
      for (const entry of data) {
        const full = prefix ? `${prefix}/${entry.name}` : entry.name
        // Las carpetas vienen sin id (objetos virtuales) → recursar.
        if (entry.id === null || entry.id === undefined) queue.push(full)
        else paths.push(full)
      }
      if (data.length < 1000) break
      offset += data.length
    }
  }
  return paths
}

// ---------------------------------------------------------------------------
// Encode: mismo formato que el base (regla de la convención `_t`)
// ---------------------------------------------------------------------------

type Encoded = { buffer: Buffer; contentType: string }

async function encodeResized(
  input: Buffer,
  ext: string,
  maxDimension: number,
): Promise<Encoded | null> {
  const pipeline = sharp(input).rotate().resize({
    width: maxDimension,
    height: maxDimension,
    fit: 'inside',
    withoutEnlargement: true,
  })
  switch (ext) {
    case 'webp':
      return { buffer: await pipeline.webp({ quality: 80 }).toBuffer(), contentType: 'image/webp' }
    case 'jpg':
    case 'jpeg':
      return { buffer: await pipeline.jpeg({ quality: 80 }).toBuffer(), contentType: 'image/jpeg' }
    case 'avif':
      return { buffer: await pipeline.avif({ quality: 60 }).toBuffer(), contentType: 'image/avif' }
    default:
      return null
  }
}

async function download(path: string): Promise<Buffer> {
  const { data, error } = await supabase.storage.from(BUCKET).download(path)
  if (error || !data) throw new Error(`download('${path}') falló: ${error?.message ?? 'sin data'}`)
  return Buffer.from(await data.arrayBuffer())
}

async function upload(path: string, encoded: Encoded): Promise<void> {
  const { error } = await supabase.storage.from(BUCKET).upload(path, encoded.buffer, {
    contentType: encoded.contentType,
    cacheControl: CACHE_CONTROL,
    upsert: true,
  })
  if (error) throw new Error(`upload('${path}') falló: ${error.message}`)
}

// ---------------------------------------------------------------------------
// PNG: caso especial. El thumb debe conservar la ext del base (thumbUrlFor),
// pero un `_t.png` pesaría demasiado. Regla: regeneramos el FULL como webp en
// un path nuevo, su `_t.webp`, y repuntamos la fila de DB que referencia al
// png. (Los 66 objetos actuales son todos webp — esto es red de seguridad.)
// ---------------------------------------------------------------------------

const IMAGE_URL_TABLES = [
  'menu_items',
  'menu_categories',
  'rewards',
  'punch_card_templates',
] as const

async function repointImageUrl(oldUrl: string, newUrl: string): Promise<number> {
  let updated = 0
  for (const table of IMAGE_URL_TABLES) {
    const { data, error } = await supabase
      .from(table)
      .update({ image_url: newUrl })
      .eq('image_url', oldUrl)
      .select('id')
    if (error) throw new Error(`update ${table}.image_url falló: ${error.message}`)
    updated += data?.length ?? 0
  }
  return updated
}

async function migratePng(path: string): Promise<void> {
  const tenantFolder = path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : ''
  const stamp = Date.now().toString(36)
  const rand = Math.random().toString(36).slice(2, 10)
  const newBase = tenantFolder ? `${tenantFolder}/${stamp}_${rand}` : `${stamp}_${rand}`
  const fullPath = `${newBase}.webp`
  const thumbPath = `${newBase}_t.webp`

  if (!APPLY) {
    console.log(`  [dry-run] png → regeneraría ${fullPath} + ${thumbPath} y repuntaría la DB`)
    return
  }

  const original = await download(path)
  const full = await encodeResized(original, 'webp', FULL_DIMENSION)
  const thumb = await encodeResized(original, 'webp', THUMB_DIMENSION)
  if (!full || !thumb) throw new Error(`no se pudo encodear ${path} a webp`)
  await upload(fullPath, full)
  await upload(thumbPath, thumb)
  const updated = await repointImageUrl(publicUrlFor(path), publicUrlFor(fullPath))
  console.log(`  png migrado → ${fullPath} (${updated} fila(s) de DB repuntadas)`)
  if (updated === 0) {
    console.warn(`  ⚠ ${path}: ninguna fila referenciaba este png — queda como huérfano`)
  }
}

// ---------------------------------------------------------------------------
// Huérfanos: objetos sin referencia en la DB (ignorando derivados de bases
// referenciadas: _t de imágenes y _vp de videos).
// ---------------------------------------------------------------------------

async function collectReferencedPaths(): Promise<Set<string>> {
  const referenced = new Set<string>()
  const add = (url: string | null) => {
    if (!url) return
    const p = pathFromPublicUrl(url)
    if (p) referenced.add(p)
  }

  const [items, cats, rewards, punch] = await Promise.all([
    supabase.from('menu_items').select('image_url, video_url'),
    supabase.from('menu_categories').select('image_url'),
    supabase.from('rewards').select('image_url'),
    supabase.from('punch_card_templates').select('image_url'),
  ])
  for (const q of [items, cats, rewards, punch]) {
    if (q.error) throw new Error(`select de referencias falló: ${q.error.message}`)
  }
  for (const row of items.data ?? []) {
    add(row.image_url)
    add(row.video_url)
  }
  for (const row of cats.data ?? []) add(row.image_url)
  for (const row of rewards.data ?? []) add(row.image_url)
  for (const row of punch.data ?? []) add(row.image_url)
  return referenced
}

function expectedPaths(referenced: Set<string>): Set<string> {
  const expected = new Set<string>(referenced)
  for (const p of referenced) {
    const ext = extOf(p)
    const base = baseOf(p)
    if (VIDEO_SUFFIX.test(p)) {
      // video referenciado → su poster derivado
      expected.add(`${base.slice(0, -2)}_vp.webp`)
    } else if (IMAGE_EXTS.has(ext)) {
      // imagen referenciada → su thumb derivado
      expected.add(`${base}_t.${ext}`)
    }
  }
  return expected
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  console.log(
    `Bucket: ${BUCKET} · modo: ${APPLY ? 'APPLY' : 'dry-run'}${PRUNE ? ' + prune-orphans' : ''}\n`,
  )

  const allPaths = await listAllPaths()
  const pathSet = new Set(allPaths)
  console.log(`${allPaths.length} objetos en el bucket.\n`)

  // --- 1) Thumbs faltantes -------------------------------------------------
  let generated = 0
  let skipped = 0
  let pngs = 0
  for (const path of allPaths) {
    if (!isBaseImage(path)) continue
    const ext = extOf(path)

    if (ext === 'png') {
      pngs += 1
      console.log(`PNG detectado: ${path}`)
      await migratePng(path)
      continue
    }

    const thumbPath = `${baseOf(path)}_t.${ext}`
    if (pathSet.has(thumbPath)) {
      skipped += 1
      continue
    }

    if (!APPLY) {
      console.log(`[dry-run] generaría ${thumbPath}`)
      generated += 1
      continue
    }

    try {
      const original = await download(path)
      const encoded = await encodeResized(original, ext, THUMB_DIMENSION)
      if (!encoded) {
        console.warn(`⚠ ${path}: extensión sin encoder (${ext}), salteado`)
        continue
      }
      await upload(thumbPath, encoded)
      console.log(`✓ ${thumbPath} (${(encoded.buffer.length / 1024).toFixed(0)} KB)`)
      generated += 1
    } catch (err) {
      console.error(`✗ ${path}: ${err instanceof Error ? err.message : String(err)}`)
    }
  }
  console.log(
    `\nThumbs: ${generated} ${APPLY ? 'generados' : 'a generar'} · ${skipped} ya existían · ${pngs} png(s) especiales.\n`,
  )

  // --- 2) Huérfanos (opcional) --------------------------------------------
  if (PRUNE) {
    const referenced = await collectReferencedPaths()
    const expected = expectedPaths(referenced)
    const orphans = allPaths.filter((p) => !expected.has(p) && !p.split('/').pop()?.startsWith('.'))

    if (orphans.length === 0) {
      console.log('Huérfanos: ninguno. ✨')
    } else {
      console.log(`Huérfanos (${orphans.length}) — sin referencia en la DB:`)
      for (const p of orphans) console.log(`  ${p}`)
      if (APPLY) {
        for (let i = 0; i < orphans.length; i += 100) {
          const chunk = orphans.slice(i, i + 100)
          const { error } = await supabase.storage.from(BUCKET).remove(chunk)
          if (error) throw new Error(`remove falló: ${error.message}`)
        }
        console.log(`\n${orphans.length} huérfano(s) borrados.`)
      } else {
        console.log('\n[dry-run] corré con --apply --prune-orphans para borrarlos.')
      }
    }
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err)
  process.exit(1)
})
