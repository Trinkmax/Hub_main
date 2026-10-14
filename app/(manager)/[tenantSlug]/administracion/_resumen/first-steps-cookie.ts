/**
 * La cookie que recuerda si la franja «Puesta en marcha» del Resumen está
 * desplegada (la lista de los próximos pasos) o en un renglón, por bar. La lee
 * el Resumen en el servidor (así la franja no se abre y se cierra al cargar)
 * y la escribe su botón «Mostrar los próximos» / «Plegar». Puro.
 *
 * Conserva el nombre de cuando era el «Ocultar» de Primeros pasos. El valor
 * de entonces (`1`) se lee como «en un renglón», que hoy es lo de siempre:
 * quien la había ocultado la ve con su avance y cómo abrirla.
 */
export function firstStepsCookieName(tenantSlug: string): string {
  return `hub_acc_pasos_${tenantSlug.replace(/[^a-z0-9-]/gi, '')}`
}

/** Lo que guarda la cookie cuando la lista queda desplegada (cualquier otro valor: en un renglón). */
export const SETUP_OPEN_VALUE = 'abierta'
