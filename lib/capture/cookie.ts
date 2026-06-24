/**
 * Nombre de la cookie que guarda el `qr_token` del cliente identificado en la
 * carta de un tenant. Tenant-scoped para no pisar la identidad entre bares que
 * comparten dominio (`/carta/[slug]`).
 */
export function walletCookieName(tenantId: string): string {
  return `hub_wallet_${tenantId}`
}
