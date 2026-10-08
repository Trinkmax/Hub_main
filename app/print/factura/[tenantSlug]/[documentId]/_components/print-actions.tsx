'use client'

import { ArrowLeft, Printer } from 'lucide-react'
import Link from 'next/link'
import { Button } from '@/components/ui/button'

/** La barra de arriba (no se imprime): volver y «Imprimir o guardar PDF». */
export function PrintActions({ backHref, backLabel }: { backHref: string; backLabel: string }) {
  return (
    <div className="flex flex-col gap-3 print:hidden sm:flex-row sm:items-center sm:justify-between">
      <Link
        href={backHref}
        className="inline-flex min-h-11 items-center gap-1 text-sm font-medium text-neutral-600 hover:text-black md:min-h-0"
      >
        <ArrowLeft className="size-4" aria-hidden />
        {backLabel}
      </Link>
      <Button
        type="button"
        className="h-11 w-full gap-2 sm:w-auto md:h-9"
        onClick={() => window.print()}
      >
        <Printer className="size-4" aria-hidden />
        Imprimir o guardar PDF
      </Button>
    </div>
  )
}
