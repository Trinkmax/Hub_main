/**
 * Smoke CON RED de los web services de ARCA (WP2, diseño §2.8). No corre en CI ni
 * en los tests: se corre a mano desde la compu del dev.
 *
 *   npx tsx --conditions=react-server scripts/arca/smoke.mts [--save <carpeta>]
 *
 * Qué hace:
 * - `FEDummy` de WSFE en homologación y en producción. Es público (sin ticket) y
 *   prueba el transporte de verdad, incluido el agente solo-ECDHE: el WSFE de
 *   producción (`servicios1`) negocia DHE de 1024 bits y Node 22.20+ corta sin él.
 * - `dummy` del padrón (constancia de inscripción) en los dos ambientes, también
 *   público.
 * - Opcional: login al WSAA de **homologación** con el certificado del dev
 *   (`ARCA_SMOKE_CERT=<ruta .crt> ARCA_SMOKE_KEY=<ruta .key>`). Muestra el
 *   vencimiento y las CUIT de `relations`; nunca el token, el sign ni la clave.
 *   Ojo: el WSAA pide reusar el ticket (12 h); correrlo dos veces seguidas da
 *   `coe.alreadyAuthenticated`, y eso también prueba que el pedido llegó bien.
 *
 * Con `--save <carpeta>` guarda las respuestas de los `dummy` (no tienen datos de
 * nadie) para usarlas de fixtures. `--conditions=react-server` hace que
 * `import 'server-only'` resuelva al módulo vacío: fuera de Next el paquete tira.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { ARCA_ENVIRONMENTS, ARCA_SERVICE } from '@/lib/arca/endpoints'
import { describeArcaError } from '@/lib/arca/errors'
import { createPadron } from '@/lib/arca/padron'
import { type ArcaTransport, arcaAgent, httpsTransport } from '@/lib/arca/transport'
import { decodeTokenInfo, wsaaLogin } from '@/lib/arca/wsaa'
import { createWsfe } from '@/lib/arca/wsfe'

const args = process.argv.slice(2)
const saveIndex = args.indexOf('--save')
const saveDir = saveIndex >= 0 && args[saveIndex + 1] ? resolve(args[saveIndex + 1] ?? '.') : null
if (saveDir) mkdirSync(saveDir, { recursive: true })

/** Guarda el cuerpo de la respuesta (solo los `dummy`: no traen nada de nadie). */
function recording(label: string): ArcaTransport {
  return async (req) => {
    const res = await httpsTransport(req)
    if (saveDir) writeFileSync(join(saveDir, `${label}.xml`), res.body)
    return res
  }
}

const noAuth = async (): Promise<never> => {
  throw new Error('este smoke no usa ticket')
}

let failures = 0

async function step(name: string, run: () => Promise<string>): Promise<void> {
  const started = Date.now()
  try {
    const detail = await run()
    console.log(`OK     ${name} (${Date.now() - started} ms) ${detail}`)
  } catch (e) {
    failures++
    const view = describeArcaError(e)
    const message = e instanceof Error ? e.message : String(e)
    console.log(
      `FALLA  ${name} (${Date.now() - started} ms) ${message} → ${view.key}: ${view.title}`,
    )
  }
}

for (const env of ARCA_ENVIRONMENTS) {
  await step(`WSFE FEDummy (${env})`, async () => {
    const status = await createWsfe(recording(`wsfe-dummy-${env}`), env, noAuth).dummy()
    if (!status.ok) throw new Error('algún servidor no dio OK')
    return `AppServer=${status.appServer} DbServer=${status.dbServer} AuthServer=${status.authServer}`
  })
  await step(`Padrón dummy (${env})`, async () => {
    const status = await createPadron(recording(`padron-dummy-${env}`), env, noAuth).dummy()
    if (!status.ok) throw new Error('algún servidor no dio OK')
    return `appserver=${status.appServer} dbserver=${status.dbServer} authserver=${status.authServer}`
  })
}

const certFile = process.env.ARCA_SMOKE_CERT
const keyFile = process.env.ARCA_SMOKE_KEY
if (certFile && keyFile) {
  await step('WSAA loginCms (homologacion, wsfe)', async () => {
    const ticket = await wsaaLogin(
      httpsTransport,
      'homologacion',
      ARCA_SERVICE.wsfe,
      readFileSync(certFile, 'utf8'),
      readFileSync(keyFile, 'utf8'),
    )
    const info = decodeTokenInfo(ticket.token)
    const relations = (info?.relations ?? []).map((c) => `${c.slice(0, 2)}-…-${c.slice(-1)}`)
    return `vence ${ticket.expirationTime.toISOString()} · relations: ${relations.join(', ') || '(ninguna)'}`
  })
} else {
  console.log('—      WSAA: sin ARCA_SMOKE_CERT / ARCA_SMOKE_KEY, no se prueba el login')
}

// Las conexiones keep-alive no tienen que dejar el proceso colgado.
arcaAgent().destroy()
process.exitCode = failures > 0 ? 1 : 0
