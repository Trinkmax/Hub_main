'use client'

import { Calendar, Columns3, FileDown, FileUp, List, Printer, X } from 'lucide-react'
import { Fragment } from 'react'
import { cn } from '@/lib/utils'
import { Spotlight } from './spotlight'

/**
 * «Mis Comprobantes» (M-03 a M-05 de `arca-pasos.md`, capturas de jun-2025): el banner azul,
 * el aviso amarillo de «hasta el día de ayer», las tarjetas Emitidos y Recibidos, la consulta
 * con el selector de fechas («Mes Pasado») y los resultados con la botonera «Excel · PDF ·
 * CSV». Los textos son los de ARCA, con sus errores de tipeo («Desde esta servicio pode…»).
 */

const BLUE = '#0097d3'
const FONT = { fontFamily: 'Roboto, "Helvetica Neue", Arial, sans-serif' }

/** Filas de ejemplo de los resultados (nombres genéricos, montos inventados). */
const RESULT_ROWS = [
  {
    date: '02/09/2026',
    type: '1 - Factura A',
    number: '00003-00001842',
    name: 'PROVEEDOR EJEMPLO SA',
    total: '$ 125.000,00',
  },
  {
    date: '05/09/2026',
    type: '1 - Factura A',
    number: '00001-00045120',
    name: 'DISTRIBUIDORA EJEMPLO SRL',
    total: '$ 48.300,50',
  },
  {
    date: '11/09/2026',
    type: '6 - Factura B',
    number: '00002-00000318',
    name: 'SERVICIOS EJEMPLO SA',
    total: '$ 9.800,00',
  },
] as const

function Banner({
  title,
  subtitle,
  compact = false,
}: {
  title: string
  subtitle: string
  /** Más bajo en las pantallas de consulta (entra el selector de fechas). */
  compact?: boolean
}) {
  return (
    <div
      className={cn(
        'shrink-0 bg-gradient-to-r from-[#08679a] to-[#0090c9] px-10 text-white',
        compact ? 'pb-3 pt-4' : 'pb-5 pt-6',
      )}
    >
      <p
        className={cn(
          'font-bold leading-none [text-shadow:0_1px_2px_rgba(0,0,0,0.3)]',
          compact ? 'text-[22px]' : 'text-[26px]',
        )}
      >
        {title}
      </p>
      <p
        className={cn(
          'text-[12.5px] [text-shadow:0_1px_1px_rgba(0,0,0,0.25)]',
          compact ? 'mt-1.5' : 'mt-2',
        )}
      >
        {subtitle}
      </p>
    </div>
  )
}

function Tabs({ active }: { active: 'Consulta' | 'Resultados' }) {
  return (
    <div className="flex border-b border-[#ddd] text-[11.5px] font-bold">
      {(['Consulta', 'Resultados', 'Historial'] as const).map((tab) => (
        <span
          key={tab}
          className={cn(
            'px-3 py-1.5',
            tab === active
              ? '-mb-px rounded-t-[3px] border border-b-white border-[#ddd] bg-white text-[#555]'
              : tab === 'Historial'
                ? 'text-[#0d8fcb]'
                : 'text-[#888]',
          )}
        >
          {tab}
        </span>
      ))}
    </div>
  )
}

