'use client'

import { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from '@/components/ui/sheet'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Brain, Search, X } from 'lucide-react'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip'

// ── Types ──────────────────────────────────────────────────────

interface Memory {
  id: string
  memory_type: string
  agent_name: string
  summary: string
  content: string
  importance: number
  created_at: string
  tags?: string | null
}

interface KnowledgeEntry {
  id: string
  key: string
  category: string
  title: string
  content: string
  views_count?: number
  indexed_at: string
  indexed_by?: string | null
  importance?: number
  tags?: string | null
}

interface MemoriesSheetProps {
  repoPath: string
  open: boolean
  onOpenChange: (open: boolean) => void
}

type TabType = 'memories' | 'knowledge'
type MemoryType = 'all' | 'context' | 'decision' | 'error' | 'pattern' | 'finding' | 'preference'
type KnowledgeCategory = 'all' | 'file' | 'command' | 'architecture' | 'api' | 'config' | 'schema' | 'workflow' | 'gotcha'

const MEMORY_TYPES: MemoryType[] = ['all', 'context', 'decision', 'error', 'pattern', 'finding', 'preference']
const KNOWLEDGE_CATEGORIES: KnowledgeCategory[] = ['all', 'file', 'command', 'architecture', 'api', 'config', 'schema', 'workflow', 'gotcha']

const memoryTypeColors: Record<string, string> = {
  context: 'bg-blue-100 text-blue-900 dark:bg-blue-900/30 dark:text-blue-300',
  decision: 'bg-amber-100 text-amber-900 dark:bg-amber-900/30 dark:text-amber-300',
  finding: 'bg-green-100 text-green-900 dark:bg-green-900/30 dark:text-green-300',
  pattern: 'bg-purple-100 text-purple-900 dark:bg-purple-900/30 dark:text-purple-300',
  error: 'bg-red-100 text-red-900 dark:bg-red-900/30 dark:text-red-300',
  preference: 'bg-cyan-100 text-cyan-900 dark:bg-cyan-900/30 dark:text-cyan-300',
}

const knowledgeColors: Record<string, string> = {
  file: 'bg-blue-100 text-blue-900 dark:bg-blue-900/30 dark:text-blue-300',
  command: 'bg-green-100 text-green-900 dark:bg-green-900/30 dark:text-green-300',
  architecture: 'bg-purple-100 text-purple-900 dark:bg-purple-900/30 dark:text-purple-300',
  api: 'bg-amber-100 text-amber-900 dark:bg-amber-900/30 dark:text-amber-300',
  config: 'bg-slate-100 text-slate-900 dark:bg-slate-900/30 dark:text-slate-300',
  schema: 'bg-orange-100 text-orange-900 dark:bg-orange-900/30 dark:text-orange-300',
  workflow: 'bg-teal-100 text-teal-900 dark:bg-teal-900/30 dark:text-teal-300',
  gotcha: 'bg-red-100 text-red-900 dark:bg-red-900/30 dark:text-red-300',
}

const PAGE_SIZE = 100
const ROW_HEIGHT = 40

// ── Helpers ────────────────────────────────────────────────────

