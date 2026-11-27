/**
 * HUB Impresoras — imprime las comandas en las comanderas que están en la red del bar (WiFi o cable).
 *
 * Pedido de Nacho (27/11/2026): tres comanderas por WiFi (cocina, barra y pizza) que impriman cada
 * pedido apenas entra, con el logo del bar y la mesa bien grande.
 *
 * El navegador no les puede hablar a esas impresoras (no abre conexiones a la red local), así que esto
 * corre en una compu del bar conectada al mismo WiFi —la de la caja sirve— y:
 *   · entra con la cuenta de la cocina del bar (la misma que usa la pantalla de cocina);
 *   · se entera al instante de cada pedido por el canal en vivo de la sucursal y, por las dudas, mira
 *     cada pocos segundos;
 *   · arma cada tique con el mismo código que la app (`lib/pos/print/*`) y se lo manda a cada impresora
 *     por su IP, en su idioma (ESC/POS, puerto 9100);
 *   · anota lo impreso en un archivo al lado del programa: no repite ni saltea, y si una impresora está
 *     apagada lo vuelve a intentar sola.
 *
 * Uso (en la carpeta donde está el archivo):
 *   node hub-impresoras.js              la primera vez configura; después, imprime
 *   node hub-impresoras.js configurar   volver a elegir cuenta, sucursal e impresoras
 *   node hub-impresoras.js buscar       buscar impresoras en la red e imprimir un número en cada una
 *   node hub-impresoras.js probar       imprimir un tique de prueba en cada impresora configurada
 *   node hub-impresoras.js instalar     que arranque solo al prender la compu
 *
 * Se arma en un solo archivo con `node scripts/hub-impresoras/build.mjs` → `public/impresoras/`.
 */
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'
import readline from 'node:readline'
import { inflateSync } from 'node:zlib'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { comandaDoc } from '@/lib/pos/print/comanda'
import { type PaperWidth, type PrintDoc, p } from '@/lib/pos/print/doc'
import { type Codepage, escposJob, type Raster } from '@/lib/pos/print/escpos'
import { decodePng } from '@/lib/pos/print/png'
import { toRaster } from '@/lib/pos/print/raster'
import { sampleCard } from '@/lib/pos/print/sample'
import {
  comandaDocs,
  type DuePrint,
  duePrints,
  type PrintedLog,
  type PrinterSettings,
  parsePrinted,
  rememberPrinted,
} from '@/lib/pos/print/station'
import type { KitchenQueue, MenuStation } from '@/lib/pos/types'

declare const __HUB_SUPABASE_URL__: string | undefined
declare const __HUB_SUPABASE_ANON_KEY__: string | undefined
declare const __HUB_APP_URL__: string | undefined
declare const __HUB_VERSION__: string | undefined

const SUPABASE_URL =
  typeof __HUB_SUPABASE_URL__ !== 'undefined'
    ? __HUB_SUPABASE_URL__
    : process.env.NEXT_PUBLIC_SUPABASE_URL
const SUPABASE_ANON_KEY =
  typeof __HUB_SUPABASE_ANON_KEY__ !== 'undefined'
    ? __HUB_SUPABASE_ANON_KEY__
    : process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
const APP_URL =
  (typeof __HUB_APP_URL__ !== 'undefined' ? __HUB_APP_URL__ : process.env.HUB_APP_URL) ??
  'http://localhost:3000'
const VERSION = typeof __HUB_VERSION__ !== 'undefined' ? __HUB_VERSION__ : 'desarrollo'

const PRINTER_PORT = 9100
/** Una comanda que salió hace más de esto ya no se imprime (al volver de un apagón largo, por ejemplo). */
const MAX_AGE_MS = 3 * 60 * 60_000
/** Cada cuánto se mira la cocina aunque no haya llegado ningún aviso. */
const POLL_LIVE_MS = 15_000
const POLL_ALONE_MS = 4_000

// ─── Archivos al lado del programa ───────────────────────────────────────────

const HOME = path.dirname(path.resolve(process.argv[1] ?? '.'))
const CONFIG_FILE = path.join(HOME, 'hub-impresoras.json')
const PRINTED_FILE = path.join(HOME, 'hub-impresoras-impresos.json')

