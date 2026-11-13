'use client'

import { useState } from 'react'

/**
 * El último valor que no fue vacío. Las hojas se cierran con una animación: mientras bajan, siguen
 * mostrando lo que tenían (si no, se achican de golpe antes de irse).
 */
export function useLast<T>(value: T | null): T | null {
  const [last, setLast] = useState(value)
  if (value !== null && value !== last) setLast(value)
  return value ?? last
}
