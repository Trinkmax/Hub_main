import { QrCode, Store } from 'lucide-react'
import Image from 'next/image'
import { redirect } from 'next/navigation'
import QRCode from 'qrcode'
import { BrandAccent } from '@/components/theme/brand-accent-provider'
import { getAppUrl } from '@/lib/app-url'
import { redeemTokenSchema } from '@/lib/redemptions/schemas'
import { createClient } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/service'
import { REDEMPTION_STAFF_ROLES } from '@/lib/tenant/roles'
import type { TenantRole } from '@/lib/tenant/types'

// La URL que lleva el QR de canje. Dos públicos, una sola dirección:
//
//  · staff (tiene membership en el tenant del canje) → derecho a la pantalla de
//    validación con el código ya cargado. Es el caso normal: escanea con la
//    cámara nativa del teléfono y cae acá.
//  · el propio socio (sin sesión) → NO un 404: le mostramos el código grande
//    para que se lo muestre al mozo. Que el link "no funcione" del lado del
//    dueño del beneficio sería el peor final posible del flujo.
//
// Sin datos sensibles: nombre del beneficio, del bar y el código. Nada de
// puntos, teléfono ni identidad del socio — este link puede terminar reenviado.

export const metadata = { title: 'Tu canje' }
export const dynamic = 'force-dynamic'

type RedemptionRow = {
  id: string
  status: string
  token_expires_at: string | null
  tenant_id: string
}

export default async function RedeemTokenPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  const parsed = redeemTokenSchema.safeParse(token)

  // Service-role a propósito: no hay sesión del socio y el token ES la
  // capability. Sólo se leen campos no sensibles del canje + del bar.
  const service = createServiceClient()
  const { data } = parsed.success
    ? await service
        .from('reward_redemptions')
        .select('id, status, token_expires_at, tenant_id, reward:rewards(name)')
        .eq('redeem_token', parsed.data)
        .maybeSingle()
    : { data: null }

  const row = data as
    | (RedemptionRow & { reward: { name: string } | { name: string }[] | null })
    | null

  if (row) {
    const { data: auth } = await (await createClient()).auth.getUser()
    if (auth.user) {
      const { data: membership } = await service
        .from('memberships')
        .select('role, tenant:tenants(slug)')
        .eq('user_id', auth.user.id)
        .eq('tenant_id', row.tenant_id)
        .maybeSingle()
      const row2 = membership as {
        role: string
        tenant: { slug: string } | { slug: string }[] | null
      } | null
      const tenant = row2?.tenant ?? null
      const slug = Array.isArray(tenant) ? tenant[0]?.slug : tenant?.slug
      // Sólo los roles que pueden entregar: un `kitchen` o un `editor` con
      // membership rebotarían contra el notFound() de /validar.
      const canValidate = row2 !== null && REDEMPTION_STAFF_ROLES.includes(row2.role as TenantRole)
      if (slug && canValidate) redirect(`/${slug}/salon/validar?code=${encodeURIComponent(token)}`)
    }
  }

  const reward = row ? (Array.isArray(row.reward) ? row.reward[0] : row.reward) : null
  const { data: tenantRow } = row
    ? await service
        .from('tenants')
        .select('name, brand_accent')
        .eq('id', row.tenant_id)
        .maybeSingle()
    : { data: null }

  const expired =
    !row ||
    row.status !== 'pending' ||
    (row.token_expires_at !== null && new Date(row.token_expires_at).getTime() <= Date.now())

  const appUrl = await getAppUrl()
  const qrDataUrl = await QRCode.toDataURL(`${appUrl}/v/${token}`, {
    width: 420,
    margin: 1,
    errorCorrectionLevel: 'M',
    color: { dark: '#000000', light: '#ffffff' },
  })

  return (
    <BrandAccent
      accent={(tenantRow as { brand_accent?: string | null } | null)?.brand_accent ?? null}
      className="force-light min-h-[100dvh] bg-app-gradient"
    >
      <main className="mx-auto flex min-h-[100dvh] max-w-md flex-col justify-center gap-6 px-4 py-10">
        {expired ? (
          <section className="card-hairline rounded-2xl border bg-card p-8 text-center">
            <QrCode className="mx-auto size-10 text-muted-foreground" aria-hidden="true" />
            <h1 className="mt-3 font-display text-xl font-semibold tracking-tight">
              Este código ya no sirve
            </h1>
            <p className="mt-2 text-sm text-muted-foreground text-balance">
              O ya lo entregaron, o venció. Abrí tu billetera y generá uno nuevo: no perdiste ningún
              punto.
            </p>
          </section>
        ) : (
          <section className="overflow-hidden rounded-2xl bg-(--brand-accent) p-6 text-center text-(--brand-accent-foreground) shadow-glow">
            <p className="text-[11px] font-medium uppercase tracking-[0.2em] opacity-80">
              Mostrale este código al mozo
            </p>
            <h1 className="mt-2 font-display text-2xl font-semibold tracking-tight text-balance">
              {reward?.name ?? 'Tu beneficio'}
            </h1>

            <div className="mx-auto mt-5 w-full max-w-[15rem] rounded-2xl bg-white p-3 shadow-sm">
              <Image
                src={qrDataUrl}
                alt="Código QR del canje"
                width={240}
                height={240}
                className="size-full"
                unoptimized
                priority
              />
            </div>

            <p className="mt-4 select-all break-all font-mono text-[15px] font-semibold leading-snug tracking-wide">
              {token}
            </p>

            {tenantRow ? (
              <p className="mt-4 inline-flex items-center gap-1.5 text-xs opacity-85">
                <Store className="size-3.5" aria-hidden="true" />
                {(tenantRow as { name: string }).name}
              </p>
            ) : null}
          </section>
        )}

        <p className="text-center text-[11px] text-muted-foreground">
          Los puntos se descuentan recién cuando te entregan el beneficio.
        </p>
      </main>
    </BrandAccent>
  )
}
