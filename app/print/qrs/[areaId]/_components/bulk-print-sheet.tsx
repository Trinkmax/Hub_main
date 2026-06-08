'use client'

import { useEffect } from 'react'
import type { QrSheet } from '@/lib/tables/qr-pdf'

export function BulkPrintSheet({
  sheets,
  areaName,
  tenantName,
}: {
  sheets: QrSheet[]
  areaName: string
  tenantName: string
}) {
  useEffect(() => {
    if (sheets.length === 0) return
    let done = false
    const print = () => {
      if (done) return
      done = true
      window.print()
    }
    // Imprimir recién cuando los QR (data-URLs) decodificaron, con fallback por
    // si algún decode falla (no dejar la impresión sin disparar).
    const decodes = sheets.map((s) => {
      const img = new Image()
      img.src = s.qrDataUrl
      return img.decode().catch(() => undefined)
    })
    const fallback = setTimeout(print, 3000)
    void Promise.all(decodes).then(() => {
      clearTimeout(fallback)
      print()
    })
    return () => clearTimeout(fallback)
  }, [sheets])

  return (
    <main className="min-h-screen bg-white p-6 text-black">
      <style>{`
        @page { size: A4 portrait; margin: 10mm; }
        @media print { .no-print { display: none; } body { background: white; } }
      `}</style>

      <div className="no-print mb-4 flex items-center justify-between">
        <div>
          <p className="text-xs uppercase tracking-widest text-gray-500">{tenantName}</p>
          <h1 className="text-xl font-bold">QRs · {areaName}</h1>
          <p className="text-sm text-gray-500">{sheets.length} mesas</p>
        </div>
        <button
          type="button"
          className="rounded-lg bg-black px-4 py-2 text-sm text-white"
          onClick={() => window.print()}
        >
          Imprimir
        </button>
      </div>

      {sheets.length === 0 ? (
        <p className="text-sm text-gray-600">
          No hay mesas ubicadas en esta área. Colocá mesas en el plano para imprimir sus QR.
        </p>
      ) : (
        <div className="grid grid-cols-2 gap-4">
          {sheets.map((s) => (
            <div
              key={s.qrUrl}
              className="flex break-inside-avoid flex-col items-center gap-2 rounded-xl border border-gray-300 p-4"
            >
              <p className="text-[10px] uppercase tracking-widest text-gray-400">{s.tenantName}</p>
              <h2 className="text-2xl font-bold">{s.tableLabel}</h2>
              {/* biome-ignore lint/performance/noImgElement: data-url QR para impresión, Next/Image no aplica */}
              <img src={s.qrDataUrl} alt={`QR de ${s.tableLabel}`} className="size-44" />
              <p className="text-center text-xs text-gray-600">
                Escaneá para ver la carta y pedir.
              </p>
            </div>
          ))}
        </div>
      )}
    </main>
  )
}
