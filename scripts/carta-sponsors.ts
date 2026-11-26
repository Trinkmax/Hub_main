/**
 * Carga los sponsors de la carta de un bar (`tenants.settings.carta_sponsors`, ver
 * `lib/menu/sponsors.ts` y `docs/carta-unica.md`).
 *
 * Mientras no haya una pantalla para que el dueño los cargue, se cargan por soporte con este script.
 * De cada logo arma un **sello**: lo recorta a su dibujo y lo deja en una sola tinta sobre transparente,
 * que es lo que la carta necesita para pintarlo del color que quiera (`mask-image`). Sirve un logo con
 * fondo transparente (se usa su forma) o con fondo liso (se usa lo que contrasta con el fondo).
 *
 * Uso (NUNCA toca nada sin --apply):
 *   npx tsx scripts/carta-sponsors.ts <slug-del-bar> <lista.json>           # ensayo: dice qué haría
 *   npx tsx scripts/carta-sponsors.ts <slug-del-bar> <lista.json> --apply   # sube los sellos y guarda
 *   npx tsx scripts/carta-sponsors.ts <slug-del-bar> --clear --apply        # los saca de la carta
 *   … --out <carpeta>   # además deja los sellos en esa carpeta, para mirarlos antes de subirlos
 *
 * `lista.json` (las rutas de `file` son relativas a ese archivo), en el orden en que se muestran:
 *   [{ "name": "Fernet Branca", "file": "branca.png", "keywords": ["branca"] }, …]
 * `keywords`: palabras que, si un producto las nombra, hacen que su ficha muestre la marca.
 *
 * Script admin: usa SUPABASE_SERVICE_ROLE_KEY de .env, siempre contra UN bar (el del slug).
 * Los sellos viejos no se borran: quedan en Storage sin uso (`backfill-menu-media --prune-orphans`).
 */

import { createHash } from 'node:crypto'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { createClient } from '@supabase/supabase-js'
import sharp from 'sharp'
import { slugify } from '../lib/menu/carta'
import { parseCartaSponsors, type StoredSponsor } from '../lib/menu/sponsors-schema'
import type { Database, Json } from '../types/database'

const BUCKET = 'menu-images'
const CACHE_CONTROL = '31536000'
/** El lado mayor del sello. En la carta se ven a lo sumo a ~200 px de ancho: alcanza para pantallas 3x. */
const LONG_SIDE = 640

const args = process.argv.slice(2)
const APPLY = args.includes('--apply')
const CLEAR = args.includes('--clear')
const outIndex = args.indexOf('--out')
const OUT_DIR = outIndex === -1 ? null : (args[outIndex + 1] ?? null)
const [tenantSlug, listPath] = args.filter(
  (arg, index) => !arg.startsWith('--') && (outIndex === -1 || index !== outIndex + 1),
)

