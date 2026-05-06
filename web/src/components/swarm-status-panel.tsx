"use client";

import React, { useState, useEffect, useRef, useCallback } from "react";
import ReactDOM from "react-dom";
import { Epic, EpicSession } from "../types";
import {
  X,
  ChevronDown,
  ChevronRight,
  Loader2,
  CheckCircle2,
  XCircle,
  Clock,
  Activity,
  Sparkles,
  ArrowRight,
  GripVertical,
  Trash2,
  Check,
} from "lucide-react";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { toast } from "sonner";

interface SwarmStatusPanelProps {
  epicId: number;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSessionClick: (sessionId: string) => void;
  boardDirectory?: string;
}

const sessionStatusIcon = (session: EpicSession) => {
  if (session.is_busy) {
    return (
      <Loader2 className="w-3.5 h-3.5 animate-spin text-blue-500 shrink-0" />
    );
  }
  // We can't easily determine if completed without more info, so default to idle
  return <Clock className="w-3.5 h-3.5 text-muted-foreground shrink-0" />;
};

const epicStatusConfig: Record<
  string,
  { icon: React.ReactNode; label: string; color: string; bg: string }
> = {
  planning: {
    icon: <Sparkles className="w-4 h-4 animate-pulse" />,
    label: "Planning",
    color: "text-purple-500",
    bg: "bg-purple-500/10",
  },
  ready: {
    icon: <Sparkles className="w-4 h-4" />,
    label: "Ready to spawn",
    color: "text-amber-500",
    bg: "bg-amber-500/10",
  },
  spawning: {
    icon: <Loader2 className="w-4 h-4 animate-spin" />,
    label: "Creating sessions",
    color: "text-purple-500",
    bg: "bg-purple-500/10",
  },
  running: {
    icon: <Activity className="w-4 h-4" />,
    label: "Running",
    color: "text-blue-500",
    bg: "bg-blue-500/10",
  },
  completed: {
    icon: <CheckCircle2 className="w-4 h-4" />,
    label: "Completed",
    color: "text-green-500",
    bg: "bg-green-500/10",
  },
  failed: {
    icon: <XCircle className="w-4 h-4" />,
    label: "Failed",
    color: "text-red-500",
    bg: "bg-red-500/10",
  },
};

