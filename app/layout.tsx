import type { Metadata, Viewport } from 'next'
import { Fraunces, Inter } from 'next/font/google'
import { noFlashScript } from '@/components/theme/no-flash-script'
import { ThemeProvider } from '@/components/theme/theme-provider'
import { Toaster } from '@/components/ui/sonner'
import { readThemePreference } from '@/lib/theme/cookie'
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
  const preference = await readThemePreference()
  const initialClass = preference === 'dark' ? 'dark' : ''

  return (
    <html
      lang="es-AR"
      className={`${initialClass} ${inter.variable} ${fraunces.variable}`}
      data-theme-pref={preference}
      suppressHydrationWarning
    >
      <head>
        {/* biome-ignore lint/security/noDangerouslySetInnerHtml: script estático sin user input — evita FOUC de tema antes de hidratar */}
        <script dangerouslySetInnerHTML={{ __html: noFlashScript }} />
      </head>
      <body className="min-h-screen bg-background text-foreground antialiased">
        <ThemeProvider initialPreference={preference}>{children}</ThemeProvider>
        <Toaster richColors closeButton />
      </body>
    </html>
  )
}
