import { useState, useEffect, useCallback, useRef } from 'react'
import type { Board, BoardFull } from '../types'

const LAST_ACTIVE_BOARD_KEY = 'last_active_board'

type ConnectionStatus = 'connected' | 'connecting' | 'disconnected'

interface UseKanbanReturn {
  boards: Board[]
  activeBoard: BoardFull | null
  selectBoard: (board: Board) => void
  createBoard: (repoPath: string) => Promise<Board | null>
  removeBoard: (boardId: number) => Promise<void>
  reorderBoards: (boardIds: number[]) => Promise<void>
  connectionStatus: ConnectionStatus
  isLoading: boolean
}

const API_BASE = ''  // same origin

export function useKanban(): UseKanbanReturn {
  const [boards, setBoards] = useState<Board[]>([])
  const [activeBoard, setActiveBoard] = useState<BoardFull | null>(null)
  const [connectionStatus, setConnectionStatus] = useState<ConnectionStatus>('connecting')
  const [isLoading, setIsLoading] = useState(true)
  const [reconnectCounter, setReconnectCounter] = useState(0)
  const eventSourceRef = useRef<EventSource | null>(null)
  // Sequence counter to discard stale fetch results (race condition guard)
  const fetchSeqRef = useRef(0)

  // Fetch all boards (preserves has_busy from current state since the list API doesn't include it)
  const fetchBoards = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/api/boards`)
      const data = await res.json()
      setBoards(prev => {
        const busyMap = new Map(prev.map(b => [b.id, b.has_busy]))
        return data.map((b: Board) => ({
          ...b,
          has_busy: busyMap.get(b.id) ?? b.has_busy,
        }))
      })
    } catch (err) {
      console.error('Failed to fetch boards:', err)
    }
  }, [])

  // Fetch full board — uses sequence counter to discard stale results
  const fetchBoardFull = useCallback(async (boardId: number) => {
    const seq = ++fetchSeqRef.current
    try {
      const res = await fetch(`${API_BASE}/api/boards/${boardId}`)
      const data = await res.json()
      // Only apply if this is still the most recent fetch
      if (seq === fetchSeqRef.current) {
        setActiveBoard(data)
        // Propagate has_busy to boards list for sidebar spinner indicator
        if (data.board) {
          setBoards(prev => prev.map(b => b.id === data.board.id ? { ...b, has_busy: data.board.has_busy } : b))
        }
      }
    } catch (err) {
      console.error('Failed to fetch board:', err)
    }
  }, [])

  const selectBoard = useCallback((board: Board) => {
    localStorage.setItem(LAST_ACTIVE_BOARD_KEY, String(board.id))
    fetchBoardFull(board.id)
  }, [fetchBoardFull])

  const createBoard = useCallback(async (repoPath: string): Promise<Board | null> => {
    try {
      const res = await fetch(`${API_BASE}/api/boards/get-or-create`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ repo_path: repoPath }),
      })
      const data = await res.json()
      if (data.error) {
        console.error('Failed to create board:', data.error)
        return null
      }
      await fetchBoards()
      selectBoard(data)
      return data
    } catch (err) {
      console.error('Failed to create board:', err)
      return null
    }
  }, [fetchBoards, selectBoard])

  const removeBoard = useCallback(async (boardId: number) => {
    try {
      await fetch(`${API_BASE}/api/boards/${boardId}`, { method: 'DELETE' })
      // If the removed board was active, clear it
      if (activeBoardRef.current?.board.id === boardId) {
        setActiveBoard(null)
        localStorage.removeItem(LAST_ACTIVE_BOARD_KEY)
      }
      await fetchBoards()
    } catch (err) {
      console.error('Failed to remove board:', err)
    }
  }, [fetchBoards])

  const reorderBoards = useCallback(async (boardIds: number[]) => {
    try {
      await fetch(`${API_BASE}/api/boards/reorder`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ board_ids: boardIds }),
      })
      await fetchBoards()
    } catch (err) {
      console.error('Failed to reorder boards:', err)
    }
  }, [fetchBoards])

  // SSE connection for real-time updates — use refs to avoid stale closures
  const activeBoardRef = useRef(activeBoard)
  activeBoardRef.current = activeBoard

  useEffect(() => {
    setConnectionStatus('connecting')
    const es = new EventSource(`${API_BASE}/api/events`)
    eventSourceRef.current = es

    es.onopen = () => {
      setConnectionStatus('connected')
    }

    es.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data)
        // Refetch active board on any event (using ref to avoid stale closure)
        const currentBoard = activeBoardRef.current
        if (currentBoard) {
          fetchBoardFull(currentBoard.board.id)
        }
        // Also refetch boards list for new boards
        fetchBoards()
      } catch (err) {
        // ignore parse errors
      }
    }

    es.onerror = () => {
      setConnectionStatus('disconnected')
      es.close()
      // Reconnect after 3 seconds by re-triggering this effect
      setTimeout(() => {
        setReconnectCounter(c => c + 1)
      }, 3000)
    }

    return () => {
      es.close()
      eventSourceRef.current = null
    }
  }, [fetchBoardFull, fetchBoards, reconnectCounter])

  // Polling fallback: catch changes that don't trigger SSE events
  // (MCP-initiated moves from separate process, title updates from opencode DB)
  useEffect(() => {
    const POLL_INTERVAL = 5000 // 5 seconds

    const interval = setInterval(() => {
      const currentBoard = activeBoardRef.current
      if (currentBoard) {
        fetchBoardFull(currentBoard.board.id)
      }
    }, POLL_INTERVAL)

    return () => clearInterval(interval)
  }, [fetchBoardFull])

  // Initial load
  useEffect(() => {
    const init = async () => {
      setIsLoading(true)
      await fetchBoards()
      setIsLoading(false)
    }
    init()
  }, [fetchBoards])

  // Auto-select board: prefer last active from localStorage, fallback to first
  useEffect(() => {
    if (!activeBoard && boards.length > 0 && !isLoading) {
      const savedId = localStorage.getItem(LAST_ACTIVE_BOARD_KEY)
      const savedBoard = savedId ? boards.find(b => b.id === Number(savedId)) : null
      fetchBoardFull(savedBoard ? savedBoard.id : boards[0].id)
    }
  }, [boards, activeBoard, isLoading, fetchBoardFull])

  return { boards, activeBoard, selectBoard, createBoard, removeBoard, reorderBoards, connectionStatus, isLoading }
}