type PrinterConfig = {
  id: string
  /** Lo que imprime, para mostrar: «Cocina + Plancha». */
  name: string
  host: string
  port: number
  stations: string[]
  /** Un tique aparte por estación (la cocina con dos sectores). */
  split: boolean
  copies: 1 | 2
  paper: PaperWidth
  /** Desde cuándo imprime (hora del servidor, ms). */
  since: number
}

type AgentConfig = {
  version: 1
  tenant: { id: string; slug: string; name: string; logoUrl: string | null; timeZone: string }
  branch: { id: string; name: string }
  codepage: Codepage
  printers: PrinterConfig[]
  /** La sesión de la cuenta de la cocina (la guarda y la renueva la librería de Supabase). */
  auth: Record<string, string>
}

function readJson(file: string): unknown {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'))
  } catch {
    return null
  }
}

/** Escribe sin dejar el archivo a medias si se corta la luz justo ahí. */
function writeJson(file: string, value: unknown) {
  const temp = `${file}.tmp`
  fs.writeFileSync(temp, JSON.stringify(value, null, 2), { mode: 0o600 })
  fs.renameSync(temp, file)
}

function readConfig(): AgentConfig | null {
  const value = readJson(CONFIG_FILE) as Partial<AgentConfig> | null
  if (!value || value.version !== 1 || !value.tenant || !value.branch) return null
  return {
    version: 1,
    tenant: value.tenant,
    branch: value.branch,
    codepage: value.codepage === 'ascii' ? 'ascii' : 'cp850',
    printers: Array.isArray(value.printers) ? value.printers : [],
    auth: value.auth ?? {},
  }
}

/** La sesión vive en el mismo archivo de la configuración. */
let authStore: Record<string, string> = (readJson(CONFIG_FILE) as AgentConfig | null)?.auth ?? {}

function saveAuth() {
  const current = (readJson(CONFIG_FILE) as Record<string, unknown> | null) ?? {}
  writeJson(CONFIG_FILE, { ...current, auth: authStore })
}

function saveConfig(config: AgentConfig) {
  writeJson(CONFIG_FILE, { ...config, auth: authStore })
}

// ─── Lo que se ve en la ventana ──────────────────────────────────────────────

const clock = () =>
  new Intl.DateTimeFormat('es-AR', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).format(new Date())

function say(message: string) {
  console.log(`[${clock()}] ${message}`)
}

/** El mismo problema una vez por minuto alcanza (una impresora apagada falla en cada vuelta). */
const lastComplaint = new Map<string, number>()
function complain(key: string, message: string) {
  const now = Date.now()
  if (now - (lastComplaint.get(key) ?? 0) < 60_000) return
  lastComplaint.set(key, now)
  say(`⚠ ${message}`)
}

// ─── Preguntas en la terminal ────────────────────────────────────────────────

function ask(question: string): Promise<string> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout })
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close()
      resolve(answer.trim())
    })
  })
}

/** La contraseña, sin que se vea en la pantalla. */
function askHidden(question: string): Promise<string> {
  const stdin = process.stdin
  if (!stdin.isTTY) return ask(question)
  process.stdout.write(question)
  return new Promise((resolve) => {
    let value = ''
    stdin.setRawMode(true)
    stdin.resume()
    stdin.setEncoding('utf8')
    const onData = (chunk: string) => {
      for (const char of chunk) {
        if (char === '\r' || char === '\n') {
          stdin.setRawMode(false)
          stdin.pause()
          stdin.off('data', onData)
          process.stdout.write('\n')
          resolve(value)
          return
        }
        if (char === '\u0003') process.exit(1)
        if (char === '\u007f' || char === '\b') value = value.slice(0, -1)
        else value += char
      }
    }
    stdin.on('data', onData)
  })
}

async function yes(question: string, byDefault = true): Promise<boolean> {
  const answer = (await ask(`${question} ${byDefault ? '[S/n]' : '[s/N]'} `)).toLowerCase()
  if (!answer) return byDefault
  return answer.startsWith('s') || answer.startsWith('y')
}

async function choose<T>(question: string, options: readonly T[], label: (o: T) => string) {
  if (options.length === 1) return options[0] as T
  console.log(question)
  for (const [index, option] of options.entries()) console.log(`  ${index + 1}) ${label(option)}`)
  for (;;) {
    const answer = Number(await ask('Número: '))
    const picked = options[answer - 1]
    if (Number.isInteger(answer) && picked !== undefined) return picked
    console.log('Escribí uno de los números de la lista.')
  }
}

// ─── La red: buscar impresoras y mandarles bytes ─────────────────────────────

