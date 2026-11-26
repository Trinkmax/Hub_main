'use client'

import { BellOff, BellRing, Smartphone } from 'lucide-react'
import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { buzz } from '@/components/pos/order/haptics'
import { Button } from '@/components/ui/button'
import type { NoticePrefs } from '@/lib/pos/notices/prefs'
import { createNoticeSound } from '@/lib/pos/notices/sound'
import {
  currentPush,
  type PushSupport,
  pushPermission,
  pushSupport,
  showLocalNotice,
} from '@/lib/push/client'
import { disableNotices, enableNotices, syncNotices, useNoticePrefs } from './notice-setup'

/**
 * «Avisos de cocina», en la hoja «Tu cuenta» del salón: prender las notificaciones en este equipo,
 * probar cómo suenan y elegir de qué pasos enterarse. Es por dispositivo: cada celular decide lo suyo.
 */

type Status = 'loading' | 'on' | 'off' | 'blocked'

const ROWS: { key: keyof NoticePrefs; title: string; hint: string }[] = [
  {
    key: 'ready',
    title: 'Cuando está para retirar',
    hint: 'Es lo único que llega como notificación.',
  },
  {
    key: 'preparing',
    title: 'También cuando lo empiezan',
    hint: 'Solo con la app abierta, sin notificación.',
  },
  {
    key: 'sound',
    title: 'Sonido y vibración con la app abierta',
    hint: 'Además del aviso en pantalla.',
  },
]

export function NoticeSettings({ slug }: { slug: string }) {
  const [prefs, savePrefs] = useNoticePrefs()
  const [support, setSupport] = useState<PushSupport>('unsupported')
  const [status, setStatus] = useState<Status>('loading')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    const kind = pushSupport()
    setSupport(kind)
    if (kind !== 'supported') {
      setStatus('off')
      return
    }
    if (pushPermission() === 'denied') {
      setStatus('blocked')
      return
    }
    let stale = false
    void currentPush().then((subscription) => {
      if (!stale) setStatus(subscription && pushPermission() === 'granted' ? 'on' : 'off')
    })
    return () => {
      stale = true
    }
  }, [])

  const turnOn = async () => {
    setBusy(true)
    const result = await enableNotices(slug, prefs)
    setBusy(false)
    if (result.ok) {
      setStatus('on')
      toast.success('Listo: te aviso en este equipo.')
    } else {
      if (pushPermission() === 'denied') setStatus('blocked')
      toast.error(result.message)
    }
  }
  const turnOff = async () => {
    setBusy(true)
    await disableNotices(slug)
    setBusy(false)
    setStatus('off')
    toast('Avisos apagados en este equipo.')
  }
  const tryIt = async () => {
    // El sonido de la app (este toque lo destraba) y, si se puede, una notificación de verdad.
    const player = createNoticeSound()
    player.unlock()
    window.setTimeout(() => {
      player.play('ready')
      window.setTimeout(() => player.close(), 1500)
    }, 60)
    buzz([240, 90, 240, 90, 460])
    const shown = await showLocalNotice(
      'Mesa 12 · para retirar',
      'Barra: 4 Mojito · 2 Stella',
      [240, 90, 240, 90, 460],
    )
    if (!shown) toast('Así suena con la app abierta.', { description: 'Mesa 12 · para retirar' })
  }
  const toggle = (key: keyof NoticePrefs) => {
    const next = { ...prefs, [key]: !prefs[key] }
    savePrefs(next)
    // Los pasos también los respeta la notificación push: se guardan para este equipo.
    if (key !== 'sound' && status === 'on') void syncNotices(slug, next)
  }

  return (
    <section
      className="space-y-3 border-t border-border/60 px-4 py-4"
      aria-labelledby="avisos-cocina"
    >
      <div>
        <h3 id="avisos-cocina" className="font-semibold text-sm">
          Avisos de cocina
        </h3>
        <p className="text-muted-foreground text-sm">
          Te avisa cuando sale lo de una mesa que atendés vos.
        </p>
      </div>

      {support === 'needs-install' ? (
        <p className="flex gap-2 rounded-xl bg-muted px-3 py-2.5 text-sm">
          <Smartphone className="mt-0.5 size-4 shrink-0" aria-hidden />
          <span>
            En iPhone los avisos con el celular bloqueado andan desde la app instalada: tocá
            Compartir y «Agregar a pantalla de inicio», abrila desde ahí y volvé a esta hoja.
          </span>
        </p>
      ) : status === 'blocked' ? (
        <p className="flex gap-2 rounded-xl bg-muted px-3 py-2.5 text-sm">
          <BellOff className="mt-0.5 size-4 shrink-0" aria-hidden />
          <span>
            Este equipo tiene bloqueadas las notificaciones de la app. Se habilitan desde los
            ajustes del navegador (Notificaciones › Permitir).
          </span>
        </p>
      ) : support === 'unsupported' ? (
        <p className="rounded-xl bg-muted px-3 py-2.5 text-sm">
          Este navegador no puede recibir notificaciones. Con la app abierta te aviso igual.
        </p>
      ) : status === 'on' ? (
        <div className="flex flex-wrap items-center gap-2">
          <p className="flex min-w-0 flex-1 items-center gap-2 font-medium text-sm">
            <BellRing className="size-4 shrink-0 text-primary" aria-hidden />
            Prendidos en este equipo
          </p>
          <Button type="button" variant="outline" size="sm" onClick={() => void tryIt()}>
            Probar
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={busy}
            onClick={() => void turnOff()}
          >
            Apagar
          </Button>
        </div>
      ) : (
        <Button
          type="button"
          size="xl"
          className="w-full justify-start gap-3"
          disabled={busy || status === 'loading'}
          onClick={() => void turnOn()}
          data-testid="avisos-activar"
        >
          <BellRing className="size-5" aria-hidden />
          Avisarme en este celular
        </Button>
      )}

      <ul className="divide-y divide-border/60 rounded-xl border border-border/60">
        {ROWS.map((row) => (
          <li key={row.key}>
            <label className="flex min-h-12 cursor-pointer items-center gap-3 px-3 py-2">
              <span className="min-w-0 flex-1">
                <span className="block font-medium text-sm">{row.title}</span>
                <span className="block text-muted-foreground text-xs">{row.hint}</span>
              </span>
              <input
                type="checkbox"
                className="size-5 accent-[var(--primary)]"
                checked={prefs[row.key]}
                onChange={() => toggle(row.key)}
              />
            </label>
          </li>
        ))}
      </ul>
    </section>
  )
}
