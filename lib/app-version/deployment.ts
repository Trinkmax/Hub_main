import { pickDeploymentId } from './decide'

/**
 * La versión publicada que está contestando este pedido (`dpl_…` en Vercel). `null` en desarrollo.
 *
 * Es lo que compara la pantalla para saber si hay una versión nueva (ver `decide.ts`): el layout se la pasa
 * a `AppVersionWatcher` al servir la página y `/api/version` la devuelve cuando la pantalla pregunta.
 *
 * Las dos puntas salen de ESTA función (la página y la respuesta a la pregunta), así que comparan exactamente
 * lo mismo. Primero la de Next (`NEXT_DEPLOYMENT_ID`, la que usa la protección de versiones de Vercel); si no
 * está, la de Vercel.
 *
 * Para apagar el aviso sin tocar código: `APP_VERSION_WATCH=off` en Vercel y volver a publicar. Desde ese
 * deployment nadie recibe un id y ninguna pantalla se recarga sola.
 */
export function currentDeploymentId(): string | null {
  if (process.env.APP_VERSION_WATCH === 'off') return null
  return pickDeploymentId(process.env.NEXT_DEPLOYMENT_ID, process.env.VERCEL_DEPLOYMENT_ID)
}
