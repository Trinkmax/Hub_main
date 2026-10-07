import type { Metadata, Viewport } from 'next'
import { Fraunces, Inter } from 'next/font/google'
import { headers } from 'next/headers'
import { noFlashScript } from '@/components/theme/no-flash-script'
import { ThemeProvider } from '@/components/theme/theme-provider'
import { Toaster } from '@/components/ui/sonner'
import { Toaster as LegacyToaster } from '@/components/ui-legacy/sonner'
import { readThemePreference } from '@/lib/theme/cookie'
import { htmlThemeClass, parseWorkspace, WORKSPACE_HEADER } from '@/lib/workspace'
import './globals.css'

const inter = Inter({
  subsets: ['latin'],
  variable: '--font-inter',
  display: 'swap',
})

// `weight: 'variable'` sirve el mismo archivo de antes (eje wght 100–900, óptica
// fija en 14), pero declara la cara como `100 900`: el 560 de los títulos y el
// 520 de los números salen exactos. Con la lista de pesos cada uno era una cara
// aparte y un 560 caía en la de 600. El eje `opsz` queda afuera a propósito: por
// encima de opsz 18, Fraunces cambia «h m n s & ñ» por sus formas inclinadas, y
// eso es un cambio de marca que decide el dueño (kit, §8.1).
const fraunces = Fraunces({
  subsets: ['latin'],
  variable: '--font-fraunces',
  display: 'swap',
  weight: 'variable',
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

  // Cada workspace emite su `<html>` desde el server (ver lib/workspace.ts). El
  // salón, ya claro: sin esto el primer paint sale oscuro y recién lo corrige el
  // script del <head> → flash. Lo público, con `legacy-theme` (el scope que
  // congela sus tokens) más `dark` si la cookie lo pide. `data-force-light` le
  // avisa al ThemeProvider que no vuelva a tocar la clase después de hidratar.
  const workspace = parseWorkspace(headerList.get(WORKSPACE_HEADER))
  const salon = workspace === 'salon'
  const themeClass = htmlThemeClass(workspace, preference)

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
        {/* El Toaster va ADENTRO del ThemeProvider: el del kit nuevo sigue el tema
            de la app con useTheme(), que falla fuera del proveedor. El
            ThemeProvider no pinta DOM propio, así que el <section> de los avisos
            sigue siendo hijo directo del <body>. */}
        <ThemeProvider initialPreference={preference}>
          {children}
          {/* El panel usa los avisos del kit (siguen el tema de la app). El salón y
              lo público quedan con el Toaster congelado, igual que antes: sonner
              resuelve su tema solo (`theme="system"` mira el SO, no la clase del
              <html>), así que en el salón hay que decírselo a mano o los toasts
              salen oscuros sobre un panel claro. */}
          {workspace === 'manager' ? (
            <Toaster />
          ) : (
            <LegacyToaster richColors closeButton theme={salon ? 'light' : 'system'} />
          )}
        </ThemeProvider>
      </body>
    </html>
  )
}
