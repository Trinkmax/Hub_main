import { headers } from 'next/headers'
import Link from 'next/link'
import { PATH_HEADER } from '@/lib/workspace'

/**
 * Película o entrada que no existe. El link vuelve a la cartelera del MISMO
 * bar (sale del path que marcó el proxy): mandar a «/» llevaba al login.
 */
export default async function EntradasNotFound() {
  const path = (await headers()).get(PATH_HEADER) ?? ''
  const slug = /^\/entradas\/([a-z0-9-]{2,40})(?:\/|$)/.exec(path)?.[1] ?? null

  return (
    <main className="ent-hero flex min-h-[100dvh] flex-col items-center justify-center px-6 text-center">
      <div className="ent-beam" aria-hidden />
      <p className="ent-mono ent-rise text-[0.7rem] text-(--ent-gold)">Fin de la función</p>
      <h1
        className="ent-display ent-rise mt-4 max-w-md text-5xl text-balance"
        style={{ '--d': 120 } as React.CSSProperties}
      >
        Esta página no está en cartelera.
      </h1>
      <p
        className="ent-rise mt-4 max-w-sm text-(--ent-cream-2)"
        style={{ '--d': 240 } as React.CSSProperties}
      >
        Puede que la película ya no esté a la venta o que el link tenga un error.
      </p>
      {slug ? (
        <Link
          href={`/entradas/${slug}`}
          className="ent-press ent-rise mt-8 inline-flex h-12 items-center rounded-full border border-(--ent-line-strong) px-6 text-sm font-semibold"
          style={{ '--d': 360 } as React.CSSProperties}
        >
          Ver la cartelera
        </Link>
      ) : null}
    </main>
  )
}
