import { useState, useCallback } from 'react'
import type { Memory, KnowledgeEntry, MemoryType, KnowledgeCategory } from '../types'

const API_BASE = ''

interface MemoriesStats {
  memory_count: number
  knowledge_count: number
}

export function useMemories(repoPath: string | null) {
  const [memories, setMemories] = useState<Memory[]>([])
  const [knowledge, setKnowledge] = useState<KnowledgeEntry[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const searchMemories = useCallback(async (query: string, filters?: { memory_type?: MemoryType; agent_name?: string }) => {
    if (!repoPath) return
    setLoading(true)
    setError(null)
    try {
      const params = new URLSearchParams({ repo_path: repoPath, query })
      if (filters?.memory_type) params.set('memory_type', filters.memory_type)
      if (filters?.agent_name) params.set('agent_name', filters.agent_name)
      const res = await fetch(`${API_BASE}/api/memories/search?${params}`)
      if (!res.ok) throw new Error(`Failed: ${res.status}`)
      const data = await res.json()
      setMemories(data.memories || [])
      return data.memories
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to search memories')
      return []
    } finally {
      setLoading(false)
    }
  }, [repoPath])

  const listMemories = useCallback(async (filters?: { agent_name?: string; conversation_id?: string }) => {
    if (!repoPath) return
    setLoading(true)
    setError(null)
    try {
      const params = new URLSearchParams({ repo_path: repoPath })
      if (filters?.agent_name) params.set('agent_name', filters.agent_name)
      if (filters?.conversation_id) params.set('conversation_id', filters.conversation_id)
      const res = await fetch(`${API_BASE}/api/memories?${params}`)
      if (!res.ok) throw new Error(`Failed: ${res.status}`)
      const data = await res.json()
      setMemories(data.memories || [])
      return data.memories
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to list memories')
      return []
    } finally {
      setLoading(false)
    }
  }, [repoPath])

  const searchKnowledge = useCallback(async (query: string, category?: KnowledgeCategory) => {
    if (!repoPath) return
    setLoading(true)
    setError(null)
    try {
      const params = new URLSearchParams({ repo_path: repoPath, query })
      if (category) params.set('category', category)
      const res = await fetch(`${API_BASE}/api/knowledge/search?${params}`)
      if (!res.ok) throw new Error(`Failed: ${res.status}`)
      const data = await res.json()
      setKnowledge(data.entries || [])
      return data.entries
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to search knowledge')
      return []
    } finally {
      setLoading(false)
    }
  }, [repoPath])

  const listKnowledge = useCallback(async (category?: KnowledgeCategory) => {
    if (!repoPath) return
    setLoading(true)
    setError(null)
    try {
      const params = new URLSearchParams({ repo_path: repoPath })
      if (category) params.set('category', category)
      const res = await fetch(`${API_BASE}/api/knowledge?${params}`)
      if (!res.ok) throw new Error(`Failed: ${res.status}`)
      const data = await res.json()
      setKnowledge(data.entries || [])
      return data.entries
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to list knowledge')
      return []
    } finally {
      setLoading(false)
    }
  }, [repoPath])

  const deleteKnowledgeEntry = useCallback(async (category: KnowledgeCategory, key: string) => {
    if (!repoPath) return false
    try {
      const params = new URLSearchParams({ repo_path: repoPath, category, key })
      const res = await fetch(`${API_BASE}/api/knowledge?${params}`, { method: 'DELETE' })
      if (!res.ok) throw new Error(`Failed: ${res.status}`)
      // Remove from local state
      setKnowledge(prev => prev.filter(k => !(k.category === category && k.key === key)))
      return true
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete knowledge entry')
      return false
    }
  }, [repoPath])

  const pruneOldMemories = useCallback(async (keepDays?: number) => {
    if (!repoPath) return 0
    try {
      const res = await fetch(`${API_BASE}/api/memories/prune`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ repo_path: repoPath, keep_days: keepDays || 90 }),
      })
      if (!res.ok) throw new Error(`Failed: ${res.status}`)
      const data = await res.json()
      return data.removed || 0
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to prune memories')
      return 0
    }
  }, [repoPath])

  const clearResults = useCallback(() => {
    setMemories([])
    setKnowledge([])
    setError(null)
  }, [])

  return {
    memories,
    knowledge,
    loading,
    error,
    searchMemories,
    listMemories,
    searchKnowledge,
    listKnowledge,
    deleteKnowledgeEntry,
    pruneOldMemories,
    clearResults,
  }
}
