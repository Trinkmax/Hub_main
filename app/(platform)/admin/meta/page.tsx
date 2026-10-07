import { PageHeader } from '@/components/ui/page-header'
import { getPlatformMetaConfigForDisplay } from '@/lib/platform/meta-config-actions'
import { MetaConfigForm } from './_form'

export const dynamic = 'force-dynamic'

export default async function PlatformMetaConfigPage() {
  const current = await getPlatformMetaConfigForDisplay()
  return (
    <>
      <PageHeader
        title="Credenciales de Meta"
        description="La Meta App de plataforma (WhatsApp/Instagram). Lo que cargues acá pisa las variables de entorno. Lo obtenés en developers.facebook.com › tu app › Configuración › Básica."
      />
      <MetaConfigForm
        initial={{
          appId: current?.appId ?? '',
          webhookVerifyToken: current?.webhookVerifyToken ?? '',
          hasSecret: current?.hasSecret ?? false,
        }}
      />
    </>
  )
}
