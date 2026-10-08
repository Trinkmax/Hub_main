'use client'

import { CircleUserRound, DollarSign, Laptop, Mail, Search, SquareCheck, Users } from 'lucide-react'
import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'
import { useMockData } from './mock-data'
import { Spotlight } from './spotlight'

/**
 * El portal nuevo de ARCA (P-01 a P-03 y M-01 de `arca-pasos.md`): cabecera blanca «ARCA |
 * AGENCIA DE RECAUDACIÓN Y CONTROL ADUANERO» con tu nombre a la derecha, la franja azul marino
 * con los íconos redondos y el buscador grande «¿Qué necesitás?».
 */

const NAVY = '#232a4e'
const CYAN = '#56c6e6'
const LINK = '#169bd5'

export type PortalIcon = 'cuenta' | 'rut' | 'presentaciones' | 'relaciones' | 'domicilio'

const ICONS: ReadonlyArray<{ key: PortalIcon; label: [string, string]; icon: typeof Users }> = [
  { key: 'cuenta', label: ['Estado de', 'cuenta'], icon: DollarSign },
  { key: 'rut', label: ['Registro Único', 'Tributario'], icon: SquareCheck },
  { key: 'presentaciones', label: ['Presentaciones', 'Digitales'], icon: Laptop },
  { key: 'relaciones', label: ['Administrador', 'de relaciones'], icon: Users },
  { key: 'domicilio', label: ['Domicilio Fiscal', 'Electrónico'], icon: Mail },
]

export function ArcaWordmark({ tone = 'navy' }: { tone?: 'navy' | 'white' }) {
  const color = tone === 'navy' ? NAVY : '#ffffff'
  return (
    <span className="flex items-center gap-2" style={{ color }}>
      <span
        className="text-[25px] font-black leading-none tracking-[0.02em]"
        style={{ fontFamily: 'Montserrat, "Arial Black", Arial, sans-serif' }}
      >
        ARCA
      </span>
      <span className="h-[22px] w-px" style={{ backgroundColor: color }} />
      <span className="text-[7.5px] font-semibold uppercase leading-[1.15] tracking-[0.08em]">
        Agencia de Recaudación
        <br />y Control Aduanero
      </span>
    </span>
  )
}

export function PortalScreen({
  query,
  highlight,
  highlightLabel = 'Tocá acá',
  children,
  className,
}: {
  /** Lo escrito en el buscador (sin esto, el texto gris de ayuda). */
  query?: string
  /** Un ícono de la franja azul con su globito. */
  highlight?: PortalIcon
  highlightLabel?: string
  /** Lo que va debajo del buscador (el resultado). Sin esto, «Servicios | Más utilizados». */
  children?: ReactNode
  className?: string
}) {
  const data = useMockData()
  return (
    <div
      className={cn('flex h-full flex-col bg-white text-[#222]', className)}
      style={{ fontFamily: 'Roboto, "Helvetica Neue", Arial, sans-serif' }}
    >
      <div className="flex h-[48px] shrink-0 items-center justify-between px-12">
        <ArcaWordmark />
        <span className="flex items-center gap-1.5 text-[10.5px]">
          <b style={{ color: LINK }}>{data.personName}</b>
          <span className="text-[#444]">[{data.personCuit}]</span>
          <CircleUserRound className="size-[22px]" style={{ color: LINK }} aria-hidden />
        </span>
      </div>
      <div className="h-[3px] shrink-0" style={{ backgroundColor: CYAN }} />
      <div className="relative shrink-0 pb-[26px]" style={{ backgroundColor: NAVY }}>
        <div className="flex justify-between px-10 pt-5 pb-3">
          {ICONS.map(({ key, label, icon: Icon }) => {
            const circle = (
              <span className="relative flex size-[40px] items-center justify-center rounded-full border-2 border-white text-white">
                <Icon className="size-[18px]" aria-hidden />
                {key === 'domicilio' ? (
                  <span className="absolute -right-2 -top-1.5 rounded-full bg-[#d64545] px-1 text-[8px] font-bold leading-[13px] text-white">
                    1
                  </span>
                ) : null}
              </span>
            )
            return (
              <span key={key} className="flex items-center gap-2 text-white">
                {highlight === key ? (
                  <Spotlight label={highlightLabel} side="bottom" rounded="rounded-full" inset={4}>
                    {circle}
                  </Spotlight>
                ) : (
                  circle
                )}
                <span className="text-[10.5px] font-medium leading-[1.2]">
                  {label[0]}
                  <br />
                  {label[1]}
                  {key === 'domicilio' ? (
                    <span className="block text-[7.5px] font-normal opacity-90">
                      Tenés notificaciones
                    </span>
                  ) : null}
                </span>
              </span>
            )
          })}
        </div>
        <div className="absolute inset-x-0 bottom-0 h-[8px]" style={{ backgroundColor: CYAN }} />
        <div className="absolute inset-x-[48px] -bottom-[14px] flex h-[34px] items-center justify-between rounded-[3px] bg-white px-3 shadow-[0_2px_6px_rgba(0,0,0,0.25)]">
          {query ? (
            <span className="text-[13px] font-medium text-[#333]">{query}</span>
          ) : (
            <span className="text-[13px] font-medium text-[#6d6d6d]">
              ¿Qué necesitás? | Buscá trámites y servicios
            </span>
          )}
          <Search className="size-4 text-[#7a7a7a]" aria-hidden />
        </div>
      </div>
      <div className="min-h-0 flex-1 px-[48px] pt-[26px]">{children ?? <MostUsed />}</div>
    </div>
  )
}

/** «Servicios | Más utilizados» con sus tarjetas. */
export function MostUsed() {
  const cards = [
    'Aceptación de Designación',
    'Administración de Certificados Digitales',
    'Mis Comprobantes',
    'Domicilio Fiscal Electrónico',
  ]
  return (
    <div>
      <p className="text-[17px] font-bold text-[#333]">
        Servicios | <span style={{ color: LINK }}>Más utilizados</span>
      </p>
      <div className="mt-2 grid grid-cols-5 rounded-[3px] border border-[#e1e1e1] py-2 shadow-[0_1px_3px_rgba(0,0,0,0.12)]">
        {cards.map((c) => (
          <span
            key={c}
            className="flex items-center justify-center border-r border-[#e1e1e1] px-2 text-center text-[10.5px] leading-tight text-[#222]"
          >
            {c}
          </span>
        ))}
        <span className="flex items-center justify-center text-[11px]" style={{ color: LINK }}>
          Ver todos
        </span>
      </div>
    </div>
  )
}

/** La tarjeta que aparece al buscar: el nombre del servicio y su descripción. */
export function PortalSearchResult({
  title,
  description,
  highlightLabel = 'Tocá acá',
}: {
  title: string
  description: string
  /** `null`: sin globito. */
  highlightLabel?: string | null
}) {
  const card = (
    <span className="flex w-[624px] flex-col gap-1 rounded-[3px] bg-white px-4 py-3 shadow-[0_1px_4px_rgba(0,0,0,0.2)]">
      <span className="text-[15px] text-[#6a6a6a]">{title}</span>
      <span className="text-[8.5px] font-bold text-[#555]">{description}</span>
    </span>
  )
  return (
    <div className="pt-1">
      {highlightLabel ? (
        <Spotlight label={highlightLabel} side="bottom" inset={4}>
          {card}
        </Spotlight>
      ) : (
        card
      )}
    </div>
  )
}
