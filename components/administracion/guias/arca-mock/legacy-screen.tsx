'use client'

import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'
import { useMockData } from './mock-data'
import { MockPeopleIcon } from './primitives'
import { Spotlight, type SpotlightSide } from './spotlight'

/**
 * Los servicios viejos de ARCA (Administrador de Relaciones, Certificados Digitales): barra
 * izquierda negra con «ARCA», los botones «››› ACCESO CON CLAVE FISCAL» y «››› TRÁMITES Y
 * SERVICIOS», la lista de categorías y, a la derecha, el título, la caja celeste «Bienvenido
 * Usuario… / Actuando en representación de…» y el contenido (capturas P-04 a P-09 y C-03 a
 * C-06 de `arca-pasos.md`).
 */

const CATEGORIES = [
  'Autónomos',
  'Contribuyentes Régimen General',
  'Empleadores',
  'Empleados',
  'Futuros Contribuyentes',
  'Monotributistas',
  'Empleados de Casas Particulares',
  'Operadores de Comercio Exterior',
  'Viajeros',
  'Usuarios Aduaneros',
] as const

export function LegacySidebar() {
  return (
    <div className="flex w-[158px] shrink-0 flex-col gap-2.5 bg-black px-2.5 pt-4">
      <span
        className="text-center text-[31px] font-black leading-none tracking-[0.03em] text-white"
        style={{ fontFamily: '"Arial Black", Arial, Helvetica, sans-serif' }}
      >
        ARCA
      </span>
      <span className="mt-2 flex h-[19px] items-center justify-center gap-1 border-2 border-[#8fd6f2] bg-[#1e9bd6] text-[8.5px] font-bold text-white">
        <span className="text-[#ffe14d]">›››</span> ACCESO CON CLAVE FISCAL
      </span>
      <span className="flex h-[19px] items-center justify-end gap-1 border-2 border-[#d9b600] bg-[#262626] pr-1.5 text-[8.5px] font-bold text-[#f1cf00]">
        ››› TRÁMITES Y SERVICIOS
      </span>
      <span className="mt-1.5 flex flex-col text-[10px] font-bold leading-[1.25] text-[#a6dcf0]">
        {CATEGORIES.map((c) => (
          <span key={c} className="border-b border-[#4d4d4d] py-[3px]">
            {c}
          </span>
        ))}
      </span>
    </div>
  )
}

/** «Bienvenido Usuario…» y, si representás a alguien, «Actuando en representación de…». */
export function WelcomeBox({
  acting = 'sas',
  highlight,
}: {
  /** `sas`: representando a la SAS (lo correcto) · `self`: a vos mismo (el error) · `none`. */
  acting?: 'sas' | 'self' | 'none'
  highlight?: { label: string; n?: number; side?: SpotlightSide }
}) {
  const data = useMockData()
  const who =
    acting === 'sas'
      ? `${data.sasName} [${data.sasCuit}]`
      : `${data.personName} [${data.personCuit}]`
  const actingLine =
    acting === 'none' ? null : (
      <span className="block">
        Actuando en representación de <b>{who}</b>
      </span>
    )
  return (
    <div className="flex items-center gap-2 bg-[#dcf0fb] px-2 py-1.5">
      <MockPeopleIcon />
      <div className="min-w-0 space-y-[3px] text-[10.5px] leading-tight text-black">
        <span className="block">
          Bienvenido Usuario{' '}
          <b>
            {data.personName} [{data.personCuit}]
          </b>
        </span>
        {actingLine && highlight ? (
          <Spotlight
            label={highlight.label}
            n={highlight.n}
            side={highlight.side ?? 'bottom'}
            inset={3}
          >
            {actingLine}
          </Spotlight>
        ) : (
          actingLine
        )}
      </div>
    </div>
  )
}

export function LegacyScreen({
  title,
  acting = 'sas',
  highlightActing,
  children,
  className,
  contentClassName,
}: {
  title: string
  acting?: 'sas' | 'self' | 'none'
  highlightActing?: { label: string; n?: number; side?: SpotlightSide }
  children?: ReactNode
  className?: string
  /** El ancho y la alineación de la columna de contenido (centrada, como en ARCA). */
  contentClassName?: string
}) {
  return (
    <div className={cn('flex h-full bg-white', className)}>
      <LegacySidebar />
      <div className="min-w-0 flex-1 px-4 pt-3">
        <p className="text-[17px] font-bold leading-tight text-black">{title}</p>
        <div className={cn('mx-auto mt-1.5 w-[452px]', contentClassName)}>
          <WelcomeBox acting={acting} highlight={highlightActing} />
          {children ? <div className="mt-3">{children}</div> : null}
        </div>
      </div>
    </div>
  )
}

/** Una tabla celeste de ARCA con título centrado («Incorporar nueva Relación»). */
export function LegacyPanel({
  title,
  children,
  className,
}: {
  title: string
  children: ReactNode
  className?: string
}) {
  return (
    <div className={cn('flex flex-col gap-[2px] bg-white text-[10.5px] text-black', className)}>
      <div className="bg-[#dcf0fb] px-2 py-[6px] text-center font-bold">{title}</div>
      {children}
    </div>
  )
}

/** Un renglón «etiqueta · valor · botón» de esas tablas. */
export function LegacyRow({
  label,
  value,
  action,
  className,
}: {
  label: ReactNode
  value: ReactNode
  action?: ReactNode
  className?: string
}) {
  return (
    <div className={cn('flex gap-[2px]', className)}>
      <div className="flex w-[118px] shrink-0 items-center bg-[#e6f4fc] px-2 py-[7px]">{label}</div>
      <div className="flex min-w-0 flex-1 items-center bg-[#f1f9fe] px-2 py-[7px]">{value}</div>
      {action ? (
        <div className="flex w-[86px] shrink-0 items-center justify-center bg-[#f1f9fe] px-1">
          {action}
        </div>
      ) : null}
    </div>
  )
}
