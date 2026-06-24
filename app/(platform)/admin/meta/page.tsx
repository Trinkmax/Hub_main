import { getPlatformMetaConfigForDisplay } from '@/lib/platform/meta-config-actions'
import { MetaConfigForm } from './_form'

export const dynamic = 'force-dynamic'

export default async function PlatformMetaConfigPage() {
  const current = await getPlatformMetaConfigForDisplay()
  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-serif text-2xl font-semibold tracking-tight">Credenciales de Meta</h1>
        <p className="text-sm text-muted-foreground">
          La Meta App de plataforma (WhatsApp/Instagram). Lo que cargues acá pisa las variables de
          entorno. Lo obtenés en developers.facebook.com → tu app → Configuración → Básica.
        </p>
      </div>
      <MetaConfigForm
        initial={{
          appId: current?.appId ?? '',
          webhookVerifyToken: current?.webhookVerifyToken ?? '',
          hasSecret: current?.hasSecret ?? false,
        }}
      />
    </div>
  )
}
