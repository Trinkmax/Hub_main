'use client'

import { useCallback, useEffect, useState } from 'react'
import {
  DEFAULT_PRINTER,
  type PrintedLog,
  type PrinterSettings,
  parsePrinted,
  parsePrinter,
  printedKey,
  printerKey,
} from '@/lib/pos/print/station'

/**
 * Los ajustes de la comandera de ESTE dispositivo (por sucursal), guardados en el navegador.
 *
 * Quien cambia un ajuste y quien imprime son componentes distintos (la hoja de la impresora y el que
 * imprime solo): se avisan con un evento de la ventana, y entre pestañas con el de `storage`.
 */

const CHANGED = 'hub:pos:printer-changed'

function readJson(key: string): unknown {
  try {
    const raw = window.localStorage.getItem(key)
    return raw ? (JSON.parse(raw) as unknown) : null
  } catch {
    return null
  }
}

function writeJson(key: string, value: unknown): boolean {
  try {
    window.localStorage.setItem(key, JSON.stringify(value))
    return true
  } catch {
    // Sin almacenamiento (modo privado, disco lleno): vale mientras la pestaña siga abierta.
    return false
  }
}

export function readPrinter(branchId: string): PrinterSettings {
  return parsePrinter(readJson(printerKey(branchId)))
}

export function writePrinter(branchId: string, settings: PrinterSettings): void {
  writeJson(printerKey(branchId), settings)
  window.dispatchEvent(new CustomEvent(CHANGED, { detail: { branchId } }))
}

export function readPrinted(branchId: string): PrintedLog {
  return parsePrinted(readJson(printedKey(branchId)))
}

export function writePrinted(branchId: string, log: PrintedLog): void {
  writeJson(printedKey(branchId), log)
}

/** Los ajustes de la comandera de este dispositivo, al día con lo que se cambie en cualquier lado. */
export function usePrinter(branchId: string | null): {
  /** `false` hasta leer lo guardado (en el servidor y en el primer dibujo no hay navegador). */
  ready: boolean
  settings: PrinterSettings
  update: (next: PrinterSettings) => void
} {
  const [state, setState] = useState<{ ready: boolean; settings: PrinterSettings }>({
    ready: false,
    settings: DEFAULT_PRINTER,
  })

  useEffect(() => {
    if (!branchId) {
      setState({ ready: true, settings: DEFAULT_PRINTER })
      return
    }
    const load = () => setState({ ready: true, settings: readPrinter(branchId) })
    load()
    const onChanged = (event: Event) => {
      const detail = (event as CustomEvent<{ branchId?: string }>).detail
      if (!detail?.branchId || detail.branchId === branchId) load()
    }
    const onStorage = (event: StorageEvent) => {
      if (event.key === null || event.key === printerKey(branchId)) load()
    }
    window.addEventListener(CHANGED, onChanged)
    window.addEventListener('storage', onStorage)
    return () => {
      window.removeEventListener(CHANGED, onChanged)
      window.removeEventListener('storage', onStorage)
    }
  }, [branchId])

  const update = useCallback(
    (next: PrinterSettings) => {
      if (!branchId) return
      setState({ ready: true, settings: next })
      writePrinter(branchId, next)
    },
    [branchId],
  )

  return { ready: state.ready, settings: state.settings, update }
}
