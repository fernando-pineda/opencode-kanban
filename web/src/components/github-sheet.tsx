'use client'

import { useState, useEffect, useCallback } from 'react'
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
import { ScrollArea } from '@/components/ui/scroll-area'
import { Skeleton } from '@/components/ui/skeleton'
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
    try {
      const res = await fetch(`/api/boards/${boardId}/github/repos`)
      if (res.ok) {
        const data = await res.json()
        setRepos(data.repos || [])
        setSelectedRepos(data.selected_repos || [])
        setShowRepoPicker(true)
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

  // ── Render ─────────────────────────────────────────────────────

  return (
    <>
      <Sheet open={open} onOpenChange={onOpenChange}>
        <SheetContent side="right" className="w-[45vw] min-w-[400px] p-0 flex flex-col">
          <SheetHeader className="px-6 pt-6 pb-4 border-b">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Github className="h-5 w-5" />
                <SheetTitle>GitHub</SheetTitle>
              </div>
              {config?.has_token && (
                <div className="flex items-center gap-2">
                  <Badge variant="outline" className="text-xs font-mono">
                    {config.token_masked}
                  </Badge>
                  <Button variant="ghost" size="sm" onClick={handleDisconnect} className="h-7 text-xs text-muted-foreground hover:text-destructive">
                    Disconnect
                  </Button>
                </div>
              )}
            </div>
            <SheetDescription>
              {config?.has_token
                ? `${config.selected_repos.length} repos selected`
                : 'Connect your GitHub account to view issues'}
            </SheetDescription>
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
              <div className="p-6 space-y-4">
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-medium">Select Repositories</h3>
                  <span className="text-xs text-muted-foreground">
                    {selectedRepos.length} selected
                  </span>
                </div>
                {loadingRepos ? (
                  <div className="space-y-2">
                    {[1, 2, 3].map(i => <Skeleton key={i} className="h-12 w-full" />)}
                  </div>
                ) : (
                  <ScrollArea className="h-[60vh]">
                    <div className="space-y-1 pr-4">
                      {repos.map(repo => (
                        <button
                          key={repo.id}
                          onClick={() => toggleRepo(repo.full_name)}
                          className={`w-full flex items-center gap-3 p-3 rounded-lg border text-left transition-colors ${
                            selectedRepos.includes(repo.full_name)
                              ? 'border-primary bg-primary/5'
                              : 'border-transparent hover:bg-accent'
                          }`}
                        >
                          <div className={`w-4 h-4 rounded border flex items-center justify-center shrink-0 ${
                            selectedRepos.includes(repo.full_name)
                              ? 'bg-primary border-primary text-primary-foreground'
                              : 'border-muted-foreground/30'
                          }`}>
                            {selectedRepos.includes(repo.full_name) && <Check className="h-3 w-3" />}
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
                      ))}
                    </div>
                  </ScrollArea>
                )}
                <div className="flex gap-2">
                  <Button variant="outline" onClick={() => setShowRepoPicker(false)} className="flex-1">
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
                  <Button onClick={fetchRepos} variant="outline" className="mt-2">
                    Select Repositories
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

                {/* Issues List */}
                <ScrollArea className="flex-1">
                  <div className="p-4 space-y-2">
                    {loadingIssues ? (
                      Array.from({ length: 5 }).map((_, i) => (
                        <div key={i} className="p-3 rounded-lg border space-y-2">
                          <Skeleton className="h-4 w-3/4" />
                          <Skeleton className="h-3 w-1/2" />
                        </div>
                      ))
                    ) : filteredIssues.length === 0 ? (
                      <div className="text-center py-8 text-muted-foreground text-sm">
                        No open issues found
                      </div>
                    ) : (
                      filteredIssues.map(issue => (
                        <div
                          key={issue.id}
                          className="p-3 rounded-lg border hover:bg-accent/50 transition-colors group"
                        >
                          <div className="flex items-start justify-between gap-2">
                            <div className="min-w-0 flex-1">
                              <div className="flex items-center gap-2 flex-wrap">
                                <span className="text-xs text-muted-foreground font-mono">#{issue.number}</span>
                                <span className="text-sm font-medium truncate">{issue.title}</span>
                              </div>
                              <div className="flex items-center gap-2 mt-1 flex-wrap">
                                {issue.labels.map(label => (
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
                                <span className="text-[10px] text-muted-foreground">
                                  opened {formatTimeAgo(issue.created_at)} by {issue.user.login}
                                </span>
                                {issue.comments > 0 && (
                                  <span className="text-[10px] text-muted-foreground">
                                    · {issue.comments} comment{issue.comments !== 1 ? 's' : ''}
                                  </span>
                                )}
                              </div>
                            </div>
                            <div className="flex items-center gap-1 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
                              <Button
                                variant="ghost"
                                size="sm"
                                className="h-7 px-2 text-xs"
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
                        </div>
                      ))
                    )}
                  </div>
                </ScrollArea>
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