function formatTimeAgo(date: string): string {
  const now = new Date()
  const then = new Date(date)
  const seconds = Math.floor((now.getTime() - then.getTime()) / 1000)

  if (seconds < 60) return 'now'
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`
  if (seconds < 2592000) return `${Math.floor(seconds / 86400)}d ago`
  return then.toLocaleDateString()
}

function formatDate(date: string): string {
  return new Date(date).toLocaleString()
}

// ── Shared components ──────────────────────────────────────────

function ImportanceBadge({ value }: { value: number }) {
  const percent = Math.round(Math.min(100, Math.max(0, value * 100)))
  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <span className="text-xs font-medium text-muted-foreground hover:text-foreground cursor-default tabular-nums">
            {percent}%
          </span>
        </TooltipTrigger>
        <TooltipContent side="left">
          <p>Confidence score: how relevant and reliable this memory is deemed by the agent.</p>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  )
}

// ── Detail Dialog ──────────────────────────────────────────────

function MemoryDetailDialog({ memory, open, onOpenChange }: {
  memory: Memory | null
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  if (!memory) return null
  const colorClass = memoryTypeColors[memory.memory_type] || memoryTypeColors.context

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <div className="flex items-center gap-2">
            <Badge variant="outline" className={colorClass}>
              {memory.memory_type}
            </Badge>
            <Badge variant="outline" className="text-xs">
              {memory.agent_name}
            </Badge>
            <ImportanceBadge value={memory.importance || 0.5} />
          </div>
          <DialogTitle className="text-base">{memory.summary || 'Untitled memory'}</DialogTitle>
          <DialogDescription className="text-xs text-muted-foreground">
            {formatDate(memory.created_at)}
            {memory.tags && <span className="ml-2">&middot; {memory.tags}</span>}
          </DialogDescription>
        </DialogHeader>
        <div className="text-sm text-foreground whitespace-pre-wrap break-words leading-relaxed border rounded-md p-4 bg-muted/30">
          {memory.content}
        </div>
      </DialogContent>
    </Dialog>
  )
}

function KnowledgeDetailDialog({ entry, open, onOpenChange }: {
  entry: KnowledgeEntry | null
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  if (!entry) return null
  const colorClass = knowledgeColors[entry.category] || knowledgeColors.file

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <div className="flex items-center gap-2">
            <Badge variant="outline" className={colorClass}>
              {entry.category}
            </Badge>
            <span className="text-xs font-mono text-muted-foreground">{entry.key}</span>
            <ImportanceBadge value={entry.importance || 0.5} />
          </div>
          <DialogTitle className="text-base">{entry.title || entry.key}</DialogTitle>
          <DialogDescription className="text-xs text-muted-foreground">
            Indexed {formatDate(entry.indexed_at)}
            {entry.indexed_by && <span className="ml-2">by {entry.indexed_by}</span>}
            {entry.tags && <span className="ml-2">&middot; {entry.tags}</span>}
          </DialogDescription>
        </DialogHeader>
        <div className="text-sm text-foreground whitespace-pre-wrap break-words leading-relaxed border rounded-md p-4 bg-muted/30">
          {entry.content}
        </div>
      </DialogContent>
    </Dialog>
  )
}

// ── Main Sheet ─────────────────────────────────────────────────

export default function MemoriesSheet({
  repoPath,
  open,
  onOpenChange,
}: MemoriesSheetProps) {
  const [activeTab, setActiveTab] = useState<TabType>('memories')
  const [searchQuery, setSearchQuery] = useState('')
  const [memoryFilter, setMemoryFilter] = useState<MemoryType>('all')
  const [knowledgeFilter, setKnowledgeFilter] = useState<KnowledgeCategory>('all')

  // Data
  const [memories, setMemories] = useState<Memory[]>([])
  const [knowledgeEntries, setKnowledgeEntries] = useState<KnowledgeEntry[]>([])
  const [totalCount, setTotalCount] = useState(0)
  const [isLoading, setIsLoading] = useState(false)
  const [isEmpty, setIsEmpty] = useState(false)

  // Stats for filter chips
  const [memoryStats, setMemoryStats] = useState<{ total: number; by_type: Array<{ memory_type: string; count: number }> } | null>(null)
  const [knowledgeStats, setKnowledgeStats] = useState<{ total: number; by_category: Array<{ category: string; count: number }> } | null>(null)

  // Detail dialog
  const [selectedMemory, setSelectedMemory] = useState<Memory | null>(null)
  const [selectedKnowledge, setSelectedKnowledge] = useState<KnowledgeEntry | null>(null)
  const [detailOpen, setDetailOpen] = useState(false)

  // Virtualizer
  const scrollRef = useRef<HTMLDivElement>(null)
  const items = activeTab === 'memories' ? memories : knowledgeEntries

  const virtualizer = useVirtualizer({
    count: items.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 20,
  })

  // Load stats
  const loadStats = useCallback(async () => {
    try {
      if (activeTab === 'memories') {
        const res = await fetch(`/api/memories/stats?repo_path=${encodeURIComponent(repoPath)}`)
        if (res.ok) setMemoryStats(await res.json())
      } else {
        const res = await fetch(`/api/knowledge/stats?repo_path=${encodeURIComponent(repoPath)}`)
        if (res.ok) setKnowledgeStats(await res.json())
      }
    } catch { /* ignore */ }
  }, [repoPath, activeTab])

  // Load memories
  const loadMemories = useCallback(async () => {
    setIsLoading(true)
    setIsEmpty(false)
    try {
      const params = new URLSearchParams({ repo_path: repoPath, limit: String(PAGE_SIZE), offset: '0' })
      if (memoryFilter !== 'all') params.set('memory_type', memoryFilter)
      const res = await fetch(`/api/memories?${params}`)
      if (!res.ok) throw new Error('Failed to load memories')
      const data = await res.json()
      setMemories(data.memories || [])
      setTotalCount(data.total || 0)
      setIsEmpty((data.memories || []).length === 0)
    } catch (err) {
      console.error('Failed to load memories:', err)
      setIsEmpty(true)
    } finally {
      setIsLoading(false)
    }
  }, [repoPath, memoryFilter])

  // Load knowledge
  const loadKnowledge = useCallback(async () => {
    setIsLoading(true)
    setIsEmpty(false)
    try {
      const params = new URLSearchParams({ repo_path: repoPath, limit: String(PAGE_SIZE), offset: '0' })
      if (knowledgeFilter !== 'all') params.set('category', knowledgeFilter)
      const res = await fetch(`/api/knowledge?${params}`)
      if (!res.ok) throw new Error('Failed to load knowledge')
      const data = await res.json()
      setKnowledgeEntries(data.entries || [])
      setTotalCount(data.total || 0)
      setIsEmpty((data.entries || []).length === 0)
    } catch (err) {
      console.error('Failed to load knowledge:', err)
      setIsEmpty(true)
    } finally {
      setIsLoading(false)
    }
  }, [repoPath, knowledgeFilter])

  // Search memories
  const searchMem = useCallback(async (query: string) => {
    if (!query.trim()) { await loadMemories(); return }
    setIsLoading(true)
    setIsEmpty(false)
    try {
      const params = new URLSearchParams({ repo_path: repoPath, query })
      if (memoryFilter !== 'all') params.set('memory_type', memoryFilter)
      const res = await fetch(`/api/memories/search?${params}`)
      if (!res.ok) throw new Error('Failed to search memories')
      const data = await res.json()
      setMemories(data.memories || [])
      setTotalCount(data.memories?.length || 0)
      setIsEmpty((data.memories || []).length === 0)
    } catch (err) {
      console.error('Failed to search memories:', err)
      setIsEmpty(true)
    } finally {
      setIsLoading(false)
    }
  }, [repoPath, memoryFilter, loadMemories])

  // Search knowledge
  const searchKnow = useCallback(async (query: string) => {
    if (!query.trim()) { await loadKnowledge(); return }
    setIsLoading(true)
    setIsEmpty(false)
    try {
      const params = new URLSearchParams({ repo_path: repoPath, query })
      if (knowledgeFilter !== 'all') params.set('category', knowledgeFilter)
      const res = await fetch(`/api/knowledge/search?${params}`)
      if (!res.ok) throw new Error('Failed to search knowledge')
      const data = await res.json()
      setKnowledgeEntries(data.entries || [])
      setTotalCount(data.entries?.length || 0)
      setIsEmpty((data.entries || []).length === 0)
    } catch (err) {
      console.error('Failed to search knowledge:', err)
      setIsEmpty(true)
    } finally {
      setIsLoading(false)
    }
  }, [repoPath, knowledgeFilter, loadKnowledge])

  // Load on tab change
  useEffect(() => {
    if (!open) return
    loadStats()
    if (activeTab === 'memories') loadMemories()
    else loadKnowledge()
  }, [open, activeTab, loadMemories, loadKnowledge, loadStats])

  // Re-fetch when filter changes
  useEffect(() => {
    if (!open) return
    if (searchQuery.trim()) {
      if (activeTab === 'memories') searchMem(searchQuery)
      else searchKnow(searchQuery)
    } else {
      if (activeTab === 'memories') loadMemories()
      else loadKnowledge()
    }
    loadStats()
  }, [memoryFilter, knowledgeFilter])

  const handleSearch = async (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      if (activeTab === 'memories') await searchMem(searchQuery)
      else await searchKnow(searchQuery)
    }
  }

  const handleClearSearch = () => {
    setSearchQuery('')
    if (activeTab === 'memories') loadMemories()
    else loadKnowledge()
  }

  const handleFilterChange = (filter: MemoryType | KnowledgeCategory) => {
    if (activeTab === 'memories') setMemoryFilter(filter as MemoryType)
    else setKnowledgeFilter(filter as KnowledgeCategory)
  }

  // Build count lookup for filter chips
  const memoryCounts = useMemo(() => {
    const map: Record<string, number> = { all: memoryStats?.total ?? 0 }
    memoryStats?.by_type.forEach(t => { map[t.memory_type] = t.count })
    return map
  }, [memoryStats])

  const knowledgeCounts = useMemo(() => {
    const map: Record<string, number> = { all: knowledgeStats?.total ?? 0 }
    knowledgeStats?.by_category.forEach(c => { map[c.category] = c.count })
    return map
  }, [knowledgeStats])

  // Open detail
  const openDetail = (memory: Memory) => {
    setSelectedMemory(memory)
    setDetailOpen(true)
  }
  const openKnowledgeDetail = (entry: KnowledgeEntry) => {
    setSelectedKnowledge(entry)
    setDetailOpen(true)
  }

  return (
    <>
      <Sheet open={open} onOpenChange={onOpenChange}>
        <SheetContent side="right" style={{ width: '45vw', maxWidth: 'none' }} className="flex flex-col p-0">
          {/* Header */}
          <SheetHeader className="px-4 pt-4 pb-2 flex-row items-center justify-between space-y-0">
            <div>
              <div className="flex items-center gap-2">
                <Brain className="h-4 w-4 text-primary" />
                <SheetTitle className="text-lg">Memories</SheetTitle>
              </div>
              <SheetDescription className="text-xs font-mono truncate mt-0.5">
                {repoPath}
              </SheetDescription>
            </div>
          </SheetHeader>

          {/* Tabs */}
          <div className="px-4 pb-3 flex gap-2 border-b">
            <Button
              variant={activeTab === 'memories' ? 'default' : 'ghost'}
              size="sm"
              onClick={() => setActiveTab('memories')}
              className="text-sm"
            >
              Memories
            </Button>
            <Button
              variant={activeTab === 'knowledge' ? 'default' : 'ghost'}
              size="sm"
              onClick={() => setActiveTab('knowledge')}
              className="text-sm"
            >
              Knowledge
            </Button>
          </div>

          {/* Search bar + filters */}
          <div className="px-4 py-3 space-y-3 border-b">
            <div className="flex items-center gap-2">
              <Search className="h-4 w-4 text-muted-foreground flex-shrink-0" />
              <Input
                placeholder={activeTab === 'memories' ? 'Search memories...' : 'Search knowledge...'}
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                onKeyDown={handleSearch}
                className="h-8 text-sm flex-1"
              />
              {searchQuery && (
                <Button variant="ghost" size="icon" onClick={handleClearSearch} className="h-8 w-8">
                  <X className="h-4 w-4" />
                </Button>
              )}
            </div>

            {/* Filter chips with counts */}
            <div className="flex flex-wrap gap-2">
              {activeTab === 'memories'
                ? MEMORY_TYPES.map((type) => (
                    <Button
                      key={type}
                      variant={memoryFilter === type ? 'default' : 'outline'}
                      size="sm"
                      onClick={() => handleFilterChange(type)}
                      className="text-xs h-7 px-2 gap-1"
                    >
                      {type.charAt(0).toUpperCase() + type.slice(1)}
                      <span className="text-[10px] opacity-60">{memoryCounts[type] ?? 0}</span>
                    </Button>
                  ))
                : KNOWLEDGE_CATEGORIES.map((cat) => (
                    <Button
                      key={cat}
                      variant={knowledgeFilter === cat ? 'default' : 'outline'}
                      size="sm"
                      onClick={() => handleFilterChange(cat)}
                      className="text-xs h-7 px-2 gap-1"
                    >
                      {cat.charAt(0).toUpperCase() + cat.slice(1)}
                      <span className="text-[10px] opacity-60">{knowledgeCounts[cat] ?? 0}</span>
                    </Button>
                  ))}
            </div>
          </div>

          {/* Table header */}
          <div className="px-4 py-2 border-b bg-muted/30">
            <div className="grid grid-cols-[1fr_100px_90px_60px] gap-4 text-xs font-medium text-muted-foreground uppercase tracking-wider">
              <span>{activeTab === 'memories' ? 'Summary' : 'Title'}</span>
              <span>{activeTab === 'memories' ? 'Type' : 'Category'}</span>
              <span>Date</span>
              <span className="text-right">Score</span>
            </div>
          </div>

          {/* Virtualized table body */}
          <div ref={scrollRef} className="flex-1 overflow-y-auto">
            {!isLoading && isEmpty && (
              <div className="flex flex-col items-center justify-center py-8 text-center">
                <Brain className="h-8 w-8 text-muted-foreground mb-2 opacity-50" />
                <p className="text-sm text-muted-foreground">
                  No {activeTab === 'memories' ? 'memories' : 'knowledge'} found
                </p>
                {searchQuery && (
                  <p className="text-xs text-muted-foreground mt-1">
                    Try adjusting your search or filters
                  </p>
                )}
              </div>
            )}

            {!isLoading && !isEmpty && (
              <div
                style={{
                  height: `${virtualizer.getTotalSize()}px`,
                  width: '100%',
                  position: 'relative',
                }}
              >
                {virtualizer.getVirtualItems().map((virtualRow) => {
                  const item = items[virtualRow.index]
                  if (!item) return null

                  const isMemory = activeTab === 'memories'
                  const memory = isMemory ? (item as Memory) : null
                  const knowledge = !isMemory ? (item as KnowledgeEntry) : null

                  const title = isMemory
                    ? (memory!.summary || 'Untitled memory')
                    : (knowledge!.title || knowledge!.key)
                  const type = isMemory ? memory!.memory_type : knowledge!.category
                  const date = isMemory ? memory!.created_at : knowledge!.indexed_at
                  const importance = isMemory ? (memory!.importance || 0.5) : (knowledge!.importance || 0.5)
                  const colors = isMemory ? memoryTypeColors : knowledgeColors
                  const colorClass = colors[type] || ''

                  return (
                    <button
                      key={virtualRow.key}
                      onClick={() => isMemory ? openDetail(memory!) : openKnowledgeDetail(knowledge!)}
                      style={{
                        position: 'absolute',
                        top: 0,
                        left: 0,
                        width: '100%',
                        height: `${virtualRow.size}px`,
                        transform: `translateY(${virtualRow.start}px)`,
                      }}
                      className="grid grid-cols-[1fr_100px_90px_60px] gap-4 items-center px-4 text-left hover:bg-accent/50 transition-colors border-b border-border/50"
                    >
                      <span className="text-sm text-foreground truncate">{title}</span>
                      <Badge variant="outline" className={`text-[10px] px-1.5 py-0 h-4 w-fit ${colorClass}`}>
                        {type}
                      </Badge>
                      <span className="text-xs text-muted-foreground">{formatTimeAgo(date)}</span>
                      <span className="text-xs font-medium text-muted-foreground text-right tabular-nums">
                        {Math.round(importance * 100)}%
                      </span>
                    </button>
                  )
                })}
              </div>
            )}
          </div>
        </SheetContent>
      </Sheet>

      {/* Detail dialogs */}
      {activeTab === 'memories' ? (
        <MemoryDetailDialog
          memory={selectedMemory}
          open={detailOpen && !!selectedMemory}
          onOpenChange={setDetailOpen}
        />
      ) : (
        <KnowledgeDetailDialog
          entry={selectedKnowledge}
          open={detailOpen && !!selectedKnowledge}
          onOpenChange={setDetailOpen}
        />
      )}
    </>
  )
}
