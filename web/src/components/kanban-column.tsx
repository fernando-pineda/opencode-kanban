"use client";

import React from "react";
import { useDroppable } from "@dnd-kit/core";
import { Badge } from "@/components/ui/badge";
import { Column, Card as CardType } from "../types";
import KanbanCard from "./kanban-card";
import { useNotifications } from "../hooks/use-notifications";

interface KanbanColumnProps {
  column: Column;
  cards: CardType[];
  onCardClick?: (sessionId: string) => void;
  overId: string | null;
  activeCardId: string | null;
}

const columnDescriptions: Record<string, string> = {
  Backlog: "Planning sessions — new or running with PLAN agent",
  "In Progress": "Active build sessions — running with BUILD agent",
  Done: "Sessions explicitly marked as completed",
  Archived: "Old sessions not updated for over 24 hours",
};

export default function KanbanColumn({
  column,
  cards,
  onCardClick,
  overId,
  activeCardId,
}: KanbanColumnProps) {
  const { hasUnseenSession, markSessionSeen } = useNotifications();
  const { setNodeRef, isOver } = useDroppable({ id: column.name });

  const handleCardClick = (sessionId: string) => {
    markSessionSeen(sessionId);
    onCardClick?.(sessionId);
  };

  const sortedCards = [...cards].sort(
    (a, b) =>
      new Date(b.time_updated).getTime() - new Date(a.time_updated).getTime(),
  );

  // Determine if this column is being hovered by a drag from another column
  // overId could be this column's name (column droppable) or a card's session_id
  const overCardInThisColumn = overId
    ? sortedCards.find((c) => c.session_id === overId)
    : null;

  // Only show the gap if we're actively dragging and the over target is in this column
  // (or hovering the column itself = empty space)
  const showGap = activeCardId !== null && (isOver || overCardInThisColumn);

  return (
    <div
      ref={setNodeRef}
      className={`flex flex-col w-80 h-full min-h-0 flex-shrink-0 rounded-lg transition-colors ${
        isOver ? "bg-accent/30 ring-2 ring-primary/20 ring-inset" : ""
      }`}
    >
      {/* Column Header */}
      <div className="flex-shrink-0 px-4 py-3">
        <div className="flex items-center justify-between gap-2">
          <h2 className="font-semibold text-lg">{column.name}</h2>
          <Badge variant="secondary">{cards.length}</Badge>
        </div>
        <p className="text-xs text-muted-foreground mt-0.5">
          {columnDescriptions[column.name] ?? ""}
        </p>
      </div>

      {/* Cards List */}
      <div className="flex-1 overflow-y-auto min-h-0 px-3 py-2">
        <div className="flex flex-col gap-3">
          {sortedCards.map((card) => (
            <React.Fragment key={card.session_id}>
              {/* Gap indicator before this card */}
              {showGap &&
                overCardInThisColumn?.session_id === card.session_id &&
                card.session_id !== activeCardId && (
                  <div className="flex items-center gap-2 py-1">
                    <div className="flex-1 h-0.5 rounded-full bg-primary/60" />
                  </div>
                )}
              <KanbanCard
                card={card}
                onClick={() => handleCardClick(card.session_id)}
                hasUnseenNotification={hasUnseenSession(card.session_id)}
              />
            </React.Fragment>
          ))}
        </div>
      </div>
    </div>
  );
}
