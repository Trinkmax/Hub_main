/**
 * Revisión rápida del HTML de una landing.
 *
 * POR QUÉ EXISTE: el HTML lo escribe (o lo copia de internet) el encargado de
 * marketing, y las tres cosas que más veces rompen una landing publicada no
 * dan ningún error visible mientras la editás:
 *
 *   1. falta el <meta viewport> → en el celular se ve la versión de escritorio
 *      miniatura, y el 90% de la gente entra desde una historia de Instagram;
 *   2. rutas relativas ("img/hero.jpg") → en hubbar.com.ar no existe esa
 *      carpeta, así que las imágenes salen rotas SÓLO en producción;
 *   3. localStorage / document.cookie → la página publicada corre en un origen
 *      opaco (CSP sandbox, ver app/p/[slug]/route.ts) y esas APIs no devuelven
 *      null: TIRAN SecurityError, o sea que cortan el script en la primera
 *      línea y la landing queda a medio armar.
 *
 * Es una función pura sobre el texto: no parsea el DOM, no toca el HTML y no
 * bloquea nada. Sólo avisa, con el mismo lenguaje que usaría un compañero.
 */

export type LandingCheckLevel = 'error' | 'aviso' | 'tip'

export type LandingCheck = {
  id: string
  level: LandingCheckLevel
  title: string
  detail: string
}

/** Muestra sólo los primeros ejemplos: la lista completa no ayuda a nadie. */
const MAX_EXAMPLES = 4

const LEVEL_WEIGHT: Record<LandingCheckLevel, number> = { error: 0, aviso: 1, tip: 2 }

/** Peso a partir del cual avisamos que la página va a tardar en abrir en 4G. */
const HEAVY_CHARS = 300_000

/**
 * Esquemas y prefijos que SÍ resuelven desde hubbar.com.ar. `/p/` entra porque
 * linkear de una landing a otra es normal y sano.
 */
function isResolvableRef(raw: string): boolean {
  const value = raw.trim()
  if (value.length === 0) return true
  if (value.startsWith('#')) return true
  if (value.startsWith('//')) return true
  if (value.startsWith('/p/')) return true
  if (/^(?:https?|data|mailto|tel|whatsapp|sms|blob):/i.test(value)) return true
  // Cualquier otro esquema conocido (javascript:, about:…) no es un archivo
  // nuestro: no es un link roto, es problema de quien lo escribió.
  if (/^[a-z][a-z0-9+.-]*:/i.test(value)) return true
  return false
}

/** Referencias a archivos: src=, href= y url(...) de CSS inline. */
function collectRefs(html: string): string[] {
  const refs: string[] = []
  const attr = /(?:src|href)\s*=\s*(?:"([^"]*)"|'([^']*)')/gi
  const cssUrl = /url\(\s*(?:"([^"]*)"|'([^']*)'|([^)'"]+))\s*\)/gi

  for (const match of html.matchAll(attr)) {
    refs.push(match[1] ?? match[2] ?? '')
  }
  for (const match of html.matchAll(cssUrl)) {
    refs.push(match[1] ?? match[2] ?? match[3] ?? '')
  }
  return refs
}

function listExamples(values: string[]): string {
  const unique = [...new Set(values.map((v) => v.trim()).filter(Boolean))]
  const shown = unique.slice(0, MAX_EXAMPLES).join(', ')
  const rest = unique.length - MAX_EXAMPLES
  return rest > 0 ? `${shown} y ${rest} más` : shown
}

/**
 * Devuelve los avisos ordenados por gravedad. Array vacío = está todo bien.
 */
