import type { Metadata } from 'next'
import type { ReactNode } from 'react'
import { z } from 'zod'
import { getRequestIp } from '@/lib/ip'
import { RateLimitedError, rateLimit } from '@/lib/rate-limit'
import { createClient } from '@/lib/supabase/server'
import { SubirClient } from './subir-client'

export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: 'Foto del comprobante',
  // El token del link es la credencial: que no lo indexe nadie ni viaje en un referer.
  robots: { index: false, follow: false },
  referrer: 'no-referrer',
}

const tokenSchema = z.string().regex(/^[A-Za-z0-9_-]{32,128}$/)

const openedSchema = z.object({
  ok: z.literal(true),
  tenant_name: z.string().min(1),
  uploaded: z.number().int().min(0),
  slots: z.array(z.object({ path: z.string().min(1), token: z.string().min(1) })),
})

function Notice({ title, children }: { title: string; children: ReactNode }) {
  return (
    <main className="mx-auto grid min-h-dvh w-full max-w-sm content-center gap-2 px-6 py-10 text-center">
      <h1 className="font-serif text-2xl font-semibold tracking-tight text-balance">{title}</h1>
      <p className="text-sm text-muted-foreground text-pretty">{children}</p>
    </main>
  )
}

const EXPIRED = (
  <Notice title="Este QR ya venció">
    Dura 30 minutos, o hasta que se carga el comprobante. Abrí el formulario en la compu de nuevo y
    escaneá el QR nuevo.
  </Notice>
)

/**
 * Lo que abre el celular al escanear el QR de la compu: sin sesión y sin el panel. El token de la URL
 * es la credencial: dura poco y solo sirve para subir la foto de ese comprobante. No se ve nada del
 * bar más que su nombre.
 */
export default async function SubirPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  if (!tokenSchema.safeParse(token).success) return EXPIRED

  try {
    rateLimit({ key: `subir:${await getRequestIp()}`, limit: 30, windowMs: 60_000 })
  } catch (error) {
    if (error instanceof RateLimitedError) {
      return <Notice title="Esperá un minuto">Probaste muchas veces seguidas.</Notice>
    }
    throw error
  }

  const supabase = await createClient()
  const { data, error } = await supabase.rpc('acc_upload_link_open', { p_token: token })
  if (error) {
    // Sin el token ni nada del bar en el log.
    console.error('[subir.open]', error.code ?? 'sin_codigo')
    return (
      <Notice title="No pudimos abrir el link">
        Revisá la conexión del celular y volvé a escanear el QR.
      </Notice>
    )
  }

  const opened = openedSchema.safeParse(data)
  if (!opened.success) return EXPIRED

  return (
    <SubirClient
      token={token}
      tenantName={opened.data.tenant_name}
      slots={opened.data.slots}
      uploaded={opened.data.uploaded}
    />
  )
}
