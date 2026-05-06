"use client";

import React from "react";
import { Badge } from "@/components/ui/badge";
import { Epic, EpicSession } from "../types";
import {
  Loader2,
  CheckCircle2,
  XCircle,
  Trash2,
  ListTodo,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

interface EpicCardProps {
  epic: Epic;
  onClick?: () => void;
  onDelete?: (epicId: number) => void;
}

/* ── Status icon (left column) ── */

function EpicStatusIcon({ status }: { status: string }) {
  switch (status) {
    case "planning":
    case "spawning":
      return (
        <Loader2 className="h-4 w-4 text-purple-500 animate-spin flex-shrink-0" />
      );
    case "ready":
      return (
        <span className="text-base leading-none flex-shrink-0">🐝</span>
      );
    case "running":
      return (
        <span className="text-base leading-none flex-shrink-0">🐝</span>
      );
    case "completed":
      return (
        <CheckCircle2 className="h-4 w-4 text-emerald-500 flex-shrink-0" />
      );
    case "failed":
      return <XCircle className="h-4 w-4 text-red-500 flex-shrink-0" />;
    default:
      return (
        <span className="text-base leading-none flex-shrink-0">🐝</span>
      );
  }
}

/* ── Session status icon ── */

function sessionStatusIcon(session: EpicSession) {
  if (session.is_busy) {
    return (
      <Loader2 className="w-3 h-3 text-blue-500 animate-spin shrink-0" />
    );
  }
  return <CheckCircle2 className="w-3 h-3 text-green-500 shrink-0" />;
}

/* ── Status label config ── */

const statusLabel: Record<string, { label: string; color: string }> = {
  planning: { label: "Planning…", color: "text-purple-500" },
  ready: { label: "Ready to spawn", color: "text-amber-500" },
  spawning: { label: "Creating…", color: "text-purple-500" },
  running: { label: "Running", color: "text-blue-500" },
  completed: { label: "Completed", color: "text-green-500" },
  failed: { label: "Failed", color: "text-red-500" },
};

/* ── Flying bees — overlaid on the entire card ── */

function FlyingBees({ count }: { count: number }) {
  const bees = Math.min(count * 3, 20);
  return (
    <>
      {/* Per-bee keyframes — each bee gets its own path */}
      <style>{`
        @keyframes bee-fly-0 {
          0%   { left: -15%; top: -20%; transform: scaleX(1); }
          25%  { left: 45%;  top: -30%; transform: scaleX(1); }
          50%  { left: 90%;  top: 10%;  transform: scaleX(-1); }
          75%  { left: 40%;  top: 50%;  transform: scaleX(-1); }
          100% { left: -15%; top: -20%; transform: scaleX(1); }
        }
        @keyframes bee-fly-1 {
          0%   { left: 80%; top: -25%; transform: scaleX(-1); }
          20%  { left: 20%; top: 40%;  transform: scaleX(1); }
          50%  { left: 95%; top: 55%;  transform: scaleX(1); }
          80%  { left: -10%; top: -10%; transform: scaleX(-1); }
          100% { left: 80%; top: -25%; transform: scaleX(-1); }
        }
        @keyframes bee-fly-2 {
          0%   { left: 50%;  top: 60%; transform: scaleX(1); }
          30%  { left: -20%; top: -15%; transform: scaleX(-1); }
          60%  { left: 70%;  top: -25%; transform: scaleX(1); }
          85%  { left: 110%; top: 45%;  transform: scaleX(-1); }
          100% { left: 50%;  top: 60%; transform: scaleX(1); }
        }
        @keyframes bee-fly-3 {
          0%   { left: 110%; top: 30%;  transform: scaleX(-1); }
          25%  { left: 40%;  top: -30%; transform: scaleX(1); }
          55%  { left: -10%; top: 50%;  transform: scaleX(1); }
          80%  { left: 75%;  top: 65%;  transform: scaleX(-1); }
          100% { left: 110%; top: 30%;  transform: scaleX(-1); }
        }
        @keyframes bee-fly-4 {
          0%   { left: -20%; top: 55%; transform: scaleX(1); }
          35%  { left: 80%;  top: -20%; transform: scaleX(-1); }
          65%  { left: 15%;  top: -10%; transform: scaleX(1); }
          90%  { left: 100%; top: 60%;  transform: scaleX(-1); }
          100% { left: -20%; top: 55%; transform: scaleX(1); }
        }
        @keyframes bee-fly-5 {
          0%   { left: 60%;  top: -30%; transform: scaleX(-1); }
          20%  { left: -15%; top: 35%;  transform: scaleX(1); }
          45%  { left: 105%; top: 65%;  transform: scaleX(1); }
          70%  { left: 30%;  top: -15%; transform: scaleX(-1); }
          100% { left: 60%;  top: -30%; transform: scaleX(-1); }
        }
        @keyframes bee-fly-6 {
          0%   { left: -10%; top: -10%; transform: scaleX(1); }
          30%  { left: 70%;  top: 60%;  transform: scaleX(-1); }
          60%  { left: 100%; top: -20%; transform: scaleX(1); }
          80%  { left: 20%;  top: 50%;  transform: scaleX(-1); }
          100% { left: -10%; top: -10%; transform: scaleX(1); }
        }
        @keyframes bee-fly-7 {
          0%   { left: 95%;  top: 55%; transform: scaleX(-1); }
          25%  { left: -15%; top: -25%; transform: scaleX(1); }
          50%  { left: 50%;  top: 70%;  transform: scaleX(1); }
          75%  { left: 105%; top: -10%; transform: scaleX(-1); }
          100% { left: 95%;  top: 55%; transform: scaleX(-1); }
        }
      `}</style>
      {Array.from({ length: bees }).map((_, i) => (
        <span
          key={i}
          className="absolute text-sm pointer-events-none select-none"
          style={{
            animation: `bee-fly-${i % 8} ${3 + i * 0.5}s ease-in-out infinite`,
            animationDelay: `${i * 0.4}s`,
            zIndex: 1,
          }}
        >
          🐝
        </span>
      ))}
    </>
  );
}

/* ── Helpers ── */

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

/* ── Main component ── */

export default function EpicCard({ epic, onClick, onDelete }: EpicCardProps) {
  const handleDelete = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (confirm(`Delete epic ${epic.task_key}?`)) {
      fetch(`/api/epics/${epic.id}`, { method: "DELETE" })
        .then((res) => {
          if (res.ok) {
            toast.success("Epic deleted");
            onDelete?.(epic.id);
          } else {
            toast.error("Failed to delete epic");
          }
        })
        .catch(() => toast.error("Error deleting epic"));
    }
  };

  const sessions = epic.sessions || [];
  const total = sessions.length;
  const busyCount = sessions.filter((s) => s.is_busy).length;
  const completedCount = total - busyCount;
  const config = statusLabel[epic.status] || statusLabel.planning;

  const isActive =
    epic.status === "spawning" || epic.status === "running";

  return (
    <div
      onClick={onClick}
      className={cn(
        "relative rounded-lg bg-transparent p-3 transition-all cursor-pointer",
      )}
    >
      {/* Flying bees — positioned across the entire card */}
      {isActive && busyCount > 0 && <FlyingBees count={busyCount} />}

      {/* Content layer — above bees */}
      <div className="relative" style={{ zIndex: 2 }}>
        <div className="flex items-start gap-3">
          {/* Left icon column */}
          <EpicStatusIcon status={epic.status} />

          <div className="flex-1 min-w-0">
            {/* Title + status label */}
            <div className="flex items-start justify-between gap-2">
              <div className="text-sm font-medium line-clamp-2 flex-1 min-w-0">
                {epic.title}
              </div>
              <div className="flex items-center gap-1.5 shrink-0">
                {onDelete && (
                  <button
                    onClick={handleDelete}
                    className="p-0.5 rounded text-muted-foreground/40 hover:text-destructive transition-colors"
                  >
                    <Trash2 className="w-3 h-3" />
                  </button>
                )}
                <span className={cn("text-[10px] font-medium", config.color)}>
                  {config.label}
                </span>
              </div>
            </div>

            {/* Description (truncated) */}
            {epic.description && epic.description !== epic.title && (
              <p className="text-xs text-muted-foreground line-clamp-2 mt-0.5">
                {epic.description}
              </p>
            )}
          </div>
        </div>

        {/* Sessions container — grouped with light background */}
        {total > 0 && (
          <div className="mt-2 rounded-md bg-muted/30 px-2.5 py-2">
            <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-muted-foreground font-medium mb-1.5">
              <ListTodo className="w-3 h-3" />
              <span>Sessions</span>
              <span className="text-muted-foreground/70 ml-1">
                {completedCount}/{total}
              </span>
              {completedCount === total && total > 0 && (
                <CheckCircle2 className="w-2.5 h-2.5 text-green-500" />
              )}
            </div>
            <div className="space-y-1">
              {sessions.slice(0, 5).map((s) => (
                <div
                  key={s.id}
                  className="flex items-center gap-1.5 text-[11px]"
                >
                  {sessionStatusIcon(s)}
                  <span className="font-mono font-bold text-amber-600 dark:text-amber-400 text-[10px] shrink-0">
                    {s.task_key}
                  </span>
                  <span className="flex-1 min-w-0 line-clamp-1 leading-snug">
                    {s.title}
                  </span>
                </div>
              ))}
              {total > 5 && (
                <div className="text-[10px] text-muted-foreground pl-4">
                  +{total - 5} more
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Bottom bar — date left, task key tag right */}
      <div className="relative mt-2 pt-2 border-t border-border/50 flex items-center justify-between" style={{ zIndex: 2 }}>
        <span className="text-[10px] text-muted-foreground">
          {formatDate(epic.updated_at)}
        </span>
        <Badge
          variant="secondary"
          className="text-[9px] font-mono font-bold bg-amber-500/15 text-amber-600 dark:text-amber-400 hover:bg-amber-500/20 border-0"
        >
          {epic.task_key}
        </Badge>
      </div>
    </div>
  );
}
