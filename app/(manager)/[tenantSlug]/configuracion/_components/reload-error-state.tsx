'use client'

import { useRouter } from 'next/navigation'
import { ErrorState, type ErrorStateProps } from '@/components/ui/error-state'

/**
 * `ErrorState` con «Reintentar» para una pantalla server: vuelve a pedir los
 * datos al server (`router.refresh()`). Existe porque una función no cruza de
 * un Server Component a uno cliente, y el `onRetry` del kit es una función.
 */
export function ReloadErrorState(props: Omit<ErrorStateProps, 'onRetry'>) {
  const router = useRouter()
  return <ErrorState {...props} onRetry={() => router.refresh()} />
}
