import { currentDeploymentId } from '@/lib/app-version/deployment'

/**
 * Qué versión está publicada. La pregunta cada pantalla abierta, una vez por minuto, para ponerse al día
 * sola (`components/shell/app-version-watcher.tsx`, `lib/app-version/decide.ts`).
 *
 * Es pública y no dice nada que no esté ya en cada página (el id del deployment viaja en el HTML). No pasa por
 * el proxy (`proxy.ts`): no hay sesión que refrescar y se la llama seguido. Se lee en cada pedido: un `fetch`
 * común no va atado a la versión de quien pregunta, así que contesta siempre la publicada.
 */
export const dynamic = 'force-dynamic'

export function GET() {
  return Response.json(
    { id: currentDeploymentId() },
    { headers: { 'Cache-Control': 'no-store, max-age=0' } },
  )
}