/** ¿Hay algo escuchando en ese puerto? (Las térmicas en red atienden en el 9100.) */
function probe(host: string, port: number, timeoutMs: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = net.createConnection({ host, port })
    const done = (open: boolean) => {
      socket.destroy()
      resolve(open)
    }
    socket.setTimeout(timeoutMs, () => done(false))
    socket.once('connect', () => done(true))
    socket.once('error', () => done(false))
  })
}

/** Las redes de esta compu (las de tipo casa u oficina: 192.168.x.x, 10.x.x.x, 172.16–31.x.x). */
function localNetworks(): { prefix: string; self: string }[] {
  const out: { prefix: string; self: string }[] = []
  for (const list of Object.values(os.networkInterfaces())) {
    for (const entry of list ?? []) {
      if (entry.family !== 'IPv4' || entry.internal) continue
      const parts = entry.address.split('.')
      if (parts.length !== 4) continue
      const [a, b] = parts.map(Number) as [number, number]
      const privateNet = a === 10 || (a === 192 && b === 168) || (a === 172 && b >= 16 && b <= 31)
      if (!privateNet) continue
      const prefix = parts.slice(0, 3).join('.')
      if (!out.some((known) => known.prefix === prefix)) out.push({ prefix, self: entry.address })
    }
  }
  return out
}

async function scanNetwork(): Promise<string[]> {
  const hosts: string[] = []
  for (const { prefix, self } of localNetworks()) {
    for (let last = 1; last <= 254; last++) {
      const host = `${prefix}.${last}`
      if (host !== self) hosts.push(host)
    }
  }
  const found: string[] = []
  const queue = [...hosts]
  const worker = async () => {
    for (let host = queue.shift(); host !== undefined; host = queue.shift()) {
      if (await probe(host, PRINTER_PORT, 700)) found.push(host)
    }
  }
  await Promise.all(Array.from({ length: 64 }, worker))
  return found.sort((a, b) => Number(a.split('.').pop()) - Number(b.split('.').pop()))
}

/**
 * Manda un trabajo a una impresora. Resuelve cuando los bytes salieron de esta compu (si la impresora
 * no tiene papel, eso no se puede saber por acá: se ve en la pantalla de cocina que el pedido entró).
 */
function sendBytes(host: string, port: number, bytes: Uint8Array): Promise<void> {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection({ host, port })
    let finished = false
    const fail = (error: Error) => {
      if (finished) return
      finished = true
      socket.destroy()
      reject(error)
    }
    socket.setTimeout(6000, () => fail(new Error('no contesta')))
    socket.once('error', (error) => fail(error))
    socket.once('connect', () => {
      socket.write(Buffer.from(bytes), (error) => {
        if (error) return fail(error)
        socket.end()
        finished = true
        resolve()
        // Algunas impresoras no cierran su lado: a los pocos segundos se suelta igual.
        setTimeout(() => socket.destroy(), 3000).unref()
      })
    })
  })
}

/** De a un trabajo por impresora: algunas atienden una sola conexión a la vez. */
const printerTurns = new Map<string, Promise<unknown>>()
function inTurn(printerId: string, task: () => Promise<void>): Promise<void> {
  const previous = printerTurns.get(printerId) ?? Promise.resolve()
  const next = previous.catch(() => undefined).then(task)
  printerTurns.set(printerId, next)
  return next
}

// ─── La cuenta y los datos del bar ───────────────────────────────────────────

function supabaseClient(): SupabaseClient {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    throw new Error(
      'Este programa no sabe a qué servidor conectarse. Bajalo de nuevo desde el panel.',
    )
  }
  return createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: false,
      storage: {
        getItem: (key) => authStore[key] ?? null,
        setItem: (key, value) => {
          authStore = { ...authStore, [key]: value }
          saveAuth()
        },
        removeItem: (key) => {
          const { [key]: _gone, ...rest } = authStore
          authStore = rest
          saveAuth()
        },
      },
    },
  })
}

async function readQueue(supabase: SupabaseClient, branchId: string): Promise<KitchenQueue> {
  const { data, error } = await supabase.rpc('pos_kitchen_queue', { p_branch_id: branchId })
  if (error) throw new Error(error.message || error.code || 'error')
  return data as KitchenQueue
}

