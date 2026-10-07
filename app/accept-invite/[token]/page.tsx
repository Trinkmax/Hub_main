import { Mail, MailX } from 'lucide-react'
import { AuthCard, AuthFrame } from '@/app/(auth)/_components/auth-card'
import { Badge } from '@/components/ui/badge'
import { Callout } from '@/components/ui/callout'
import { createClient } from '@/lib/supabase/server'
import { roleLabel } from '@/lib/tenant/roles'
import { AcceptInviteClient } from './accept-invite-client'

export const metadata = { title: 'Aceptar invitación' }

type Preview = {
  email: string
  /** Rol de la invitación tal como lo devuelve la base (cualquier valor de tenant_role). */
  role: string
  tenant_name: string
  expired: boolean
}

export default async function AcceptInvitePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  const supabase = await createClient()

  const { data: previewArr } = await supabase.rpc('get_invitation_preview', { p_token: token })
  const preview = (previewArr as Preview[] | null)?.[0] ?? null
  const {
    data: { user },
  } = await supabase.auth.getUser()

  return (
    <AuthFrame width="md">
      {preview ? (
        <AuthCard
          icon={Mail}
          title="Tenés una invitación"
          description={
            <>
              Te invitaron a unirte a{' '}
              <strong className="font-semibold text-foreground">{preview.tenant_name}</strong> como{' '}
              <Badge appearance="outline" className="align-middle">
                {roleLabel(preview.role)}
              </Badge>
            </>
          }
        >
          {preview.expired ? (
            <Callout tone="warning" title="La invitación venció">
              Pedile al dueño del bar que te genere una nueva.
            </Callout>
          ) : (
            <AcceptInviteClient
              token={token}
              preview={preview}
              currentEmail={user?.email ?? null}
            />
          )}
        </AuthCard>
      ) : (
        <AuthCard
          icon={MailX}
          title="Invitación no encontrada"
          description="Esta invitación no existe o ya fue usada. Pedile al dueño del bar que te genere una nueva."
        />
      )}
    </AuthFrame>
  )
}
