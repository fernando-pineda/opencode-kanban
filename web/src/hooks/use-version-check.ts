import { useEffect } from 'react'
import { toast } from 'sonner'

interface VersionInfo {
  current: string
  latest: string | null
  updateAvailable: boolean
  releaseUrl?: string
  releaseName?: string
}

const DISMISSED_KEY = 'kanban_dismissed_version'
const CHECK_INTERVAL = 30 * 60 * 1000 // 30 minutes

export function useVersionCheck() {
  useEffect(() => {
    let cancelled = false

    const checkVersion = async () => {
      try {
        const res = await fetch('/api/version')
        if (!res.ok) return
        const data: VersionInfo = await res.json()

        if (cancelled) return
        if (!data.updateAvailable || !data.latest) return

        const dismissedVersion = sessionStorage.getItem(DISMISSED_KEY)
        if (dismissedVersion === data.latest) return

        sessionStorage.setItem(DISMISSED_KEY, data.latest)

        toast.info('New version available', {
          description: `${data.latest} is available (you have ${data.current})`,
          duration: 10000,
          action: {
            label: 'View Release',
            onClick: () => window.open(data.releaseUrl || '', '_blank'),
          },
        })
      } catch {
        // Silently ignore errors
      }
    }

    checkVersion()
    const interval = setInterval(checkVersion, CHECK_INTERVAL)

    return () => {
      cancelled = true
      clearInterval(interval)
    }
  }, [])
}
