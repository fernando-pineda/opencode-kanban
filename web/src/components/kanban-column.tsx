"use client";

import React from "react";
import { Badge } from "@/components/ui/badge";
import { Column, Card as CardType } from "../types";
import KanbanCard from "./kanban-card";
import { useNotifications } from "../hooks/use-notifications";

interface KanbanColumnProps {
  column: Column;
  cards: CardType[];
  onCardClick?: (sessionId: string) => void;
}

const columnDescriptions: Record<string, string> = {
  Backlog: "Planning sessions — new or running with PLAN agent",
  "In Progress": "Active build sessions — running with BUILD agent",
  Done: "Sessions explicitly marked as completed",
  Archived: "Old sessions not updated for over 24 hours",
};

export default function KanbanColumn({ column, cards, onCardClick }: KanbanColumnProps) {
  const { hasUnseenSession, markSessionSeen } = useNotifications();

  const handleCardClick = (sessionId: string) => {
    markSessionSeen(sessionId);
    onCardClick?.(sessionId);
  };

  const sortedCards = [...cards].sort(
    (a, b) => new Date(b.time_updated).getTime() - new Date(a.time_updated).getTime()
  );

  return (
    <div className="flex flex-col w-80 h-full min-h-0 flex-shrink-0">
      {/* Column Header — fixed, does not scroll */}
      <div className="flex-shrink-0 px-4 py-3">
        <div className="flex items-center justify-between gap-2">
          <h2 className="font-semibold text-lg">{column.name}</h2>
          <Badge variant="secondary">{cards.length}</Badge>
        </div>
        <p className="text-xs text-muted-foreground mt-0.5">
          {columnDescriptions[column.name] ?? ""}
        </p>
      </div>

      {/* Cards List — scrollable */}
      <div className="flex-1 overflow-y-auto min-h-0 px-3 py-2">
        <div className="flex flex-col gap-3">
          {sortedCards.map((card) => (
            <KanbanCard
              key={card.session_id}
              card={card}
              onClick={() => handleCardClick(card.session_id)}
              hasUnseenNotification={hasUnseenSession(card.session_id)}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
