'use client'

import { Printer } from 'lucide-react'
import Image from 'next/image'
import { Button } from '@/components/ui/button'

export function CustomerQrPrint({
  tenantName,
  firstName,
  lastName,
  qrDataUrl,
  panelUrl,
}: {
  tenantName: string
  firstName: string
  lastName: string
  qrDataUrl: string
  panelUrl: string
}) {
  return (
    <main className="min-h-screen bg-white text-black">
      <div className="mx-auto max-w-md px-6 py-10 print:py-0">
        <header className="flex items-center justify-between gap-3 print:hidden">
          <p className="text-sm text-neutral-500">Hoja imprimible · A6 / tarjeta</p>
          <Button onClick={() => window.print()} size="sm" className="gap-2">
            <Printer className="size-3.5" />
            Imprimir
          </Button>
        </header>

        <article className="mt-6 rounded-2xl border border-neutral-200 p-8 text-center shadow-sm print:mt-0 print:border-none print:shadow-none">
          <p className="text-xs font-medium uppercase tracking-[0.2em] text-neutral-500">
            {tenantName}
          </p>
          <h1 className="mt-1 font-display text-2xl font-semibold">
            {firstName} {lastName}
          </h1>

          <div className="mx-auto mt-4 size-64 overflow-hidden rounded-xl bg-white p-3 ring-1 ring-neutral-200">
            <Image
              src={qrDataUrl}
              alt="QR cliente"
              width={256}
              height={256}
              className="size-full"
              unoptimized
              priority
            />
          </div>

          <p className="mt-4 text-sm font-medium text-neutral-700">Acumulá puntos en cada visita</p>
          <p className="mt-1 break-all font-mono text-[10px] text-neutral-400">{panelUrl}</p>
          <p className="mt-4 text-[11px] text-neutral-500">
            Mostrá este QR en la caja. Solo el bar puede regenerarlo.
          </p>
        </article>
      </div>
    </main>
  )
}
