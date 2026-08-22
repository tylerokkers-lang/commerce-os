import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

/** Merges Tailwind classes so a later class reliably wins over an earlier one. */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs))
}

export function formatDate(iso: string, locale = 'en-GB'): string {
  return new Date(iso).toLocaleDateString(locale, { day: 'numeric', month: 'short', year: 'numeric' })
}

export function formatDateTime(iso: string, locale = 'en-GB'): string {
  return new Date(iso).toLocaleString(locale, {
    day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
  })
}

export function formatRelative(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime()
  const minutes = Math.round(diffMs / 60000)
  if (minutes < 1) return 'just now'
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.round(hours / 24)
  return days === 1 ? 'yesterday' : `${days}d ago`
}

/** Turns SCREAMING_SNAKE audit actions into readable text. */
export function humaniseAction(action: string): string {
  const words = action.toLowerCase().split('_')
  return words[0].charAt(0).toUpperCase() + words[0].slice(1) + (words.length > 1 ? ' ' + words.slice(1).join(' ') : '')
}

export const formatPct = (value: number | null, digits = 1): string =>
  value === null ? 'n/a' : `${value.toFixed(digits)}%`
