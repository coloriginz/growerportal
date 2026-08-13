'use client'

import * as React from 'react'
import { Button } from '@/components/ui/button'

/* Beheerd bestand van @col/sso-button — niet lokaal aanpassen.
   Bijwerken: npx shadcn add @col/sso-button --overwrite */

export const SSO_BUTTON_VERSION = '1.0.0'

export interface SsoButtonProps {
  label: string
  onClick: () => void
  /** Tekst tijdens het inloggen. Zonder dit blijft `label` staan. */
  busyLabel?: string
  busy?: boolean
  disabled?: boolean
}

/**
 * Knop om met een Microsoft-account in te loggen, met het officiële
 * vierkleurenlogo. De zachte blauwe vulling zorgt dat de knop op een witte
 * kaart als knop leest zonder de primaire actie te overschreeuwen.
 */
export function SsoButton({ label, onClick, busyLabel, busy = false, disabled = false }: SsoButtonProps) {
  return (
    <Button
      type="button"
      variant="outline"
      className="w-full border-[#0067b8]/30 bg-[#0067b8]/10 hover:bg-[#0067b8]/20 hover:text-foreground"
      disabled={disabled || busy}
      onClick={onClick}
    >
      {busy && busyLabel ? (
        busyLabel
      ) : (
        <>
          <svg className="mr-2 h-4 w-4" viewBox="0 0 21 21" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
            <rect x="1" y="1" width="9" height="9" fill="#f25022" />
            <rect x="11" y="1" width="9" height="9" fill="#7fba00" />
            <rect x="1" y="11" width="9" height="9" fill="#00a4ef" />
            <rect x="11" y="11" width="9" height="9" fill="#ffb900" />
          </svg>
          {label}
        </>
      )}
    </Button>
  )
}