/** El logo del bar, en puntos para cada ancho de rollo. Sin logo (o si no se puede leer), sin logo. */
async function loadLogo(logoUrl: string | null): Promise<Record<PaperWidth, Raster | null>> {
  const none = { 80: null, 58: null }
  if (!logoUrl) return none
  try {
    const url = new URL(logoUrl, APP_URL)
    const response = await fetch(url, { signal: AbortSignal.timeout(15_000) })
    if (!response.ok) throw new Error(String(response.status))
    const image = decodePng(new Uint8Array(await response.arrayBuffer()), (data) =>
      Uint8Array.from(inflateSync(data)),
    )
    return { 80: toRaster(image, 320, 150), 58: toRaster(image, 240, 110) }
  } catch {
    say('No pude leer el logo del bar (tiene que ser un PNG). Los tiques salen sin logo.')
    return none
  }
}

// ─── Tiques de prueba ────────────────────────────────────────────────────────

function identifyDoc(number: number, host: string): PrintDoc {
  return {
    title: `Impresora ${number}`,
    lines: [
      { kind: 'logo' },
      p.banner('HUB Impresoras'),
      { kind: 'hero', caption: 'Impresora', text: String(number) },
      p.center(host, { size: 'lg', bold: true }),
      p.space(),
      p.center('Anotá el número: el programa te va a preguntar qué imprime cada una.'),
      p.rule('solid'),
    ],
  }
}

function testDoc(printer: PrinterConfig, config: AgentConfig): PrintDoc {
  const doc = comandaDoc(sampleCard(config.branch.name, new Date()), {
    branch: config.branch.name,
    timeZone: config.tenant.timeZone,
    stationLabel: printer.name,
  })
  return {
    ...doc,
    lines: [
      ...doc.lines,
      p.center('Tique de prueba · HUB Impresoras', { size: 'sm', bold: true }),
      p.center('Tildes: á é í ó ú ñ Ñ ¿ ¡ «»', { size: 'sm' }),
    ],
  }
}

// ─── Configurar ──────────────────────────────────────────────────────────────

async function login(supabase: SupabaseClient): Promise<string> {
  const { data } = await supabase.auth.getSession()
  if (data.session && (await yes(`Ya hay una cuenta conectada. ¿La sigo usando?`))) {
    return data.session.user.id
  }
  console.log('\nEntrá con la cuenta de la COCINA del bar (la misma de la pantalla de cocina).')
  for (;;) {
    const email = await ask('Mail: ')
    const password = await askHidden('Contraseña: ')
    const { data: signed, error } = await supabase.auth.signInWithPassword({ email, password })
    if (!error && signed.user) return signed.user.id
    console.log('No pude entrar con esos datos. Probá de nuevo.')
  }
}

type TenantRow = {
  id: string
  slug: string
  name: string
  logo_url: string | null
  timezone: string | null
}

