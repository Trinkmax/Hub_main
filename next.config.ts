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
    // NUNCA usamos el optimizador de Vercel: la cuota Hobby (5K transformaciones/
    // mes, POR CUENTA) se agota y `/_next/image` devuelve 402, rompiendo todas las
    // imágenes. En su lugar, un custom loader enruta las imágenes de Supabase
    // Storage al endpoint `render/image` de Supabase (imgproxy propio, incluido en
    // Pro) — redimensiona al ancho pedido y negocia avif/webp por `Accept`.
    // Todo lo demás (data URLs de QR, estáticos, externas) se sirve directo.
    // Ver lib/images/supabase-loader.ts para la lógica exacta.
    loader: 'custom',
    loaderFile: './lib/images/supabase-loader.ts',
    // El bar no sirve fotos > 1920px; recortar la escalera evita generar una
    // variante de 2048/3840 que Supabase clamparía a 2500 igual.
    deviceSizes: [640, 750, 828, 1080, 1200, 1920],
    // Defensivo: con custom loader Next no valida remotePatterns, pero lo dejamos
    // cubriendo object + render por si alguna imagen se sirve sin loader.
    remotePatterns: [
      {
        protocol: 'https',
        hostname: '*.supabase.co',
        pathname: '/storage/v1/**',
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
