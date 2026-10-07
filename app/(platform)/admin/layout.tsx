import { ShieldCheck } from 'lucide-react'
import Link from 'next/link'
import { Badge } from '@/components/ui/badge'
import { PageShell } from '@/components/ui/page-shell'
import { TabsNav } from '@/components/ui/tabs-nav'
import { requirePlatformAdmin } from '@/lib/platform/is-admin'

export const metadata = { title: 'HUB · Plataforma' }

/** Mismo ancho para la barra y el contenido. */
const CONTAINER = 'mx-auto w-full max-w-5xl px-4 sm:px-6 lg:px-8'

export default async function PlatformAdminLayout({ children }: { children: React.ReactNode }) {
  await requirePlatformAdmin()

  return (
    <div className="min-h-dvh">
      {/* Papel sólido con un pelo abajo, como el topbar del panel (sin vidrio). */}
      <header className="sticky top-0 z-20 border-b border-border bg-background">
        <div className={`${CONTAINER} flex flex-wrap items-center gap-x-6`}>
          <div className="flex h-(--topbar-h) min-w-0 items-center gap-2">
            <ShieldCheck className="size-5 shrink-0 text-primary" aria-hidden="true" />
            <Link
              href="/admin"
              className="truncate rounded-sm font-display text-lg font-semibold outline-offset-2 outline-(--ring) focus-visible:outline-2"
            >
              HUB · Plataforma
            </Link>
            <Badge>Superadmin</Badge>
          </div>
          {/* La fila de subpáginas: en el celular baja a su propia línea. El
              subrayado del activo se apoya en el pelo de la barra. */}
          <TabsNav
            aria-label="Secciones de la plataforma"
            items={[
              { href: '/admin', label: 'Bares' },
              { href: '/admin/meta', label: 'Credenciales de Meta' },
            ]}
            className="max-sm:w-full shadow-none sm:ml-auto sm:self-stretch"
          />
        </div>
      </header>
      <main>
        <PageShell width="comfortable" className="max-w-5xl">
          {children}
        </PageShell>
      </main>
    </div>
  )
}
