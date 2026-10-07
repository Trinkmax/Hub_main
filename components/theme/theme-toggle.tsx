'use client'

import { Monitor, Moon, Sun } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import type { ThemePreference } from '@/lib/theme/types'
import { useTheme } from './theme-provider'

const ICONS = {
  auto: Monitor,
  light: Sun,
  dark: Moon,
} as const

const LABELS: Record<ThemePreference, string> = {
  auto: 'Automático',
  light: 'Claro',
  dark: 'Oscuro',
}

export function ThemeToggle({
  align = 'end',
  variant = 'ghost',
}: {
  align?: 'start' | 'center' | 'end'
  variant?: 'ghost' | 'outline'
}) {
  const { preference, resolved, setPreference } = useTheme()
  const Icon = preference === 'auto' ? ICONS[resolved] : ICONS[preference]

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant={variant}
          size="icon"
          className="h-9 w-9"
          aria-label={`Tema actual: ${LABELS[preference]}`}
        >
          <Icon className="h-4 w-4" aria-hidden />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align={align} className="w-44">
        <DropdownMenuLabel>Apariencia</DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuRadioGroup
          value={preference}
          onValueChange={(value) => {
            void setPreference(value as ThemePreference)
          }}
        >
          <DropdownMenuRadioItem value="auto">
            <Monitor className="mr-2 h-4 w-4" aria-hidden /> Automático
          </DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="light">
            <Sun className="mr-2 h-4 w-4" aria-hidden /> Claro
          </DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="dark">
            <Moon className="mr-2 h-4 w-4" aria-hidden /> Oscuro
          </DropdownMenuRadioItem>
        </DropdownMenuRadioGroup>
        <DropdownMenuSeparator />
        <DropdownMenuItem disabled className="text-xs text-muted-foreground">
          Sistema actual: {LABELS[resolved]}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
