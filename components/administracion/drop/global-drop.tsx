'use client'

import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import { useRouter } from 'next/navigation'
import { useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import { useAccounting } from '@/components/administracion/accounting-provider'
import { classifyDroppedFile, importPathFor } from './classify'
import { deliverComprobante, setDroppedFile } from './drop-store'

const hasFiles = (event: DragEvent): boolean =>
  Array.from(event.dataTransfer?.types ?? []).includes('Files')

/**
 * Arrastrar un archivo a cualquier pantalla de Administración: reemplaza a «Importar» en el menú.
 * Una foto o un PDF abre la compra con ese comprobante; el ZIP de ARCA, el reporte de Mercado Pago o
 * los movimientos del banco se reconocen solos y abren su pantalla con el archivo adentro.
 *
 * El aviso cubre toda la ventana mientras se arrastra, para que quede claro que se puede soltar en
 * cualquier lado. Las zonas propias (`FileDropZone`) atajan el archivo antes: paran la propagación
 * del `drop`, así que el aviso se cierra en la fase de captura y la ruta se decide en la de burbuja.
 * La contadora no carga: para ella no hace nada.
 */
export function GlobalDrop() {
  const { tenantSlug, readOnly } = useAccounting()
  const router = useRouter()
  const reduceMotion = useReducedMotion() ?? false
  const [over, setOver] = useState(false)
  const depth = useRef(0)
  const base = `/${tenantSlug}/administracion`

  useEffect(() => {
    if (readOnly) return
    const onEnter = (event: DragEvent) => {
      if (!hasFiles(event)) return
      event.preventDefault()
      depth.current += 1
      setOver(true)
    }
    const onOver = (event: DragEvent) => {
      if (hasFiles(event)) event.preventDefault()
    }
    const onLeave = (event: DragEvent) => {
      if (!hasFiles(event)) return
      depth.current = Math.max(0, depth.current - 1)
      if (depth.current === 0) setOver(false)
    }
    const onDropCapture = (event: DragEvent) => {
      if (!hasFiles(event)) return
      depth.current = 0
      setOver(false)
    }
    const onDrop = (event: DragEvent) => {
      if (!hasFiles(event)) return
      event.preventDefault()
      const file = event.dataTransfer?.files?.[0]
      if (file) void route(file)
    }
    const route = async (file: File) => {
      const kind = classifyDroppedFile(file)
      if (kind === 'comprobante') {
        if (deliverComprobante(file)) return
        setDroppedFile(file)
        router.push(`${base}/compras/nueva?desde=archivo`)
        return
      }
      if (kind === 'desconocido') {
        toast.error(
          'No sabemos qué hacer con ese archivo. Probá con una foto, un PDF, un CSV o un ZIP.',
        )
        return
      }
      try {
        const [{ openImportFile }, { defaultInflateRaw }] = await Promise.all([
          import('@/lib/imports/ui/upload'),
          import('@/lib/imports/zip'),
        ])
        const opened = await openImportFile({
          bytes: new Uint8Array(await file.arrayBuffer()),
          fileName: file.name,
          inflateRaw: defaultInflateRaw,
        })
        setDroppedFile(file)
        // Un reporte que no se puede usar (el de Cobros de Mercado Pago) igual sabe de dónde vino:
        // su pantalla explica qué bajar en su lugar.
        router.push(`${base}${importPathFor(opened.detected ?? '')}`)
      } catch {
        toast.error('No pudimos abrir ese archivo. Probá de nuevo.')
      }
    }
    window.addEventListener('dragenter', onEnter)
    window.addEventListener('dragover', onOver)
    window.addEventListener('dragleave', onLeave)
    window.addEventListener('drop', onDropCapture, true)
    window.addEventListener('drop', onDrop)
    return () => {
      window.removeEventListener('dragenter', onEnter)
      window.removeEventListener('dragover', onOver)
      window.removeEventListener('dragleave', onLeave)
      window.removeEventListener('drop', onDropCapture, true)
      window.removeEventListener('drop', onDrop)
    }
  }, [readOnly, router, base])

  return (
    <AnimatePresence>
      {over ? (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: reduceMotion ? 0 : 0.15 }}
          aria-hidden="true"
          className="pointer-events-none fixed inset-0 z-[60] grid place-items-center bg-adm-hero/80 p-6 backdrop-blur-[3px]"
        >
          <motion.div
            initial={{ opacity: 0, y: -8, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, scale: 0.98 }}
            transition={
              reduceMotion ? { duration: 0 } : { type: 'spring', stiffness: 420, damping: 30 }
            }
            className="adm-drop-pulse max-w-xl rounded-3xl border-2 border-dashed border-adm-hero-muted px-10 py-9 text-center text-adm-hero-fg"
          >
            <p className="font-serif text-2xl font-semibold tracking-tight">Soltalo acá</p>
            <p className="mt-2 text-sm text-pretty text-adm-hero-muted">
              Una foto o un PDF abre la compra con el comprobante. El reporte de Mercado Pago, el
              ZIP de ARCA o los movimientos del banco se reconocen solos.
            </p>
          </motion.div>
        </motion.div>
      ) : null}
    </AnimatePresence>
  )
}
