import type { NextRequest } from 'next/server'
import { updateSession } from '@/lib/supabase/middleware'

export async function proxy(request: NextRequest) {
  return updateSession(request)
}

export const config = {
  // Excluimos estáticos y los endpoints máquina-a-máquina (cron de pg_cron,
  // webhooks de Meta, pulso de la billetera): no tienen sesión de usuario y
  // se auto-protegen (CRON_SECRET / firma de Meta / capability por token).
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|icons/|api/cron/|api/webhooks/|api/wallet/|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|woff2?|css|js|map|webmanifest)$).*)',
  ],
}
