'use client'

import { useEffect } from 'react'
import type { QrSheet } from '@/lib/tables/qr-pdf'

export function PrintSheet({ sheet }: { sheet: QrSheet }) {
  useEffect(() => {
    const t = setTimeout(() => window.print(), 500)
    return () => clearTimeout(t)
  }, [])

  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-4 bg-white p-6 text-black">
      <style>{`
        @page { size: A6 portrait; margin: 8mm; }
        @media print { .no-print { display: none; } body { background: white; } }
      `}</style>
      <div className="text-center">
        <p className="text-xs uppercase tracking-widest text-gray-500">{sheet.tenantName}</p>
        <h1 className="mt-1 text-3xl font-bold">{sheet.tableLabel}</h1>
      </div>
      {/* biome-ignore lint/performance/noImgElement: data-url QR para impresión, Next/Image no aplica */}
      <img src={sheet.qrDataUrl} alt={`QR de ${sheet.tableLabel}`} className="size-72" />
      <p className="text-center text-sm text-gray-700">
        Escaneá para ver la carta y pedir desde tu celular.
      </p>
      <p className="break-all text-center text-[10px] text-gray-400">{sheet.qrUrl}</p>
      <button
        type="button"
        className="no-print mt-6 rounded-lg bg-black px-4 py-2 text-sm text-white"
        onClick={() => window.print()}
      >
        Imprimir
      </button>
    </main>
  )
}
