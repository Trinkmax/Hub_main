'use client'

import { Printer } from 'lucide-react'
import { Button } from '@/components/ui/button'

export function PrintQrButton({ qrToken }: { qrToken: string }) {
  const handleClick = () => {
    const url = `/print/qr/${encodeURIComponent(qrToken)}`
    window.open(url, '_blank', 'width=600,height=800')
  }

  return (
    <Button size="sm" variant="ghost" onClick={handleClick}>
      <Printer className="size-3.5" />
    </Button>
  )
}
