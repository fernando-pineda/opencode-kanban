import { useState, useEffect, useCallback, useRef } from 'react';
import type { FileIndexingStatus, FileIndexingProgress } from '../types';

interface UseFileIndexingReturn {
  status: FileIndexingStatus | null;
  progress: FileIndexingProgress | null;
  loading: boolean;
  error: string | null;
  startIndexing: () => Promise<void>;
  stopIndexing: () => Promise<void>;
  refresh: () => Promise<void>;
}

export function useFileIndexing(boardId: number | null): UseFileIndexingReturn {
  const [status, setStatus] = useState<FileIndexingStatus | null>(null);
  const [progress, setProgress] = useState<FileIndexingProgress | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const boardIdRef = useRef(boardId);
  boardIdRef.current = boardId;

  const fetchStatus = useCallback(async () => {
    if (!boardId) return;
    try {
      const res = await fetch(`/api/boards/${boardId}/indexing/status`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setStatus(data);
      setError(null);
    } catch (err: any) {
      setError(err.message);
    }
  }, [boardId]);

  const startIndexing = useCallback(async () => {
    if (!boardId) return;
    setLoading(true);
    setError(null);

    // Optimistically set status to indexing immediately
    setStatus((prev) => ({
      ...prev,
      board_id: boardId,
      status: 'indexing',
      status_message: 'Starting...',
      total_files: prev?.total_files ?? 0,
      total_chunks: prev?.total_chunks ?? 0,
      total_bytes: prev?.total_bytes ?? 0,
      last_full_index: prev?.last_full_index ?? null,
      ollama_model: prev?.ollama_model ?? '',
      is_watching: false,
    } as FileIndexingStatus));

    try {
      const res = await fetch(`/api/boards/${boardId}/indexing/start`, { method: 'POST' });
      if (!res.ok) {
        const data = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
        throw new Error(data.error || `HTTP ${res.status}`);
      }
      // Fetch status immediately to get server-side state
      await fetchStatus();
    } catch (err: any) {
      setError(err.message);
      // Revert optimistic state on error
      await fetchStatus();
    } finally {
      setLoading(false);
    }
  }, [boardId, fetchStatus]);

  const stopIndexing = useCallback(async () => {
    if (!boardId) return;
    try {
      await fetch(`/api/boards/${boardId}/indexing/stop`, { method: 'POST' });
      await fetchStatus();
    } catch (err: any) {
      setError(err.message);
    }
  }, [boardId, fetchStatus]);

  // Fetch status on mount and when boardId changes
  useEffect(() => {
    if (boardId) {
      fetchStatus();
    } else {
      setStatus(null);
      setProgress(null);
    }
  }, [boardId, fetchStatus]);

  // Subscribe to SSE events for indexing progress
  useEffect(() => {
    if (!boardId) return;

    const handleSSE = (event: MessageEvent) => {
      try {
        const data = JSON.parse(event.data);
        const currentBoardId = boardIdRef.current;
        if (!currentBoardId) return;

        if (data.type === 'file_indexing_progress' && data.board_id === currentBoardId) {
          setProgress(data);
        }

        if (data.type === 'file_indexing_status' && data.board_id === currentBoardId) {
          setStatus((prev) => ({
            ...prev,
            board_id: currentBoardId,
            status: data.status,
            status_message: data.status_message,
            total_files: data.total_files,
            total_chunks: data.total_chunks,
            is_watching: data.status === 'watching',
          } as FileIndexingStatus));

          if (data.status === 'idle' || data.status === 'error' || data.status === 'watching') {
            setProgress(null);
          }
        }
      } catch {
        // ignore parse errors
      }
    };

    // Listen on the existing EventSource if available, or create one
    // The session-detail.tsx already has an EventSource for /api/events
    // We'll use a separate lightweight one here for the topbar indicator
    let es: EventSource | null = null;
    try {
      es = new EventSource('/api/events');
      es.addEventListener('message', handleSSE);
    } catch {
      // SSE not available, fallback to polling
    }

    return () => {
      if (es) {
        es.removeEventListener('message', handleSSE);
        es.close();
      }
    };
  }, [boardId]);

  // Poll for status updates while indexing (fallback for SSE)
  useEffect(() => {
    if (!boardId) return;

    // Only poll when status is 'indexing'
    if (status?.status !== 'indexing' && status?.status !== 'watching') return;

    const interval = setInterval(async () => {
      try {
        const res = await fetch(`/api/boards/${boardId}/indexing/status`);
        if (!res.ok) return;
        const data = await res.json();
        setStatus(data);

        // If indexing finished, clear progress
        if (data.status !== 'indexing') {
          setProgress(null);
        }
      } catch {
        // ignore
      }
    }, 2000);

    return () => clearInterval(interval);
  }, [boardId, status?.status]);

  return {
    status,
    progress,
    loading,
    error,
    startIndexing,
    stopIndexing,
    refresh: fetchStatus,
  };
}