function loadEnv(): Record<string, string> {
  const out: Record<string, string> = {}
  // Este repo usa .env (no .env.local); probamos ambos, .env.local gana.
  for (const file of ['.env', '.env.local']) {
    try {
      for (const line of readFileSync(resolve(process.cwd(), file), 'utf8').split('\n')) {
        const trimmed = line.trim()
        if (trimmed.length === 0 || trimmed.startsWith('#')) continue
        const eq = trimmed.indexOf('=')
        if (eq === -1) continue
        out[trimmed.slice(0, eq).trim()] = trimmed
          .slice(eq + 1)
          .trim()
          .replace(/^(['"])(.*)\1$/, '$2')
      }
    } catch {
      // archivo ausente: seguimos
    }
  }
  return out
}

const fileEnv = loadEnv()
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? fileEnv.NEXT_PUBLIC_SUPABASE_URL ?? ''
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? fileEnv.SUPABASE_SERVICE_ROLE_KEY ?? ''

type Entry = { name: string; file: string; keywords?: string[] }

type Seal = { buffer: Buffer; ratio: number; density: number; width: number; height: number }

/**
 * El sello de un logo: su forma en un solo canal (cuánta tinta hay en cada punto), recortada al dibujo
 * y guardada como tinta negra sobre transparente.
 */
async function makeSeal(path: string): Promise<Seal> {
  const source = sharp(readFileSync(path)).ensureAlpha()
  const { data, info } = await source.raw().toBuffer({ resolveWithObject: true })
  const pixels = info.width * info.height
  const ink = Buffer.alloc(pixels)

  let transparent = 0
  for (let i = 0; i < pixels; i++) if ((data[i * 4 + 3] ?? 255) < 250) transparent++

  if (transparent > pixels * 0.02) {
    // Fondo transparente: la forma es el canal alfa.
    for (let i = 0; i < pixels; i++) ink[i] = data[i * 4 + 3] ?? 0
  } else {
    // Fondo liso: la tinta es lo que se aleja del color de las esquinas.
    const corners = [0, info.width - 1, pixels - info.width, pixels - 1]
    const background = [0, 1, 2].map(
      (channel) =>
        corners.reduce((sum, corner) => sum + (data[corner * 4 + channel] ?? 0), 0) /
        corners.length,
    )
    let farthest = 1
    const distance = new Float32Array(pixels)
    for (let i = 0; i < pixels; i++) {
      const d = Math.hypot(
        (data[i * 4] ?? 0) - (background[0] ?? 0),
        (data[i * 4 + 1] ?? 0) - (background[1] ?? 0),
        (data[i * 4 + 2] ?? 0) - (background[2] ?? 0),
      )
      distance[i] = d
      if (d > farthest) farthest = d
    }
    for (let i = 0; i < pixels; i++) {
      ink[i] = Math.round(Math.min(1, (distance[i] ?? 0) / farthest) * 255)
    }
  }

  const trimmed = await sharp(ink, { raw: { width: info.width, height: info.height, channels: 1 } })
    .trim({ background: '#000000', threshold: 8 })
    .resize({ width: LONG_SIDE, height: LONG_SIDE, fit: 'inside', withoutEnlargement: true })
    // Un solo canal a la salida: sin esto sharp devuelve tres y la forma queda hecha rayas.
    .toColourspace('b-w')
    .raw()
    .toBuffer({ resolveWithObject: true })

  const { width, height, channels } = trimmed.info
  if (channels !== 1 || trimmed.data.length !== width * height) {
    throw new Error(`El sello de ${path} no salió en un solo canal (${channels}).`)
  }
  let total = 0
  for (const value of trimmed.data) total += value
  const buffer = await sharp({
    create: { width, height, channels: 3, background: { r: 0, g: 0, b: 0 } },
  })
    .joinChannel(trimmed.data, { raw: { width, height, channels: 1 } })
    .webp({ quality: 40, alphaQuality: 100, effort: 6 })
    .toBuffer()

  return {
    buffer,
    width,
    height,
    ratio: Math.round((width / height) * 10000) / 10000,
    density: Math.round((total / (trimmed.data.length * 255)) * 10000) / 10000,
  }
}

async function main(): Promise<void> {
  if (!tenantSlug || (!listPath && !CLEAR)) {
    console.error('Uso: npx tsx scripts/carta-sponsors.ts <slug-del-bar> <lista.json> [--apply]')
    process.exit(2)
  }
  if (!SUPABASE_URL || !SERVICE_KEY) {
    console.error('Faltan NEXT_PUBLIC_SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY en .env')
    process.exit(2)
  }
  const supabase = createClient<Database>(SUPABASE_URL, SERVICE_KEY, {
    auth: { persistSession: false },
  })

  const { data: tenant, error: tenantError } = await supabase
    .from('tenants')
    .select('id, name, settings')
    .eq('slug', tenantSlug)
    .maybeSingle()
  if (tenantError || !tenant) {
    console.error(`No encontré el bar «${tenantSlug}»: ${tenantError?.message ?? 'no existe'}`)
    process.exit(1)
  }
  const settings = (tenant.settings ?? {}) as Record<string, Json>
  console.log(`Bar: ${tenant.name} (${tenantSlug}) · modo: ${APPLY ? 'APPLY' : 'ensayo'}`)
  console.log(`Hoy tiene ${parseCartaSponsors(settings).length} sponsor(s) en la carta.\n`)

  const stored: StoredSponsor[] = []
  if (!CLEAR && listPath) {
    const listFile = resolve(process.cwd(), listPath)
    const entries = JSON.parse(readFileSync(listFile, 'utf8')) as Entry[]
    for (const entry of entries) {
      const seal = await makeSeal(resolve(dirname(listFile), entry.file))
      const hash = createHash('sha256').update(seal.buffer).digest('hex').slice(0, 10)
      // El nombre lleva la huella del archivo: un logo cambiado es otra URL (la vieja se guarda un año).
      const path = `${tenant.id}/sponsors/${slugify(entry.name) || 'marca'}-${hash}.webp`
      const url = `${SUPABASE_URL}/storage/v1/object/public/${BUCKET}/${path}`
      console.log(
        `${entry.name.padEnd(18)} ${String(seal.width).padStart(4)}×${String(seal.height).padEnd(4)} ` +
          `${(seal.buffer.length / 1024).toFixed(1).padStart(5)} KB  proporción ${seal.ratio}  tinta ${seal.density}`,
      )
      if (OUT_DIR) {
        mkdirSync(OUT_DIR, { recursive: true })
        writeFileSync(resolve(OUT_DIR, `${slugify(entry.name) || 'marca'}.webp`), seal.buffer)
      }
      if (APPLY) {
        const { error } = await supabase.storage.from(BUCKET).upload(path, seal.buffer, {
          contentType: 'image/webp',
          cacheControl: CACHE_CONTROL,
          upsert: true,
        })
        if (error) throw new Error(`No se pudo subir ${path}: ${error.message}`)
      }
      stored.push({
        name: entry.name,
        logo_url: url,
        ratio: seal.ratio,
        density: seal.density,
        keywords: entry.keywords ?? [],
      })
    }
    // Lo mismo que va a leer la carta: si algo no pasa, mejor enterarse acá.
    const readable = parseCartaSponsors({ carta_sponsors: stored })
    if (readable.length !== stored.length) {
      throw new Error(`La carta leería ${readable.length} de ${stored.length}: revisá la lista.`)
    }
  }

  const next: Record<string, Json> = { ...settings }
  if (stored.length > 0) next.carta_sponsors = stored as unknown as Json
  else delete next.carta_sponsors

  if (!APPLY) {
    console.log(
      `\n[ensayo] quedarían ${stored.length} sponsor(s). Corré con --apply para guardarlo.`,
    )
    return
  }
  const { error } = await supabase.from('tenants').update({ settings: next }).eq('id', tenant.id)
  if (error) throw new Error(`No se pudo guardar: ${error.message}`)
  console.log(`\nListo: la carta de ${tenant.name} muestra ${stored.length} sponsor(s).`)
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error)
  process.exit(1)
})
