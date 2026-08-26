import type { Metadata, Viewport } from 'next'
import { Fraunces, Inter } from 'next/font/google'
import { headers } from 'next/headers'
import { noFlashScript } from '@/components/theme/no-flash-script'
import { ThemeProvider } from '@/components/theme/theme-provider'
import { Toaster } from '@/components/ui/sonner'
import { readThemePreference } from '@/lib/theme/cookie'
import { parseWorkspace, WORKSPACE_HEADER } from '@/lib/workspace'
import './globals.css'

const inter = Inter({
  subsets: ['latin'],
  variable: '--font-inter',
  display: 'swap',
})

const fraunces = Fraunces({
  subsets: ['latin'],
  variable: '--font-fraunces',
  display: 'swap',
  weight: ['400', '500', '600', '700'],
  style: ['normal'],
})

export const metadata: Metadata = {
  title: {
    default: 'HUB · Plataforma para bares',
    template: '%s · HUB',
  },
  description:
    'CRM multi-tenant para bares. Conocé a tu cliente, fidelizalo y convertilo en habitué.',
}

export const viewport: Viewport = {
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#f5edd7' },
    { media: '(prefers-color-scheme: dark)', color: '#0f2a20' },
  ],
  width: 'device-width',
  initialScale: 1,
}

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const [preference, headerList] = await Promise.all([readThemePreference(), headers()])

  // El salón es light-only (ver lib/workspace.ts). Emitimos el `<html>` ya claro
  // desde el server: sin esto el primer paint sale oscuro y recién lo corrige el
  // script del <head> → flash. `data-force-light` le avisa al ThemeProvider que
  // no vuelva a tocar la clase después de hidratar.
  const salon = parseWorkspace(headerList.get(WORKSPACE_HEADER)) === 'salon'
  const themeClass = salon ? 'force-light' : preference === 'dark' ? 'dark' : ''

  return (
    <html
      lang="es-AR"
      className={`${themeClass} ${inter.variable} ${fraunces.variable}`}
      data-theme-pref={preference}
      data-force-light={salon ? '1' : undefined}
      suppressHydrationWarning
    >
      <head>
        {/* biome-ignore lint/security/noDangerouslySetInnerHtml: script estático sin user input — evita FOUC de tema antes de hidratar */}
        <script dangerouslySetInnerHTML={{ __html: noFlashScript }} />
      </head>
      <body className="min-h-screen bg-background text-foreground antialiased">
        <ThemeProvider initialPreference={preference}>{children}</ThemeProvider>
        {/* sonner resuelve su tema solo (`theme="system"` mira el SO, no la clase
            del <html>), así que en el salón hay que decírselo a mano o los toasts
            salen oscuros sobre un panel claro. */}
        <Toaster richColors closeButton theme={salon ? 'light' : 'system'} />
      </body>
    </html>
  )
}
