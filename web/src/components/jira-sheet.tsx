"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Skeleton } from "@/components/ui/skeleton";

import { useVirtualizer } from "@tanstack/react-virtual";
import { Separator } from "@/components/ui/separator";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  Popover,
  PopoverTrigger,
  PopoverContent,
} from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  ExternalLink,
  Loader2,
  Rocket,
  AlertCircle,
  Check,
  Search,
  Users,
  SlidersHorizontal,
} from "lucide-react";
import type {
  JiraConfig,
  JiraProject,
  JiraIssue,
  JiraPriority,
} from "../types";

// ── Props ────────────────────────────────────────────────────────

interface JiraSheetProps {
  boardId: number;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

// ── Constants ────────────────────────────────────────────────────

const JIRA_BRAND_COLOR = "#0052CC";

// ── Helpers ──────────────────────────────────────────────────────

function formatTimeAgo(date: string): string {
  const now = new Date();
  const then = new Date(date);
  const seconds = Math.floor((now.getTime() - then.getTime()) / 1000);
  if (seconds < 60) return "just now";
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  if (seconds < 2592000) return `${Math.floor(seconds / 86400)}d ago`;
  return then.toLocaleDateString();
}

function priorityColor(priority: JiraPriority | null): string {
  if (!priority) return "#9CA3AF";
  switch (priority.name) {
    case "Highest":
      return "#EF4444";
    case "High":
      return "#F97316";
    case "Medium":
      return "#EAB308";
    case "Low":
      return "#22C55E";
    case "Lowest":
      return "#9CA3AF";
    default:
      return "#9CA3AF";
  }
}

function issueTypeColor(typeName: string): string {
  switch (typeName) {
    case "Bug":
      return "#EF4444";
    case "Story":
      return "#22C55E";
    case "Task":
      return "#3B82F6";
    case "Epic":
      return "#8B5CF6";
    case "Sub-task":
      return "#6B7280";
    default:
      return "#6B7280";
  }
}

function statusCategoryColor(colorName: string): string {
  switch (colorName) {
    case "blue-gray":
      return "#6B7280";
    case "yellow":
      return "#EAB308";
    case "green":
      return "#22C55E";
    case "brown":
      return "#D97706";
    case "warm-red":
      return "#EF4444";
    default:
      return "#6B7280";
  }
}

// ── Component ────────────────────────────────────────────────────

export default function JiraSheet({
  boardId,
  open,
  onOpenChange,
}: JiraSheetProps) {
  // Config state
  const [config, setConfig] = useState<JiraConfig | null>(null);
  const [loadingConfig, setLoadingConfig] = useState(false);

  // Setup state
  const [baseUrlInput, setBaseUrlInput] = useState("");
  const [emailInput, setEmailInput] = useState("");
  const [tokenInput, setTokenInput] = useState("");
  const [saving, setSaving] = useState(false);
  const [setupError, setSetupError] = useState<string | null>(null);

  // Project picker state
  const [projects, setProjects] = useState<JiraProject[]>([]);
  const [selectedProjects, setSelectedProjects] = useState<string[]>([]);
  const [loadingProjects, setLoadingProjects] = useState(false);
  const [showProjectPicker, setShowProjectPicker] = useState(false);
  const [projectFilter, setProjectFilter] = useState("");

  // Issues state
  const [issues, setIssues] = useState<JiraIssue[]>([]);
  const [loadingIssues, setLoadingIssues] = useState(false);
  const [activeProjectTab, setActiveProjectTab] = useState<string>("");
  const [issuesFilter, setIssuesFilter] = useState("");

  // Issues filters
  const [statusCategoryFilter, setStatusCategoryFilter] =
    useState<string>("todo");
  const [priorityFilter, setPriorityFilter] = useState<string>("all");
  const [assigneeFilter, setAssigneeFilter] = useState<string>("all");

  // JQL input
  const [jqlInput, setJqlInput] = useState("");

  // Multi-select state
  const [selectedIssueIds, setSelectedIssueIds] = useState<Set<string>>(
    new Set(),
  );

  // Spawn dialog state
  const [spawnDialogOpen, setSpawnDialogOpen] = useState(false);
  const [spawnIssue, setSpawnIssue] = useState<JiraIssue | null>(null);
  const [spawnIssues, setSpawnIssues] = useState<JiraIssue[]>([]);
  const [spawnAgent, setSpawnAgent] = useState("__default__");
  const [spawnPrompt, setSpawnPrompt] = useState("");
  const [agents, setAgents] = useState<{ name: string }[]>([]);
  const [spawning, setSpawning] = useState(false);

  // Issue detail state
  const [detailIssue, setDetailIssue] = useState<JiraIssue | null>(null);

  // ── Selection helpers ────────────────────────────────────────────

  const toggleIssueSelection = (issueKey: string, e?: React.MouseEvent) => {
    e?.stopPropagation();
    setSelectedIssueIds((prev) => {
      const next = new Set(prev);
      if (next.has(issueKey)) next.delete(issueKey);
      else next.add(issueKey);
      return next;
    });
  };

  const clearSelection = () => setSelectedIssueIds(new Set());

  // ── Reset on open ────────────────────────────────────────────────

  useEffect(() => {
    setConfig(null);
    setLoadingConfig(false);
    setBaseUrlInput("");
    setEmailInput("");
    setTokenInput("");
    setSaving(false);
    setSetupError(null);
    setProjects([]);
    setSelectedProjects([]);
    setLoadingProjects(false);
    setShowProjectPicker(false);
    setProjectFilter("");
    setIssues([]);
    setLoadingIssues(false);
    setActiveProjectTab("");
    setIssuesFilter("");
    setStatusCategoryFilter("todo");
    setPriorityFilter("all");
    setAssigneeFilter("all");
    setJqlInput("");
    setSpawnDialogOpen(false);
    setSpawnIssue(null);
    setSpawnIssues([]);
    setSpawnAgent("");
    setSpawnPrompt("");
    setSpawning(false);
    setDetailIssue(null);
    setSelectedIssueIds(new Set());
  }, [boardId, open]);

  // ── Fetch config ───────────────────────────────────────────────

  const fetchConfig = useCallback(async () => {
    setLoadingConfig(true);
    try {
      const res = await fetch(`/api/boards/${boardId}/jira/config`);
      const data = await res.json();
      setConfig(data);
      if (data.selected_projects?.length > 0 && !activeProjectTab) {
        setActiveProjectTab(data.selected_projects[0]);
      }
    } catch {
      // ignore
    } finally {
      setLoadingConfig(false);
    }
  }, [boardId, activeProjectTab]);

  useEffect(() => {
    if (open) fetchConfig();
  }, [open, fetchConfig]);

  // ── Fetch projects (for picker) ───────────────────────────────

  const fetchProjects = useCallback(async () => {
    setLoadingProjects(true);
    setShowProjectPicker(true);
    try {
      const res = await fetch(`/api/boards/${boardId}/jira/projects`);
      if (res.ok) {
        const data = await res.json();
        setProjects(data.projects || []);
        setSelectedProjects(data.selected_projects || []);
      }
    } catch {
      // ignore
    } finally {
      setLoadingProjects(false);
    }
  }, [boardId]);

  // ── Pre-fetch projects silently when config has selected projects ─

  useEffect(() => {
    if (
      open &&
      config?.has_token &&
      config.selected_projects.length > 0 &&
      projects.length === 0
    ) {
      fetch(`/api/boards/${boardId}/jira/projects`)
        .then((r) => r.json())
        .then((data) => {
          if (data.projects) setProjects(data.projects);
        })
        .catch(() => {});
    }
  }, [open, config?.has_token, config?.selected_projects, boardId]);

  // ── Save config (connect) ─────────────────────────────────────

  const handleSaveConfig = async () => {
    if (!baseUrlInput.trim() || !emailInput.trim() || !tokenInput.trim())
      return;
    setSaving(true);
    setSetupError(null);
    try {
      const res = await fetch(`/api/boards/${boardId}/jira/config`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          base_url: baseUrlInput.trim().replace(/\/+$/, ""),
          email: emailInput.trim(),
          token: tokenInput.trim(),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to save configuration");
      setBaseUrlInput("");
      setEmailInput("");
      setTokenInput("");
      await fetchConfig();
      fetchProjects();
    } catch (err) {
      setSetupError((err as Error).message);
    } finally {
      setSaving(false);
    }
  };

  // ── Save selected projects ────────────────────────────────────

  const handleSaveProjects = async () => {
    try {
      await fetch(`/api/boards/${boardId}/jira/projects`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ selected_projects: selectedProjects }),
      });
      setShowProjectPicker(false);
      await fetchConfig();
      if (selectedProjects.length > 0) {
        setActiveProjectTab(selectedProjects[0]);
        fetchIssues();
      }
    } catch {
      // ignore
    }
  };

  // ── Fetch issues ───────────────────────────────────────────────

  const fetchIssues = useCallback(async () => {
    if (!config?.has_token || config.selected_projects.length === 0) return;
    setLoadingIssues(true);
    try {
      const params = new URLSearchParams();
      if (activeProjectTab) params.set("project", activeProjectTab);
      if (statusCategoryFilter && statusCategoryFilter !== "all")
        params.set("statusCategory", statusCategoryFilter);
      if (jqlInput.trim()) params.set("jql", jqlInput.trim());
      const url = `/api/boards/${boardId}/jira/issues?${params.toString()}`;
      const res = await fetch(url);
      if (res.ok) {
        const data = await res.json();
        setIssues(data.issues || []);
      }
    } catch {
      // ignore
    } finally {
      setLoadingIssues(false);
    }
  }, [
    boardId,
    config?.has_token,
    config?.selected_projects,
    activeProjectTab,
    statusCategoryFilter,
    jqlInput,
  ]);

  useEffect(() => {
    if (open && config?.has_token && config.selected_projects.length > 0) {
      fetchIssues();
    }
  }, [
    open,
    config?.has_token,
    config?.selected_projects,
    activeProjectTab,
    statusCategoryFilter,
    jqlInput,
    fetchIssues,
  ]);

  // ── Fetch agents (for spawn dialog) ────────────────────────────

  useEffect(() => {
    if (spawnDialogOpen) {
      fetch("/api/opencode/agent")
        .then((r) => r.json())
        .then((list: Array<{ name: string; mode: string }>) =>
          setAgents(list.filter((a) => a.mode === "primary")),
        )
        .catch(() => {
          // Fallback endpoint
          fetch("/api/agents")
            .then((r) => r.json())
            .then((list: Array<{ name: string; mode: string }>) =>
              setAgents(list.filter((a) => a.mode === "primary")),
            )
            .catch(() => {});
        });
    }
  }, [spawnDialogOpen]);

  // ── Spawn agent ────────────────────────────────────────────────

  const handleSpawn = async () => {
    // Multi-issue mode
    if (spawnIssues.length > 0) {
      setSpawning(true);
      try {
        const res = await fetch(`/api/boards/${boardId}/jira/spawn`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            issues: spawnIssues.map((i) => ({
              key: i.key,
              title: i.fields.summary,
              description: i.fields.description || "",
              url: i.html_url,
              project_key: i.fields.project.key,
            })),
            prompt: spawnPrompt,
            agent: spawnAgent === "__default__" ? undefined : spawnAgent,
          }),
        });
        if (!res.ok) {
          const data = await res.json();
          throw new Error(data.error || "Failed to spawn agent");
        }
        setSpawnDialogOpen(false);
        setSpawnIssues([]);
        setSpawnAgent("");
        clearSelection();
      } catch (err) {
        console.error("Spawn failed:", err);
      } finally {
        setSpawning(false);
      }
      return;
    }

    // Single issue mode
    if (!spawnIssue) return;
    setSpawning(true);
    try {
      const res = await fetch(`/api/boards/${boardId}/jira/spawn`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          issue: {
            key: spawnIssue.key,
            title: spawnIssue.fields.summary,
            description: spawnIssue.fields.description || "",
            url: spawnIssue.html_url,
            project_key: spawnIssue.fields.project.key,
          },
          prompt: spawnPrompt,
          agent: spawnAgent === "__default__" ? undefined : spawnAgent,
        }),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Failed to spawn agent");
      }
      setSpawnDialogOpen(false);
      setSpawnIssue(null);
      setSpawnAgent("");
    } catch (err) {
      console.error("Spawn failed:", err);
    } finally {
      setSpawning(false);
    }
  };

  // ── Delete config (disconnect) ────────────────────────────────

  const handleDisconnect = async () => {
    try {
      await fetch(`/api/boards/${boardId}/jira/config`, { method: "DELETE" });
      setConfig(null);
      setProjects([]);
      setSelectedProjects([]);
      setIssues([]);
      setShowProjectPicker(false);
      setActiveProjectTab("");
      setDetailIssue(null);
    } catch {
      // ignore
    }
  };

  // ── Toggle project selection ──────────────────────────────────

  const toggleProject = (projectKey: string) => {
    setSelectedProjects((prev) =>
      prev.includes(projectKey)
        ? prev.filter((k) => k !== projectKey)
        : [...prev, projectKey],
    );
  };

  // ── Render helpers ─────────────────────────────────────────────

  const filteredIssues = issues.filter((i) => {
    // Priority filter
    if (
      priorityFilter !== "all" &&
      i.fields.priority?.name !== priorityFilter
    )
      return false;
    // Assignee filter
    if (assigneeFilter !== "all") {
      if (
        !i.fields.assignee ||
        i.fields.assignee.accountId !== assigneeFilter
      )
        return false;
    }
    // Text filter
    if (issuesFilter) {
      const lower = issuesFilter.toLowerCase();
      return (
        i.fields.summary.toLowerCase().includes(lower) ||
        i.key.toLowerCase().includes(lower) ||
        i.fields.labels.some((l) => l.toLowerCase().includes(lower))
      );
    }
    return true;
  });

  // Derived filter options from current issues
  const uniqueAssignees = Array.from(
    new Map(
      issues
        .filter((i) => i.fields.assignee)
        .map((i) => [
          i.fields.assignee!.accountId,
          i.fields.assignee!,
        ]),
    ).values(),
  );

  const activeFilterCount = [
    statusCategoryFilter !== "todo",
    priorityFilter !== "all",
    assigneeFilter !== "all",
  ].filter(Boolean).length;

  const filteredProjects = projectFilter
    ? projects.filter(
        (p) =>
          p.name.toLowerCase().includes(projectFilter.toLowerCase()) ||
          p.key.toLowerCase().includes(projectFilter.toLowerCase()),
      )
    : projects;

  // Virtualizer: project picker
  const projectScrollRef = useRef<HTMLDivElement>(null);
  const projectVirtualizer = useVirtualizer({
    count: filteredProjects.length,
    getScrollElement: () => projectScrollRef.current,
    estimateSize: () => 56,
    overscan: 10,
  });

  // Virtualizer: issues list
  const issueScrollRef = useRef<HTMLDivElement>(null);
  const issueVirtualizer = useVirtualizer({
    count: filteredIssues.length,
    getScrollElement: () => issueScrollRef.current,
    estimateSize: () => 48,
    overscan: 10,
  });

  // ── Render ─────────────────────────────────────────────────────

  return (
    <>
      <Sheet open={open} onOpenChange={onOpenChange}>
        <SheetContent
          side="right"
          style={{ width: "55vw", maxWidth: "none" }}
          className="flex flex-col p-0"
        >
          <SheetHeader className="px-6 pt-6 pb-4 border-b">
            <div className="flex items-center gap-2">
              <div
                className="w-5 h-5 rounded flex items-center justify-center"
                style={{ backgroundColor: JIRA_BRAND_COLOR }}
              >
                <svg
                  width="12"
                  height="12"
                  viewBox="0 0 24 24"
                  fill="none"
                  xmlns="http://www.w3.org/2000/svg"
                >
                  <path
                    d="M11.4 1L0 22h22.8L11.4 1zM10.2 18.6v-1.8h2.4v1.8h-2.4zM10.2 14.4V7.8h2.4v6.6h-2.4z"
                    fill="white"
                  />
                </svg>
              </div>
              <SheetTitle>JIRA</SheetTitle>
            </div>
          </SheetHeader>

          {/* Action buttons bar */}
          {config?.has_token && !showProjectPicker && !loadingConfig && (
            <div className="border-b px-6 flex items-center gap-2">
              <div className="flex-1" />
              <TooltipProvider delayDuration={300}>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={fetchProjects}
                      className="shrink-0 h-8 w-8 p-0"
                    >
                      <Users className="h-3.5 w-3.5" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent side="bottom" className="text-xs">
                    Select Projects
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
              <Button
                variant="ghost"
                size="sm"
                onClick={handleDisconnect}
                className="shrink-0 h-8 px-2 text-xs text-muted-foreground hover:text-destructive"
              >
                Disconnect
              </Button>
            </div>
          )}

          <div className="flex-1 overflow-hidden">
            {/* ── Setup Mode ──────────────────────────────────── */}
            {loadingConfig ? (
              <div className="p-6 space-y-4">
                <Skeleton className="h-10 w-full" />
                <Skeleton className="h-10 w-full" />
                <Skeleton className="h-20 w-full" />
              </div>
            ) : !config?.has_token ? (
              <div className="p-6 space-y-4">
                <div className="space-y-2">
                  <h3 className="text-sm font-medium">Connect JIRA</h3>
                  <p className="text-xs text-muted-foreground">
                    Enter your JIRA instance URL, email, and API token. The
                    credentials are stored locally for this board only.
                  </p>
                  <div className="rounded-lg border bg-muted/30 p-3 space-y-1.5">
                    <p className="text-xs font-medium">Required access:</p>
                    <ul className="text-xs text-muted-foreground space-y-0.5 list-none">
                      <li>
                        <code className="text-[11px] bg-muted px-1 py-0.5 rounded">
                          Browse Projects
                        </code>{" "}
                        — Access to projects and issues
                      </li>
                      <li>
                        API tokens can be created from your Atlassian account
                        settings
                      </li>
                    </ul>
                    <a
                      href="https://id.atlassian.com/manage-profile/security/api-tokens"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-xs text-primary hover:underline inline-flex items-center gap-1"
                    >
                      <ExternalLink className="h-3 w-3" />
                      Create an API token
                    </a>
                  </div>
                </div>
                <div className="space-y-2">
                  <Input
                    placeholder="https://your-domain.atlassian.net"
                    value={baseUrlInput}
                    onChange={(e) => setBaseUrlInput(e.target.value)}
                  />
                  <Input
                    type="email"
                    placeholder="your-email@example.com"
                    value={emailInput}
                    onChange={(e) => setEmailInput(e.target.value)}
                  />
                  <Input
                    type="password"
                    placeholder="JIRA API Token"
                    value={tokenInput}
                    onChange={(e) => setTokenInput(e.target.value)}
                    onKeyDown={(e) =>
                      e.key === "Enter" && handleSaveConfig()
                    }
                  />
                  {setupError && (
                    <p className="text-xs text-destructive flex items-center gap-1">
                      <AlertCircle className="h-3 w-3" />
                      {setupError}
                    </p>
                  )}
                  <Button
                    onClick={handleSaveConfig}
                    disabled={
                      saving ||
                      !baseUrlInput.trim() ||
                      !emailInput.trim() ||
                      !tokenInput.trim()
                    }
                    className="w-full"
                  >
                    {saving ? (
                      <Loader2 className="h-4 w-4 animate-spin mr-2" />
                    ) : (
                      <Check className="h-4 w-4 mr-2" />
                    )}
                    Connect
                  </Button>
                </div>
              </div>
            ) : showProjectPicker ? (
              /* ── Project Picker ─────────────────────────────── */
              <div className="flex flex-col h-full">
                <div className="px-6 pt-4 pb-3 space-y-3">
                  <div className="flex items-center justify-between">
                    <h3 className="text-sm font-medium">Select Projects</h3>
                    <span className="text-xs text-muted-foreground">
                      {selectedProjects.length} selected
                    </span>
                  </div>
                  {!loadingProjects && projects.length > 0 && (
                    <div className="relative">
                      <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
                      <Input
                        placeholder="Search projects..."
                        value={projectFilter}
                        onChange={(e) => setProjectFilter(e.target.value)}
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
                      {[1, 2, 3, 4, 5].map((i) => (
                        <Skeleton key={i} className="h-12 w-full" />
                      ))}
                    </div>
                  ) : (
                    <div ref={projectScrollRef} className="h-full overflow-y-auto">
                      <div
                        style={{
                          height: `${projectVirtualizer.getTotalSize()}px`,
                          width: "100%",
                          position: "relative",
                        }}
                      >
                        {projectVirtualizer.getVirtualItems().map((virtualRow) => {
                          const project = filteredProjects[virtualRow.index];
                          if (!project) return null;
                          const isSelected = selectedProjects.includes(
                            project.key,
                          );
                          return (
                            <button
                              key={project.key}
                              onClick={() => toggleProject(project.key)}
                              style={{
                                position: "absolute",
                                top: 0,
                                left: 0,
                                width: "100%",
                                height: `${virtualRow.size}px`,
                                transform: `translateY(${virtualRow.start}px)`,
                              }}
                              className={`w-full flex items-center gap-3 px-3 rounded-lg border text-left transition-colors ${
                                isSelected
                                  ? "border-primary bg-primary/5"
                                  : "border-transparent hover:bg-accent"
                              }`}
                            >
                              <div
                                className={`w-4 h-4 rounded border flex items-center justify-center shrink-0 ${
                                  isSelected
                                    ? "bg-primary border-primary text-primary-foreground"
                                    : "border-muted-foreground/30"
                                }`}
                              >
                                {isSelected && (
                                  <Check className="h-3 w-3" />
                                )}
                              </div>
                              <div className="min-w-0 flex-1">
                                <div className="text-sm font-medium truncate">
                                  <span className="text-muted-foreground font-mono text-xs mr-1.5">
                                    {project.key}
                                  </span>
                                  {project.name}
                                </div>
                                <div className="text-xs text-muted-foreground truncate">
                                  {project.projectTypeKey} · {project.style}
                                </div>
                              </div>
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  )}
                </div>
                <div className="border-t px-6 py-4 flex gap-2">
                  <Button
                    variant="outline"
                    onClick={() => {
                      setShowProjectPicker(false);
                      setProjectFilter("");
                    }}
                    className="flex-1"
                  >
                    Cancel
                  </Button>
                  <Button
                    onClick={handleSaveProjects}
                    disabled={selectedProjects.length === 0}
                    className="flex-1"
                  >
                    Save Selection
                  </Button>
                </div>
              </div>
            ) : config.selected_projects.length === 0 ? (
              /* ── No projects selected ────────────────────────── */
              <div className="p-6 space-y-4">
                <div className="text-center py-8 space-y-2">
                  <div
                    className="w-10 h-10 mx-auto rounded-lg flex items-center justify-center"
                    style={{ backgroundColor: `${JIRA_BRAND_COLOR}15` }}
                  >
                    <svg
                      width="20"
                      height="20"
                      viewBox="0 0 24 24"
                      fill="none"
                      xmlns="http://www.w3.org/2000/svg"
                    >
                      <path
                        d="M11.4 1L0 22h22.8L11.4 1zM10.2 18.6v-1.8h2.4v1.8h-2.4zM10.2 14.4V7.8h2.4v6.6h-2.4z"
                        fill={JIRA_BRAND_COLOR}
                      />
                    </svg>
                  </div>
                  <h3 className="text-sm font-medium">Select Projects</h3>
                  <p className="text-xs text-muted-foreground">
                    Choose which JIRA projects to follow.
                  </p>
                  <div className="flex items-center justify-center gap-2 mt-4">
                    <Button onClick={fetchProjects} variant="outline">
                      <Users className="h-4 w-4 mr-2" />
                      Select Projects
                    </Button>
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={handleDisconnect}
                    className="text-xs text-muted-foreground hover:text-destructive"
                  >
                    Disconnect
                  </Button>
                </div>
              </div>
            ) : detailIssue ? (
              /* ── Issue Detail ─────────────────────────────────── */
              <div className="flex flex-col h-full">
                <div className="px-6 pt-4 pb-3 border-b">
                  <div className="flex items-center gap-2">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setDetailIssue(null)}
                      className="h-7 px-2 text-xs"
                    >
                      &larr; Back
                    </Button>
                    <span className="text-xs text-muted-foreground font-mono">
                      {detailIssue.key}
                    </span>
                  </div>
                  <h2 className="text-base font-semibold mt-2">
                    {detailIssue.fields.summary}
                  </h2>
                  <div className="flex items-center gap-2 mt-1 flex-wrap">
                    <Badge
                      className="text-[10px] px-1.5 py-0 border-0"
                      style={{
                        backgroundColor: `${statusCategoryColor(detailIssue.fields.status.statusCategory.colorName)}20`,
                        color: statusCategoryColor(
                          detailIssue.fields.status.statusCategory.colorName,
                        ),
                      }}
                    >
                      {detailIssue.fields.status.name}
                    </Badge>
                    {detailIssue.fields.priority && (
                      <Badge
                        className="text-[10px] px-1.5 py-0 border-0"
                        style={{
                          backgroundColor: `${priorityColor(detailIssue.fields.priority)}20`,
                          color: priorityColor(
                            detailIssue.fields.priority,
                          ),
                        }}
                      >
                        {detailIssue.fields.priority.name}
                      </Badge>
                    )}
                    <Badge
                      className="text-[10px] px-1.5 py-0 border-0"
                      style={{
                        backgroundColor: `${issueTypeColor(detailIssue.fields.issuetype.name)}20`,
                        color: issueTypeColor(
                          detailIssue.fields.issuetype.name,
                        ),
                      }}
                    >
                      {detailIssue.fields.issuetype.name}
                    </Badge>
                    {detailIssue.fields.labels.map((label) => (
                      <Badge
                        key={label}
                        variant="secondary"
                        className="text-[10px] px-1.5 py-0"
                      >
                        {label}
                      </Badge>
                    ))}
                    <span className="text-xs text-muted-foreground">
                      created {formatTimeAgo(detailIssue.fields.created)}
                    </span>
                    {detailIssue.fields.updated !==
                      detailIssue.fields.created && (
                      <span className="text-xs text-muted-foreground">
                        · updated {formatTimeAgo(detailIssue.fields.updated)}
                      </span>
                    )}
                  </div>
                  {detailIssue.fields.assignee && (
                    <div className="flex items-center gap-1 mt-2">
                      <span className="text-xs text-muted-foreground">
                        Assignee:
                      </span>
                      <Badge
                        variant="outline"
                        className="text-[10px] px-1.5 py-0"
                      >
                        {detailIssue.fields.assignee.displayName}
                      </Badge>
                    </div>
                  )}
                  {detailIssue.fields.reporter && (
                    <div className="flex items-center gap-1 mt-1">
                      <span className="text-xs text-muted-foreground">
                        Reporter:
                      </span>
                      <Badge
                        variant="outline"
                        className="text-[10px] px-1.5 py-0"
                      >
                        {detailIssue.fields.reporter.displayName}
                      </Badge>
                    </div>
                  )}
                </div>
                <div className="flex-1 overflow-y-auto px-6 py-4">
                  {detailIssue.fields.description ? (
                    <div className="text-sm whitespace-pre-wrap break-words leading-relaxed text-muted-foreground">
                      {detailIssue.fields.description}
                    </div>
                  ) : (
                    <p className="text-sm text-muted-foreground italic">
                      No description provided.
                    </p>
                  )}
                </div>
                <div className="border-t px-6 py-4 flex items-center gap-2">
                  <Button
                    variant="outline"
                    onClick={() =>
                      window.open(detailIssue.html_url, "_blank")
                    }
                    className="text-xs"
                  >
                    <ExternalLink className="h-3 w-3 mr-1" />
                    Open in JIRA
                  </Button>
                  <div className="flex-1" />
                  <Button
                    variant="default"
                    onClick={() => {
                      setSpawnIssue(detailIssue);
                      setSpawnPrompt(
                        `## JIRA Issue ${detailIssue.key}\n\n**Title:** ${detailIssue.fields.summary}\n**URL:** ${detailIssue.html_url}\n\n${detailIssue.fields.description || "(no description)"}\n\n---\n\nPlease analyze and address this JIRA issue.`,
                      );
                      setSpawnDialogOpen(true);
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
                {/* Project Tabs */}
                <div className="border-b px-4">
                  <Tabs
                    value={activeProjectTab}
                    onValueChange={(val) => {
                      setActiveProjectTab(val);
                      setPriorityFilter("all");
                      setAssigneeFilter("all");
                      setJqlInput("");
                      clearSelection();
                    }}
                  >
                    <TabsList variant="line" className="w-full overflow-x-auto">
                      {config.selected_projects.map((projectKey: string) => {
                        const project = projects.find(
                          (p) => p.key === projectKey,
                        );
                        return (
                          <TabsTrigger
                            key={projectKey}
                            value={projectKey}
                            className="text-xs"
                          >
                            {project?.key || projectKey.slice(0, 6)}
                          </TabsTrigger>
                        );
                      })}
                    </TabsList>
                  </Tabs>
                </div>

                {/* JQL input + search bar + filters */}
                <div className="px-4 py-2 border-b space-y-2">
                  {/* JQL input */}
                  <div className="relative">
                    <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
                    <Input
                      placeholder="JQL query (e.g. assignee = currentUser())"
                      value={jqlInput}
                      onChange={(e) => setJqlInput(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") fetchIssues();
                      }}
                      className="pl-8 h-8 text-xs font-mono"
                    />
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="relative flex-1">
                      <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
                      <Input
                        placeholder="Filter issues..."
                        value={issuesFilter}
                        onChange={(e) => setIssuesFilter(e.target.value)}
                        className="pl-8 h-8 text-xs"
                      />
                    </div>
                    <Popover>
                      <PopoverTrigger asChild>
                        <Button
                          variant="outline"
                          size="sm"
                          className="h-8 px-2 relative"
                        >
                          <SlidersHorizontal className="h-3.5 w-3.5" />
                          {activeFilterCount > 0 && (
                            <span className="absolute -top-1 -right-1 h-3.5 w-3.5 rounded-full bg-primary text-[8px] text-primary-foreground flex items-center justify-center">
                              {activeFilterCount}
                            </span>
                          )}
                        </Button>
                      </PopoverTrigger>
                      <PopoverContent
                        align="end"
                        className="w-56 p-3 space-y-3"
                      >
                        <div className="space-y-1.5">
                          <label className="text-xs font-medium">Status</label>
                          <Select
                            value={statusCategoryFilter}
                            onValueChange={setStatusCategoryFilter}
                          >
                            <SelectTrigger className="h-7 text-xs">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="todo">To Do</SelectItem>
                              <SelectItem value="indeterminate">
                                In Progress
                              </SelectItem>
                              <SelectItem value="done">Done</SelectItem>
                              <SelectItem value="all">All</SelectItem>
                            </SelectContent>
                          </Select>
                        </div>
                        <div className="space-y-1.5">
                          <label className="text-xs font-medium">
                            Priority
                          </label>
                          <Select
                            value={priorityFilter}
                            onValueChange={setPriorityFilter}
                          >
                            <SelectTrigger className="h-7 text-xs">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="all">Any priority</SelectItem>
                              <SelectItem value="Highest">Highest</SelectItem>
                              <SelectItem value="High">High</SelectItem>
                              <SelectItem value="Medium">Medium</SelectItem>
                              <SelectItem value="Low">Low</SelectItem>
                              <SelectItem value="Lowest">Lowest</SelectItem>
                            </SelectContent>
                          </Select>
                        </div>
                        <div className="space-y-1.5">
                          <label className="text-xs font-medium">
                            Assignee
                          </label>
                          <Select
                            value={assigneeFilter}
                            onValueChange={setAssigneeFilter}
                          >
                            <SelectTrigger className="h-7 text-xs">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="all">Anyone</SelectItem>
                              {uniqueAssignees.map((a) => (
                                <SelectItem
                                  key={a!.accountId}
                                  value={a!.accountId}
                                >
                                  {a!.displayName}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                        {activeFilterCount > 0 && (
                          <Button
                            variant="ghost"
                            size="sm"
                            className="w-full h-7 text-xs"
                            onClick={() => {
                              setStatusCategoryFilter("todo");
                              setPriorityFilter("all");
                              setAssigneeFilter("all");
                            }}
                          >
                            Clear filters
                          </Button>
                        )}
                      </PopoverContent>
                    </Popover>
                  </div>
                </div>

                {/* Table header */}
                <div className="px-4 py-2 border-b bg-muted/30">
                  <div className="grid grid-cols-[28px_1fr_100px_90px_80px_90px_80px] gap-2 text-xs font-medium text-muted-foreground uppercase tracking-wider">
                    <div className="flex items-center justify-center">
                      <button
                        onClick={() => {
                          if (
                            selectedIssueIds.size ===
                              filteredIssues.length &&
                            filteredIssues.length > 0
                          ) {
                            clearSelection();
                          } else {
                            setSelectedIssueIds(
                              new Set(filteredIssues.map((i) => i.key)),
                            );
                          }
                        }}
                        className={`w-4 h-4 rounded border flex items-center justify-center shrink-0 ${
                          filteredIssues.length > 0 &&
                          selectedIssueIds.size === filteredIssues.length
                            ? "bg-primary border-primary text-primary-foreground"
                            : "border-muted-foreground/30 hover:border-muted-foreground"
                        }`}
                      >
                        {filteredIssues.length > 0 &&
                          selectedIssueIds.size ===
                            filteredIssues.length && (
                            <Check className="h-3 w-3" />
                          )}
                      </button>
                    </div>
                    <span>Issue</span>
                    <span>Type</span>
                    <span>Status</span>
                    <span>Priority</span>
                    <span>Assignee</span>
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
                        width: "100%",
                        position: "relative",
                      }}
                    >
                      {issueVirtualizer.getVirtualItems().map((virtualRow) => {
                        const issue = filteredIssues[virtualRow.index];
                        if (!issue) return null;
                        return (
                          <div
                            key={virtualRow.key}
                            style={{
                              position: "absolute",
                              top: 0,
                              left: 0,
                              width: "100%",
                              height: `${virtualRow.size}px`,
                              transform: `translateY(${virtualRow.start}px)`,
                            }}
                            className="grid grid-cols-[28px_1fr_100px_90px_80px_90px_80px] gap-2 items-center px-4 hover:bg-accent/50 transition-colors border-b border-border/50 cursor-pointer"
                            onClick={() => setDetailIssue(issue)}
                          >
                            {/* Checkbox */}
                            <div
                              className="flex items-center justify-center"
                              onClick={(e) => e.stopPropagation()}
                            >
                              <button
                                onClick={(e) =>
                                  toggleIssueSelection(issue.key, e)
                                }
                                className={`w-4 h-4 rounded border flex items-center justify-center shrink-0 ${
                                  selectedIssueIds.has(issue.key)
                                    ? "bg-primary border-primary text-primary-foreground"
                                    : "border-muted-foreground/30 hover:border-muted-foreground"
                                }`}
                              >
                                {selectedIssueIds.has(issue.key) && (
                                  <Check className="h-3 w-3" />
                                )}
                              </button>
                            </div>
                            {/* Issue title + labels */}
                            <div className="min-w-0 flex items-center gap-2">
                              <span className="text-xs text-muted-foreground font-mono shrink-0">
                                {issue.key}
                              </span>
                              <span className="text-sm truncate">
                                {issue.fields.summary}
                              </span>
                              {issue.fields.labels.length > 0 && (
                                <div className="flex items-center gap-1 shrink-0">
                                  {issue.fields.labels
                                    .slice(0, 2)
                                    .map((label) => (
                                      <Badge
                                        key={label}
                                        variant="secondary"
                                        className="text-[10px] px-1.5 py-0"
                                      >
                                        {label}
                                      </Badge>
                                    ))}
                                  {issue.fields.labels.length > 2 && (
                                    <span className="text-[10px] text-muted-foreground">
                                      +{issue.fields.labels.length - 2}
                                    </span>
                                  )}
                                </div>
                              )}
                            </div>
                            {/* Issue Type */}
                            <Badge
                              className="text-[10px] px-1.5 py-0 border-0 w-fit"
                              style={{
                                backgroundColor: `${issueTypeColor(issue.fields.issuetype.name)}20`,
                                color: issueTypeColor(
                                  issue.fields.issuetype.name,
                                ),
                              }}
                            >
                              {issue.fields.issuetype.name}
                            </Badge>
                            {/* Status */}
                            <Badge
                              className="text-[10px] px-1.5 py-0 border-0 w-fit"
                              style={{
                                backgroundColor: `${statusCategoryColor(issue.fields.status.statusCategory.colorName)}20`,
                                color: statusCategoryColor(
                                  issue.fields.status.statusCategory.colorName,
                                ),
                              }}
                            >
                              {issue.fields.status.name}
                            </Badge>
                            {/* Priority */}
                            <span className="text-xs truncate flex items-center gap-1">
                              {issue.fields.priority && (
                                <span
                                  className="w-2 h-2 rounded-full shrink-0"
                                  style={{
                                    backgroundColor: priorityColor(
                                      issue.fields.priority,
                                    ),
                                  }}
                                />
                              )}
                              {issue.fields.priority?.name || "—"}
                            </span>
                            {/* Assignee */}
                            <span className="text-xs text-muted-foreground truncate">
                              {issue.fields.assignee?.displayName || "—"}
                            </span>
                            {/* Updated */}
                            <span className="text-xs text-muted-foreground truncate">
                              {formatTimeAgo(issue.fields.updated)}
                            </span>
                            {/* Actions */}
                            <div
                              className="flex items-center justify-end gap-1"
                              onClick={(e) => e.stopPropagation()}
                            >
                              <Button
                                variant="ghost"
                                size="sm"
                                className="h-7 w-7 p-0"
                                onClick={() =>
                                  window.open(issue.html_url, "_blank")
                                }
                              >
                                <ExternalLink className="h-3 w-3" />
                              </Button>
                              <Button
                                variant="default"
                                size="sm"
                                className="h-7 px-2 text-xs"
                                onClick={() => {
                                  setSpawnIssue(issue);
                                  setSpawnIssues([]);
                                  setSpawnPrompt(
                                    `## JIRA Issue ${issue.key}\n\n**Title:** ${issue.fields.summary}\n**URL:** ${issue.html_url}\n\n${issue.fields.description || "(no description)"}\n\n---\n\nPlease analyze and address this JIRA issue.`,
                                  );
                                  setSpawnDialogOpen(true);
                                }}
                              >
                                <Rocket className="h-3 w-3 mr-1" />
                                Spawn
                              </Button>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
                {selectedIssueIds.size > 0 && (
                  <div className="border-t px-4 py-2 bg-background flex items-center gap-3 shrink-0">
                    <span className="text-xs text-muted-foreground">
                      {selectedIssueIds.size} issue
                      {selectedIssueIds.size !== 1 ? "s" : ""} selected
                    </span>
                    <div className="flex-1" />
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={clearSelection}
                      className="text-xs h-7"
                    >
                      Clear
                    </Button>
                    <Button
                      variant="default"
                      size="sm"
                      className="text-xs h-7"
                      onClick={() => {
                        const selected = filteredIssues.filter((i) =>
                          selectedIssueIds.has(i.key),
                        );
                        const generated = `## JIRA Issues (${selected.length} issues)\n\n${selected.map((iss) => `### ${iss.key}: ${iss.fields.summary}\n**URL:** ${iss.html_url}\n\n${iss.fields.description || "(no description)"}`).join("\n\n---\n\n")}\n\n---\n\nPlease analyze and address these JIRA issues.`;
                        setSpawnPrompt(generated);
                        setSpawnIssues(selected);
                        setSpawnIssue(null);
                        setSpawnDialogOpen(true);
                      }}
                    >
                      <Rocket className="h-3 w-3 mr-1" />
                      Spawn Agent ({selectedIssueIds.size})
                    </Button>
                  </div>
                )}
              </div>
            )}
          </div>
        </SheetContent>
      </Sheet>

      {/* ── Spawn Dialog ─────────────────────────────────────── */}
      <Dialog
        open={spawnDialogOpen}
        onOpenChange={(open) => {
          setSpawnDialogOpen(open);
          if (!open) {
            setSpawnIssues([]);
            setSpawnIssue(null);
            setSpawnPrompt("");
          }
        }}
      >
        <DialogContent className="sm:max-w-5xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Rocket className="h-4 w-4" />
              Spawn Agent from Issue
            </DialogTitle>
            <DialogDescription>
              Create a new session to work on this JIRA issue.
            </DialogDescription>
          </DialogHeader>

          {spawnIssues.length > 0 ? (
            <div className="space-y-4">
              {/* Issue list */}
              <div className="rounded-lg border bg-muted/30">
                <div className="px-3 pt-3 pb-1 text-xs font-medium text-muted-foreground">
                  {spawnIssues.length} issues combined into one session
                </div>
                <div className="max-h-[200px] overflow-y-auto px-3 pb-3 space-y-1">
                  {spawnIssues.map((iss) => (
                    <div key={iss.key} className="flex items-center gap-2">
                      <span className="text-xs text-muted-foreground font-mono shrink-0">
                        {iss.key}
                      </span>
                      <span className="text-sm truncate">
                        {iss.fields.summary}
                      </span>
                    </div>
                  ))}
                </div>
              </div>

              <Separator />

              {/* Prompt */}
              <div className="space-y-1.5">
                <h4 className="text-xs font-medium text-muted-foreground">
                  Prompt
                </h4>
                <textarea
                  className="w-full rounded border bg-muted/30 p-3 text-xs text-foreground resize-y min-h-[120px] max-h-[300px] focus:outline-none focus:ring-1 focus:ring-primary"
                  value={spawnPrompt}
                  onChange={(e) => setSpawnPrompt(e.target.value)}
                />
              </div>

              <Separator />

              {/* Agent Selector */}
              <div className="space-y-1.5">
                <h4 className="text-xs font-medium text-muted-foreground">
                  Agent
                </h4>
                <Select value={spawnAgent} onValueChange={setSpawnAgent}>
                  <SelectTrigger>
                    <SelectValue placeholder="Default agent" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__default__">Default agent</SelectItem>
                    {agents.map((a) => (
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
          ) : spawnIssue ? (
            <div className="space-y-4">
              {/* Issue Preview */}
              <div className="rounded-lg border p-3 space-y-2 bg-muted/30">
                <div className="flex items-center gap-2">
                  <span className="text-xs text-muted-foreground font-mono">
                    {spawnIssue.key}
                  </span>
                  <span className="text-sm font-medium">
                    {spawnIssue.fields.summary}
                  </span>
                </div>
                <div className="flex items-center gap-1.5">
                  <Badge
                    className="text-[10px] px-1.5 py-0 border-0"
                    style={{
                      backgroundColor: `${statusCategoryColor(spawnIssue.fields.status.statusCategory.colorName)}20`,
                      color: statusCategoryColor(
                        spawnIssue.fields.status.statusCategory.colorName,
                      ),
                    }}
                  >
                    {spawnIssue.fields.status.name}
                  </Badge>
                  {spawnIssue.fields.priority && (
                    <Badge
                      className="text-[10px] px-1.5 py-0 border-0"
                      style={{
                        backgroundColor: `${priorityColor(spawnIssue.fields.priority)}20`,
                        color: priorityColor(
                          spawnIssue.fields.priority,
                        ),
                      }}
                    >
                      {spawnIssue.fields.priority.name}
                    </Badge>
                  )}
                  <Badge
                    className="text-[10px] px-1.5 py-0 border-0"
                    style={{
                      backgroundColor: `${issueTypeColor(spawnIssue.fields.issuetype.name)}20`,
                      color: issueTypeColor(
                        spawnIssue.fields.issuetype.name,
                      ),
                    }}
                  >
                    {spawnIssue.fields.issuetype.name}
                  </Badge>
                </div>
                {spawnIssue.fields.description && (
                  <p className="text-xs text-muted-foreground line-clamp-4 whitespace-pre-wrap">
                    {spawnIssue.fields.description.slice(0, 500)}
                    {spawnIssue.fields.description.length > 500 ? "..." : ""}
                  </p>
                )}
                <a
                  href={spawnIssue.html_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-xs text-primary hover:underline inline-flex items-center gap-1"
                >
                  <ExternalLink className="h-3 w-3" />
                  View in JIRA
                </a>
              </div>

              <Separator />

              {/* Prompt */}
              <div className="space-y-1.5">
                <h4 className="text-xs font-medium text-muted-foreground">
                  Prompt
                </h4>
                <textarea
                  className="w-full rounded border bg-muted/30 p-3 text-xs text-foreground resize-y min-h-[120px] max-h-[300px] focus:outline-none focus:ring-1 focus:ring-primary"
                  value={spawnPrompt}
                  onChange={(e) => setSpawnPrompt(e.target.value)}
                />
              </div>

              <Separator />

              {/* Agent Selector */}
              <div className="space-y-1.5">
                <h4 className="text-xs font-medium text-muted-foreground">
                  Agent
                </h4>
                <Select value={spawnAgent} onValueChange={setSpawnAgent}>
                  <SelectTrigger>
                    <SelectValue placeholder="Default agent" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__default__">Default agent</SelectItem>
                    {agents.map((a) => (
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
          ) : null}
        </DialogContent>
      </Dialog>
    </>
  );
}
