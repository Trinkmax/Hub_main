import { LogOut, Settings2, ShieldCheck, Smartphone } from 'lucide-react'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { signOutAction } from '@/components/shell/sign-out-action'
import { ThemeToggle } from '@/components/theme/theme-toggle'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { PageHeader } from '@/components/ui/page-header'
import { requireFeature } from '@/lib/platform/guards'
import { createClient } from '@/lib/supabase/server'
import { requireTenantAccess, TenantNotFoundError } from '@/lib/tenant'

export const metadata = { title: 'Salón · Mi turno' }

const ROLE_LABEL: Record<string, string> = {
  owner: 'Owner',
  cashier: 'Cajero',
  waiter: 'Mozo',
  kitchen: 'Cocina',
}

export default async function MiTurnoPage({ params }: { params: Promise<{ tenantSlug: string }> }) {
  const { tenantSlug } = await params

  let access: Awaited<ReturnType<typeof requireTenantAccess>>
  try {
    access = await requireTenantAccess(tenantSlug)
  } catch (error) {
    if (error instanceof TenantNotFoundError) notFound()
    throw error
  }

  await requireFeature(access.tenant, 'table_service')

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  const email = user?.email ?? ''
  const initial = email.charAt(0).toUpperCase()

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Salón"
        title="Mi turno"
        description="Tu sesión y preferencias en este dispositivo."
      />

      <Card className="card-hairline gap-4 border-border/70 bg-card/85 p-5">
        <div className="flex items-center gap-3">
          <div className="flex size-12 items-center justify-center rounded-full bg-primary/15 font-serif text-xl font-semibold text-primary">
            {initial}
          </div>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium">{email}</p>
            <p className="text-xs text-muted-foreground">
              {ROLE_LABEL[access.role] ?? access.role} · {access.tenant.name}
            </p>
          </div>
        </div>
      </Card>

      <Card className="card-hairline gap-3 border-border/70 bg-card/85 p-5">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <Smartphone className="size-4 text-muted-foreground" aria-hidden />
            <span className="text-sm font-medium">Apariencia</span>
          </div>
          <ThemeToggle variant="outline" />
        </div>
      </Card>

      {access.role === 'owner' ? (
        <Card className="card-hairline gap-2 border-border/70 bg-card/85 p-5">
          <div className="flex items-center gap-2">
            <ShieldCheck className="size-4 text-primary" aria-hidden />
            <p className="text-sm font-medium">Modo manager</p>
          </div>
          <p className="text-xs text-muted-foreground">
            Estás como owner. Podés salir del salón y volver al dashboard completo.
          </p>
          <Button asChild variant="outline" className="mt-2 w-full" size="lg">
            <Link href={`/${tenantSlug}`} prefetch={false}>
              <Settings2 className="mr-2 size-4" aria-hidden />
              Volver al dashboard
            </Link>
          </Button>
        </Card>
      ) : null}

      <form
        action={async () => {
          'use server'
          await signOutAction()
        }}
      >
        <Button type="submit" variant="destructive" size="lg" className="w-full">
          <LogOut className="mr-2 size-4" aria-hidden />
          Cerrar sesión
        </Button>
      </form>
    </div>
  )
}
