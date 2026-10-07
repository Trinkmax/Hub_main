/**
 * La cookie que recuerda «Ocultar» de Primeros pasos, por bar. La lee el
 * Resumen en el servidor (así la tarjeta no aparece y desaparece) y la
 * escribe el botón. Puro.
 */
export function firstStepsCookieName(tenantSlug: string): string {
  return `hub_acc_pasos_${tenantSlug.replace(/[^a-z0-9-]/gi, '')}`
}
