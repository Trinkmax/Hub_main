import type { Metadata, Viewport } from 'next'
import { notFound } from 'next/navigation'
import { AppShellSalon } from '@/components/shell/salon/app-shell-salon'
import { requireTenantAccess, TenantNotFoundError } from '@/lib/tenant'

export const metadata: Metadata = {
  manifest: '/manifest.webmanifest',
  appleWebApp: {
    capable: true,
    statusBarStyle: 'default',
    title: 'HUB!',
    startupImage: '/icons/icon-512.png',
  },
  applicationName: 'HUB! Salón',
  icons: {
    icon: [
      { url: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
      { url: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
    ],
    apple: '/apple-touch-icon.png',
  },
}

export const viewport: Viewport = {
  // Un solo color: el salón es light-only (ver lib/workspace.ts). Con el par
  // light/dark, un celular en modo oscuro pintaba la barra de estado verde
  // noche arriba de un panel crema.
  themeColor: '#f5edd7',
  width: 'device-width',
  initialScale: 1,
  // Sin `maximumScale`/`userScalable: false`: bloquear el zoom rompe WCAG 1.4.4
  // y en un salón oscuro el mozo a veces necesita agrandar. El auto-zoom de iOS
  // al enfocar un input ya está cubierto por el `text-base` de <Input>.
}

export default async function SalonLayout({
  children,
  params,
}: {
  children: React.ReactNode
  params: Promise<{ tenantSlug: string }>
}) {
  const { tenantSlug } = await params

  let access: Awaited<ReturnType<typeof requireTenantAccess>>
  try {
    access = await requireTenantAccess(tenantSlug)
  } catch (error) {
    if (error instanceof TenantNotFoundError) notFound()
    throw error
  }

  return (
    <AppShellSalon
      tenant={access.tenant}
      role={access.role}
      isPlatformAdmin={access.isPlatformAdmin}
      email={access.user.email ?? ''}
    >
      {children}
    </AppShellSalon>
  )
}