async function configure(existing: AgentConfig | null): Promise<AgentConfig> {
  console.log(`\nHUB Impresoras ${VERSION} · configuración\n`)
  const supabase = supabaseClient()
  const userId = await login(supabase)

  const { data: memberships, error: memberError } = await supabase
    .from('memberships')
    .select('role, tenants(id, slug, name, logo_url, timezone)')
    .eq('user_id', userId)
  if (memberError) throw new Error(`No pude leer los bares de la cuenta: ${memberError.message}`)
  const tenants = (memberships ?? [])
    .map((row) => (row as { tenants: TenantRow | TenantRow[] | null }).tenants)
    .map((tenant) => (Array.isArray(tenant) ? tenant[0] : tenant))
    .filter((tenant): tenant is TenantRow => Boolean(tenant))
  if (tenants.length === 0) throw new Error('Esa cuenta no es parte de ningún bar.')
  const tenant = await choose('\n¿De qué bar?', tenants, (t) => t.name)

  const { data: branches, error: branchError } = await supabase
    .from('branches')
    .select('id, name, is_default')
    .eq('tenant_id', tenant.id)
    .order('is_default', { ascending: false })
    .order('name', { ascending: true })
  if (branchError) throw new Error(`No pude leer las sucursales: ${branchError.message}`)
  const branch = await choose(
    '\n¿En qué sucursal están estas impresoras?',
    (branches ?? []) as { id: string; name: string }[],
    (b) => b.name,
  )
  if (!branch) throw new Error('El bar no tiene sucursales.')

  let queue: KitchenQueue
  try {
    queue = await readQueue(supabase, branch.id)
  } catch (error) {
    throw new Error(
      `Esta cuenta no puede ver la cocina de ${branch.name} (${error instanceof Error ? error.message : 'error'}). Usá la cuenta de la cocina o la de un dueño.`,
    )
  }
  const stations: MenuStation[] = queue.stations
  if (stations.length === 0) {
    throw new Error('El bar no tiene estaciones. Armalas en Carta › Cocina y aclaraciones.')
  }

  const config: AgentConfig = {
    version: 1,
    tenant: {
      id: tenant.id,
      slug: tenant.slug,
      name: tenant.name,
      logoUrl: tenant.logo_url,
      timeZone: tenant.timezone || 'America/Argentina/Cordoba',
    },
    branch: { id: branch.id, name: branch.name },
    codepage: existing?.codepage ?? 'cp850',
    printers: [],
    auth: authStore,
  }
  const logo = await loadLogo(config.tenant.logoUrl)

  console.log('\nBuscando impresoras en la red… (unos segundos)')
  let hosts = await scanNetwork()
  if (hosts.length === 0) {
    console.log(
      'No encontré ninguna. Fijate que estén prendidas y en el mismo WiFi que esta compu.',
    )
  } else {
    console.log(
      `Encontré ${hosts.length}. Imprimo un número en cada una para que sepas cuál es cuál.`,
    )
    for (const [index, host] of hosts.entries()) {
      try {
        await sendBytes(
          host,
          PRINTER_PORT,
          escposJob(
            { paper: 80, docs: [identifyDoc(index + 1, host)] },
            { codepage: config.codepage, logo: logo[80] },
          ),
        )
        console.log(`  ${index + 1}) ${host} ✓`)
      } catch {
        console.log(`  ${index + 1}) ${host} — no aceptó el tique (puede no ser una impresora)`)
      }
    }
  }
  const extra = await ask(
    '\nSi alguna no apareció, escribí su IP (varias separadas por coma), o Enter para seguir: ',
  )
  for (const host of extra.split(',').map((value) => value.trim())) {
    if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host) && !hosts.includes(host)) hosts = [...hosts, host]
  }

  const paper: PaperWidth = (await yes('\n¿El rollo es de 80 mm?')) ? 80 : 58
  const legend = stations.map((station, index) => `${index + 1}) ${station.name}`).join('   ')
  const now = Date.parse(queue.now) || Date.now()
  for (const [index, host] of hosts.entries()) {
    console.log(`\nImpresora ${index + 1} (${host}). Estaciones: ${legend}`)
    const answer = await ask(
      '¿Qué imprime? Números separados por coma (por ejemplo «1,4»), o Enter si no la usamos: ',
    )
    const picked = [
      ...new Set(
        answer
          .split(/[,\s]+/)
          .map((value) => stations[Number(value) - 1])
          .filter((station): station is MenuStation => Boolean(station)),
      ),
    ]
    if (picked.length === 0) continue
    const split = picked.length > 1 ? await yes('¿Un tique aparte por estación?') : false
    config.printers.push({
      id: `p${index + 1}-${host}`,
      name: picked.map((station) => station.name).join(' + '),
      host,
      port: PRINTER_PORT,
      stations: picked.map((station) => station.id),
      split,
      copies: 1,
      paper,
      since: now,
    })
  }
  if (config.printers.length === 0) throw new Error('No elegiste ninguna impresora.')

  saveConfig(config)
  console.log('\nImprimo un tique de prueba en cada una…')
  await printTests(config)
  if (!(await yes('¿Se ven bien las tildes (á, é, ñ) en los tiques de prueba?'))) {
    config.codepage = 'ascii'
    saveConfig(config)
    console.log('Listo: imprimo sin tildes. Va otra prueba.')
    await printTests(config)
  }
  console.log('\nConfiguración guardada en', CONFIG_FILE)
  return config
}

async function printTests(config: AgentConfig) {
  const logo = await loadLogo(config.tenant.logoUrl)
  for (const printer of config.printers) {
    try {
      await sendBytes(
        printer.host,
        printer.port,
        escposJob(
          { paper: printer.paper, docs: [testDoc(printer, config)] },
          { codepage: config.codepage, logo: logo[printer.paper] },
        ),
      )
      console.log(`  ${printer.name} (${printer.host}) ✓`)
    } catch (error) {
      console.log(
        `  ${printer.name} (${printer.host}) ✗ ${error instanceof Error ? error.message : ''}`,
      )
    }
  }
}