export default function SwarmStatusPanel({
  epicId,
  open,
  onOpenChange,
  onSessionClick,
  boardDirectory,
}: SwarmStatusPanelProps) {
  const [epic, setEpic] = useState<Epic | null>(null);
  const [loading, setLoading] = useState(true);
  const [planOpen, setPlanOpen] = useState(true);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [spawning, setSpawning] = useState(false);
  const [width, setWidth] = useState(() => window.innerWidth * 0.5);
  const panelRef = useRef<HTMLDivElement>(null);
  const isDragging = useRef(false);
  const startX = useRef(0);
  const startWidth = useRef(0);

  // Resize handle
  const onPointerDown = useCallback((e: React.PointerEvent) => {
    isDragging.current = true;
    startX.current = e.clientX;
    startWidth.current =
      panelRef.current?.offsetWidth || window.innerWidth * 0.5;
    e.preventDefault();
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  }, []);

  const onPointerMove = useCallback((e: React.PointerEvent) => {
    if (!isDragging.current) return;
    const delta = startX.current - e.clientX;
    const newWidth = Math.min(
      Math.max(startWidth.current + delta, 320),
      window.innerWidth * 0.85,
    );
    setWidth(newWidth);
  }, []);

  const onPointerUp = useCallback(() => {
    isDragging.current = false;
  }, []);

  // Fetch epic data
  const fetchEpic = useCallback(async () => {
    try {
      const res = await fetch(`/api/epics/${epicId}`);
      if (res.ok) {
        const data = await res.json();
        setEpic(data);
      }
    } catch {
      // retry on next poll
    } finally {
      setLoading(false);
    }
  }, [epicId]);

  const handleDelete = useCallback(async () => {
    try {
      const res = await fetch(`/api/epics/${epicId}`, { method: "DELETE" });
      if (res.ok) {
        toast.success("Epic deleted");
        setConfirmDelete(false);
        onOpenChange(false);
      } else {
        toast.error("Failed to delete epic");
      }
    } catch {
      toast.error("Error deleting epic");
    }
  }, [epicId, onOpenChange]);

  const handleComplete = useCallback(async () => {
    try {
      const res = await fetch(`/api/epics/${epicId}/complete`, { method: "POST" });
      if (res.ok) {
        toast.success("Epic marked as done");
        onOpenChange(false);
      } else {
        toast.error("Failed to mark epic as done");
      }
    } catch {
      toast.error("Error marking epic as done");
    }
  }, [epicId, onOpenChange]);

  const handleSpawn = useCallback(async () => {
    if (!epic?.plan_subtasks || !boardDirectory) return;
    setSpawning(true);
    try {
      const res = await fetch("/api/sessions/swarm/spawn", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          directory: boardDirectory,
          board_id: epic.board_id,
          epic_id: epic.id,
          subtasks: epic.plan_subtasks,
          original_task: epic.title,
        }),
      });
      if (res.ok) {
        const data = await res.json();
        toast.success(
          `Spawned ${data.sessions?.length || epic.plan_subtasks.length} sessions`,
        );
        fetchEpic(); // Refresh to show new status
      } else {
        const body = await res
          .json()
          .catch(() => ({ error: `HTTP ${res.status}` }));
        toast.error(body.error || "Failed to spawn sessions");
      }
    } catch {
      toast.error("Error spawning sessions");
    } finally {
      setSpawning(false);
    }
  }, [epic, boardDirectory, fetchEpic]);

  // Initial fetch
  useEffect(() => {
    if (!open || !epicId) return;
    setLoading(true);
    fetchEpic();
  }, [open, epicId, fetchEpic]);

  // Poll every 2 seconds
  useEffect(() => {
    if (!open || !epicId) return;
    const interval = setInterval(fetchEpic, 2000);
    return () => clearInterval(interval);
  }, [open, epicId, fetchEpic]);

  if (!open) return null;

  const sessions = epic?.sessions || [];
  const totalSessions = sessions.length;
  const busySessions = sessions.filter((s) => s.is_busy).length;
  const config = epic
    ? epicStatusConfig[epic.status] || epicStatusConfig.planning
    : epicStatusConfig.planning;

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 z-40 bg-black/50"
        onClick={() => onOpenChange(false)}
      />

      {/* Panel */}
      <div
        ref={panelRef}
        style={{ width: `${width}px` }}
        className={cn(
          "fixed top-0 right-0 z-50 h-full bg-background border-l shadow-lg flex flex-col",
          "animate-in slide-in-from-right duration-200",
        )}
      >
        {/* Resize Handle */}
        <div
          className="absolute top-0 left-0 h-full w-2 -translate-x-1/2 cursor-col-resize flex items-center justify-center hover:bg-accent/50 transition-colors"
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
        >
          <GripVertical className="w-3 h-3 text-muted-foreground/50" />
        </div>

        {/* Header */}
        <div className="border-b px-6 py-3 flex items-center justify-end gap-2 flex-shrink-0">
          {epic && epic.status !== "completed" && (
            <Button
              variant="ghost"
              size="sm"
              onClick={handleComplete}
              className="h-6 w-6 p-0 text-green-500 hover:text-green-600 hover:bg-green-500/10"
              title="Mark done"
            >
              <Check className="w-4 h-4" />
            </Button>
          )}
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setConfirmDelete(true)}
            className="h-6 w-6 p-0"
          >
            <Trash2 className="w-4 h-4" />
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => onOpenChange(false)}
            className="h-6 w-6 p-0"
          >
            <X className="w-4 h-4" />
          </Button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4">
          {loading && !epic ? (
            <div className="space-y-3">
              <Skeleton className="h-6 w-48" />
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-4 w-3/4" />
              <Skeleton className="h-20 w-full" />
            </div>
          ) : epic ? (
            <>
              {/* Description with epic chip */}
              <div>
                <Badge
                  variant="secondary"
                  className="text-[10px] font-mono font-bold bg-amber-500/15 text-amber-600 dark:text-amber-400 border-0 mb-2"
                >
                  {epic.task_key}
                </Badge>
                {epic.description && (
                  <p className="text-sm text-muted-foreground leading-relaxed">
                    {epic.description}
                  </p>
                )}
              </div>

              {/* Plan subtasks — show when plan detected */}
              {epic.plan_subtasks && epic.plan_subtasks.length > 0 && (
                <div className="space-y-2">
                  <h3 className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                    Plan — {epic.plan_subtasks.length} subtasks
                  </h3>
                  <div className="space-y-1.5">
                    {epic.plan_subtasks.map((subtask, i) => (
                      <div
                        key={i}
                        className="flex gap-2 text-xs px-2 py-1.5 rounded-md border border-border/50"
                      >
                        <span className="font-mono font-bold text-amber-600 shrink-0 w-5">
                          {i + 1}.
                        </span>
                        <div className="min-w-0">
                          <p className="font-medium">{subtask.title}</p>
                          {subtask.description && (
                            <div className="text-muted-foreground text-[11px] [&_p]:leading-relaxed [&_ul]:list-disc [&_ul]:pl-4 [&_ol]:list-decimal [&_ol]:pl-4 [&_code]:bg-muted [&_code]:px-1 [&_code]:rounded [&_strong]:text-foreground [&_strong]:font-semibold">
                              <ReactMarkdown remarkPlugins={[remarkGfm]}>
                                {subtask.description}
                              </ReactMarkdown>
                            </div>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                  {epic.status === "ready" && (
                    <Button
                      size="sm"
                      className="w-full bg-amber-500 hover:bg-amber-600 text-white text-xs"
                      onClick={handleSpawn}
                      disabled={spawning}
                    >
                      {spawning ? (
                        <>
                          <Loader2 className="w-3 h-3 animate-spin mr-1.5" />
                          Spawning…
                        </>
                      ) : (
                        <>🐝 Spawn {epic.plan_subtasks.length} Sessions</>
                      )}
                    </Button>
                  )}
                </div>
              )}

              {/* Sessions list */}
              {sessions.length > 0 && (
                <div className="space-y-1.5">
                  <h3 className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                    Sessions ({sessions.length})
                  </h3>
                  {sessions.map((session) => (
                    <div
                      key={session.id}
                      className="flex items-center gap-2 px-3 py-2 rounded-md border border-border/50 hover:bg-muted/30 transition-colors"
                    >
                      {sessionStatusIcon(session)}
                      <Badge
                        variant="secondary"
                        className="text-[9px] font-mono shrink-0"
                      >
                        {session.task_key}
                      </Badge>
                      <span className="text-xs truncate flex-1">
                        {session.title}
                      </span>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-6 text-xs shrink-0 px-2"
                        onClick={() => onSessionClick(session.session_id)}
                      >
                        view
                        <ArrowRight className="w-3 h-3 ml-0.5" />
                      </Button>
                    </div>
                  ))}
                </div>
              )}

              {/* Plan Details (collapsible) */}
              {epic.plan_text && (
                <Collapsible open={planOpen} onOpenChange={setPlanOpen}>
                  <CollapsibleTrigger asChild>
                    <button className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors w-full">
                      {planOpen ? (
                        <ChevronDown className="w-3 h-3" />
                      ) : (
                        <ChevronRight className="w-3 h-3" />
                      )}
                      <span className="font-medium">Plan Details</span>
                    </button>
                  </CollapsibleTrigger>
                  <CollapsibleContent>
                    <div className="mt-2 space-y-1.5">
                      {(() => {
                        try {
                          let parsed = JSON.parse(epic.plan_text);
                          if (!Array.isArray(parsed) && typeof parsed === "object" && parsed.subtasks) {
                            parsed = parsed.subtasks;
                          }
                          if (Array.isArray(parsed)) {
                            return parsed.map((subtask: any, i: number) => (
                              <div key={i} className="text-xs px-2 py-1.5 rounded-md border border-border/50">
                                <span className="font-mono font-bold text-amber-600 dark:text-amber-400 mr-1.5">
                                  {i + 1}.
                                </span>
                                <span className="font-medium text-foreground">{subtask.title}</span>
                                {subtask.description && (
                                  <div className="text-muted-foreground text-[11px] mt-0.5 ml-5 leading-relaxed [&_p]:leading-relaxed [&_ul]:list-disc [&_ul]:pl-4 [&_ol]:list-decimal [&_ol]:pl-4 [&_code]:bg-muted [&_code]:px-1 [&_code]:rounded [&_strong]:text-foreground [&_strong]:font-semibold">
                                    <ReactMarkdown remarkPlugins={[remarkGfm]}>
                                      {subtask.description}
                                    </ReactMarkdown>
                                  </div>
                                )}
                              </div>
                            ));
                          }
                        } catch { /* not JSON */ }
                        // Fallback: render as markdown
                        return (
                          <div className="text-xs text-muted-foreground max-w-none space-y-2 [&_h1]:text-sm [&_h1]:font-semibold [&_h1]:text-foreground [&_h2]:text-sm [&_h2]:font-semibold [&_h2]:text-foreground [&_p]:leading-relaxed [&_ul]:list-disc [&_ul]:pl-4 [&_ol]:list-decimal [&_ol]:pl-4 [&_code]:bg-muted [&_code]:px-1 [&_code]:rounded">
                            <ReactMarkdown remarkPlugins={[remarkGfm]}>
                              {epic.plan_text}
                            </ReactMarkdown>
                          </div>
                        );
                      })()}
                    </div>
                  </CollapsibleContent>
                </Collapsible>
              )}
            </>
          ) : null}
        </div>
      </div>
      {/* Delete confirmation dialog */}
      {confirmDelete &&
        ReactDOM.createPortal(
          <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50">
            <div className="bg-popover text-popover-foreground rounded-lg border p-4 shadow-lg max-w-sm mx-4 space-y-3">
              <h3 className="font-semibold text-sm">Delete epic</h3>
              <p className="text-sm text-muted-foreground">
                Delete this epic
                {epic?.sessions && epic.sessions.length > 0
                  ? ` and its ${epic.sessions.length} session${epic.sessions.length > 1 ? "s" : ""}`
                  : ""}
                ? The opencode sessions will remain but won't be tracked as a
                swarm.
              </p>
              <div className="flex justify-end gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setConfirmDelete(false)}
                >
                  Cancel
                </Button>
                <Button variant="destructive" size="sm" onClick={handleDelete}>
                  Delete
                </Button>
              </div>
            </div>
          </div>,
          document.body,
        )}
    </>
  );
}
