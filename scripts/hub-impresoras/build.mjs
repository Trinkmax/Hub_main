/**
 * Arma «HUB Impresoras» en un solo archivo que corre con Node, sin instalar nada más:
 *
 *   node scripts/hub-impresoras/build.mjs
 *
 * Sale en `public/impresoras/hub-impresoras.js`, que es lo que se baja desde el panel (la hoja
 * «Comandera»). Lleva adentro la dirección del servidor y la clave pública del proyecto (las mismas
 * que viajan en cada página de la app: no son secretas) y la dirección de la app para leer el logo.
 *
 * Toma los valores de `.env` (o del entorno): NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY
 * y HUB_APP_URL (la dirección pública de la app; por defecto, la de producción).
 */
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')

function env() {
  const out = {}
  for (const file of ['.env', '.env.local']) {
    try {
      for (const line of readFileSync(resolve(root, file), 'utf8').split('\n')) {
        const match = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim())
        if (match) out[match[1]] = match[2].replace(/^["']|["']$/g, '')
      }
    } catch {
      // archivo opcional
    }
  }
  return { ...out, ...process.env }
}

const values = env()
const supabaseUrl = values.NEXT_PUBLIC_SUPABASE_URL
const anonKey = values.NEXT_PUBLIC_SUPABASE_ANON_KEY
const appUrl = values.HUB_APP_URL || 'https://www.hubbar.com.ar'
if (!supabaseUrl || !anonKey) {
  console.error('Faltan NEXT_PUBLIC_SUPABASE_URL o NEXT_PUBLIC_SUPABASE_ANON_KEY.')
  process.exit(1)
}

const version = new Date().toISOString().slice(0, 10)
await build({
  entryPoints: [resolve(root, 'scripts/hub-impresoras/main.ts')],
  outfile: resolve(root, 'public/impresoras/hub-impresoras.js'),
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node18',
  minify: true,
  legalComments: 'none',
  tsconfig: resolve(root, 'tsconfig.json'),
  banner: {
    js: `#!/usr/bin/env node\n// HUB Impresoras ${version}: imprime las comandas en las comanderas del bar por WiFi.\n// Uso: node hub-impresoras.js   (la primera vez pregunta la cuenta y busca las impresoras)`,
  },
  define: {
    __HUB_SUPABASE_URL__: JSON.stringify(supabaseUrl),
    __HUB_SUPABASE_ANON_KEY__: JSON.stringify(anonKey),
    __HUB_APP_URL__: JSON.stringify(appUrl),
    __HUB_VERSION__: JSON.stringify(version),
  },
  logLevel: 'warning',
})
console.log(`Listo: public/impresoras/hub-impresoras.js (${version}, app ${appUrl})`)
