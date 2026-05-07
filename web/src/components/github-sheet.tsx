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
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { Popover, PopoverTrigger, PopoverContent } from '@/components/ui/popover'
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
  LayoutList,
  FolderGit2,
  SlidersHorizontal,
} from 'lucide-react'
import type {
  GitHubConfig,
  GitHubRepo,
  GitHubIssue,
  GitHubLabel,
  GitHubUser,
  GitHubProject,
  GitHubProjectItem,
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

  // Project picker state
  const [allProjects, setAllProjects] = useState<GitHubProject[]>([])
  const [selectedProjectIds, setSelectedProjectIds] = useState<string[]>([])
  const [projectFilter, setProjectFilter] = useState('')
  const [loadingProjects, setLoadingProjects] = useState(false)
  const [showProjectPicker, setShowProjectPicker] = useState(false)

  // Issues state
  const [issuesByRepo, setIssuesByRepo] = useState<Record<string, GitHubIssue[]>>({})
  const [loadingIssues, setLoadingIssues] = useState(false)
  const [activeRepoTab, setActiveRepoTab] = useState<string>('')
  const [issuesFilter, setIssuesFilter] = useState('')

  // Issues filters (advanced)
  const [issuesStateFilter, setIssuesStateFilter] = useState<'open' | 'closed' | 'all'>('open')
  const [issuesAssigneeFilter, setIssuesAssigneeFilter] = useState<string>('all')
  const [issuesLabelFilter, setIssuesLabelFilter] = useState<string>('all')

  // Projects view state
  const [projects, setProjects] = useState<GitHubProject[]>([])
  const [activeProjectTab, setActiveProjectTab] = useState<string>('')
  const [projectItems, setProjectItems] = useState<GitHubProjectItem[]>([])
  const [loadingProjectItems, setLoadingProjectItems] = useState(false)
  const [projectItemsFilter, setProjectItemsFilter] = useState('')

  // Project items filters (advanced)
  const [projectsTypeFilter, setProjectsTypeFilter] = useState<string>('all')
  const [projectsAssigneeFilter, setProjectsAssigneeFilter] = useState<string>('all')

  // Spawn dialog state
  const [spawnDialogOpen, setSpawnDialogOpen] = useState(false)
  const [spawnIssue, setSpawnIssue] = useState<GitHubIssue | null>(null)
  const [spawnAgent, setSpawnAgent] = useState('')
  const [agents, setAgents] = useState<{ name: string }[]>([])
  const [spawning, setSpawning] = useState(false)

  // Issue detail state
  const [detailIssue, setDetailIssue] = useState<GitHubIssue | null>(null)

  // Project item detail state
  const [detailProjectItem, setDetailProjectItem] = useState<GitHubProjectItem | null>(null)

  // Tab state
  const [activeMainTab, setActiveMainTab] = useState('issues')

  // ── Reset on board change ────────────────────────────────────────
  useEffect(() => {
    setConfig(null)
    setLoadingConfig(false)
    setTokenInput('')
    setSaving(false)
    setSetupError(null)
    setRepos([])
    setSelectedRepos([])
    setLoadingRepos(false)
    setShowRepoPicker(false)
    setRepoFilter('')
    setIssuesByRepo({})
    setLoadingIssues(false)
    setActiveRepoTab('')
    setIssuesFilter('')
    setIssuesStateFilter('open')
    setIssuesAssigneeFilter('all')
    setIssuesLabelFilter('all')
    setSpawnDialogOpen(false)
    setSpawnIssue(null)
    setSpawnAgent('')
    setSpawning(false)
    setDetailIssue(null)
    setActiveMainTab('issues')
    setAllProjects([])
    setSelectedProjectIds([])
    setProjectFilter('')
    setLoadingProjects(false)
    setShowProjectPicker(false)
    setProjects([])
    setActiveProjectTab('')
    setProjectItems([])
    setLoadingProjectItems(false)
    setProjectItemsFilter('')
    setDetailProjectItem(null)
  }, [boardId])

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
      if (data.selected_projects?.length > 0 && !activeProjectTab) {
        setActiveProjectTab(data.selected_projects[0])
      }
    } catch {
      // ignore
    } finally {
      setLoadingConfig(false)
    }
  }, [boardId, activeRepoTab, activeProjectTab])

  useEffect(() => {
    if (open) fetchConfig()
  }, [open, fetchConfig])

  // ── Fetch repos (for setup/picker) ─────────────────────────────

  const fetchRepos = useCallback(async () => {
    setLoadingRepos(true)
    setShowRepoPicker(true)
    setShowProjectPicker(false)
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

  // ── Fetch projects (for picker) ────────────────────────────────

  const fetchProjectPicker = useCallback(async () => {
    if (!config?.has_token) return
    setLoadingProjects(true)
    setShowProjectPicker(true)
    setShowRepoPicker(false)
    try {
      const res = await fetch(`/api/boards/${boardId}/github/projects?all=true`)
      if (res.ok) {
        const data = await res.json()
        setAllProjects(data.projects || [])
        setSelectedProjectIds(config.selected_projects || [])
      }
    } catch {
      // ignore
    } finally {
      setLoadingProjects(false)
    }
  }, [boardId, config?.has_token, config?.selected_projects])

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

  // ── Save selected projects ─────────────────────────────────────

  const handleSaveProjects = async () => {
    try {
      await fetch(`/api/boards/${boardId}/github/projects`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ selected_projects: selectedProjectIds }),
      })
      setShowProjectPicker(false)
      await fetchConfig()
      if (selectedProjectIds.length > 0) {
        const firstProject = allProjects.find(p => selectedProjectIds.includes(p.id))
        if (firstProject) setActiveProjectTab(firstProject.id)
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

  // ── Fetch projects (for Projects tab — filtered) ───────────────

  const fetchProjects = useCallback(async (force?: boolean) => {
    if (!config?.has_token) return
    // Skip re-fetch if we already have data (unless forced)
    if (!force && projects.length > 0) return
    setLoadingProjects(true)
    try {
      const res = await fetch(`/api/boards/${boardId}/github/projects`)
      if (res.ok) {
        const data = await res.json()
        setProjects(data.projects || [])
        // Auto-select first project if none selected
        if (!activeProjectTab && data.projects?.length > 0) {
          setActiveProjectTab(data.projects[0].id)
        }
      }
    } catch {
      // ignore
    } finally {
      setLoadingProjects(false)
    }
  }, [boardId, config?.has_token, activeProjectTab, projects.length])

  const fetchProjectItems = useCallback(async (projectId: string) => {
    setLoadingProjectItems(true)
    try {
      const res = await fetch(`/api/boards/${boardId}/github/projects/${projectId}/items`)
      if (res.ok) {
        const data = await res.json()
        setProjectItems(data.items || [])
      }
    } catch {
      // ignore
    } finally {
      setLoadingProjectItems(false)
    }
  }, [boardId])

  useEffect(() => {
    if (open && config?.has_token && activeMainTab === 'projects' && !showProjectPicker) {
      if (activeProjectTab) {
        fetchProjectItems(activeProjectTab)
      }
      fetchProjects()
    }
  }, [open, config?.has_token, activeMainTab, activeProjectTab, showProjectPicker, fetchProjects, fetchProjectItems])

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
      setShowProjectPicker(false)
      setActiveRepoTab('')
      setAllProjects([])
      setSelectedProjectIds([])
      setProjects([])
      setActiveProjectTab('')
      setProjectItems([])
      setDetailProjectItem(null)
      setActiveMainTab('issues')
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

  // ── Toggle project selection ───────────────────────────────────

  const toggleProject = (projectId: string) => {
    setSelectedProjectIds(prev =>
      prev.includes(projectId)
        ? prev.filter(id => id !== projectId)
        : [...prev, projectId]
    )
  }

  // ── Render helpers ─────────────────────────────────────────────

  const currentRepoIssues = activeRepoTab ? (issuesByRepo[activeRepoTab] || []) : []
  const filteredIssues = currentRepoIssues
    .filter(i => {
      // State filter
      if (issuesStateFilter !== 'all' && i.state !== issuesStateFilter) return false
      // Assignee filter
      if (issuesAssigneeFilter !== 'all') {
        const hasAssignee = i.assignees.some(a => a.login === issuesAssigneeFilter)
        if (!hasAssignee) return false
      }
      // Label filter
      if (issuesLabelFilter !== 'all') {
        const hasLabel = i.labels.some(l => l.name === issuesLabelFilter)
        if (!hasLabel) return false
      }
      // Text filter
      if (issuesFilter) {
        return i.title.toLowerCase().includes(issuesFilter.toLowerCase()) ||
          i.labels.some(l => l.name.toLowerCase().includes(issuesFilter.toLowerCase()))
      }
      return true
    })

  // Derived filter options from current repo issues
  const uniqueAssignees = Array.from(
    new Map(currentRepoIssues.flatMap(i => i.assignees.map(a => [a.login, a]))).values()
  )
  const uniqueLabels = Array.from(
    new Map(currentRepoIssues.flatMap(i => i.labels.map(l => [l.name, l]))).values()
  )

  const issuesActiveFilterCount = [issuesStateFilter !== 'open', issuesAssigneeFilter !== 'all', issuesLabelFilter !== 'all'].filter(Boolean).length
  const uniqueProjectAssignees = Array.from(
    new Map(projectItems.flatMap(i => i.assignees.map(a => [a.login, a]))).values()
  )
  const projectsActiveFilterCount = [projectsTypeFilter !== 'all', projectsAssigneeFilter !== 'all'].filter(Boolean).length

  const filteredRepos = repoFilter
    ? repos.filter(r =>
        r.full_name.toLowerCase().includes(repoFilter.toLowerCase()) ||
        (r.description && r.description.toLowerCase().includes(repoFilter.toLowerCase()))
      )
    : repos

  const filteredPickerProjects = projectFilter
    ? allProjects.filter(p =>
        p.title.toLowerCase().includes(projectFilter.toLowerCase()) ||
        (p.short_description && p.short_description.toLowerCase().includes(projectFilter.toLowerCase())) ||
        p.owner.toLowerCase().includes(projectFilter.toLowerCase())
      )
    : allProjects

  const filteredProjectItems = projectItems
    .filter(i => {
      // Type filter
      if (projectsTypeFilter !== 'all' && i.type !== projectsTypeFilter) return false
      // Assignee filter
      if (projectsAssigneeFilter !== 'all') {
        const hasAssignee = i.assignees.some(a => a.login === projectsAssigneeFilter)
        if (!hasAssignee) return false
      }
      // Text filter
      if (projectItemsFilter) {
        return i.title.toLowerCase().includes(projectItemsFilter.toLowerCase()) ||
          (i.status && i.status.toLowerCase().includes(projectItemsFilter.toLowerCase())) ||
          (i.repository && i.repository.toLowerCase().includes(projectItemsFilter.toLowerCase()))
      }
      return true
    })

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

  // Virtualizer: project picker
  const projectPickerScrollRef = useRef<HTMLDivElement>(null)
  const projectPickerVirtualizer = useVirtualizer({
    count: filteredPickerProjects.length,
    getScrollElement: () => projectPickerScrollRef.current,
    estimateSize: () => 56,
    overscan: 10,
  })

  // Virtualizer: project items list
  const projectItemScrollRef = useRef<HTMLDivElement>(null)
  const projectItemVirtualizer = useVirtualizer({
    count: filteredProjectItems.length,
    getScrollElement: () => projectItemScrollRef.current,
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

          {/* Main tabs: Issues | Projects + action buttons */}
          {config?.has_token && !showRepoPicker && !showProjectPicker && !loadingConfig && (
            <div className="border-b px-6 flex items-center gap-2">
              <Tabs value={activeMainTab} onValueChange={setActiveMainTab} className="flex-1">
                <TabsList variant="line">
                  <TabsTrigger value="issues" className="text-xs">
                    Issues
                  </TabsTrigger>
                  <TabsTrigger value="projects" className="text-xs">
                    Projects
                  </TabsTrigger>
                </TabsList>
              </Tabs>
              <TooltipProvider delayDuration={300}>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button variant="ghost" size="sm" onClick={fetchRepos} className="shrink-0 h-8 w-8 p-0">
                      <FolderGit2 className="h-3.5 w-3.5" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent side="bottom" className="text-xs">Select Repositories</TooltipContent>
                </Tooltip>
              </TooltipProvider>
              <TooltipProvider delayDuration={300}>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button variant="ghost" size="sm" onClick={fetchProjectPicker} className="shrink-0 h-8 w-8 p-0">
                      <LayoutList className="h-3.5 w-3.5" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent side="bottom" className="text-xs">Select Projects</TooltipContent>
                </Tooltip>
              </TooltipProvider>
              <Button variant="ghost" size="sm" onClick={handleDisconnect} className="shrink-0 h-8 px-2 text-xs text-muted-foreground hover:text-destructive">
                Disconnect
              </Button>
            </div>
          )}

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
                    Enter a GitHub Personal Access Token (classic).
                    The token is stored locally for this board only.
                  </p>
                  <div className="rounded-lg border bg-muted/30 p-3 space-y-1.5">
                    <p className="text-xs font-medium">Required scopes:</p>
                    <ul className="text-xs text-muted-foreground space-y-0.5 list-none">
                      <li><code className="text-[11px] bg-muted px-1 py-0.5 rounded">repo</code> — Access to issues and pull requests</li>
                      <li><code className="text-[11px] bg-muted px-1 py-0.5 rounded">project</code> — Access to GitHub Projects (v2)</li>
                      <li><code className="text-[11px] bg-muted px-1 py-0.5 rounded">read:org</code> — List organization projects <span className="text-muted-foreground/60">(optional)</span></li>
                    </ul>
                    <a
                      href="https://github.com/settings/tokens/new"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-xs text-primary hover:underline inline-flex items-center gap-1"
                    >
                      <ExternalLink className="h-3 w-3" />
                      Create a token
                    </a>
                  </div>
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
            ) : showProjectPicker ? (
              /* ── Project Picker ──────────────────────────────── */
              <div className="flex flex-col h-full">
                <div className="px-6 pt-4 pb-3 space-y-3">
                  <div className="flex items-center justify-between">
                    <h3 className="text-sm font-medium">Select Projects</h3>
                    <span className="text-xs text-muted-foreground">
                      {selectedProjectIds.length} selected
                    </span>
                  </div>
                  {!loadingProjects && allProjects.length > 0 && (
                    <div className="relative">
                      <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
                      <Input
                        placeholder="Search projects..."
                        value={projectFilter}
                        onChange={e => setProjectFilter(e.target.value)}
                        className="pl-8 h-8 text-xs"
                      />
                    </div>
                  )}
                </div>
                <div className="flex-1 overflow-hidden px-6">
                  {loadingProjects ? (
                    <div className="space-y-3">
                      <div className="flex items-center gap-2 text-muted-foreground">
                        <Loader2 className="h-4 w-4 animate-spin" />
                        <span className="text-sm">Loading projects...</span>
                      </div>
                      {[1, 2, 3, 4, 5].map(i => <Skeleton key={i} className="h-12 w-full" />)}
                    </div>
                  ) : filteredPickerProjects.length === 0 ? (
                    <div className="text-center py-8 text-muted-foreground text-sm">
                      {allProjects.length === 0 ? 'No projects found' : 'No matching projects'}
                    </div>
                  ) : (
                    <div ref={projectPickerScrollRef} className="h-full overflow-y-auto">
                      <div
                        style={{
                          height: `${projectPickerVirtualizer.getTotalSize()}px`,
                          width: '100%',
                          position: 'relative',
                        }}
                      >
                        {projectPickerVirtualizer.getVirtualItems().map((virtualRow) => {
                          const project = filteredPickerProjects[virtualRow.index]
                          if (!project) return null
                          const isSelected = selectedProjectIds.includes(project.id)
                          return (
                            <button
                              key={project.id}
                              onClick={() => toggleProject(project.id)}
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
                                <div className="text-sm font-medium truncate">{project.title}</div>
                                <div className="flex items-center gap-2">
                                  {project.short_description && (
                                    <span className="text-xs text-muted-foreground truncate">{project.short_description}</span>
                                  )}
                                  <span className="text-[10px] text-muted-foreground shrink-0">{project.owner}</span>
                                </div>
                              </div>
                              <div className="flex items-center gap-2 shrink-0">
                                {project.closed ? (
                                  <Badge variant="secondary" className="text-[10px] px-1.5 py-0">Closed</Badge>
                                ) : (
                                  <Badge variant="outline" className="text-[10px] px-1.5 py-0">Open</Badge>
                                )}
                                {project.public ? (
                                  <Badge variant="outline" className="text-[10px] px-1.5 py-0">Public</Badge>
                                ) : (
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
                  <Button variant="outline" onClick={() => { setShowProjectPicker(false); setProjectFilter('') }} className="flex-1">
                    Cancel
                  </Button>
                  <Button onClick={handleSaveProjects} className="flex-1">
                    Save Selection
                  </Button>
                </div>
              </div>
            ) : config.selected_repos.length === 0 && config.selected_projects.length === 0 ? (
              /* ── No repos or projects selected ─────────────────── */
              <div className="p-6 space-y-4">
                <div className="text-center py-8 space-y-2">
                  <Github className="h-8 w-8 mx-auto text-muted-foreground" />
                  <h3 className="text-sm font-medium">Select Data Sources</h3>
                  <p className="text-xs text-muted-foreground">
                    Choose which repositories and projects to follow.
                  </p>
                  <div className="flex items-center justify-center gap-2 mt-4">
                    <Button onClick={fetchRepos} variant="outline">
                      <FolderGit2 className="h-4 w-4 mr-2" />
                      Select Repos
                    </Button>
                    <Button onClick={fetchProjectPicker} variant="outline">
                      <LayoutList className="h-4 w-4 mr-2" />
                      Select Projects
                    </Button>
                  </div>
                  <Button variant="ghost" size="sm" onClick={handleDisconnect} className="text-xs text-muted-foreground hover:text-destructive">
                    Disconnect
                  </Button>
                </div>
              </div>
            ) : activeMainTab === 'issues' && detailIssue ? (
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
            ) : activeMainTab === 'issues' ? (
              /* ── Issues View ─────────────────────────────────── */
              <div className="flex flex-col h-full">
                {/* Repo Tabs */}
                <div className="border-b px-4">
                  <Tabs
                    value={activeRepoTab}
                    onValueChange={(val) => { setActiveRepoTab(val); setIssuesAssigneeFilter('all'); setIssuesLabelFilter('all') }}
                  >
                    <TabsList variant="line" className="w-full overflow-x-auto">
                      {config.selected_repos.map(repo => (
                        <TabsTrigger key={repo} value={repo} className="text-xs">
                          {repo.split('/')[1]}
                        </TabsTrigger>
                      ))}
                    </TabsList>
                  </Tabs>
                </div>

                {/* Search bar */}
                <div className="px-4 py-2 border-b">
                  <div className="flex items-center gap-2">
                    <div className="relative flex-1">
                      <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
                      <Input
                        placeholder="Filter issues..."
                        value={issuesFilter}
                        onChange={e => setIssuesFilter(e.target.value)}
                        className="pl-8 h-8 text-xs"
                      />
                    </div>
                    <Popover>
                      <PopoverTrigger asChild>
                        <Button variant="outline" size="sm" className="h-8 px-2 relative">
                          <SlidersHorizontal className="h-3.5 w-3.5" />
                          {issuesActiveFilterCount > 0 && (
                            <span className="absolute -top-1 -right-1 h-3.5 w-3.5 rounded-full bg-primary text-[8px] text-primary-foreground flex items-center justify-center">{issuesActiveFilterCount}</span>
                          )}
                        </Button>
                      </PopoverTrigger>
                      <PopoverContent align="end" className="w-56 p-3 space-y-3">
                        <div className="space-y-1.5">
                          <label className="text-xs font-medium">State</label>
                          <Select value={issuesStateFilter} onValueChange={(v) => setIssuesStateFilter(v as 'open' | 'closed' | 'all')}>
                            <SelectTrigger className="h-7 text-xs"><SelectValue /></SelectTrigger>
                            <SelectContent>
                              <SelectItem value="open">Open</SelectItem>
                              <SelectItem value="closed">Closed</SelectItem>
                              <SelectItem value="all">All</SelectItem>
                            </SelectContent>
                          </Select>
                        </div>
                        <div className="space-y-1.5">
                          <label className="text-xs font-medium">Assignee</label>
                          <Select value={issuesAssigneeFilter} onValueChange={setIssuesAssigneeFilter}>
                            <SelectTrigger className="h-7 text-xs"><SelectValue /></SelectTrigger>
                            <SelectContent>
                              <SelectItem value="all">Anyone</SelectItem>
                              {uniqueAssignees.map(a => (
                                <SelectItem key={a.login} value={a.login}>{a.login}</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                        <div className="space-y-1.5">
                          <label className="text-xs font-medium">Label</label>
                          <Select value={issuesLabelFilter} onValueChange={setIssuesLabelFilter}>
                            <SelectTrigger className="h-7 text-xs"><SelectValue /></SelectTrigger>
                            <SelectContent>
                              <SelectItem value="all">Any label</SelectItem>
                              {uniqueLabels.map(l => (
                                <SelectItem key={l.name} value={l.name}>
                                  <span className="flex items-center gap-1.5">
                                    <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: `#${l.color}` }} />
                                    {l.name}
                                  </span>
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                        {(issuesActiveFilterCount > 0) && (
                          <Button variant="ghost" size="sm" className="w-full h-7 text-xs" onClick={() => { setIssuesStateFilter('open'); setIssuesAssigneeFilter('all'); setIssuesLabelFilter('all') }}>
                            Clear filters
                          </Button>
                        )}
                      </PopoverContent>
                    </Popover>
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
            ) : activeMainTab === 'projects' && config?.has_token && !showRepoPicker && !showProjectPicker && config.selected_projects.length === 0 ? (
              /* ── No Projects Selected (early) ──────────────────── */
              <div className="p-6 space-y-4">
                <div className="text-center py-8 space-y-2">
                  <LayoutList className="h-8 w-8 mx-auto text-muted-foreground" />
                  <h3 className="text-sm font-medium">No Projects Selected</h3>
                  <p className="text-xs text-muted-foreground">
                    Choose which GitHub Projects to follow.
                  </p>
                  <div className="flex items-center justify-center gap-2 mt-2">
                    <Button onClick={fetchProjectPicker} variant="outline">
                      Select Projects
                    </Button>
                    <Button variant="ghost" size="sm" onClick={handleDisconnect} className="text-xs text-muted-foreground hover:text-destructive">
                      Disconnect
                    </Button>
                  </div>
                </div>
              </div>
            ) : activeMainTab === 'projects' && config?.has_token && !showRepoPicker && !showProjectPicker ? (
              /* ── Projects View ────────────────────────────────── */
              <div className="flex flex-col h-full">
                {detailProjectItem ? (
                  /* ── Project Item Detail ─────────────────────── */
                  <div className="flex flex-col h-full">
                    <div className="px-6 pt-4 pb-3 border-b">
                      <Button variant="ghost" size="sm" onClick={() => setDetailProjectItem(null)} className="h-7 px-2 text-xs">
                        ← Back
                      </Button>
                      <h2 className="text-base font-semibold mt-2">{detailProjectItem.title}</h2>
                      <div className="flex items-center gap-2 mt-1 flex-wrap">
                        {detailProjectItem.status && (
                          <Badge variant="outline" className="text-[10px] px-1.5 py-0">{detailProjectItem.status}</Badge>
                        )}
                        {detailProjectItem.type && (
                          <Badge variant="secondary" className="text-[10px] px-1.5 py-0">{detailProjectItem.type === 'PULL_REQUEST' ? 'PR' : detailProjectItem.type}</Badge>
                        )}
                        {detailProjectItem.state && (
                          <Badge variant={detailProjectItem.state === 'open' ? 'default' : 'secondary'} className="text-[10px] px-1.5 py-0">{detailProjectItem.state}</Badge>
                        )}
                        {detailProjectItem.repository && (
                          <span className="text-xs text-muted-foreground">{detailProjectItem.repository}</span>
                        )}
                        {detailProjectItem.labels.map(label => (
                          <Badge key={label.id} className="text-[10px] px-1.5 py-0 border-0" style={{ backgroundColor: `#${label.color}20`, color: `#${label.color}` }}>{label.name}</Badge>
                        ))}
                      </div>
                      {detailProjectItem.assignees.length > 0 && (
                        <div className="flex items-center gap-1 mt-2">
                          <span className="text-xs text-muted-foreground">Assignees:</span>
                          {detailProjectItem.assignees.map(a => (
                            <Badge key={a.login} variant="outline" className="text-[10px] px-1.5 py-0">{a.login}</Badge>
                          ))}
                        </div>
                      )}
                    </div>
                    <div className="flex-1 overflow-y-auto px-6 py-4">
                      {detailProjectItem.body ? (
                        <div className="text-sm whitespace-pre-wrap break-words leading-relaxed text-muted-foreground">{detailProjectItem.body}</div>
                      ) : (
                        <p className="text-sm text-muted-foreground italic">No description provided.</p>
                      )}
                    </div>
                    <div className="border-t px-6 py-4 flex items-center gap-2">
                      {detailProjectItem.html_url && (
                        <Button variant="outline" onClick={() => window.open(detailProjectItem.html_url!, '_blank')} className="text-xs">
                          <ExternalLink className="h-3 w-3 mr-1" />
                          {detailProjectItem.type === 'PULL_REQUEST' ? 'Open PR' : 'Open Issue'}
                        </Button>
                      )}
                      <div className="flex-1" />
                      <Button variant="default" onClick={() => {
                        setSpawnIssue({
                          id: 0,
                          number: detailProjectItem.number || 0,
                          title: detailProjectItem.title,
                          body: detailProjectItem.body,
                          state: (detailProjectItem.state as 'open' | 'closed') || 'open',
                          html_url: detailProjectItem.html_url || '',
                          labels: detailProjectItem.labels,
                          assignees: detailProjectItem.assignees,
                          user: detailProjectItem.assignees[0] || { login: '', avatar_url: '', html_url: '' },
                          comments: 0,
                          created_at: detailProjectItem.created_at,
                          updated_at: detailProjectItem.updated_at,
                          repository_url: detailProjectItem.repository ? `https://api.github.com/repos/${detailProjectItem.repository}` : '',
                        })
                        setSpawnDialogOpen(true)
                      }} className="text-xs">
                        <Rocket className="h-3 w-3 mr-1" />
                        Spawn Agent
                      </Button>
                    </div>
                  </div>
                ) : projects.length === 0 && !loadingProjects ? (
                  /* ── No Projects Selected ────────────────────── */
                  <div className="p-6 space-y-4">
                    <div className="text-center py-8 space-y-2">
                      <LayoutList className="h-8 w-8 mx-auto text-muted-foreground" />
                      <h3 className="text-sm font-medium">No Projects Selected</h3>
                      <p className="text-xs text-muted-foreground">
                        Choose which GitHub Projects to follow.
                      </p>
                      <div className="flex items-center justify-center gap-2 mt-2">
                        <Button onClick={fetchProjectPicker} variant="outline">
                          Select Projects
                        </Button>
                        <Button variant="ghost" size="sm" onClick={handleDisconnect} className="text-xs text-muted-foreground hover:text-destructive">
                          Disconnect
                        </Button>
                      </div>
                    </div>
                  </div>
                ) : (
                  /* ── Project Items (tabbed, matching Issues design) ── */
                  <div className="flex flex-col h-full">
                    {/* Project Tabs */}
                    <div className="border-b px-4">
                      <Tabs
                        value={activeProjectTab}
                        onValueChange={(val) => {
                          setActiveProjectTab(val)
    setProjectItemsFilter('')
    setProjectsTypeFilter('all')
    setProjectsAssigneeFilter('all')
                          setDetailProjectItem(null)
                        }}
                      >
                        <TabsList variant="line" className="w-full overflow-x-auto">
                          {projects.map(project => (
                            <TabsTrigger key={project.id} value={project.id} className="text-xs">
                              {project.title}
                            </TabsTrigger>
                          ))}
                        </TabsList>
                      </Tabs>
                    </div>

                    {/* Search bar */}
                    <div className="px-4 py-2 border-b">
                      <div className="flex items-center gap-2">
                        <div className="relative flex-1">
                          <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
                          <Input
                            placeholder="Filter items..."
                            value={projectItemsFilter}
                            onChange={e => setProjectItemsFilter(e.target.value)}
                            className="pl-8 h-8 text-xs"
                          />
                        </div>
                        <Popover>
                          <PopoverTrigger asChild>
                            <Button variant="outline" size="sm" className="h-8 px-2 relative">
                              <SlidersHorizontal className="h-3.5 w-3.5" />
                              {projectsActiveFilterCount > 0 && (
                                <span className="absolute -top-1 -right-1 h-3.5 w-3.5 rounded-full bg-primary text-[8px] text-primary-foreground flex items-center justify-center">{projectsActiveFilterCount}</span>
                              )}
                            </Button>
                          </PopoverTrigger>
                          <PopoverContent align="end" className="w-56 p-3 space-y-3">
                            <div className="space-y-1.5">
                              <label className="text-xs font-medium">Type</label>
                              <Select value={projectsTypeFilter} onValueChange={setProjectsTypeFilter}>
                                <SelectTrigger className="h-7 text-xs"><SelectValue /></SelectTrigger>
                                <SelectContent>
                                  <SelectItem value="all">All types</SelectItem>
                                  <SelectItem value="ISSUE">Issues</SelectItem>
                                  <SelectItem value="PULL_REQUEST">Pull Requests</SelectItem>
                                  <SelectItem value="DRAFT_ISSUE">Draft Issues</SelectItem>
                                </SelectContent>
                              </Select>
                            </div>
                            <div className="space-y-1.5">
                              <label className="text-xs font-medium">Assignee</label>
                              <Select value={projectsAssigneeFilter} onValueChange={setProjectsAssigneeFilter}>
                                <SelectTrigger className="h-7 text-xs"><SelectValue /></SelectTrigger>
                                <SelectContent>
                                  <SelectItem value="all">Anyone</SelectItem>
                                  {uniqueProjectAssignees.map(a => (
                                    <SelectItem key={a.login} value={a.login}>{a.login}</SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                            </div>
                            {projectsActiveFilterCount > 0 && (
                              <Button variant="ghost" size="sm" className="w-full h-7 text-xs" onClick={() => { setProjectsTypeFilter('all'); setProjectsAssigneeFilter('all') }}>
                                Clear filters
                              </Button>
                            )}
                          </PopoverContent>
                        </Popover>
                      </div>
                    </div>

                    {/* Table header */}
                    <div className="px-4 py-2 border-b bg-muted/30">
                      <div className="grid grid-cols-[1fr_100px_100px_100px] gap-4 text-xs font-medium text-muted-foreground uppercase tracking-wider">
                        <span>Title</span>
                        <span>Status</span>
                        <span>Type</span>
                        <span>Updated</span>
                      </div>
                    </div>

                    {/* Project Items Table */}
                    <div ref={projectItemScrollRef} className="flex-1 overflow-y-auto">
                      {loadingProjectItems ? (
                        <div className="p-4 space-y-2">
                          {Array.from({ length: 5 }).map((_, i) => <div key={i} className="h-12"><Skeleton className="h-8 w-full" /></div>)}
                        </div>
                      ) : filteredProjectItems.length === 0 ? (
                        <div className="text-center py-8 text-muted-foreground text-sm">
                          {projectItemsFilter ? 'No matching items' : 'No items in this project'}
                        </div>
                      ) : (
                        <div style={{ height: `${projectItemVirtualizer.getTotalSize()}px`, width: '100%', position: 'relative' }}>
                          {projectItemVirtualizer.getVirtualItems().map((virtualRow) => {
                            const item = filteredProjectItems[virtualRow.index]
                            if (!item) return null
                            return (
                              <div
                                key={item.id}
                                style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: `${virtualRow.size}px`, transform: `translateY(${virtualRow.start}px)` }}
                                className="grid grid-cols-[1fr_100px_100px_100px] gap-4 items-center px-4 hover:bg-accent/50 transition-colors border-b border-border/50 cursor-pointer"
                                onClick={() => setDetailProjectItem(item)}
                              >
                                <div className="min-w-0 flex items-center gap-2">
                                  <span className="text-sm truncate">{item.title || 'Untitled'}</span>
                                  {item.repository && <span className="text-[10px] text-muted-foreground shrink-0">{item.repository}</span>}
                                </div>
                                <span className="text-xs truncate">{item.status || '—'}</span>
                                <Badge variant="secondary" className="text-[10px] px-1.5 py-0 w-fit">{item.type === 'PULL_REQUEST' ? 'PR' : item.type === 'DRAFT_ISSUE' ? 'Draft' : 'Issue'}</Badge>
                                <span className="text-xs text-muted-foreground truncate">{formatTimeAgo(item.updated_at)}</span>
                              </div>
                            )
                          })}
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>
            ) : null}
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
