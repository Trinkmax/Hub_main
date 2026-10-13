/**
 * La cookie que recuerda que la franja «Puesta en marcha» del Resumen está
 * plegada, por bar. La lee el Resumen en el servidor (así la franja no se abre
 * y se cierra al cargar) y la escribe su botón «Plegar» / «Mostrar». Puro.
 *
 * Conserva el nombre de cuando era el «Ocultar» de Primeros pasos: quien ya la
 * había ocultado la sigue viendo plegada, ahora con su avance y cómo abrirla.
 */
export function firstStepsCookieName(tenantSlug: string): string {
  return `hub_acc_pasos_${tenantSlug.replace(/[^a-z0-9-]/gi, '')}`
}
