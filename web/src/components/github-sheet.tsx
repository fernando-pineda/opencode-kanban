'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
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
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import { Skeleton } from '@/components/ui/skeleton'

import { useVirtualizer } from '@tanstack/react-virtual'
import { Separator } from '@/components/ui/separator'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Github,
  ExternalLink,
  Loader2,
  RefreshCw,
  Rocket,
  AlertCircle,
  Check,
  X,
  Eye,
  Search,
} from 'lucide-react'
import type {
  GitHubConfig,
  GitHubRepo,
  GitHubIssue,
  GitHubLabel,
  GitHubUser,
} from '../types'

// ── Props ────────────────────────────────────────────────────────

interface GithubSheetProps {
  boardId: number
  open: boolean
  onOpenChange: (open: boolean) => void
}

// ── Helpers ──────────────────────────────────────────────────────

function formatTimeAgo(date: string): string {
  const now = new Date()
  const then = new Date(date)
  const seconds = Math.floor((now.getTime() - then.getTime()) / 1000)
  if (seconds < 60) return 'just now'
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`
  if (seconds < 2592000) return `${Math.floor(seconds / 86400)}d ago`
  return then.toLocaleDateString()
}

function parseRepoFromUrl(url: string): string {
  // "https://api.github.com/repos/owner/repo" → "owner/repo"
  const match = url.match(/\/repos\/([^/]+\/[^/]+)/)
  return match ? match[1] : url
}

// ── Component ────────────────────────────────────────────────────

export default function GithubSheet({ boardId, open, onOpenChange }: GithubSheetProps) {
  // Config state
  const [config, setConfig] = useState<GitHubConfig | null>(null)
  const [loadingConfig, setLoadingConfig] = useState(false)

  // Setup state
  const [tokenInput, setTokenInput] = useState('')
  const [saving, setSaving] = useState(false)
  const [setupError, setSetupError] = useState<string | null>(null)

  // Repo picker state
  const [repos, setRepos] = useState<GitHubRepo[]>([])
  const [selectedRepos, setSelectedRepos] = useState<string[]>([])
  const [loadingRepos, setLoadingRepos] = useState(false)
  const [showRepoPicker, setShowRepoPicker] = useState(false)
  const [repoFilter, setRepoFilter] = useState('')

  // Issues state
  const [issuesByRepo, setIssuesByRepo] = useState<Record<string, GitHubIssue[]>>({})
  const [loadingIssues, setLoadingIssues] = useState(false)
  const [activeRepoTab, setActiveRepoTab] = useState<string>('')
  const [issuesFilter, setIssuesFilter] = useState('')

  // Spawn dialog state
  const [spawnDialogOpen, setSpawnDialogOpen] = useState(false)
  const [spawnIssue, setSpawnIssue] = useState<GitHubIssue | null>(null)
  const [spawnAgent, setSpawnAgent] = useState('')
  const [agents, setAgents] = useState<{ name: string }[]>([])
  const [spawning, setSpawning] = useState(false)

  // Issue detail state
  const [detailIssue, setDetailIssue] = useState<GitHubIssue | null>(null)

  // ── Fetch config ───────────────────────────────────────────────

  const fetchConfig = useCallback(async () => {
    setLoadingConfig(true)
    try {
      const res = await fetch(`/api/boards/${boardId}/github/config`)
      const data = await res.json()
      setConfig(data)
      if (data.selected_repos?.length > 0 && !activeRepoTab) {
        setActiveRepoTab(data.selected_repos[0])
      }
    } catch {
      // ignore
    } finally {
      setLoadingConfig(false)
    }
  }, [boardId, activeRepoTab])

  useEffect(() => {
    if (open) fetchConfig()
  }, [open, fetchConfig])

  // ── Fetch repos (for setup/picker) ─────────────────────────────

  const fetchRepos = useCallback(async () => {
    setLoadingRepos(true)
    setShowRepoPicker(true)
    try {
      const res = await fetch(`/api/boards/${boardId}/github/repos`)
      if (res.ok) {
        const data = await res.json()
        setRepos(data.repos || [])
        setSelectedRepos(data.selected_repos || [])
      }
    } catch {
      // ignore
    } finally {
      setLoadingRepos(false)
    }
  }, [boardId])

  // ── Save token ─────────────────────────────────────────────────

  const handleSaveToken = async () => {
    if (!tokenInput.trim()) return
    setSaving(true)
    setSetupError(null)
    try {
      const res = await fetch(`/api/boards/${boardId}/github/config`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: tokenInput.trim() }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Failed to save token')
      setTokenInput('')
      await fetchConfig()
      // Auto-fetch repos after saving token
      fetchRepos()
    } catch (err) {
      setSetupError((err as Error).message)
    } finally {
      setSaving(false)
    }
  }

  // ── Save selected repos ────────────────────────────────────────

  const handleSaveRepos = async () => {
    try {
      await fetch(`/api/boards/${boardId}/github/repos`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ selected_repos: selectedRepos }),
      })
      setShowRepoPicker(false)
      await fetchConfig()
      // Auto-load issues for first selected repo
      if (selectedRepos.length > 0) {
        setActiveRepoTab(selectedRepos[0])
        fetchIssues()
      }
    } catch {
      // ignore
    }
  }

  // ── Fetch issues ───────────────────────────────────────────────

  const fetchIssues = useCallback(async () => {
    if (!config?.has_token || config.selected_repos.length === 0) return
    setLoadingIssues(true)
    try {
      const repoParam = activeRepoTab || undefined
      const url = `/api/boards/${boardId}/github/issues?state=open${repoParam ? `&repo=${encodeURIComponent(repoParam)}` : ''}`
      const res = await fetch(url)
      if (res.ok) {
        const data = await res.json()
        setIssuesByRepo(data.repos || {})
      }
    } catch {
      // ignore
    } finally {
      setLoadingIssues(false)
    }
  }, [boardId, config?.has_token, config?.selected_repos, activeRepoTab])

  useEffect(() => {
    if (open && config?.has_token && config.selected_repos.length > 0) {
      fetchIssues()
    }
  }, [open, config?.has_token, config?.selected_repos, activeRepoTab, fetchIssues])

  // ── Fetch agents (for spawn dialog) ────────────────────────────

  useEffect(() => {
    if (spawnDialogOpen) {
      fetch('/api/agents')
        .then(r => r.json())
        .then(setAgents)
        .catch(() => {})
    }
  }, [spawnDialogOpen])

  // ── Spawn agent ────────────────────────────────────────────────

  const handleSpawn = async () => {
    if (!spawnIssue) return
    setSpawning(true)
    try {
      const res = await fetch(`/api/boards/${boardId}/github/spawn`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          issue: {
            title: spawnIssue.title,
            body: spawnIssue.body || '',
            html_url: spawnIssue.html_url,
            number: spawnIssue.number,
            repository_url: spawnIssue.repository_url,
          },
          agent: spawnAgent || undefined,
        }),
      })
      if (!res.ok) {
        const data = await res.json()
        throw new Error(data.error || 'Failed to spawn agent')
      }
      setSpawnDialogOpen(false)
      setSpawnIssue(null)
      setSpawnAgent('')
    } catch (err) {
      console.error('Spawn failed:', err)
    } finally {
      setSpawning(false)
    }
  }

  // ── Delete config ──────────────────────────────────────────────

  const handleDisconnect = async () => {
    try {
      await fetch(`/api/boards/${boardId}/github/config`, { method: 'DELETE' })
      setConfig(null)
      setRepos([])
      setSelectedRepos([])
      setIssuesByRepo({})
      setShowRepoPicker(false)
      setActiveRepoTab('')
    } catch {
      // ignore
    }
  }

  // ── Toggle repo selection ──────────────────────────────────────

  const toggleRepo = (fullName: string) => {
    setSelectedRepos(prev =>
      prev.includes(fullName)
        ? prev.filter(r => r !== fullName)
        : [...prev, fullName]
    )
  }

  // ── Render helpers ─────────────────────────────────────────────

  const currentRepoIssues = activeRepoTab ? (issuesByRepo[activeRepoTab] || []) : []
  const filteredIssues = issuesFilter
    ? currentRepoIssues.filter(i =>
        i.title.toLowerCase().includes(issuesFilter.toLowerCase()) ||
        i.labels.some(l => l.name.toLowerCase().includes(issuesFilter.toLowerCase()))
      )
    : currentRepoIssues

  const filteredRepos = repoFilter
    ? repos.filter(r =>
        r.full_name.toLowerCase().includes(repoFilter.toLowerCase()) ||
        (r.description && r.description.toLowerCase().includes(repoFilter.toLowerCase()))
      )
    : repos

  // Virtualizer: repo picker
  const repoScrollRef = useRef<HTMLDivElement>(null)
  const repoVirtualizer = useVirtualizer({
    count: filteredRepos.length,
    getScrollElement: () => repoScrollRef.current,
    estimateSize: () => 56,
    overscan: 10,
  })

  // Virtualizer: issues list
  const issueScrollRef = useRef<HTMLDivElement>(null)
  const issueVirtualizer = useVirtualizer({
    count: filteredIssues.length,
    getScrollElement: () => issueScrollRef.current,
    estimateSize: () => 48,
    overscan: 10,
  })

  // ── Render ─────────────────────────────────────────────────────

  return (
    <>
      <Sheet open={open} onOpenChange={onOpenChange}>
        <SheetContent side="right" style={{ width: '55vw', maxWidth: 'none' }} className="flex flex-col p-0">
          <SheetHeader className="px-6 pt-6 pb-4 border-b">
            <div className="flex items-center gap-2">
              <Github className="h-5 w-5" />
              <SheetTitle>GitHub</SheetTitle>
            </div>
          </SheetHeader>

          <div className="flex-1 overflow-hidden">
            {/* ── Setup Mode ──────────────────────────────────── */}
            {loadingConfig ? (
              <div className="p-6 space-y-4">
                <Skeleton className="h-10 w-full" />
                <Skeleton className="h-20 w-full" />
              </div>
            ) : !config?.has_token ? (
              <div className="p-6 space-y-4">
                <div className="space-y-2">
                  <h3 className="text-sm font-medium">Connect GitHub</h3>
                  <p className="text-xs text-muted-foreground">
                    Enter a GitHub Personal Access Token with repo access.
                    The token is stored locally for this board only.
                  </p>
                </div>
                <div className="space-y-2">
                  <Input
                    type="password"
                    placeholder="ghp_xxxxxxxxxxxxxxxxxxxx"
                    value={tokenInput}
                    onChange={e => setTokenInput(e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && handleSaveToken()}
                  />
                  {setupError && (
                    <p className="text-xs text-destructive flex items-center gap-1">
                      <AlertCircle className="h-3 w-3" />
                      {setupError}
                    </p>
                  )}
                  <Button onClick={handleSaveToken} disabled={saving || !tokenInput.trim()} className="w-full">
                    {saving ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Check className="h-4 w-4 mr-2" />}
                    Connect
                  </Button>
                </div>
              </div>
            ) : showRepoPicker ? (
              /* ── Repo Picker ─────────────────────────────────── */
              <div className="flex flex-col h-full">
                <div className="px-6 pt-4 pb-3 space-y-3">
                  <div className="flex items-center justify-between">
                    <h3 className="text-sm font-medium">Select Repositories</h3>
                    <span className="text-xs text-muted-foreground">
                      {selectedRepos.length} selected
                    </span>
                  </div>
                  {!loadingRepos && repos.length > 0 && (
                    <div className="relative">
                      <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
                      <Input
                        placeholder="Search repositories..."
                        value={repoFilter}
                        onChange={e => setRepoFilter(e.target.value)}
                        className="pl-8 h-8 text-xs"
                      />
                    </div>
                  )}
                </div>
                <div className="flex-1 overflow-hidden px-6">
                  {loadingRepos ? (
                    <div className="space-y-3">
                      <div className="flex items-center gap-2 text-muted-foreground">
                        <Loader2 className="h-4 w-4 animate-spin" />
                        <span className="text-sm">Loading repositories...</span>
                      </div>
                      {[1, 2, 3, 4, 5].map(i => <Skeleton key={i} className="h-12 w-full" />)}
                    </div>
                  ) : (
                    <div ref={repoScrollRef} className="h-full overflow-y-auto">
                      <div
                        style={{
                          height: `${repoVirtualizer.getTotalSize()}px`,
                          width: '100%',
                          position: 'relative',
                        }}
                      >
                        {repoVirtualizer.getVirtualItems().map((virtualRow) => {
                          const repo = filteredRepos[virtualRow.index]
                          if (!repo) return null
                          const isSelected = selectedRepos.includes(repo.full_name)
                          return (
                            <button
                              key={repo.id}
                              onClick={() => toggleRepo(repo.full_name)}
                              style={{
                                position: 'absolute',
                                top: 0,
                                left: 0,
                                width: '100%',
                                height: `${virtualRow.size}px`,
                                transform: `translateY(${virtualRow.start}px)`,
                              }}
                              className={`w-full flex items-center gap-3 px-3 rounded-lg border text-left transition-colors ${
                                isSelected
                                  ? 'border-primary bg-primary/5'
                                  : 'border-transparent hover:bg-accent'
                              }`}
                            >
                              <div className={`w-4 h-4 rounded border flex items-center justify-center shrink-0 ${
                                isSelected
                                  ? 'bg-primary border-primary text-primary-foreground'
                                  : 'border-muted-foreground/30'
                              }`}>
                                {isSelected && <Check className="h-3 w-3" />}
                              </div>
                              <div className="min-w-0 flex-1">
                                <div className="text-sm font-medium truncate">{repo.full_name}</div>
                                {repo.description && (
                                  <div className="text-xs text-muted-foreground truncate">{repo.description}</div>
                                )}
                              </div>
                              <div className="flex items-center gap-2 shrink-0">
                                {repo.language && (
                                  <Badge variant="outline" className="text-[10px] px-1.5 py-0">{repo.language}</Badge>
                                )}
                                {repo.private && (
                                  <Badge variant="secondary" className="text-[10px] px-1.5 py-0">Private</Badge>
                                )}
                              </div>
                            </button>
                          )
                        })}
                      </div>
                    </div>
                  )}
                </div>
                <div className="border-t px-6 py-4 flex gap-2">
                  <Button variant="outline" onClick={() => { setShowRepoPicker(false); setRepoFilter('') }} className="flex-1">
                    Cancel
                  </Button>
                  <Button onClick={handleSaveRepos} disabled={selectedRepos.length === 0} className="flex-1">
                    Save Selection
                  </Button>
                </div>
              </div>
            ) : config.selected_repos.length === 0 ? (
              /* ── No repos selected ───────────────────────────── */
              <div className="p-6 space-y-4">
                <div className="text-center py-8 space-y-2">
                  <Github className="h-8 w-8 mx-auto text-muted-foreground" />
                  <h3 className="text-sm font-medium">No Repositories Selected</h3>
                  <p className="text-xs text-muted-foreground">
                    Select which repositories to show issues from.
                  </p>
                  <div className="flex items-center justify-center gap-2 mt-2">
                    <Button onClick={fetchRepos} variant="outline">
                      Select Repositories
                    </Button>
                    <Button variant="ghost" size="sm" onClick={handleDisconnect} className="text-xs text-muted-foreground hover:text-destructive">
                      Disconnect
                    </Button>
                  </div>
                </div>
              </div>
            ) : detailIssue ? (
              /* ── Issue Detail ─────────────────────────────────── */
              <div className="flex flex-col h-full">
                <div className="px-6 pt-4 pb-3 border-b">
                  <div className="flex items-center gap-2">
                    <Button variant="ghost" size="sm" onClick={() => setDetailIssue(null)} className="h-7 px-2 text-xs">
                      ← Back
                    </Button>
                    <span className="text-xs text-muted-foreground font-mono">#{detailIssue.number}</span>
                  </div>
                  <h2 className="text-base font-semibold mt-2">{detailIssue.title}</h2>
                  <div className="flex items-center gap-2 mt-1 flex-wrap">
                    <Badge variant={detailIssue.state === 'open' ? 'default' : 'secondary'} className="text-[10px] px-1.5 py-0">
                      {detailIssue.state}
                    </Badge>
                    {detailIssue.labels.map(label => (
                      <Badge
                        key={label.id}
                        className="text-[10px] px-1.5 py-0 border-0"
                        style={{
                          backgroundColor: `#${label.color}20`,
                          color: `#${label.color}`,
                        }}
                      >
                        {label.name}
                      </Badge>
                    ))}
                    <span className="text-xs text-muted-foreground">
                      opened {formatTimeAgo(detailIssue.created_at)} by {detailIssue.user.login}
                    </span>
                    {detailIssue.updated_at !== detailIssue.created_at && (
                      <span className="text-xs text-muted-foreground">
                        · updated {formatTimeAgo(detailIssue.updated_at)}
                      </span>
                    )}
                  </div>
                  {detailIssue.assignees.length > 0 && (
                    <div className="flex items-center gap-1 mt-2">
                      <span className="text-xs text-muted-foreground">Assignees:</span>
                      {detailIssue.assignees.map(a => (
                        <Badge key={a.id} variant="outline" className="text-[10px] px-1.5 py-0">{a.login}</Badge>
                      ))}
                    </div>
                  )}
                </div>
                <div className="flex-1 overflow-y-auto px-6 py-4">
                  {detailIssue.body ? (
                    <div className="text-sm whitespace-pre-wrap break-words leading-relaxed text-muted-foreground">
                      {detailIssue.body}
                    </div>
                  ) : (
                    <p className="text-sm text-muted-foreground italic">No description provided.</p>
                  )}
                </div>
                <div className="border-t px-6 py-4 flex items-center gap-2">
                  <Button
                    variant="outline"
                    onClick={() => window.open(detailIssue.html_url, '_blank')}
                    className="text-xs"
                  >
                    <ExternalLink className="h-3 w-3 mr-1" />
                    Open on GitHub
                  </Button>
                  <div className="flex-1" />
                  <Button
                    variant="default"
                    onClick={() => {
                      setSpawnIssue(detailIssue)
                      setSpawnDialogOpen(true)
                    }}
                    className="text-xs"
                  >
                    <Rocket className="h-3 w-3 mr-1" />
                    Spawn Agent
                  </Button>
                </div>
              </div>
            ) : (
              /* ── Issues View ─────────────────────────────────── */
              <div className="flex flex-col h-full">
                {/* Repo Tabs */}
                <div className="border-b px-4">
                  <div className="flex items-center gap-2">
                    <Tabs
                      value={activeRepoTab}
                      onValueChange={setActiveRepoTab}
                      className="flex-1"
                    >
                      <TabsList variant="line" className="w-full overflow-x-auto">
                        {config.selected_repos.map(repo => (
                          <TabsTrigger key={repo} value={repo} className="text-xs">
                            {repo.split('/')[1]}
                          </TabsTrigger>
                        ))}
                      </TabsList>
                    </Tabs>
                    <Button variant="ghost" size="sm" onClick={fetchRepos} className="shrink-0 h-8 w-8 p-0">
                      <RefreshCw className="h-3.5 w-3.5" />
                    </Button>
                    <Button variant="ghost" size="sm" onClick={handleDisconnect} className="shrink-0 h-8 px-2 text-xs text-muted-foreground hover:text-destructive">
                      Disconnect
                    </Button>
                  </div>
                </div>

                {/* Search bar */}
                <div className="px-4 py-2 border-b">
                  <div className="relative">
                    <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
                    <Input
                      placeholder="Filter issues..."
                      value={issuesFilter}
                      onChange={e => setIssuesFilter(e.target.value)}
                      className="pl-8 h-8 text-xs"
                    />
                  </div>
                </div>

                {/* Table header */}
                <div className="px-4 py-2 border-b bg-muted/30">
                  <div className="grid grid-cols-[1fr_120px_80px_110px] gap-4 text-xs font-medium text-muted-foreground uppercase tracking-wider">
                    <span>Issue</span>
                    <span>Opened</span>
                    <span className="text-center">Comments</span>
                    <span className="text-right">Actions</span>
                  </div>
                </div>

                {/* Issues Table */}
                <div ref={issueScrollRef} className="flex-1 overflow-y-auto">
                  {loadingIssues ? (
                    <div className="p-4 space-y-2">
                      {Array.from({ length: 5 }).map((_, i) => (
                        <div key={i} className="h-12">
                          <Skeleton className="h-8 w-full" />
                        </div>
                      ))}
                    </div>
                  ) : filteredIssues.length === 0 ? (
                    <div className="text-center py-8 text-muted-foreground text-sm">
                      No open issues found
                    </div>
                  ) : (
                    <div
                      style={{
                        height: `${issueVirtualizer.getTotalSize()}px`,
                        width: '100%',
                        position: 'relative',
                      }}
                    >
                      {issueVirtualizer.getVirtualItems().map((virtualRow) => {
                        const issue = filteredIssues[virtualRow.index]
                        if (!issue) return null
                        return (
                          <div
                            key={virtualRow.key}
                            style={{
                              position: 'absolute',
                              top: 0,
                              left: 0,
                              width: '100%',
                              height: `${virtualRow.size}px`,
                              transform: `translateY(${virtualRow.start}px)`,
                            }}
                            className="grid grid-cols-[1fr_120px_80px_110px] gap-4 items-center px-4 hover:bg-accent/50 transition-colors border-b border-border/50 cursor-pointer"
                            onClick={() => setDetailIssue(issue)}
                          >
                            {/* Issue title + labels */}
                            <div className="min-w-0 flex items-center gap-2">
                              <span className="text-xs text-muted-foreground font-mono shrink-0">#{issue.number}</span>
                              <span className="text-sm truncate">{issue.title}</span>
                              {issue.labels.length > 0 && (
                                <div className="flex items-center gap-1 shrink-0">
                                  {issue.labels.slice(0, 2).map(label => (
                                    <Badge
                                      key={label.id}
                                      className="text-[10px] px-1.5 py-0 border-0"
                                      style={{
                                        backgroundColor: `#${label.color}20`,
                                        color: `#${label.color}`,
                                      }}
                                    >
                                      {label.name}
                                    </Badge>
                                  ))}
                                  {issue.labels.length > 2 && (
                                    <span className="text-[10px] text-muted-foreground">+{issue.labels.length - 2}</span>
                                  )}
                                </div>
                              )}
                            </div>
                            {/* Opened */}
                            <span className="text-xs text-muted-foreground truncate">
                              {formatTimeAgo(issue.created_at)}
                            </span>
                            {/* Comments */}
                            <span className="text-xs text-muted-foreground text-center">
                              {issue.comments > 0 ? issue.comments : '—'}
                            </span>
                            {/* Actions */}
                            <div className="flex items-center justify-end gap-1" onClick={e => e.stopPropagation()}>
                              <Button
                                variant="ghost"
                                size="sm"
                                className="h-7 w-7 p-0"
                                onClick={() => window.open(issue.html_url, '_blank')}
                              >
                                <ExternalLink className="h-3 w-3" />
                              </Button>
                              <Button
                                variant="default"
                                size="sm"
                                className="h-7 px-2 text-xs"
                                onClick={() => {
                                  setSpawnIssue(issue)
                                  setSpawnDialogOpen(true)
                                }}
                              >
                                <Rocket className="h-3 w-3 mr-1" />
                                Spawn
                              </Button>
                            </div>
                          </div>
                        )
                      })}
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        </SheetContent>
      </Sheet>

      {/* ── Spawn Dialog ─────────────────────────────────────── */}
      <Dialog open={spawnDialogOpen} onOpenChange={setSpawnDialogOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Rocket className="h-4 w-4" />
              Spawn Agent from Issue
            </DialogTitle>
            <DialogDescription>
              Create a new session to work on this GitHub issue.
            </DialogDescription>
          </DialogHeader>

          {spawnIssue && (
            <div className="space-y-4">
              {/* Issue Preview */}
              <div className="rounded-lg border p-3 space-y-2 bg-muted/30">
                <div className="flex items-center gap-2">
                  <span className="text-xs text-muted-foreground font-mono">
                    #{spawnIssue.number}
                  </span>
                  <span className="text-sm font-medium">{spawnIssue.title}</span>
                </div>
                {spawnIssue.body && (
                  <p className="text-xs text-muted-foreground line-clamp-4 whitespace-pre-wrap">
                    {spawnIssue.body.slice(0, 500)}
                    {spawnIssue.body.length > 500 ? '...' : ''}
                  </p>
                )}
                <a
                  href={spawnIssue.html_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-xs text-primary hover:underline inline-flex items-center gap-1"
                >
                  <ExternalLink className="h-3 w-3" />
                  View on GitHub
                </a>
              </div>

              <Separator />

              {/* Message Preview */}
              <div className="space-y-1.5">
                <h4 className="text-xs font-medium text-muted-foreground">Message Preview</h4>
                <div className="rounded border bg-muted/30 p-3 text-xs whitespace-pre-wrap text-muted-foreground max-h-32 overflow-y-auto">
                  {`## GitHub Issue #${spawnIssue.number}\n\n**Title:** ${spawnIssue.title}\n**URL:** ${spawnIssue.html_url}\n\n${spawnIssue.body || '(no description)'}\n\n---\n\nPlease analyze and address this GitHub issue.`}
                </div>
              </div>

              <Separator />

              {/* Agent Selector */}
              <div className="space-y-1.5">
                <h4 className="text-xs font-medium text-muted-foreground">Agent</h4>
                <Select value={spawnAgent} onValueChange={setSpawnAgent}>
                  <SelectTrigger>
                    <SelectValue placeholder="Default agent" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="">Default agent</SelectItem>
                    {agents.map(a => (
                      <SelectItem key={a.name} value={a.name}>
                        {a.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {/* Actions */}
              <div className="flex justify-end gap-2">
                <Button
                  variant="outline"
                  onClick={() => setSpawnDialogOpen(false)}
                  disabled={spawning}
                >
                  Cancel
                </Button>
                <Button onClick={handleSpawn} disabled={spawning}>
                  {spawning ? (
                    <Loader2 className="h-4 w-4 animate-spin mr-2" />
                  ) : (
                    <Rocket className="h-4 w-4 mr-2" />
                  )}
                  Spawn Agent
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  )
}
