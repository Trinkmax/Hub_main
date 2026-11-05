'use client'

import { useRouter } from 'next/navigation'
import { useEffect, useRef, useState } from 'react'
import { setDroppedFile, takeDroppedFile } from '@/components/administracion/drop/drop-store'
import { Button } from '@/components/ui/button'
import { IMPORT_SOURCE_COPY, importSourceHref, UI_IMPORT_SOURCES } from '@/lib/imports/ui/labels'
import { detectedSourceHome, openImportFile } from '@/lib/imports/ui/upload'
import { defaultInflateRaw } from '@/lib/imports/zip'
import { ANSWER_BUTTON, QuestionAnswers, QuestionCard } from './review/question-card'

type Dropped = {
  name: string
  file: File
  /** Por qué no se pudo abrir: ahí no sirve preguntar de dónde es. */
  problem: string | null
}

/**
 * Lo que se soltó en una pantalla y no se reconoció (`GlobalDrop` lo manda a «Importar»): antes de
 * dar un error, se pregunta de dónde es y se sigue en esa subida con el mismo archivo.
 *
 * Si acá se ve qué es (el nombre del reporte de Cobros de Mercado Pago, que `GlobalDrop` no resuelve),
 * no se pregunta: se sigue en esa pantalla, que explica qué archivo hace falta. Se mira después de
 * cada dibujo, y no solo al montar, porque el archivo se puede soltar estando ya en «Importar».
 */
export function DroppedFileQuestion({ slug }: { slug: string }) {
  const router = useRouter()
  const headingRef = useRef<HTMLDivElement | null>(null)
  const [dropped, setDropped] = useState<Dropped | null>(null)

  useEffect(() => {
    const file = takeDroppedFile()
    if (!file) return
    const look = async () => {
      try {
        const opened = await openImportFile({
          bytes: new Uint8Array(await file.arrayBuffer()),
          fileName: file.name,
          inflateRaw: defaultInflateRaw,
        })
        const home = opened.detected ? detectedSourceHome(opened.detected) : null
        if (home) {
          setDroppedFile(file)
          router.replace(importSourceHref(slug, home))
          return
        }
        setDropped({ name: file.name, file, problem: opened.ok ? null : opened.message })
      } catch {
        setDropped({
          name: file.name,
          file,
          problem: 'No pude leer el archivo. Probá de nuevo o bajalo otra vez.',
        })
      }
    }
    void look()
  })

  const shown = dropped !== null
  useEffect(() => {
    if (shown) headingRef.current?.focus()
  }, [shown])

  if (!dropped) return null

  const go = (source: (typeof UI_IMPORT_SOURCES)[number]) => {
    setDroppedFile(dropped.file)
    router.push(importSourceHref(slug, source))
  }

  return (
    <QuestionCard
      ref={headingRef}
      tabIndex={-1}
      role="alert"
      tone={dropped.problem ? 'info' : 'ask'}
      headingLevel="h2"
      eyebrow={dropped.name}
      question={dropped.problem ?? '¿De dónde es este archivo?'}
    >
      <QuestionAnswers>
        {dropped.problem
          ? null
          : UI_IMPORT_SOURCES.map((source) => (
              <Button
                key={source}
                type="button"
                variant="outline"
                className={ANSWER_BUTTON}
                onClick={() => go(source)}
              >
                {IMPORT_SOURCE_COPY[source].short}
              </Button>
            ))}
        <Button
          type="button"
          variant="ghost"
          className={`${ANSWER_BUTTON} text-muted-foreground`}
          onClick={() => setDropped(null)}
        >
          {dropped.problem ? 'Cerrar' : 'Ninguno'}
        </Button>
      </QuestionAnswers>
    </QuestionCard>
  )
}
