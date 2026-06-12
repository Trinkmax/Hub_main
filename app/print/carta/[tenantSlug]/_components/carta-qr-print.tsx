'use client'

import { Printer, UtensilsCrossed } from 'lucide-react'
import Image from 'next/image'
import { Button } from '@/components/ui/button'

export function CartaQrPrint({
  tenantName,
  qrDataUrl,
  cartaUrl,
}: {
  tenantName: string
  qrDataUrl: string
  cartaUrl: string
}) {
  return (
    <main className="min-h-screen bg-white text-black">
      <div className="mx-auto max-w-md px-6 py-10 print:py-0">
        <header className="flex items-center justify-between gap-3 print:hidden">
          <p className="text-sm text-neutral-500">Hoja imprimible · A6 / tarjeta de mesa</p>
          <Button onClick={() => window.print()} size="sm" className="gap-2">
            <Printer className="size-3.5" />
            Imprimir
          </Button>
        </header>

        <article className="mt-6 rounded-2xl border border-neutral-200 p-8 text-center shadow-sm print:mt-0 print:border-none print:shadow-none">
          <div className="mx-auto flex size-10 items-center justify-center rounded-xl bg-neutral-100 text-neutral-500">
            <UtensilsCrossed className="size-5" aria-hidden />
          </div>
          <p className="mt-3 text-xs font-medium uppercase tracking-[0.2em] text-neutral-500">
            {tenantName}
          </p>
          <h1 className="mt-1 font-display text-2xl font-semibold">Nuestra carta</h1>

          <div className="mx-auto mt-4 size-64 overflow-hidden rounded-xl bg-white p-3 ring-1 ring-neutral-200">
            <Image
              src={qrDataUrl}
              alt="QR de la carta"
              width={256}
              height={256}
              className="size-full"
              unoptimized
              priority
            />
          </div>

          <p className="mt-4 text-sm font-medium text-neutral-700">
            Escaneá el código para ver la carta
          </p>
          <p className="mt-1 break-all font-mono text-[10px] text-neutral-400">{cartaUrl}</p>
        </article>
      </div>
    </main>
  )
}
