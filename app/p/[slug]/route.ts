import { getRequestIp } from '@/lib/ip'
import { bumpLandingView, getPublishedLanding } from '@/lib/landings/queries'
import {
  HAS_LANDINGS_HOST,
  isLandingsHost,
  LANDING_CSP,
  landingsOrigin,
} from '@/lib/landings/security'
import { RateLimitedError, rateLimit } from '@/lib/rate-limit'

/**
 * La landing HTML del bar, servida tal cual la subió marketing.
 *
 * Es un Route Handler y no una `page.tsx` a propósito: devolvemos el documento
 * del bar BYTE A BYTE, sin layout, sin `<html>` nuestro alrededor, sin React y
 * sin interpolar absolutamente nada adentro del HTML.
 *
 * La seguridad vive en los headers (ver lib/landings/security.ts): sin el
 * `sandbox` del CSP, un `<script>` pegado dentro de una landing podría leer las
 * cookies de sesión del panel, que están en el mismo dominio.
 *
 * `force-dynamic` + `no-store`: el contador de visitas tiene que correr en cada
 * visita de verdad, y cuando el dueño toca algo espera verlo YA desde el
 * celular. A la escala de un bar el costo es un select y un update por visita.
 */
export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const SLUG_RE = /^[a-z0-9][a-z0-9-]{1,39}$/

function html(
  body: string,
  status: number,
  opts: { sandboxed: boolean; extra?: Record<string, string> },
) {
  return new Response(body, {
    status,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      // El sandbox va SÓLO cuando la landing se sirve desde el dominio del
      // panel. En el host dedicado el documento tiene que conservar su origen o
      // el reproductor de YouTube (y cualquier iframe) queda con origen opaco y
      // no arranca. Duplicado a propósito con next.config.ts — si uno se cae,
      // el otro sigue de pie. Ver lib/landings/security.ts.
      ...(opts.sandboxed ? { 'Content-Security-Policy': LANDING_CSP } : {}),
      'X-Content-Type-Options': 'nosniff',
      'Cache-Control': 'no-store',
      ...opts.extra,
    },
  })
}

/** 404 propio: la página del bar no existe, pero el que llegó no tiene la culpa. */
function notFoundPage(sandboxed: boolean) {
  return html(
    `<!doctype html>
<html lang="es-AR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Página no disponible</title>
<style>
  :root { color-scheme: light }
  body { margin:0; min-height:100dvh; display:grid; place-items:center; background:#f5edd7;
         font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; color:#2b2a26 }
  main { text-align:center; padding:2rem; max-width:22rem }
  h1 { font-size:1.25rem; margin:0 0 .5rem; letter-spacing:-.01em }
  p { margin:0; font-size:.9rem; line-height:1.5; opacity:.7 }
</style>
</head>
<body><main>
  <h1>Esta página ya no está</h1>
  <p>Puede que la promo haya terminado o que el link esté mal escrito. Preguntale al bar por el link nuevo.</p>
</main></body>
</html>`,
    404,
    { sandboxed, extra: { 'X-Robots-Tag': 'noindex, nofollow' } },
  )
}

export async function GET(request: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  // En el host dedicado el documento conserva su origen (sin sandbox); en el
  // dominio del panel, no.
  const onLandingsHost = isLandingsHost(new Headers(request.headers).get('host'))
  const sandboxed = !onLandingsHost
  // Sólo minúsculas y trim: alguien puede escribir el link con mayúsculas al
  // pasarlo de boca en boca. NO se vuelve a decodificar — Next ya entrega
  // `params` decodificado y un `%` suelto haría explotar decodeURIComponent
  // con un 500 en vez del 404 que corresponde.
  const normalized = (slug ?? '').trim().toLowerCase()
  if (!SLUG_RE.test(normalized)) return notFoundPage(sandboxed)

  // Con host dedicado, ésta es la URL vieja: los links ya repartidos por
  // WhatsApp e Instagram tienen que seguir funcionando, así que van al nuevo
  // origen con un 308 (permanente y sin cambiar el método).
  if (HAS_LANDINGS_HOST && !onLandingsHost) {
    const origin = landingsOrigin()
    if (origin) return Response.redirect(`${origin}/${normalized}`, 308)
  }

  // Techo alto: detrás de una IP de red móvil (CGNAT) puede haber cientos de
  // personas abriendo la misma historia de Instagram al mismo tiempo.
  try {
    const ip = await getRequestIp()
    rateLimit({ key: `landing:${ip}`, limit: 240, windowMs: 60_000 })
  } catch (error) {
    if (error instanceof RateLimitedError) {
      return html(
        '<!doctype html><meta charset="utf-8"><p>Demasiadas visitas. Probá en un minuto.</p>',
        429,
        { sandboxed },
      )
    }
    throw error
  }

  const page = await getPublishedLanding(normalized)
  if (!page) return notFoundPage(sandboxed)

  await bumpLandingView(page.id)

  return html(page.html, 200, {
    sandboxed,
    // Mientras no esté marcada como indexable, fuera de Google: una landing a
    // medio hacer no tiene por qué quedar pegada al dominio.
    extra: page.indexable ? {} : { 'X-Robots-Tag': 'noindex, nofollow' },
  })
}
