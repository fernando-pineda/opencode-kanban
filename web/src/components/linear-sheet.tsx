'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
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
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
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
  ExternalLink,
  Loader2,
  Rocket,
  AlertCircle,
  Check,
  Search,
  Users,
  SlidersHorizontal,
} from 'lucide-react'
import type {
  LinearConfig,
  LinearTeam,
  LinearIssue,
} from '../types'

// ── Props ────────────────────────────────────────────────────────

interface LinearSheetProps {
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

function priorityColor(priority: number): string {
  switch (priority) {
    case 1: return '#ef4444' // Urgent — red
    case 2: return '#f97316' // High — orange
    case 3: return '#eab308' // Medium — yellow
    case 4: return '#22c55e' // Low — green
    default: return '#9ca3af' // No priority — gray
  }
}

function priorityLabel(priority: number): string {
  switch (priority) {
    case 1: return 'Urgent'
    case 2: return 'High'
    case 3: return 'Medium'
    case 4: return 'Low'
    default: return 'No priority'
  }
}

// ── Component ────────────────────────────────────────────────────

export default function LinearSheet({ boardId, open, onOpenChange }: LinearSheetProps) {
  // Config state
  const [config, setConfig] = useState<LinearConfig | null>(null)
  const [loadingConfig, setLoadingConfig] = useState(false)

  // Setup state
  const [tokenInput, setTokenInput] = useState('')
  const [saving, setSaving] = useState(false)
  const [setupError, setSetupError] = useState<string | null>(null)

  // Team picker state
  const [teams, setTeams] = useState<LinearTeam[]>([])
  const [selectedTeams, setSelectedTeams] = useState<string[]>([])
  const [loadingTeams, setLoadingTeams] = useState(false)
  const [showTeamPicker, setShowTeamPicker] = useState(false)
  const [teamFilter, setTeamFilter] = useState('')

  // Issues state
  const [issues, setIssues] = useState<LinearIssue[]>([])
  const [loadingIssues, setLoadingIssues] = useState(false)
  const [activeTeamTab, setActiveTeamTab] = useState<string>('')
  const [issuesFilter, setIssuesFilter] = useState('')

  // Issues filters
  const [stateTypeFilter, setStateTypeFilter] = useState<string>('active')
  const [priorityFilter, setPriorityFilter] = useState<string>('all')
  const [assigneeFilter, setAssigneeFilter] = useState<string>('all')

  // Spawn dialog state
  const [spawnDialogOpen, setSpawnDialogOpen] = useState(false)
  const [spawnIssue, setSpawnIssue] = useState<LinearIssue | null>(null)
  const [spawnAgent, setSpawnAgent] = useState('')
  const [agents, setAgents] = useState<{ name: string }[]>([])
  const [spawning, setSpawning] = useState(false)

  // Issue detail state
  const [detailIssue, setDetailIssue] = useState<LinearIssue | null>(null)

  // ── Reset on board change ────────────────────────────────────────
  useEffect(() => {
    setConfig(null)
    setLoadingConfig(false)
    setTokenInput('')
    setSaving(false)
    setSetupError(null)
    setTeams([])
    setSelectedTeams([])
    setLoadingTeams(false)
    setShowTeamPicker(false)
    setTeamFilter('')
    setIssues([])
    setLoadingIssues(false)
    setActiveTeamTab('')
    setIssuesFilter('')
    setStateTypeFilter('active')
    setPriorityFilter('all')
    setAssigneeFilter('all')
    setSpawnDialogOpen(false)
    setSpawnIssue(null)
    setSpawnAgent('')
    setSpawning(false)
    setDetailIssue(null)
  }, [boardId])

  // ── Fetch config ───────────────────────────────────────────────

  const fetchConfig = useCallback(async () => {
    setLoadingConfig(true)
    try {
      const res = await fetch(`/api/boards/${boardId}/linear/config`)
      const data = await res.json()
      setConfig(data)
      if (data.selected_teams?.length > 0 && !activeTeamTab) {
        setActiveTeamTab(data.selected_teams[0])
      }
    } catch {
      // ignore
    } finally {
      setLoadingConfig(false)
    }
  }, [boardId, activeTeamTab])

  useEffect(() => {
    if (open) fetchConfig()
  }, [open, fetchConfig])

  // ── Fetch teams (for picker) ───────────────────────────────────

  const fetchTeams = useCallback(async () => {
    setLoadingTeams(true)
    setShowTeamPicker(true)
    try {
      const res = await fetch(`/api/boards/${boardId}/linear/teams`)
      if (res.ok) {
        const data = await res.json()
        setTeams(data.teams || [])
        setSelectedTeams(data.selected_teams || [])
      }
    } catch {
      // ignore
    } finally {
      setLoadingTeams(false)
    }
  }, [boardId])

  // ── Pre-fetch teams silently when config has selected teams ────

  useEffect(() => {
    if (open && config?.has_token && config.selected_teams.length > 0 && teams.length === 0) {
      fetch(`/api/boards/${boardId}/linear/teams`)
        .then(r => r.json())
        .then(data => {
          if (data.teams) setTeams(data.teams)
        })
        .catch(() => {})
    }
  }, [open, config?.has_token, config?.selected_teams, boardId])

  // ── Save token ─────────────────────────────────────────────────

  const handleSaveToken = async () => {
    if (!tokenInput.trim()) return
    setSaving(true)
    setSetupError(null)
    try {
      const res = await fetch(`/api/boards/${boardId}/linear/config`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: tokenInput.trim() }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Failed to save API key')
      setTokenInput('')
      await fetchConfig()
      fetchTeams()
    } catch (err) {
      setSetupError((err as Error).message)
    } finally {
      setSaving(false)
    }
  }

  // ── Save selected teams ────────────────────────────────────────

  const handleSaveTeams = async () => {
    try {
      await fetch(`/api/boards/${boardId}/linear/teams`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ selected_teams: selectedTeams }),
      })
      setShowTeamPicker(false)
      await fetchConfig()
      if (selectedTeams.length > 0) {
        setActiveTeamTab(selectedTeams[0])
        fetchIssues()
      }
    } catch {
      // ignore
    }
  }

  // ── Fetch issues ───────────────────────────────────────────────

  const fetchIssues = useCallback(async () => {
    if (!config?.has_token || config.selected_teams.length === 0) return
    setLoadingIssues(true)
    try {
      const teamParam = activeTeamTab || undefined
      const url = `/api/boards/${boardId}/linear/issues?stateType=${stateTypeFilter}${teamParam ? `&team=${encodeURIComponent(teamParam)}` : ''}`
      const res = await fetch(url)
      if (res.ok) {
        const data = await res.json()
        setIssues(data.issues || [])
      }
    } catch {
      // ignore
    } finally {
      setLoadingIssues(false)
    }
  }, [boardId, config?.has_token, config?.selected_teams, activeTeamTab, stateTypeFilter])

  useEffect(() => {
    if (open && config?.has_token && config.selected_teams.length > 0) {
      fetchIssues()
    }
  }, [open, config?.has_token, config?.selected_teams, activeTeamTab, stateTypeFilter, fetchIssues])

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
      const res = await fetch(`/api/boards/${boardId}/linear/spawn`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          issue: {
            identifier: spawnIssue.identifier,
            title: spawnIssue.title,
            description: spawnIssue.description || '',
            url: spawnIssue.url,
            team_key: spawnIssue.team.key,
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
      await fetch(`/api/boards/${boardId}/linear/config`, { method: 'DELETE' })
      setConfig(null)
      setTeams([])
      setSelectedTeams([])
      setIssues([])
      setShowTeamPicker(false)
      setActiveTeamTab('')
      setDetailIssue(null)
    } catch {
      // ignore
    }
  }

  // ── Toggle team selection ──────────────────────────────────────

  const toggleTeam = (teamId: string) => {
    setSelectedTeams(prev =>
      prev.includes(teamId)
        ? prev.filter(id => id !== teamId)
        : [...prev, teamId]
    )
  }

  // ── Render helpers ─────────────────────────────────────────────

  const filteredIssues = issues.filter(i => {
    // Priority filter
    if (priorityFilter !== 'all' && i.priority !== parseInt(priorityFilter)) return false
    // Assignee filter
    if (assigneeFilter !== 'all') {
      if (!i.assignee || i.assignee.id !== assigneeFilter) return false
    }
    // Text filter
    if (issuesFilter) {
      return i.title.toLowerCase().includes(issuesFilter.toLowerCase()) ||
        i.identifier.toLowerCase().includes(issuesFilter.toLowerCase()) ||
        i.labels.some(l => l.name.toLowerCase().includes(issuesFilter.toLowerCase()))
    }
    return true
  })

  // Derived filter options from current issues
  const uniqueAssignees = Array.from(
    new Map(
      issues
        .filter(i => i.assignee)
        .map(i => [i.assignee!.id, i.assignee!])
    ).values()
  )

  const activeFilterCount = [
    stateTypeFilter !== 'active',
    priorityFilter !== 'all',
    assigneeFilter !== 'all',
  ].filter(Boolean).length

  const filteredTeams = teamFilter
    ? teams.filter(t =>
        t.name.toLowerCase().includes(teamFilter.toLowerCase()) ||
        t.key.toLowerCase().includes(teamFilter.toLowerCase()) ||
        (t.description && t.description.toLowerCase().includes(teamFilter.toLowerCase()))
      )
    : teams

  // Virtualizer: team picker
  const teamScrollRef = useRef<HTMLDivElement>(null)
  const teamVirtualizer = useVirtualizer({
    count: filteredTeams.length,
    getScrollElement: () => teamScrollRef.current,
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
              <div className="w-5 h-5 rounded bg-[#5E6AD2] flex items-center justify-center">
                <span className="text-white text-[10px] font-bold">L</span>
              </div>
              <SheetTitle>Linear</SheetTitle>
            </div>
          </SheetHeader>

          {/* Action buttons bar */}
          {config?.has_token && !showTeamPicker && !loadingConfig && (
            <div className="border-b px-6 flex items-center gap-2">
              <div className="flex-1" />
              <TooltipProvider delayDuration={300}>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button variant="ghost" size="sm" onClick={fetchTeams} className="shrink-0 h-8 w-8 p-0">
                      <Users className="h-3.5 w-3.5" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent side="bottom" className="text-xs">Select Teams</TooltipContent>
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
                  <h3 className="text-sm font-medium">Connect Linear</h3>
                  <p className="text-xs text-muted-foreground">
                    Enter a Linear Personal API Key.
                    The key is stored locally for this board only.
                  </p>
                  <div className="rounded-lg border bg-muted/30 p-3 space-y-1.5">
                    <p className="text-xs font-medium">Required access:</p>
                    <ul className="text-xs text-muted-foreground space-y-0.5 list-none">
                      <li><code className="text-[11px] bg-muted px-1 py-0.5 rounded">Read</code> — Access to teams and issues</li>
                      <li>Personal API keys have full workspace access</li>
                    </ul>
                    <a
                      href="https://linear.app/settings/account/security"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-xs text-primary hover:underline inline-flex items-center gap-1"
                    >
                      <ExternalLink className="h-3 w-3" />
                      Create an API key
                    </a>
                  </div>
                </div>
                <div className="space-y-2">
                  <Input
                    type="password"
                    placeholder="lin_api_xxxxxxxxxxxxxxxx"
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
            ) : showTeamPicker ? (
              /* ── Team Picker ─────────────────────────────────── */
              <div className="flex flex-col h-full">
                <div className="px-6 pt-4 pb-3 space-y-3">
                  <div className="flex items-center justify-between">
                    <h3 className="text-sm font-medium">Select Teams</h3>
                    <span className="text-xs text-muted-foreground">
                      {selectedTeams.length} selected
                    </span>
                  </div>
                  {!loadingTeams && teams.length > 0 && (
                    <div className="relative">
                      <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
                      <Input
                        placeholder="Search teams..."
                        value={teamFilter}
                        onChange={e => setTeamFilter(e.target.value)}
                        className="pl-8 h-8 text-xs"
                      />
                    </div>
                  )}
                </div>
                <div className="flex-1 overflow-hidden px-6">
                  {loadingTeams ? (
                    <div className="space-y-3">
                      <div className="flex items-center gap-2 text-muted-foreground">
                        <Loader2 className="h-4 w-4 animate-spin" />
                        <span className="text-sm">Loading teams...</span>
                      </div>
                      {[1, 2, 3, 4, 5].map(i => <Skeleton key={i} className="h-12 w-full" />)}
                    </div>
                  ) : (
                    <div ref={teamScrollRef} className="h-full overflow-y-auto">
                      <div
                        style={{
                          height: `${teamVirtualizer.getTotalSize()}px`,
                          width: '100%',
                          position: 'relative',
                        }}
                      >
                        {teamVirtualizer.getVirtualItems().map((virtualRow) => {
                          const team = filteredTeams[virtualRow.index]
                          if (!team) return null
                          const isSelected = selectedTeams.includes(team.id)
                          return (
                            <button
                              key={team.id}
                              onClick={() => toggleTeam(team.id)}
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
                                <div className="text-sm font-medium truncate">
                                  <span className="text-muted-foreground font-mono text-xs mr-1.5">{team.key}</span>
                                  {team.name}
                                </div>
                                {team.description && (
                                  <div className="text-xs text-muted-foreground truncate">{team.description}</div>
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
                  <Button variant="outline" onClick={() => { setShowTeamPicker(false); setTeamFilter('') }} className="flex-1">
                    Cancel
                  </Button>
                  <Button onClick={handleSaveTeams} disabled={selectedTeams.length === 0} className="flex-1">
                    Save Selection
                  </Button>
                </div>
              </div>
            ) : config.selected_teams.length === 0 ? (
              /* ── No teams selected ─────────────────────────────── */
              <div className="p-6 space-y-4">
                <div className="text-center py-8 space-y-2">
                  <div className="w-10 h-10 mx-auto rounded-lg bg-[#5E6AD2]/10 flex items-center justify-center">
                    <span className="text-[#5E6AD2] text-lg font-bold">L</span>
                  </div>
                  <h3 className="text-sm font-medium">Select Teams</h3>
                  <p className="text-xs text-muted-foreground">
                    Choose which Linear teams to follow.
                  </p>
                  <div className="flex items-center justify-center gap-2 mt-4">
                    <Button onClick={fetchTeams} variant="outline">
                      <Users className="h-4 w-4 mr-2" />
                      Select Teams
                    </Button>
                  </div>
                  <Button variant="ghost" size="sm" onClick={handleDisconnect} className="text-xs text-muted-foreground hover:text-destructive">
                    Disconnect
                  </Button>
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
                    <span className="text-xs text-muted-foreground font-mono">{detailIssue.identifier}</span>
                  </div>
                  <h2 className="text-base font-semibold mt-2">{detailIssue.title}</h2>
                  <div className="flex items-center gap-2 mt-1 flex-wrap">
                    <Badge
                      className="text-[10px] px-1.5 py-0 border-0"
                      style={{
                        backgroundColor: `${detailIssue.state.color}20`,
                        color: detailIssue.state.color,
                      }}
                    >
                      {detailIssue.state.name}
                    </Badge>
                    <Badge
                      className="text-[10px] px-1.5 py-0 border-0"
                      style={{
                        backgroundColor: `${priorityColor(detailIssue.priority)}20`,
                        color: priorityColor(detailIssue.priority),
                      }}
                    >
                      {detailIssue.priority_label}
                    </Badge>
                    {detailIssue.labels.map(label => (
                      <Badge
                        key={label.id}
                        className="text-[10px] px-1.5 py-0 border-0"
                        style={{
                          backgroundColor: `${label.color}20`,
                          color: label.color,
                        }}
                      >
                        {label.name}
                      </Badge>
                    ))}
                    <span className="text-xs text-muted-foreground">
                      created {formatTimeAgo(detailIssue.created_at)}
                    </span>
                    {detailIssue.updated_at !== detailIssue.created_at && (
                      <span className="text-xs text-muted-foreground">
                        · updated {formatTimeAgo(detailIssue.updated_at)}
                      </span>
                    )}
                  </div>
                  {detailIssue.assignee && (
                    <div className="flex items-center gap-1 mt-2">
                      <span className="text-xs text-muted-foreground">Assignee:</span>
                      <Badge variant="outline" className="text-[10px] px-1.5 py-0">
                        {detailIssue.assignee.display_name || detailIssue.assignee.name}
                      </Badge>
                    </div>
                  )}
                  {detailIssue.project && (
                    <div className="flex items-center gap-1 mt-1">
                      <span className="text-xs text-muted-foreground">Project:</span>
                      <Badge variant="secondary" className="text-[10px] px-1.5 py-0">
                        {detailIssue.project.name}
                      </Badge>
                    </div>
                  )}
                  {detailIssue.due_date && (
                    <div className="flex items-center gap-1 mt-1">
                      <span className="text-xs text-muted-foreground">Due:</span>
                      <span className="text-xs text-muted-foreground">{detailIssue.due_date}</span>
                    </div>
                  )}
                </div>
                <div className="flex-1 overflow-y-auto px-6 py-4">
                  {detailIssue.description ? (
                    <div className="text-sm whitespace-pre-wrap break-words leading-relaxed text-muted-foreground">
                      {detailIssue.description}
                    </div>
                  ) : (
                    <p className="text-sm text-muted-foreground italic">No description provided.</p>
                  )}
                </div>
                <div className="border-t px-6 py-4 flex items-center gap-2">
                  <Button
                    variant="outline"
                    onClick={() => window.open(detailIssue.url, '_blank')}
                    className="text-xs"
                  >
                    <ExternalLink className="h-3 w-3 mr-1" />
                    Open in Linear
                  </Button>
                  {detailIssue.branch_name && (
                    <Badge variant="outline" className="text-[10px] px-1.5 py-0 font-mono">
                      {detailIssue.branch_name}
                    </Badge>
                  )}
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
                {/* Team Tabs */}
                <div className="border-b px-4">
                  <Tabs
                    value={activeTeamTab}
                    onValueChange={(val) => {
                      setActiveTeamTab(val)
                      setPriorityFilter('all')
                      setAssigneeFilter('all')
                    }}
                  >
                    <TabsList variant="line" className="w-full overflow-x-auto">
                      {config.selected_teams.map(teamId => {
                        const team = teams.find(t => t.id === teamId)
                        return (
                          <TabsTrigger key={teamId} value={teamId} className="text-xs">
                            {team?.key || teamId.slice(0, 6)}
                          </TabsTrigger>
                        )
                      })}
                    </TabsList>
                  </Tabs>
                </div>

                {/* Search bar + filters */}
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
                          {activeFilterCount > 0 && (
                            <span className="absolute -top-1 -right-1 h-3.5 w-3.5 rounded-full bg-primary text-[8px] text-primary-foreground flex items-center justify-center">{activeFilterCount}</span>
                          )}
                        </Button>
                      </PopoverTrigger>
                      <PopoverContent align="end" className="w-56 p-3 space-y-3">
                        <div className="space-y-1.5">
                          <label className="text-xs font-medium">State</label>
                          <Select value={stateTypeFilter} onValueChange={setStateTypeFilter}>
                            <SelectTrigger className="h-7 text-xs"><SelectValue /></SelectTrigger>
                            <SelectContent>
                              <SelectItem value="active">Active</SelectItem>
                              <SelectItem value="backlog">Backlog</SelectItem>
                              <SelectItem value="completed">Completed</SelectItem>
                              <SelectItem value="canceled">Canceled</SelectItem>
                              <SelectItem value="all">All</SelectItem>
                            </SelectContent>
                          </Select>
                        </div>
                        <div className="space-y-1.5">
                          <label className="text-xs font-medium">Priority</label>
                          <Select value={priorityFilter} onValueChange={setPriorityFilter}>
                            <SelectTrigger className="h-7 text-xs"><SelectValue /></SelectTrigger>
                            <SelectContent>
                              <SelectItem value="all">Any priority</SelectItem>
                              <SelectItem value="1">Urgent</SelectItem>
                              <SelectItem value="2">High</SelectItem>
                              <SelectItem value="3">Medium</SelectItem>
                              <SelectItem value="4">Low</SelectItem>
                              <SelectItem value="0">No priority</SelectItem>
                            </SelectContent>
                          </Select>
                        </div>
                        <div className="space-y-1.5">
                          <label className="text-xs font-medium">Assignee</label>
                          <Select value={assigneeFilter} onValueChange={setAssigneeFilter}>
                            <SelectTrigger className="h-7 text-xs"><SelectValue /></SelectTrigger>
                            <SelectContent>
                              <SelectItem value="all">Anyone</SelectItem>
                              {uniqueAssignees.map(a => (
                                <SelectItem key={a!.id} value={a!.id}>
                                  {a!.display_name || a!.name}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                        {activeFilterCount > 0 && (
                          <Button variant="ghost" size="sm" className="w-full h-7 text-xs" onClick={() => { setStateTypeFilter('active'); setPriorityFilter('all'); setAssigneeFilter('all') }}>
                            Clear filters
                          </Button>
                        )}
                      </PopoverContent>
                    </Popover>
                  </div>
                </div>

                {/* Table header */}
                <div className="px-4 py-2 border-b bg-muted/30">
                  <div className="grid grid-cols-[1fr_100px_90px_90px_80px] gap-3 text-xs font-medium text-muted-foreground uppercase tracking-wider">
                    <span>Issue</span>
                    <span>State</span>
                    <span>Priority</span>
                    <span>Updated</span>
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
                      No issues found
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
                            className="grid grid-cols-[1fr_100px_90px_90px_80px] gap-3 items-center px-4 hover:bg-accent/50 transition-colors border-b border-border/50 cursor-pointer"
                            onClick={() => setDetailIssue(issue)}
                          >
                            {/* Issue title + labels */}
                            <div className="min-w-0 flex items-center gap-2">
                              <span className="text-xs text-muted-foreground font-mono shrink-0">{issue.identifier}</span>
                              <span className="text-sm truncate">{issue.title}</span>
                              {issue.labels.length > 0 && (
                                <div className="flex items-center gap-1 shrink-0">
                                  {issue.labels.slice(0, 2).map(label => (
                                    <Badge
                                      key={label.id}
                                      className="text-[10px] px-1.5 py-0 border-0"
                                      style={{
                                        backgroundColor: `${label.color}20`,
                                        color: label.color,
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
                            {/* State */}
                            <Badge
                              className="text-[10px] px-1.5 py-0 border-0 w-fit"
                              style={{
                                backgroundColor: `${issue.state.color}20`,
                                color: issue.state.color,
                              }}
                            >
                              {issue.state.name}
                            </Badge>
                            {/* Priority */}
                            <span className="text-xs truncate flex items-center gap-1">
                              <span
                                className="w-2 h-2 rounded-full shrink-0"
                                style={{ backgroundColor: priorityColor(issue.priority) }}
                              />
                              {priorityLabel(issue.priority)}
                            </span>
                            {/* Updated */}
                            <span className="text-xs text-muted-foreground truncate">
                              {formatTimeAgo(issue.updated_at)}
                            </span>
                            {/* Actions */}
                            <div className="flex items-center justify-end gap-1" onClick={e => e.stopPropagation()}>
                              <Button
                                variant="ghost"
                                size="sm"
                                className="h-7 w-7 p-0"
                                onClick={() => window.open(issue.url, '_blank')}
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
              Create a new session to work on this Linear issue.
            </DialogDescription>
          </DialogHeader>

          {spawnIssue && (
            <div className="space-y-4">
              {/* Issue Preview */}
              <div className="rounded-lg border p-3 space-y-2 bg-muted/30">
                <div className="flex items-center gap-2">
                  <span className="text-xs text-muted-foreground font-mono">
                    {spawnIssue.identifier}
                  </span>
                  <span className="text-sm font-medium">{spawnIssue.title}</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <Badge
                    className="text-[10px] px-1.5 py-0 border-0"
                    style={{
                      backgroundColor: `${spawnIssue.state.color}20`,
                      color: spawnIssue.state.color,
                    }}
                  >
                    {spawnIssue.state.name}
                  </Badge>
                  <Badge
                    className="text-[10px] px-1.5 py-0 border-0"
                    style={{
                      backgroundColor: `${priorityColor(spawnIssue.priority)}20`,
                      color: priorityColor(spawnIssue.priority),
                    }}
                  >
                    {spawnIssue.priority_label}
                  </Badge>
                </div>
                {spawnIssue.description && (
                  <p className="text-xs text-muted-foreground line-clamp-4 whitespace-pre-wrap">
                    {spawnIssue.description.slice(0, 500)}
                    {spawnIssue.description.length > 500 ? '...' : ''}
                  </p>
                )}
                <a
                  href={spawnIssue.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-xs text-primary hover:underline inline-flex items-center gap-1"
                >
                  <ExternalLink className="h-3 w-3" />
                  View in Linear
                </a>
              </div>

              <Separator />

              {/* Message Preview */}
              <div className="space-y-1.5">
                <h4 className="text-xs font-medium text-muted-foreground">Message Preview</h4>
                <div className="rounded border bg-muted/30 p-3 text-xs whitespace-pre-wrap text-muted-foreground max-h-32 overflow-y-auto">
                  {`## Linear Issue ${spawnIssue.identifier}\n\n**Title:** ${spawnIssue.title}\n**URL:** ${spawnIssue.url}\n\n${spawnIssue.description || '(no description)'}\n\n---\n\nPlease analyze and address this Linear issue.`}
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
