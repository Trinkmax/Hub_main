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
  images: {
    // Fotos del menú y logos de tenants se sirven desde Supabase Storage.
    // El subdominio coincide con el project ref; lo dejamos abierto a *.supabase.co
    // para que funcione en preview/prod sin reconfiguración.
    remotePatterns: [
      {
        protocol: 'https',
        hostname: '*.supabase.co',
        pathname: '/storage/v1/object/public/**',
      },
    ],
  },
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
      // Mensajería: la sección se consolidó en /mensajeria/*
      { source: '/:slug/bandeja', destination: '/:slug/mensajeria/inbox', permanent: true },
      {
        source: '/:slug/bandeja/:rest*',
        destination: '/:slug/mensajeria/inbox/:rest*',
        permanent: true,
      },
      { source: '/:slug/difusiones', destination: '/:slug/mensajeria/difusiones', permanent: true },
      {
        source: '/:slug/difusiones/:rest*',
        destination: '/:slug/mensajeria/difusiones/:rest*',
        permanent: true,
      },
      { source: '/:slug/flows', destination: '/:slug/mensajeria/flows', permanent: true },
      {
        source: '/:slug/flows/:rest*',
        destination: '/:slug/mensajeria/flows/:rest*',
        permanent: true,
      },
      { source: '/:slug/audiencias', destination: '/:slug/mensajeria/audiencias', permanent: true },
      {
        source: '/:slug/audiencias/:rest*',
        destination: '/:slug/mensajeria/audiencias/:rest*',
        permanent: true,
      },
      {
        source: '/:slug/configuracion/canales',
        destination: '/:slug/mensajeria/canales',
        permanent: true,
      },
      {
        source: '/:slug/configuracion/templates',
        destination: '/:slug/mensajeria/plantillas',
        permanent: true,
      },
      {
        source: '/:slug/configuracion/mensajes-rapidos',
        destination: '/:slug/mensajeria/mensajes-rapidos',
        permanent: true,
      },
      {
        source: '/:slug/configuracion/tags',
        destination: '/:slug/menu/tags',
        permanent: true,
      },
      { source: '/:slug/marketing', destination: '/:slug/mensajeria', permanent: true },
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
