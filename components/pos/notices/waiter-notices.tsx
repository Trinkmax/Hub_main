'use client'

import { useRouter } from 'next/navigation'
import { useCallback, useEffect, useRef } from 'react'
import { toast } from 'sonner'
import { buzz } from '@/components/pos/order/haptics'
import { stationIcon } from '@/lib/pos/kitchen/station-kind'
import { wantsNotice } from '@/lib/pos/notices/prefs'
import { createNoticeSound, type NoticeSound } from '@/lib/pos/notices/sound'
import { noticeText } from '@/lib/pos/notices/text'
import { type PosNotice, parseNotice } from '@/lib/pos/notices/types'
import { useKitchenNotices } from '@/lib/pos/use-poke'
import { recentNotices } from '@/lib/push/actions'
import { pushPermission, pushSupport } from '@/lib/push/client'
import { enableNotices, readNoticePrefs, syncNotices, useNoticePrefs } from './notice-setup'

/**
 * Los avisos de cocina para quien atiende mesas, con la app abierta.
 *
 * No dibuja nada propio: vive en el marco del salón (así avisa se mire el mapa, una mesa o la caja) y
 * cuando una estación empieza o termina lo de una mesa SUYA, suena, vibra y muestra el aviso con un
 * atajo a esa mesa. Los avisos llegan por el canal en vivo de la sucursal (`useKitchenNotices`); lo que
 * pudo perderse con la app atrás se lee de la bandeja al volver. Con la app cerrada o el celular
 * bloqueado avisa la notificación push (la muestra `public/sw.js`).
 */

type Props = {
  slug: string
  /** Quién está en este equipo: de todos los avisos de la sucursal, solo los suyos suenan acá. */
  userId: string
  /** Las sucursales de esta persona. */
  branchIds: string[]
  /**
   * ¿Ofrecerle los avisos en el celular apenas entra? Sí al mozo. A quien no vive de atender mesas (la
   * caja, el dueño) se le ofrecen recién cuando le llega el primer aviso de una mesa suya.
   */
  askOnEntry: boolean
}

const ASKED_KEY = 'hub:pos:notices:asked'
const SYNCED_KEY = 'hub:pos:notices:synced'
/** Lo que se lee al volver: solo lo reciente y solo lo que hay que ir a buscar. */
const CATCH_UP_MS = 3 * 60_000
/** Cuánto esperar, al entrar, antes de ofrecer los avisos en el celular. */
const ASK_AFTER_MS = 7000
/** Y cuánto después del primer aviso de una mesa propia (que primero se lea el aviso). */
const ASK_AFTER_NOTICE_MS = 2500

/** ¿A este equipo todavía hay que ofrecerle los avisos? Una sola vez por equipo. */
function shouldAsk(): 'push' | 'install' | null {
  const support = pushSupport()
  if (support === 'unsupported') return null
  if (support === 'supported' && pushPermission() !== 'default') return null
  try {
    if (window.localStorage.getItem(ASKED_KEY) === '1') return null
  } catch {
    return null
  }
  return support === 'needs-install' ? 'install' : 'push'
}