// ─── Imprimir ────────────────────────────────────────────────────────────────

function settingsOf(printer: PrinterConfig): PrinterSettings {
  return {
    auto: true,
    paper: printer.paper,
    stations: printer.stations,
    splitByStation: printer.split,
    copies: printer.copies,
    since: printer.since,
    receiptOnCharge: false,
  }
}

async function run(config: AgentConfig) {
  const supabase = supabaseClient()
  const { data } = await supabase.auth.getSession()
  if (!data.session) {
    throw new Error('La cuenta se desconectó. Corré: node hub-impresoras.js configurar')
  }
  const logo = await loadLogo(config.tenant.logoUrl)
  const printed: Record<string, PrintedLog> = {}
  const saved = readJson(PRINTED_FILE) as Record<string, unknown> | null
  for (const printer of config.printers) printed[printer.id] = parsePrinted(saved?.[printer.id])
  const savePrinted = () => writeJson(PRINTED_FILE, printed)

  console.log(`\nHUB Impresoras ${VERSION} · ${config.tenant.name} · ${config.branch.name}`)
  for (const printer of config.printers) console.log(`  ${printer.name} → ${printer.host}`)
  console.log('Dejá esta ventana abierta (podés minimizarla). Para cortar: Ctrl+C.\n')

  async function printFor(printer: PrinterConfig, queue: KitchenQueue) {
    const serverNow = Date.parse(queue.now) || Date.now()
    const log = printed[printer.id] ?? {}
    const due = duePrints(queue, settingsOf(printer), log).filter(
      (entry: DuePrint) => serverNow - entry.card.firedMs <= MAX_AGE_MS,
    )
    if (due.length === 0) return
    // Se anota ANTES de mandar: si el programa se corta en el medio, no sale dos veces.
    printed[printer.id] = rememberPrinted(
      log,
      due.map((entry) => entry.key),
      Date.now(),
    )
    savePrinted()
    const bytes = escposJob(
      {
        paper: printer.paper,
        docs: comandaDocs(due, {
          branch: queue.branch.name,
          timeZone: config.tenant.timeZone,
          copies: printer.copies,
        }),
      },
      { codepage: config.codepage, logo: logo[printer.paper] },
    )
    try {
      await inTurn(printer.id, () => sendBytes(printer.host, printer.port, bytes))
      for (const entry of due) {
        const where =
          entry.card.titleFit === 'small' ? entry.card.title : `Mesa ${entry.card.title}`
        say(`${where} → ${entry.stationLabel ?? printer.name} ✓`)
      }
    } catch (error) {
      // No salió: se desanota y en la próxima vuelta se intenta de nuevo.
      const current = printed[printer.id] ?? {}
      for (const entry of due) delete current[entry.key]
      printed[printer.id] = current
      savePrinted()
      complain(
        printer.id,
        `No pude imprimir en ${printer.name} (${printer.host}): ${error instanceof Error ? error.message : 'error'}. ¿Está prendida y en el WiFi? Lo reintento solo.`,
      )
    }
  }

  let reading = false
  let again = false
  let lastRead = 0
  const read = async () => {
    if (reading) {
      again = true
      return
    }
    reading = true
    try {
      do {
        again = false
        try {
          const queue = await readQueue(supabase, config.branch.id)
          lastRead = Date.now()
          await Promise.all(config.printers.map((printer) => printFor(printer, queue)))
        } catch (error) {
          const message = error instanceof Error ? error.message : 'error'
          complain(
            'lectura',
            /jwt|token|auth|401/i.test(message)
              ? 'La cuenta se desconectó (¿le cambiaron la contraseña?). Corré: node hub-impresoras.js configurar'
              : `No pude leer la cocina (${message}). ¿Hay internet? Lo reintento solo.`,
          )
        }
      } while (again)
    } finally {
      reading = false
    }
  }

  // El aviso en vivo: cuando sale un pedido, se lee al instante.
  let live = false
  try {
    const token = data.session.access_token
    await supabase.realtime.setAuth(token)
    supabase
      .channel(`pos:${config.branch.id}`, { config: { private: true } })
      .on('broadcast', { event: 'poke' }, (message) => {
        const what = (message.payload as { what?: string } | undefined)?.what
        if (!what || what === 'kitchen' || what === 'floor') void read()
      })
      .subscribe((status) => {
        const wasLive = live
        live = status === 'SUBSCRIBED'
        if (live && !wasLive) say('Conectado en vivo: cada pedido sale al instante.')
        if (!live && wasLive) say('Se cortó el aviso en vivo: miro la cocina cada 4 segundos.')
      })
  } catch {
    say('Sin aviso en vivo en esta compu: miro la cocina cada 4 segundos.')
  }

  const tick = async () => {
    await read()
    setTimeout(tick, live ? POLL_LIVE_MS : POLL_ALONE_MS)
  }
  void tick()

  setInterval(() => {
    const ago = lastRead ? Math.round((Date.now() - lastRead) / 1000) : null
    say(
      `Sigo andando. Última lectura de la cocina: ${ago === null ? 'todavía no' : `hace ${ago} s`}.`,
    )
  }, 30 * 60_000)
}