export function MisComprobantesScreen({ step }: { step: 'inicio' | 'consulta' | 'resultados' }) {
  if (step === 'inicio') {
    return (
      <div className="flex h-full flex-col bg-[#f8f8f8] text-[#333]" style={FONT}>
        <Banner
          title="Mis Comprobantes"
          subtitle="Desde esta servicio pode consultar tus Comprobantes Electrónicos"
        />
        <div className="px-10 pt-4">
          <div className="flex items-start justify-between gap-3 rounded-[3px] border border-[#f3d27a] bg-[#fcf4d9] px-3 py-2 text-[11px] leading-snug">
            <span>
              Tené en cuenta que desde este servicio solamente vas a poder visualizar los{' '}
              <b>comprobantes electrónicos generados hasta el día de ayer</b>.
            </span>
            <X className="mt-0.5 size-3 shrink-0 text-[#aaa]" aria-hidden />
          </div>
          <div className="mt-4 grid grid-cols-2 gap-6">
            <div
              className="flex h-[150px] flex-col justify-end rounded-[3px] px-4 pb-3 text-white shadow-[0_1px_3px_rgba(0,0,0,0.2)]"
              style={{ backgroundColor: BLUE }}
            >
              <FileUp className="mx-auto mb-auto mt-5 size-9 opacity-80" aria-hidden />
              <span className="text-[15px] font-medium">Emitidos</span>
              <span className="text-[12px] opacity-90">Comprobantes Emitidos</span>
            </div>
            <Spotlight label="Tocá «Recibidos»" side="left" inset={4}>
              <div className="flex h-[150px] w-full flex-col overflow-hidden rounded-[3px] bg-white shadow-[0_1px_3px_rgba(0,0,0,0.2)]">
                <div
                  className="flex flex-1 items-center justify-center"
                  style={{ backgroundColor: BLUE }}
                >
                  <FileDown className="size-9 text-white" aria-hidden />
                </div>
                <div className="px-4 py-2.5">
                  <span className="block text-[15px] font-medium text-[#222]">Recibidos</span>
                  <span className="block text-[12px] text-[#777]">Comprobantes Recibidos</span>
                </div>
              </div>
            </Spotlight>
          </div>
        </div>
      </div>
    )
  }

  if (step === 'consulta') {
    return (
      <div className="flex h-full flex-col bg-[#f8f8f8] text-[#333]" style={FONT}>
        <Banner
          title="Comprobantes Recibidos"
          subtitle="Desde esta sección pode consultar tus Comprobantes Recibidos"
          compact
        />
        <div className="relative px-10 pt-2">
          <Tabs active="Consulta" />
          <p className="mt-2 text-[11px] font-bold">
            Fecha del Comprobante <span className="text-[#d33]">*</span>
          </p>
          <div className="mt-1 flex h-[26px] items-center overflow-hidden rounded-[3px] border border-[#ccc] bg-white text-[12px]">
            <span className="flex h-full w-[28px] items-center justify-center border-r border-[#ccc] bg-[#eee]">
              <Calendar className="size-3 text-[#666]" aria-hidden />
            </span>
            <span className="px-2">01/09/2026 - 30/09/2026</span>
          </div>
          <p className="mt-0.5 text-[10px] text-[#888]">Rango máximo: 365 días</p>
          <div className="absolute left-[150px] top-[104px] z-10 flex gap-3 rounded-[4px] border border-[#ccc] bg-white p-2.5 shadow-[0_4px_12px_rgba(0,0,0,0.25)]">
            <div className="grid w-[150px] grid-cols-7 gap-[3px] text-center text-[9px] text-[#333]">
              {['Do', 'Lu', 'Ma', 'Mi', 'Ju', 'Vi', 'Sa'].map((d) => (
                <span key={d} className="font-bold">
                  {d}
                </span>
              ))}
              {Array.from({ length: 30 }, (_, i) => i + 1).map((day) => (
                <span
                  key={day}
                  className={cn(
                    'rounded-[2px] py-[1px]',
                    day === 1 || day === 30 ? 'bg-[#0b78b0] text-white' : 'bg-[#e4f2f9]',
                  )}
                >
                  {day}
                </span>
              ))}
            </div>
            <div className="flex w-[118px] flex-col gap-[3px] text-[9.5px]">
              {['Ayer', 'Últimos 7 Días', 'Últimos 30 Días', 'Este Mes'].map((o) => (
                <span key={o} className="rounded-[2px] bg-[#f0f0f0] px-1.5 py-[2px] text-[#0d8fcb]">
                  {o}
                </span>
              ))}
              <Spotlight label="«Mes Pasado»" side="right" inset={2}>
                <span className="w-full rounded-[2px] bg-[#0b78b0] px-1.5 py-[2px] text-white">
                  Mes Pasado
                </span>
              </Spotlight>
              {['Año Pasado'].map((o) => (
                <span key={o} className="rounded-[2px] bg-[#f0f0f0] px-1.5 py-[2px] text-[#0d8fcb]">
                  {o}
                </span>
              ))}
              <span className="mt-1 flex gap-1">
                <Spotlight n={2} inset={2}>
                  <span className="rounded-[2px] bg-[#2fae63] px-2 py-[2px] font-bold text-white">
                    Aplicar
                  </span>
                </Spotlight>
                <span className="rounded-[2px] border border-[#0d8fcb] px-2 py-[2px] text-[#0d8fcb]">
                  Cancelar
                </span>
              </span>
            </div>
          </div>
          <div className="mt-[168px]">
            <Spotlight n={3} className="w-full" inset={3}>
              <span
                className="flex h-[30px] w-full items-center justify-center rounded-[3px] text-[11px] font-bold text-white"
                style={{ backgroundColor: BLUE }}
              >
                BUSCAR
              </span>
            </Spotlight>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="flex h-full flex-col bg-[#f8f8f8] text-[#333]" style={FONT}>
      <Banner
        title="Comprobantes Recibidos"
        subtitle="Desde esta sección pode consultar tus Comprobantes Recibidos"
        compact
      />
      <div className="px-10 pt-2">
        <Tabs active="Resultados" />
        <div className="mt-2 overflow-hidden rounded-[3px] border border-[#0097d3] bg-white">
          <p
            className="px-3 py-1.5 text-[12px] font-medium text-white"
            style={{ backgroundColor: BLUE }}
          >
            Filtro Aplicado
          </p>
          <p className="px-5 py-1.5 text-[10.5px]">
            • Fecha del Comprobante: <b>01/09/2026</b> a <b>30/09/2026</b>
          </p>
        </div>
        <div className="mt-2.5 flex items-center justify-between">
          <span className="inline-flex rounded-[2px] border border-[#ddd] bg-white text-[9.5px] font-bold text-[#0d8fcb]">
            <span className="border-r border-[#ddd] px-2 py-1">Excel</span>
            <span className="border-r border-[#ddd] px-2 py-1">PDF</span>
            <Spotlight label="Tocá «CSV»: baja un .zip" side="right" inset={2}>
              <span className="px-2 py-1">CSV</span>
            </Spotlight>
            <span className="border-l border-[#ddd] px-1.5 py-1">
              <Columns3 className="size-3" aria-hidden />
            </span>
            <span className="border-l border-[#ddd] px-1.5 py-1">
              <Printer className="size-3" aria-hidden />
            </span>
            <span className="border-l border-[#ddd] px-1.5 py-1">
              <List className="size-3" aria-hidden />
            </span>
          </span>
          <span className="flex items-center gap-1 text-[10px]">
            Buscar:
            <span className="h-[20px] w-[110px] rounded-[2px] border border-[#ccc] bg-white" />
          </span>
        </div>
        <div className="mt-2 grid grid-cols-[70px_90px_100px_minmax(0,1fr)_90px] text-[10px]">
          {['Fecha', 'Tipo', 'Número', 'Denominación Emisor', 'Imp. Total'].map((h) => (
            <span key={h} className="border-b-2 border-[#ddd] py-1 font-bold last:text-right">
              {h}
            </span>
          ))}
          {RESULT_ROWS.map((row) => (
            <Fragment key={row.number}>
              <span className="border-b border-[#eee] py-1">{row.date}</span>
              <span className="border-b border-[#eee] py-1">{row.type}</span>
              <span className="border-b border-[#eee] py-1">{row.number}</span>
              <span className="truncate border-b border-[#eee] py-1 pr-2">{row.name}</span>
              <span className="border-b border-[#eee] py-1 text-right">{row.total}</span>
            </Fragment>
          ))}
        </div>
      </div>
    </div>
  )
}
