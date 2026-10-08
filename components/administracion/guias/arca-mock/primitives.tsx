import { ChevronDown, Download, Settings } from 'lucide-react'
import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'

/**
 * Los controles de las maquetas de ARCA, con la apariencia de cada familia de pantallas
 * (`arca-pasos.md` §11): los servicios viejos (botones azules con degradé y texto tal cual,
 * «BUSCAR», «Nueva Relación»), el portal nuevo (botones planos celestes) y las ventanas grises
 * del ABM de puntos de venta. Son dibujos: nada de esto es un control de verdad (las maquetas
 * van con `aria-hidden` y cada instrucción está también en texto).
 *
 * Colores fijos (la paleta de ARCA, clara en los dos temas): no usan los tokens del panel.
 */

type ButtonVariant = 'legacy' | 'portal' | 'portalOutline' | 'modal' | 'file'

const BUTTON: Readonly<Record<ButtonVariant, string>> = {
  legacy:
    'rounded-[3px] border border-[#0b5c8d] bg-gradient-to-b from-[#48ade1] to-[#0e6aa3] px-3 py-[5px] text-[11px] font-bold text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.35),0_1px_2px_rgba(0,0,0,0.3)]',
  portal: 'rounded-[4px] bg-[#169bd5] px-4 py-[9px] text-[13px] font-bold tracking-wide text-white',
  portalOutline:
    'rounded-[4px] border border-[#169bd5] bg-white px-4 py-[8px] text-[13px] font-bold tracking-wide text-[#169bd5]',
  modal:
    'gap-1.5 rounded-[6px] border border-[#c8c8c8] bg-gradient-to-b from-white to-[#e9e9e9] px-3 py-[6px] text-[13px] font-bold text-[#1d3a5f] shadow-[0_1px_2px_rgba(0,0,0,0.15)]',
  file: 'rounded-[3px] border border-[#8f8f8f] bg-gradient-to-b from-[#fbfbfb] to-[#dcdcdc] px-2 py-[2px] text-[11px] text-black',
}

export function MockButton({
  variant = 'legacy',
  children,
  className,
}: {
  variant?: ButtonVariant
  children: ReactNode
  className?: string
}) {
  return (
    <span
      className={cn(
        'inline-flex items-center justify-center whitespace-nowrap leading-none',
        BUTTON[variant],
        className,
      )}
    >
      {children}
    </span>
  )
}

/** Un desplegable cerrado o abierto (`open`): las opciones abajo y la resaltada en azul. */
export function MockSelect({
  value,
  open = false,
  options = [],
  selected,
  muted = false,
  className,
  size = 'md',
}: {
  value: ReactNode
  open?: boolean
  options?: readonly string[]
  /** La opción resaltada en la lista abierta. */
  selected?: string
  /** Gris (deshabilitado), como «Representado» en «Incorporar nueva Relación». */
  muted?: boolean
  className?: string
  size?: 'sm' | 'md' | 'lg'
}) {
  return (
    <span className={cn('relative inline-flex', className)}>
      <span
        className={cn(
          'flex w-full items-center justify-between gap-2 rounded-[4px] border bg-white',
          size === 'sm' && 'h-[20px] px-1.5 text-[10.5px]',
          size === 'md' && 'h-[24px] px-2 text-[12px]',
          size === 'lg' && 'h-[30px] px-2.5 text-[14px]',
          muted ? 'border-[#c4c4c4] text-[#7b7b7b]' : 'border-[#9a9a9a] text-black',
        )}
      >
        <span className="truncate">{value}</span>
        <ChevronDown className="size-3 shrink-0 text-[#444]" aria-hidden />
      </span>
      {open && options.length > 0 ? (
        <span className="absolute left-0 right-0 top-full z-10 mt-px flex flex-col border border-[#7a7a7a] bg-white py-0.5 shadow-[0_3px_8px_rgba(0,0,0,0.25)]">
          {options.map((option) => (
            <span
              key={option}
              className={cn(
                'truncate px-2 py-[3px]',
                size === 'sm' ? 'text-[10.5px]' : size === 'lg' ? 'text-[14px]' : 'text-[12px]',
                option === selected ? 'bg-[#1a73e8] text-white' : 'text-black',
              )}
            >
              {option}
            </span>
          ))}
        </span>
      ) : null}
    </span>
  )
}

