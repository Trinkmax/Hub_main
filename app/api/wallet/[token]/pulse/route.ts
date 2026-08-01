import { NextResponse } from 'next/server'
import { getRequestIp } from '@/lib/ip'
import { RateLimitedError, rateLimit } from '@/lib/rate-limit'
import { createClient } from '@/lib/supabase/server'

/**
 * Pulso de la billetera del socio. Devuelve un hash opaco de todo lo que puede
 * cambiar mientras la pantalla está abierta (puntos, canjes pendientes, sellos).
 *
 * Existe para que la billetera se actualice sola: el socio genera el QR, el mozo
 * lo valida, y la pantalla tiene que reflejarlo sin que él recargue. Como es una
 * pantalla anónima (la identidad es el `qr_token`), Realtime no sirve — ver la
 * migración 20260801120000_wallet_pulse.
 *
 * Es a propósito lo más barato posible: unos bytes cada pocos segundos. Lo caro
 * (volver a armar la billetera entera) sólo pasa cuando el hash cambió.
 *
 * Usa el cliente `anon`: la RPC es SECURITY DEFINER con capability por token,
 * igual que el resto del flujo público del club. Sin service_role.
 */
export const dynamic = 'force-dynamic'

const TOKEN_RE = /^[A-Za-z0-9_-]{16,128}$/

export async function GET(_req: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  if (!TOKEN_RE.test(token)) {
    return NextResponse.json({ rev: null }, { status: 400 })
  }

  const ip = await getRequestIp()
  try {
    // Generoso a propósito: con el QR en pantalla el cliente consulta cada 3s, y
    // varias personas de la misma mesa comparten la IP del WiFi del bar.
    rateLimit({ key: `wallet-pulse:${ip}`, limit: 240, windowMs: 60_000 })
  } catch (e) {
    if (e instanceof RateLimitedError) {
      return NextResponse.json({ rev: null }, { status: 429 })
    }
    throw e
  }

  const supabase = await createClient()
  const { data, error } = await supabase.rpc('wallet_pulse', { p_qr_token: token })
  if (error) {
    console.error('[wallet.pulse]', error.message)
    return NextResponse.json({ rev: null }, { status: 500 })
  }

  const rev = (data as { rev?: string | null } | null)?.rev ?? null
  return NextResponse.json({ rev }, { headers: { 'Cache-Control': 'no-store, max-age=0' } })
}
