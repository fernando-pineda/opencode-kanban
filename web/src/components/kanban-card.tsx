"use client";

import React, { useCallback } from "react";
import { Card as CardType } from "../types";
import { useDraggable, useDroppable } from "@dnd-kit/core";
import {
  Loader2,
  CheckCircle2,
  Circle,
  Database,
} from "lucide-react";

interface KanbanCardProps {
  card: CardType;
  onClick?: () => void;
  searchQuery?: string;
}

function HighlightText({ text, query }: { text: string; query?: string }) {
  if (!query || !query.trim()) return <>{text}</>;
  const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const regex = new RegExp(`(${escaped})`, "gi");
  const parts = text.split(regex);
  return (
    <>
      {parts.map((part, i) =>
        regex.test(part) ? (
          <mark
            key={i}
            className="bg-yellow-200/80 text-foreground rounded-sm px-0.5"
          >
            {part}
          </mark>
        ) : (
          <span key={i}>{part}</span>
        ),
      )}
    </>
  );
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

export default function KanbanCard({
  card,
  onClick,
  searchQuery,
}: KanbanCardProps) {
  const columnName = card.column_name || "";

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

  return (
    <div
      ref={combinedRef}
      style={style}
      className="relative rounded-lg border bg-card p-3 hover:bg-accent/50 transition-colors cursor-grab active:cursor-grabbing select-none"
      onClick={onClick}
      {...attributes}
      {...listeners}
    >
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
                <HighlightText text={card.title} query={searchQuery} />
              </div>
            </div>

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