export function WaiterNotices({ slug, userId, branchIds, askOnEntry }: Props) {
  const router = useRouter()
  const [prefs] = useNoticePrefs()
  const prefsRef = useRef(prefs)
  prefsRef.current = prefs
  const sound = useRef<NoticeSound | null>(null)
  const seen = useRef(new Set<string>())
  const since = useRef(new Date().toISOString())
  const askTimer = useRef<number | null>(null)

  // Ofrecer los avisos con el celular bloqueado. Una sola vez por equipo.
  const ask = useCallback(
    (afterMs: number) => {
      if (askTimer.current !== null || shouldAsk() === null) return
      askTimer.current = window.setTimeout(() => {
        askTimer.current = null
        const kind = shouldAsk()
        if (kind === null) return
        try {
          window.localStorage.setItem(ASKED_KEY, '1')
        } catch {
          // sin almacenamiento: se ofrece igual
        }
        if (kind === 'install') {
          toast('Para que te avise con el celular bloqueado', {
            description:
              'En iPhone, instalá la app: Compartir › «Agregar a pantalla de inicio». Después activá los avisos desde tu cuenta.',
            duration: 12_000,
          })
          return
        }
        toast('¿Te aviso cuando sale un pedido tuyo?', {
          description: 'Suena y vibra aunque tengas el celular bloqueado.',
          duration: 20_000,
          action: {
            label: 'Activar',
            onClick: () => {
              void enableNotices(slug, readNoticePrefs()).then((result) => {
                if (result.ok) toast.success('Listo: te aviso en este equipo.')
                else toast.error(result.message)
              })
            },
          },
        })
      }, afterMs)
    },
    [slug],
  )
  useEffect(
    () => () => {
      if (askTimer.current !== null) window.clearTimeout(askTimer.current)
      askTimer.current = null
    },
    [],
  )

  // El navegador deja sonar recién después de un toque.
  useEffect(() => {
    const player = createNoticeSound()
    sound.current = player
    const unlock = () => player.unlock()
    window.addEventListener('pointerdown', unlock, true)
    window.addEventListener('keydown', unlock, true)
    return () => {
      window.removeEventListener('pointerdown', unlock, true)
      window.removeEventListener('keydown', unlock, true)
      player.close()
      sound.current = null
    }
  }, [])

  const show = useCallback(
    (notice: PosNotice, quiet: boolean) => {
      if (notice.user_id !== userId || seen.current.has(notice.id)) return
      seen.current.add(notice.id)
      if (notice.created_at > since.current) since.current = notice.created_at
      // Le llegó un aviso: atiende mesas. Si este equipo todavía no avisa bloqueado, se le ofrece.
      ask(ASK_AFTER_NOTICE_MS)
      if (!wantsNotice(prefsRef.current, notice.kind)) return
      const text = noticeText(notice)
      if (!quiet && prefsRef.current.sound) {
        sound.current?.play(notice.kind)
        buzz(text.vibrate)
      }
      toast(text.title, {
        // Un aviso nuevo de la misma mesa y estación reemplaza al anterior.
        id: text.tag,
        description: text.body.replace(/^\S+\s/, ''),
        icon: (
          <span aria-hidden style={{ fontSize: '1.25rem', lineHeight: 1 }}>
            {stationIcon({
              name: notice.station_name ?? '',
              kind: notice.station_kind,
              icon: notice.station_icon,
            })}
          </span>
        ),
        duration: text.strong ? 14_000 : 5000,
        action: {
          label: 'Ver mesa',
          onClick: () => router.push(`/${slug}/salon/mesa/${notice.session_id}`),
        },
      })
    },
    [userId, slug, router, ask],
  )

  // Lo que pudo perderse (la app estuvo atrás, o el canal se cayó): se lee de la bandeja. En silencio:
  // si el teléfono estaba bloqueado, ya sonó la notificación.
  const catchUp = useCallback(async () => {
    try {
      const result = await recentNotices(slug, since.current)
      if (!result.ok) return
      const fresh = Date.now() - CATCH_UP_MS
      for (const notice of result.data) {
        if (notice.kind === 'ready' && Date.parse(notice.created_at) > fresh) show(notice, true)
        else seen.current.add(notice.id)
      }
    } catch {
      // Sin señal: no hay nada que leer; cuando vuelva, llega el próximo aviso en vivo.
    }
  }, [slug, show])

  useKitchenNotices(
    branchIds,
    (payload) => {
      const notice = parseNotice(payload)
      if (notice) show(notice, false)
    },
    () => void catchUp(),
  )

  useEffect(() => {
    let hiddenAt: number | null = null
    const onVisibility = () => {
      if (document.hidden) {
        hiddenAt = Date.now()
      } else if (hiddenAt !== null && Date.now() - hiddenAt > 4000) {
        hiddenAt = null
        void catchUp()
      }
    }
    const onOnline = () => void catchUp()
    document.addEventListener('visibilitychange', onVisibility)
    window.addEventListener('online', onOnline)
    return () => {
      document.removeEventListener('visibilitychange', onVisibility)
      window.removeEventListener('online', onOnline)
    }
  }, [catchUp])

  // Este equipo ya tenía las notificaciones prendidas: quedan a nombre de quien entró ahora (una vez
  // por sesión del navegador y por persona).
  useEffect(() => {
    if (pushSupport() !== 'supported' || pushPermission() !== 'granted') return
    try {
      if (window.sessionStorage.getItem(SYNCED_KEY) === userId) return
      window.sessionStorage.setItem(SYNCED_KEY, userId)
    } catch {
      // sin almacenamiento: se anota igual
    }
    void syncNotices(slug)
  }, [slug, userId])

  // Al mozo, la primera vez en un equipo que puede, se le ofrecen apenas entra.
  useEffect(() => {
    if (askOnEntry) ask(ASK_AFTER_MS)
  }, [askOnEntry, ask])

  return null
}