export function analyzeLandingHtml(html: string): LandingCheck[] {
  const checks: LandingCheck[] = []
  const code = html ?? ''
  const trimmed = code.trim()

  if (trimmed.length === 0) {
    return [
      {
        id: 'empty',
        level: 'error',
        title: 'Todavía no hay código',
        detail: 'Pegá el HTML de la landing o arrastrá el archivo .html acá abajo.',
      },
    ]
  }

  // El HTML se compara en minúsculas: los atributos y tags no distinguen mayúsculas.
  const lower = trimmed.toLowerCase()

  if (!lower.startsWith('<!doctype html')) {
    checks.push({
      id: 'no-doctype',
      level: 'aviso',
      title: 'Falta <!DOCTYPE html> al principio',
      detail:
        'Sin eso el navegador entra en "modo compatibilidad" y los márgenes, las alturas y el centrado se descolocan sin motivo aparente.',
    })
  }

  if (!/<meta[^>]+name\s*=\s*["']?viewport/i.test(code)) {
    checks.push({
      id: 'no-viewport',
      level: 'error',
      title: 'Falta la etiqueta de viewport',
      detail:
        'En el celular se va a ver la página de escritorio en miniatura, y casi todo el tráfico entra desde Instagram. Agregá dentro del <head>: <meta name="viewport" content="width=device-width, initial-scale=1">',
    })
  }

  if (!/<title[\s>]/i.test(code)) {
    checks.push({
      id: 'no-title',
      level: 'aviso',
      title: 'Falta el <title>',
      detail:
        'Es el texto que se lee en la pestaña del navegador y el que aparece cuando alguien manda el link por WhatsApp.',
    })
  }

  if (!/<meta[^>]+charset/i.test(code)) {
    checks.push({
      id: 'no-charset',
      level: 'tip',
      title: 'Falta el charset',
      detail:
        'Sin <meta charset="utf-8"> los acentos y las ñ pueden salir como símbolos raros en algunos celulares.',
    })
  }

  const refs = collectRefs(code)
  const broken = refs.filter((ref) => !isResolvableRef(ref))
  if (broken.length > 0) {
    checks.push({
      id: 'relative-refs',
      level: 'error',
      title: 'Hay rutas que no van a existir online',
      detail: `${listExamples(broken)} — esas carpetas viven en tu compu, no en hubbar.com.ar. Subí las imágenes en la pestaña "Imágenes" y pegá el link que te da.`,
    })
  }

  const insecure = refs.filter((ref) => /^http:\/\//i.test(ref.trim()))
  if (insecure.length > 0) {
    checks.push({
      id: 'insecure-refs',
      level: 'aviso',
      title: 'Hay recursos cargados por http://',
      detail: `${listExamples(insecure)} — la página se sirve por https y el navegador bloquea lo que venga por http. Cambiá esos links a https:// si el sitio lo permite.`,
    })
  }

  const storageApis = ['localStorage', 'sessionStorage', 'document.cookie', 'indexedDB'].filter(
    (api) => code.includes(api),
  )
  if (storageApis.length > 0) {
    checks.push({
      id: 'blocked-apis',
      level: 'error',
      title: `${storageApis.join(', ')} no funciona en la página publicada`,
      detail:
        'Por seguridad la landing corre aislada del resto del sistema, y esas APIs no devuelven vacío: cortan el script ahí mismo, dejando la página a medio cargar. Sacalas o envolvelas en un try/catch.',
    })
  }

  if (/gtag\s*\(|googletagmanager|google-analytics/i.test(code)) {
    checks.push({
      id: 'ga-blocked',
      level: 'aviso',
      title: 'Google Analytics no va a registrar visitas',
      detail:
        'Por el mismo aislamiento, GA no logra mandar los datos (falla en silencio: no vas a ver ningún error, sólo cero visitas). Usá el contador de visitas que ya trae esta pantalla.',
    })
  }

  if (/<script[^>]*>[\s\S]*?document\.write/i.test(code)) {
    checks.push({
      id: 'document-write',
      level: 'aviso',
      title: 'Hay un document.write',
      detail:
        'Si se ejecuta después de que la página cargó, borra todo el contenido y deja la pantalla en blanco. Conviene reemplazarlo.',
    })
  }

  if (code.length > HEAVY_CHARS) {
    const kb = Math.round(code.length / 1024)
    checks.push({
      id: 'heavy',
      level: 'tip',
      title: `El código pesa ${kb} KB`,
      detail:
        'Suele ser por imágenes pegadas dentro del HTML (base64). Subilas en "Imágenes" y usá su link: la página abre mucho más rápido con datos móviles.',
    })
  }

  return checks.sort((a, b) => LEVEL_WEIGHT[a.level] - LEVEL_WEIGHT[b.level])
}

/** Resumen para el badge del editor. */
export function summarizeChecks(checks: LandingCheck[]): {
  errors: number
  warnings: number
  tips: number
} {
  return {
    errors: checks.filter((c) => c.level === 'error').length,
    warnings: checks.filter((c) => c.level === 'aviso').length,
    tips: checks.filter((c) => c.level === 'tip').length,
  }
}
