'use client'

import { Check, ChevronDown, Printer } from 'lucide-react'
import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetGrabber,
  SheetTitle,
} from '@/components/ui/sheet'
import { refreshKitchen } from '@/lib/pos/actions'
import { posFont } from '@/lib/pos/font'
import { comandaDoc } from '@/lib/pos/print/comanda'
import { PAPER_WIDTHS } from '@/lib/pos/print/doc'
import { sampleCard } from '@/lib/pos/print/sample'
import { type PrinterSettings, setAuto } from '@/lib/pos/print/station'
import type { MenuStation } from '@/lib/pos/types'
import { cn } from '@/lib/utils'
import { printJob } from './print-frame'
import { usePrinter } from './use-printer'
import './printer.css'

/**
 * La comandera de esta compu: el botón de la barra de arriba y su hoja.
 *
 * Se muestra en pantallas con lugar (una compu, una tablet apaisada): un celular no tiene una
 * impresora enchufada. Con la impresión automática prendida, el botón lo dice con un punto.
 */

type Props = {
  slug: string
  branchId: string
  branchName: string
  timeZone: string
  /** `kitchen`: el botón va en la barra oscura de la tele de cocina, con su palabra. */
  variant?: 'topbar' | 'kitchen'
}

export function PrinterButton({ slug, branchId, branchName, timeZone, variant = 'topbar' }: Props) {
  const { ready, settings, update } = usePrinter(branchId)
  const [open, setOpen] = useState(false)
  const [stations, setStations] = useState<MenuStation[] | null>(null)
  const [testing, setTesting] = useState(false)

  // Las estaciones se piden recién al abrir la hoja: la barra de arriba no carga nada de más.
  useEffect(() => {
    if (!open || stations !== null) return
    let alive = true
    void refreshKitchen(slug, branchId).then((result) => {
      if (alive) setStations(result.ok ? result.data.stations : [])
    })
    return () => {
      alive = false
    }
  }, [open, stations, slug, branchId])

  const change = (patch: Partial<PrinterSettings>) => update({ ...settings, ...patch })

  const toggleStation = (id: string) => {
    const has = settings.stations.includes(id)
    const next = has ? settings.stations.filter((each) => each !== id) : [...settings.stations, id]
    // Elegir todas es lo mismo que no filtrar.
    change({ stations: stations && next.length === stations.length ? [] : next })
  }

  const test = async () => {
    if (testing) return
    setTesting(true)
    try {
      await printJob({
        paper: settings.paper,
        docs: [
          comandaDoc(sampleCard(branchName, new Date()), {
            branch: branchName,
            timeZone,
            stationLabel: 'Prueba',
          }),
        ],
      })
    } catch {
      toast.error('No pude mandar la prueba a la impresora')
    } finally {
      setTesting(false)
    }
  }

  const all = settings.stations.length === 0
  return (
    <>
      <button
        type="button"
        className={variant === 'kitchen' ? 'kds-tool prn-kds' : 'prn-btn'}
        data-on={ready && settings.auto ? 'true' : undefined}
        aria-label={
          ready && settings.auto
            ? 'Comandera: esta compu imprime las comandas. Tocá para cambiar.'
            : 'Comandera: imprimir las comandas en esta compu'
        }
        onClick={() => setOpen(true)}
        data-testid="printer-open"
      >
        <Printer aria-hidden strokeWidth={variant === 'kitchen' ? 2.4 : 2.2} />
        {variant === 'kitchen' ? (
          <span className="prn-kds-word">{ready && settings.auto ? 'Imprime' : 'Comandera'}</span>
        ) : null}
        {ready && settings.auto ? <span className="prn-btn-dot" aria-hidden /> : null}
      </button>

      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent
          side="bottom"
          showClose={false}
          className={cn('pos pos-sheet prn-sheet', posFont.variable)}
          data-testid="printer-sheet"
        >
          <SheetGrabber />
          <div className="pos-sheet-body prn-body">
            <div className="prn-head">
              <SheetTitle className="pos-sheet-title">Comandera</SheetTitle>
              <SheetDescription className="pos-sheet-hint">
                La impresora de tiques enchufada a esta compu. Lo que elijas vale para este
                dispositivo, en {branchName}.
              </SheetDescription>
            </div>

            <button
              type="button"
              role="switch"
              aria-checked={settings.auto}
              className="prn-switch"
              data-on={settings.auto ? 'true' : undefined}
              onClick={() => update(setAuto(settings, !settings.auto, Date.now()))}
              data-testid="printer-auto"
            >
              <span className="prn-switch-text">
                <b>Imprimir las comandas acá</b>
                <span>
                  {settings.auto
                    ? 'Prendido: cada pedido que entra sale solo. Dejá el punto de venta abierto en esta compu.'
                    : 'Apagado: esta compu no imprime sola.'}
                </span>
              </span>
              <span className="prn-switch-knob" aria-hidden />
            </button>

            {stations && stations.length > 1 ? (
              <div className="prn-field">
                <p className="pos-sheet-q">¿Qué imprime?</p>
                <div className="prn-chips">
                  <button
                    type="button"
                    className="prn-chip"
                    aria-pressed={all}
                    onClick={() => change({ stations: [] })}
                  >
                    {all ? <Check aria-hidden strokeWidth={3} /> : null}
                    Todo
                  </button>
                  {stations.map((station) => {
                    const on = settings.stations.includes(station.id)
                    return (
                      <button
                        key={station.id}
                        type="button"
                        className="prn-chip"
                        aria-pressed={on}
                        onClick={() => toggleStation(station.id)}
                      >
                        {on ? (
                          <Check aria-hidden strokeWidth={3} />
                        ) : (
                          <span
                            className="prn-chip-dot"
                            style={{ background: station.color }}
                            aria-hidden
                          />
                        )}
                        {station.name}
                      </button>
                    )
                  })}
                </div>
                <label className="prn-check">
                  <input
                    type="checkbox"
                    checked={settings.splitByStation}
                    onChange={(event) => change({ splitByStation: event.target.checked })}
                  />
                  <span>
                    <b>Un tique por estación</b>
                    <span>
                      Para cortar y repartir: la plancha recibe lo suyo y la barra lo suyo.
                    </span>
                  </span>
                </label>
              </div>
            ) : null}

            <div className="prn-row">
              <div className="prn-field">
                <p className="pos-sheet-q">Papel</p>
                <div className="prn-chips">
                  {PAPER_WIDTHS.map((width) => (
                    <button
                      key={width}
                      type="button"
                      className="prn-chip"
                      aria-pressed={settings.paper === width}
                      onClick={() => change({ paper: width })}
                    >
                      {width} mm
                    </button>
                  ))}
                </div>
              </div>
              <div className="prn-field">
                <p className="pos-sheet-q">Copias</p>
                <div className="prn-chips">
                  {([1, 2] as const).map((copies) => (
                    <button
                      key={copies}
                      type="button"
                      className="prn-chip"
                      aria-pressed={settings.copies === copies}
                      onClick={() => change({ copies })}
                    >
                      {copies}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            <details className="prn-how">
              <summary>
                Para que salga sin preguntar <ChevronDown aria-hidden />
              </summary>
              <ol>
                <li>
                  En la compu, dejá la comandera como <b>impresora predeterminada</b> y con el papel
                  en «rollo» de {settings.paper} mm.
                </li>
                <li>
                  Abrí Chrome con un acceso directo que termine en <code>--kiosk-printing</code>{' '}
                  (clic derecho en el acceso directo › Propiedades › Destino, y agregalo al final).
                </li>
                <li>
                  Entrá al punto de venta desde ese acceso directo y prendé «Imprimir las comandas
                  acá». Sin ese paso también imprime, pero muestra el cuadro de imprimir y hay que
                  apretar Enter.
                </li>
              </ol>
            </details>

            <div className="prn-foot">
              <button
                type="button"
                className="pos-btn pos-btn-quiet"
                onClick={() => void test()}
                disabled={testing}
                data-testid="printer-test"
              >
                <Printer className="size-5" aria-hidden />
                {testing ? 'Mandando…' : 'Imprimir una prueba'}
              </button>
              <button
                type="button"
                className="pos-btn pos-btn-primary"
                onClick={() => setOpen(false)}
              >
                Listo
              </button>
            </div>
          </div>
        </SheetContent>
      </Sheet>
    </>
  )
}
