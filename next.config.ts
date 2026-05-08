import type { NextConfig } from 'next'

const securityHeaders = [
  {
    key: 'Strict-Transport-Security',
    value: 'max-age=63072000; includeSubDomains; preload',
  },
  {
    key: 'X-Content-Type-Options',
    value: 'nosniff',
  },
  {
    key: 'Referrer-Policy',
    value: 'strict-origin-when-cross-origin',
  },
  {
    key: 'X-Frame-Options',
    value: 'DENY',
  },
  {
    key: 'Permissions-Policy',
    value: 'camera=(), microphone=(), geolocation=(), interest-cohort=()',
  },
]

const nextConfig: NextConfig = {
  turbopack: {},
  async headers() {
    return [
      {
        source: '/:path*',
        headers: securityHeaders,
      },
    ]
  },
  async redirects() {
    return [
      // Catálogo: puntos y punch-cards subieron a top-level (eran sub-rutas de configuración)
      {
        source: '/:slug/configuracion/puntos',
        destination: '/:slug/puntos',
        permanent: true,
      },
      {
        source: '/:slug/configuracion/puntos/:rest*',
        destination: '/:slug/puntos/:rest*',
        permanent: true,
      },
      {
        source: '/:slug/configuracion/punch-cards',
        destination: '/:slug/punch-cards',
        permanent: true,
      },
      {
        source: '/:slug/configuracion/punch-cards/:rest*',
        destination: '/:slug/punch-cards/:rest*',
        permanent: true,
      },
      // Salón: sesiones y cocina migraron al workspace de salón
      {
        source: '/:slug/sesiones',
        destination: '/:slug/salon/mesas',
        permanent: true,
      },
      {
        source: '/:slug/sesiones/:rest*',
        destination: '/:slug/salon/mesas/:rest*',
        permanent: true,
      },
      {
        source: '/:slug/cocina',
        destination: '/:slug/salon/cocina',
        permanent: true,
      },
      {
        source: '/:slug/cocina/:rest*',
        destination: '/:slug/salon/cocina/:rest*',
        permanent: true,
      },
      // Visitas global → CRM de clientes (sin job-to-be-done propio en el nav)
      {
        source: '/:slug/visitas',
        destination: '/:slug/clientes',
        permanent: false,
      },
    ]
  },
}

export default nextConfig
