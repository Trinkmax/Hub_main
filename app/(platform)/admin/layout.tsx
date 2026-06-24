import { ShieldCheck } from 'lucide-react'
import Link from 'next/link'
import { requirePlatformAdmin } from '@/lib/platform/is-admin'

export const metadata = { title: 'HUB · Plataforma' }

export default async function PlatformAdminLayout({ children }: { children: React.ReactNode }) {
  await requirePlatformAdmin()

  return (
    <div className="bg-app-gradient min-h-screen">
      <header className="sticky top-0 z-20 border-b border-border/60 bg-background/85 backdrop-blur-xl supports-[backdrop-filter]:bg-background/65">
        <div className="mx-auto flex h-14 max-w-5xl items-center gap-2 px-4 sm:px-6">
          <ShieldCheck className="size-5 text-primary" aria-hidden />
          <Link href="/admin" className="font-serif text-lg font-semibold tracking-tight">
            HUB · Plataforma
          </Link>
          <span className="ml-1 rounded-full bg-secondary px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
            superadmin
          </span>
          <nav className="ml-auto flex items-center gap-4 text-sm">
            <Link
              href="/admin"
              className="text-muted-foreground transition-colors hover:text-foreground"
            >
              Bares
            </Link>
            <Link
              href="/admin/meta"
              className="text-muted-foreground transition-colors hover:text-foreground"
            >
              Credenciales de Meta
            </Link>
          </nav>
        </div>
      </header>
      <main className="mx-auto max-w-5xl px-4 py-8 sm:px-6">{children}</main>
    </div>
  )
}