// ─── Que arranque solo ───────────────────────────────────────────────────────

function install() {
  const script = path.resolve(process.argv[1] ?? '')
  if (process.platform === 'win32') {
    const startup = path.join(
      process.env.APPDATA ?? '',
      'Microsoft',
      'Windows',
      'Start Menu',
      'Programs',
      'Startup',
    )
    const file = path.join(startup, 'HUB Impresoras.cmd')
    // Si el programa se cierra por algo, vuelve a arrancar a los 5 segundos.
    fs.writeFileSync(
      file,
      [
        '@echo off',
        'chcp 65001 >nul',
        'title HUB Impresoras',
        `cd /d "${HOME}"`,
        ':otra',
        `"${process.execPath}" "${script}"`,
        'timeout /t 5 >nul',
        'goto otra',
        '',
      ].join('\r\n'),
    )
    console.log(`Listo: arranca solo al prender la compu.\n(${file})`)
    return
  }
  if (process.platform === 'darwin') {
    const label = 'app.hub-impresoras'
    const file = path.join(os.homedir(), 'Library', 'LaunchAgents', `${label}.plist`)
    const logFile = path.join(HOME, 'hub-impresoras.log')
    fs.mkdirSync(path.dirname(file), { recursive: true })
    fs.writeFileSync(
      file,
      `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>${label}</string>
  <key>ProgramArguments</key><array><string>${process.execPath}</string><string>${script}</string></array>
  <key>WorkingDirectory</key><string>${HOME}</string>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>StandardOutPath</key><string>${logFile}</string>
  <key>StandardErrorPath</key><string>${logFile}</string>
</dict></plist>
`,
    )
    spawnSync('launchctl', ['unload', file], { stdio: 'ignore' })
    spawnSync('launchctl', ['load', '-w', file], { stdio: 'inherit' })
    console.log(`Listo: queda andando y arranca solo al prender la Mac. Lo que hace: ${logFile}`)
    return
  }
  console.log(
    'En esta compu, agregalo al arranque a mano (por ejemplo, un servicio de systemd que corra:',
  )
  console.log(`  ${process.execPath} ${script}`)
}

// ─── Arranque ────────────────────────────────────────────────────────────────

async function main() {
  const command = (process.argv[2] ?? '').toLowerCase()
  if (command === 'ayuda' || command === '--help' || command === '-h') {
    console.log(
      'node hub-impresoras.js [configurar | buscar | probar | instalar]\nSin nada: imprime (la primera vez, configura).',
    )
    return
  }
  if (command === 'instalar') return install()

  let config = readConfig()
  if (command === 'buscar') {
    console.log('Buscando impresoras en la red…')
    const hosts = await scanNetwork()
    const logo = await loadLogo(config?.tenant.logoUrl ?? null)
    for (const [index, host] of hosts.entries()) {
      try {
        await sendBytes(
          host,
          PRINTER_PORT,
          escposJob(
            { paper: 80, docs: [identifyDoc(index + 1, host)] },
            { codepage: config?.codepage ?? 'cp850', logo: logo[80] },
          ),
        )
        console.log(`  ${index + 1}) ${host} ✓`)
      } catch {
        console.log(`  ${index + 1}) ${host} — no aceptó el tique`)
      }
    }
    if (hosts.length === 0) console.log('No encontré ninguna impresora en la red de esta compu.')
    return
  }
  if (command === 'configurar' || !config) config = await configure(config)
  if (command === 'probar') {
    await printTests(config)
    return
  }
  await run(config)
}

main().catch((error) => {
  console.error(`\n✗ ${error instanceof Error ? error.message : String(error)}`)
  process.exitCode = 1
})
