'use client'

import { Smartphone } from 'lucide-react'
import { useEffect, useState } from 'react'
import { toast } from 'sonner'

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

const STORAGE_KEY = 'hub_pwa_prompt_dismissed_at'
const COOLDOWN_DAYS = 7
const FIRST_PROMPT_AFTER_MS = 2 * 60 * 1000 // 2 min de uso del salón

/**
 * Captura `beforeinstallprompt`, espera 2 min de uso del salón y, si la app
 * NO está instalada (display-mode != standalone), ofrece instalarla con un
 * toast cálido. Cooldown de 7 días si el usuario lo descarta.
 */
export function PwaInstallPrompt() {
  const [deferred, setDeferred] = useState<BeforeInstallPromptEvent | null>(null)

  useEffect(() => {
    const handler = (event: Event) => {
      event.preventDefault()
      setDeferred(event as BeforeInstallPromptEvent)
    }

    window.addEventListener('beforeinstallprompt', handler)
    return () => window.removeEventListener('beforeinstallprompt', handler)
  }, [])

  useEffect(() => {
    if (!deferred) return
    if (typeof window === 'undefined') return

    const isStandalone = window.matchMedia('(display-mode: standalone)').matches
    if (isStandalone) return

    const dismissedAt = Number(localStorage.getItem(STORAGE_KEY) ?? '0')
    if (dismissedAt && Date.now() - dismissedAt < COOLDOWN_DAYS * 24 * 60 * 60 * 1000) {
      return
    }

    const showId = window.setTimeout(() => {
      toast('Instalá HUB! en tu teléfono', {
        description: 'Acceso directo, sin URL bar y más rápido.',
        icon: <Smartphone className="size-4" aria-hidden />,
        action: {
          label: 'Instalar',
          onClick: async () => {
            try {
              await deferred.prompt()
              const choice = await deferred.userChoice
              if (choice.outcome !== 'accepted') {
                localStorage.setItem(STORAGE_KEY, String(Date.now()))
              }
            } catch (error) {
              console.error('[pwa-install] prompt failed', error)
            } finally {
              setDeferred(null)
            }
          },
        },
        cancel: {
          label: 'Después',
          onClick: () => {
            localStorage.setItem(STORAGE_KEY, String(Date.now()))
            setDeferred(null)
          },
        },
        duration: 30_000,
      })
    }, FIRST_PROMPT_AFTER_MS)

    return () => window.clearTimeout(showId)
  }, [deferred])

  return null
}