/** Un campo de texto (con valor o con el texto gris de ayuda). */
export function MockInput({
  value,
  placeholder,
  className,
  size = 'md',
  mono = false,
}: {
  value?: ReactNode
  placeholder?: string
  className?: string
  size?: 'sm' | 'md' | 'lg'
  mono?: boolean
}) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-[3px] border border-[#9a9a9a] bg-white',
        size === 'sm' && 'h-[20px] px-1.5 text-[10.5px]',
        size === 'md' && 'h-[24px] px-2 text-[12px]',
        size === 'lg' && 'h-[34px] px-3 text-[14px]',
        mono && 'font-mono',
        className,
      )}
    >
      {value ? (
        <span className="truncate text-black">{value}</span>
      ) : (
        <span className="truncate text-[#9a9a9a]">{placeholder}</span>
      )}
    </span>
  )
}

/** «Examinar…» + el nombre del archivo elegido (o «No se seleccionó un archivo.»). */
export function MockFile({ fileName }: { fileName?: string | null }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-[12px] text-black">
      <MockButton variant="file">Examinar...</MockButton>
      <span>{fileName ? fileName : 'No se seleccionó un archivo.'}</span>
    </span>
  )
}

/** La rueda gris de cada servicio en el árbol de «Selección de Servicio a Habilitar». */
export function MockGear({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        'inline-flex size-[18px] shrink-0 items-center justify-center rounded-full bg-gradient-to-b from-[#d9d9d9] to-[#9b9b9b] text-white',
        className,
      )}
    >
      <Settings className="size-3" aria-hidden />
    </span>
  )
}

/** Las dos personitas de la caja «Bienvenido Usuario…». */
export function MockPeopleIcon() {
  return (
    <span className="relative inline-flex h-[26px] w-[30px] shrink-0 items-end justify-center rounded-[3px] bg-white">
      <span className="absolute left-[4px] top-[3px] size-[9px] rounded-full bg-[#3b7fc4]" />
      <span className="absolute bottom-[3px] left-[2px] h-[9px] w-[13px] rounded-t-full bg-[#3b7fc4]" />
      <span className="absolute right-[5px] top-[6px] size-[10px] rounded-full bg-[#f2a33a]" />
      <span className="absolute bottom-[2px] right-[2px] h-[10px] w-[15px] rounded-t-full bg-[#f2a33a]" />
    </span>
  )
}

/** El ícono azul de «Descargar» del detalle del certificado. */
export function MockDownloadIcon() {
  return (
    <span className="inline-flex size-[18px] items-center justify-center rounded-[3px] bg-gradient-to-b from-[#6db8ea] to-[#2b7fc0] text-white shadow-[0_1px_2px_rgba(0,0,0,0.3)]">
      <Download className="size-3" aria-hidden />
    </span>
  )
}

/** Una tabla de ARCA (encabezado celeste, filas blancas). */
export function MockTable({
  columns,
  rows,
  className,
  headClassName,
  cellClassName,
}: {
  columns: readonly ReactNode[]
  rows: ReadonlyArray<readonly ReactNode[]>
  className?: string
  headClassName?: string
  cellClassName?: string
}) {
  return (
    <span
      className={cn('inline-grid text-[11px]', className)}
      style={{ gridTemplateColumns: `repeat(${columns.length}, auto)` }}
    >
      {columns.map((column, i) => (
        <span
          // biome-ignore lint/suspicious/noArrayIndexKey: columnas fijas de un dibujo
          key={`h${i}`}
          className={cn(
            'bg-[#dcf0fb] px-2 py-[3px] text-center font-bold text-black',
            headClassName,
          )}
        >
          {column}
        </span>
      ))}
      {rows.map((row, r) =>
        row.map((cell, c) => (
          <span
            // biome-ignore lint/suspicious/noArrayIndexKey: filas fijas de un dibujo
            key={`c${r}-${c}`}
            className={cn('px-2 py-[3px] text-black', cellClassName)}
          >
            {cell}
          </span>
        )),
      )}
    </span>
  )
}
