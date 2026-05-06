"use client";

import React, { useState, useEffect, useCallback } from "react";
import { Card as CardType } from "../types";
import { useDraggable, useDroppable } from "@dnd-kit/core";
import {
  Loader2,
  CheckCircle2,
  Circle,
  Database,
  ListTodo,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";

interface KanbanCardProps {
  card: CardType;
  onClick?: () => void;
  hasUnseenNotification?: boolean;
}

interface TodoItem {
  content: string;
  status: "pending" | "in_progress" | "completed";
  priority: "high" | "medium" | "low";
}

function formatTokens(tokens: number): string {
  if (tokens >= 1_000_000) return `${(tokens / 1_000_000).toFixed(1)}M`;
  if (tokens >= 1_000) return `${(tokens / 1_000).toFixed(1)}K`;
  return String(tokens);
}

function formatDate(isoDate: string): string {
  const d = new Date(isoDate);
  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  const diffMin = Math.floor(diffMs / 60000);
  if (diffMin < 1) return "just now";
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHrs = Math.floor(diffMin / 60);
  if (diffHrs < 24) return `${diffHrs}h ago`;
  const diffDays = Math.floor(diffHrs / 24);
  if (diffDays < 7) return `${diffDays}d ago`;
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function StatusIcon({
  columnName,
  isCompacting,
  isBusy,
}: {
  columnName: string;
  isCompacting: boolean;
  isBusy?: boolean;
}) {
  if (isBusy) {
    return (
      <Loader2 className="h-4 w-4 text-blue-500 animate-spin flex-shrink-0" />
    );
  }
  if (isCompacting) {
    return (
      <Database className="h-4 w-4 text-amber-500 animate-pulse flex-shrink-0" />
    );
  }
  if (columnName === "Done") {
    return <CheckCircle2 className="h-4 w-4 text-emerald-500 flex-shrink-0" />;
  }
  return <Circle className="h-4 w-4 text-muted-foreground flex-shrink-0" />;
}

function todoStatusIcon(status: string) {
  switch (status) {
    case "completed":
      return <CheckCircle2 className="w-3 h-3 text-green-500 shrink-0" />;
    case "in_progress":
      return (
        <Loader2 className="w-3 h-3 text-blue-500 animate-spin shrink-0" />
      );
    default:
      return <Circle className="w-3 h-3 text-muted-foreground/40 shrink-0" />;
  }
}

function priorityDot(priority: string) {
  const color =
    priority === "high"
      ? "text-red-500"
      : priority === "medium"
        ? "text-yellow-500"
        : "text-muted-foreground";
  const symbol = priority === "high" ? "●" : priority === "medium" ? "◑" : "○";
  return <span className={`text-[10px] shrink-0 ${color}`}>{symbol}</span>;
}

export default function KanbanCard({
  card,
  onClick,
  hasUnseenNotification,
}: KanbanCardProps) {
  const columnName = card.column_name || "";
  const subtasks = card.subtasks || [];
  const [todos, setTodos] = useState<TodoItem[]>([]);

  const {
    attributes,
    listeners,
    setNodeRef: setDraggableRef,
    isDragging,
  } = useDraggable({
    id: card.session_id,
  });

  const { setNodeRef: setDroppableRef } = useDroppable({
    id: card.session_id,
  });

  const combinedRef = useCallback(
    (node: HTMLElement | null) => {
      setDraggableRef(node);
      setDroppableRef(node);
    },
    [setDraggableRef, setDroppableRef],
  );

  const style: React.CSSProperties = {
    opacity: isDragging ? 0.3 : 1,
  };

  // Fetch todos from opencode API — poll to stay in sync with agent updates
  useEffect(() => {
    let cancelled = false;
    const fetchTodos = () => {
      fetch(`/api/opencode/session/${card.session_id}/todo`)
        .then((res) => (res.ok ? res.json() : []))
        .then((data) => {
          if (!cancelled) setTodos(Array.isArray(data) ? data : []);
        })
        .catch(() => {});
    };
    // Initial fetch
    fetchTodos();
    // Poll: faster when busy (agent actively working), slower when idle
    const interval = setInterval(fetchTodos, card.is_busy ? 3000 : 10000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [card.session_id, card.is_busy]);

  const todoDone = todos.filter((t) => t.status === "completed").length;

  // Group subtasks by repository
  const grouped: Record<string, typeof subtasks> = {};
  for (const st of subtasks) {
    const key = st.repository || "unknown";
    if (!grouped[key]) grouped[key] = [];
    grouped[key].push(st);
  }

  return (
    <div
      ref={combinedRef}
      style={style}
      className="relative rounded-lg border bg-card p-3 hover:bg-accent/50 transition-colors cursor-grab active:cursor-grabbing select-none"
      onClick={onClick}
      {...attributes}
      {...listeners}
    >
      {hasUnseenNotification && !card.is_busy && (
        <div className="absolute top-3 right-3 w-2 h-2 rounded-full bg-red-500 animate-pulse shadow-[0_0_6px_rgba(239,68,68,0.5)]" />
      )}

      {/* ── Regular session card ── */}
      <div>
        <div className="flex items-start gap-3">
          <StatusIcon
            columnName={columnName}
            isCompacting={card.is_compacting}
            isBusy={card.is_busy}
          />
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <div className="text-sm font-medium line-clamp-2">
                {card.title}
              </div>
            </div>

            {/* Full TODO list */}
            {todos.length > 0 && (
              <div className="mt-2">
                <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-muted-foreground font-medium mb-1.5">
                  <ListTodo className="w-3 h-3" />
                  <span>Todos</span>
                  <span className="text-muted-foreground/70 ml-1">
                    {todoDone}/{todos.length}
                  </span>
                  {todoDone === todos.length && (
                    <CheckCircle2 className="w-2.5 h-2.5 text-green-500" />
                  )}
                </div>
                <div className="space-y-1">
                  {todos.map((todo, i) => (
                    <div
                      key={i}
                      className={`flex items-center gap-1.5 text-[11px] ${
                        todo.status === "completed"
                          ? "text-muted-foreground line-through"
                          : ""
                      }`}
                    >
                      {todoStatusIcon(todo.status)}
                      <span
                        className={`flex-1 min-w-0 line-clamp-1 leading-snug ${
                          todo.status === "in_progress"
                            ? "font-medium text-foreground"
                            : ""
                        }`}
                      >
                        {todo.content}
                      </span>
                      {priorityDot(todo.priority)}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {subtasks.length > 0 && (
              <div className="mt-2">
                <div className="text-[10px] uppercase tracking-wider text-foreground font-medium mb-1 mt-4">
                  Subtasks
                </div>
                <div className="space-y-3">
                  {Object.entries(grouped).map(([repo, tasks]) => (
                    <div key={repo}>
                      <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium mb-1.5 flex items-center gap-1.5">
                        <span className="w-1 bg-muted-foreground/30 flex-shrink-0 self-stretch rounded-full" />
                        {repo}
                      </div>
                      <div className="space-y-1.5 pl-2">
                        {tasks.map((subtask) => (
                          <div
                            key={subtask.id}
                            className="text-xs text-muted-foreground flex items-start gap-1.5"
                          >
                            <span className="w-1 bg-muted-foreground/30 flex-shrink-0 self-stretch rounded-full" />
                            <div className="flex flex-col">
                              <span className="text-foreground font-semibold">
                                {subtask.agent_name}
                              </span>
                              <span className="text-foreground/80">
                                {subtask.title}
                              </span>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Bottom bar: date (left) and tokens (right) */}
        <div className="mt-2 pt-2 border-t border-border/50 flex items-center justify-between">
          <span className="text-[10px] text-muted-foreground">
            {formatDate(card.time_updated)}
          </span>
          <span className="text-[10px] text-muted-foreground">
            {card.context_tokens > 0
              ? `${formatTokens(card.context_tokens)} tokens`
              : ""}
          </span>
        </div>
      </div>
    </div>
  );
}
