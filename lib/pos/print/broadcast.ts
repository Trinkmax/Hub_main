import 'server-only'

/**
 * Avisarle algo al canal en vivo de una sucursal (`pos:<sucursal>`) desde el servidor.
 *
 * Lo usa la cuenta en papel por la comandera de la red (Nacho, 27/11: «cuando quiero imprimir la cuenta debe
 * imprimirse en la comandera 2»): el programa «HUB Impresoras» escucha ese canal. Los teléfonos no pueden
 * mandar por ese canal (la base solo los deja escuchar), así que manda el servidor, con la clave de servicio,
 * por la API de Realtime. Es una excepción a «service_role solo en webhooks y cron», del mismo tipo que el
 * ingreso con PIN: quien llama ya pasó por la sesión, el rol y la sucursal (ver `sendBillToComandera`).
 * Sin la clave, una política de envío en `realtime.messages` lo resolvería (necesita una migración).
 */
export async function broadcastToBranch(
  branchId: string,
  event: string,
  payload: Record<string, unknown>,
): Promise<boolean> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) throw new Error('Missing Supabase service role configuration')
  const response = await fetch(`${url}/realtime/v1/api/broadcast`, {
    method: 'POST',
    headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      messages: [{ topic: `pos:${branchId}`, event, payload, private: true }],
    }),
    signal: AbortSignal.timeout(8_000),
  })
  return response.ok
}
