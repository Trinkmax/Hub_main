import { capitalizeFirst, monthName, weekdayName } from '@/lib/dates'

/** «Miércoles 4 de noviembre»: la mayúscula es solo la del principio. */
export function headerDateLine(today: string): string {
  const weekday = weekdayName(today)
  const day = Number(today.slice(8, 10))
  const month = monthName(Number(today.slice(5, 7)))
  if (!weekday || !month || !Number.isFinite(day)) return ''
  return `${capitalizeFirst(weekday)} ${day} de ${month}`
}
