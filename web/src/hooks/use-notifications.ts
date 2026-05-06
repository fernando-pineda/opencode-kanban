import {
  createContext,
  createElement,
  useContext,
  useState,
  useCallback,
  useEffect,
  useRef,
  type ReactNode,
} from 'react'

// ── Types ──────────────────────────────────────────────────────────

export interface Notification {
  id: number
  board_id: number
  session_id: string
  type: 'iteration_complete' | 'task_failed' | 'subtask_complete'
  title: string
  seen: boolean
  created_at: string
  updated_at: string
}

interface UseNotificationsReturn {
  // Per-board notification data
  getUnseenCount: (boardId: number) => number
  getUnseenForSession: (sessionId: string) => Notification[]
  hasUnseenSession: (sessionId: string) => boolean

  // Actions
  markSeen: (notificationId: number) => Promise<void>
  markAllSeen: (boardId: number) => Promise<void>
  markSessionSeen: (sessionId: string) => Promise<void>

  // For sidebar — all board counts
  unseenCounts: Record<number, number>

  // For desktop notifications — total unseen across all boards
  totalUnseen: number

  // Manual refetch trigger (for SSE event integration)
  refetch: () => void
}

// ── Context ────────────────────────────────────────────────────────

const NotificationContext = createContext<UseNotificationsReturn | null>(null)

const API_BASE = '' // same origin

const POLL_INTERVAL = 5000 // 5 seconds

// ── Provider ───────────────────────────────────────────────────────

export function NotificationProvider({ children, activeBoardId }: { children: ReactNode; activeBoardId?: number | null }) {
  const [unseenCounts, setUnseenCounts] = useState<Record<number, number>>({})
  const [sessionNotifications, setSessionNotifications] = useState<
    Map<string, Notification[]>
  >(new Map())
  const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null)

  // Fetch unseen counts from the backend
  const fetchCounts = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/api/notifications/unseen-counts`)
      if (!res.ok) return
      const data = await res.json()
      // data is expected to be Record<boardId, count>
      setUnseenCounts(data ?? {})
    } catch (err) {
      console.error('Failed to fetch notification counts:', err)
    }
  }, [])

  // Fetch detailed notifications for a specific board (lazy, cached in session map)
  const fetchBoardNotifications = useCallback(async (boardId: number) => {
    try {
      const res = await fetch(
        `${API_BASE}/api/notifications?board_id=${boardId}&seen=false`
      )
      if (!res.ok) return
      const data: Notification[] = (await res.json()).filter((n: Notification) => !n.seen)
      setSessionNotifications((prev) => {
        const next = new Map(prev)
        // Clear old entries for this board, then add new ones
        for (const [key, val] of next) {
          if (val.length > 0 && val[0].board_id === boardId) {
            next.delete(key)
          }
        }
        // Group by session_id
        for (const n of data) {
          const existing = next.get(n.session_id) ?? []
          next.set(n.session_id, [...existing, n])
        }
        return next
      })
    } catch (err) {
      console.error('Failed to fetch board notifications:', err)
    }
  }, [])

  // Poll unseen counts on mount + every 5 seconds
  useEffect(() => {
    fetchCounts()
    pollingRef.current = setInterval(fetchCounts, POLL_INTERVAL)
    return () => {
      if (pollingRef.current) clearInterval(pollingRef.current)
    }
  }, [fetchCounts])

  // Auto-fetch detailed session notifications for the active board
  useEffect(() => {
    if (!activeBoardId) return
    fetchBoardNotifications(activeBoardId)
    const interval = setInterval(() => fetchBoardNotifications(activeBoardId), POLL_INTERVAL)
    return () => clearInterval(interval)
  }, [activeBoardId, fetchBoardNotifications])

  // ── Derived data ──────────────────────────────────────────────

  const totalUnseen = Object.values(unseenCounts).reduce(
    (sum, count) => sum + count,
    0
  )

  const getUnseenCount = useCallback(
    (boardId: number): number => {
      return unseenCounts[boardId] ?? 0
    },
    [unseenCounts]
  )

  const getUnseenForSession = useCallback(
    (sessionId: string): Notification[] => {
      return sessionNotifications.get(sessionId) ?? []
    },
    [sessionNotifications]
  )

  const hasUnseenSession = useCallback(
    (sessionId: string): boolean => {
      const notifs = sessionNotifications.get(sessionId)
      return (notifs?.length ?? 0) > 0
    },
    [sessionNotifications]
  )

  // ── Actions ───────────────────────────────────────────────────

  const markSeen = useCallback(
    async (notificationId: number) => {
      try {
        await fetch(`${API_BASE}/api/notifications/${notificationId}/seen`, {
          method: 'POST',
        })
      } catch (err) {
        console.error('Failed to mark notification as seen:', err)
      }
      await fetchCounts()
    },
    [fetchCounts]
  )

  const markAllSeen = useCallback(
    async (boardId: number) => {
      try {
        await fetch(`${API_BASE}/api/notifications/mark-all-seen`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ board_id: boardId }),
        })
      } catch (err) {
        console.error('Failed to mark all notifications as seen:', err)
      }
      await fetchCounts()
      // Clear session notifications for this board from local state
      setSessionNotifications((prev) => {
        const next = new Map(prev)
        for (const [key, val] of next) {
          if (val.length > 0 && val[0].board_id === boardId) {
            next.delete(key)
          }
        }
        return next
      })
    },
    [fetchCounts]
  )

  const markSessionSeen = useCallback(
    async (sessionId: string) => {
      try {
        await fetch(
          `${API_BASE}/api/sessions/${sessionId}/notifications/seen`,
          { method: 'POST' }
        )
      } catch (err) {
        console.error('Failed to mark session notifications as seen:', err)
      }
      await fetchCounts()
      // Clear session notifications from local state
      setSessionNotifications((prev) => {
        const next = new Map(prev)
        next.delete(sessionId)
        return next
      })
    },
    [fetchCounts]
  )

  // Manual refetch — can be called from SSE event handler
  const refetch = useCallback(() => {
    fetchCounts()
  }, [fetchCounts])

  // ── Context value ─────────────────────────────────────────────

  const value: UseNotificationsReturn = {
    getUnseenCount,
    getUnseenForSession,
    hasUnseenSession,
    markSeen,
    markAllSeen,
    markSessionSeen,
    unseenCounts,
    totalUnseen,
    refetch,
  }

  return createElement(NotificationContext.Provider, { value }, children)
}

// ── Hook ───────────────────────────────────────────────────────────

export function useNotifications(): UseNotificationsReturn {
  const ctx = useContext(NotificationContext)
  if (!ctx) {
    throw new Error(
      'useNotifications must be used within a <NotificationProvider>'
    )
  }
  return ctx
}
