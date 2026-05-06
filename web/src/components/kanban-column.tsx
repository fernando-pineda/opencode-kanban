"use client";

import React from "react";
import { Badge } from "@/components/ui/badge";
import { Column, Card as CardType, Epic } from "../types";
import KanbanCard from "./kanban-card";
import EpicCard from "./epic-card";
import { useNotifications } from "../hooks/use-notifications";

interface KanbanColumnProps {
  column: Column;
  cards: CardType[];
  epics?: Epic[];
  onCardClick?: (sessionId: string) => void;
  onEpicClick?: (epicId: number) => void;
}

const columnDescriptions: Record<string, string> = {
  Backlog: "Planning sessions — new or running with PLAN agent",
  "In Progress": "Active build sessions — running with BUILD agent",
  Done: "Sessions explicitly marked as completed",
  Archived: "Old sessions not updated for over 24 hours",
};

export default function KanbanColumn({ column, cards, epics = [], onCardClick, onEpicClick }: KanbanColumnProps) {
  const { hasUnseenSession, markSessionSeen } = useNotifications();

  const handleCardClick = (sessionId: string) => {
    markSessionSeen(sessionId);
    onCardClick?.(sessionId);
  };

  // Epics pinned at top, sorted by created_at (oldest first — stable, doesn't shift on updates)
  const sortedEpics = [...epics].sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());

  // Split cards: epic-related vs standalone
  const epicCards = [...cards].filter((c) => c.epic_task_key);
  const regularCards = [...cards].filter((c) => !c.epic_task_key);

  // Sort both by updated_at (most recent first)
  const sortByUpdated = (a: CardType, b: CardType) => new Date(b.time_updated).getTime() - new Date(a.time_updated).getTime();
  epicCards.sort(sortByUpdated);
  regularCards.sort(sortByUpdated);

  // Group epic cards by their epic task_key prefix (e.g. "OK-2.1" → epic "OK-2")
  const epicTaskKeyMap = new Map<string, CardType[]>();
  for (const card of epicCards) {
    const key = card.epic_task_key!;
    if (!epicTaskKeyMap.has(key)) epicTaskKeyMap.set(key, []);
    epicTaskKeyMap.get(key)!.push(card);
  }

  const totalCount = cards.length + epics.length;

  return (
    <div className="flex flex-col w-80 h-full min-h-0 flex-shrink-0">
      {/* Column Header — fixed, does not scroll */}
      <div className="flex-shrink-0 px-4 py-3">
        <div className="flex items-center justify-between gap-2">
          <h2 className="font-semibold text-lg">{column.name}</h2>
          <Badge variant="secondary">{totalCount}</Badge>
        </div>
        <p className="text-xs text-muted-foreground mt-0.5">
          {columnDescriptions[column.name] ?? ""}
        </p>
      </div>

      {/* Cards List — scrollable */}
      <div className="flex-1 overflow-y-auto min-h-0 px-3 py-2">
        <div className="flex flex-col gap-3">
          {/* Epic groups — each epic + its related session cards in a container */}
          {sortedEpics.map((epic) => (
            <div
              key={`epic-group-${epic.id}`}
              className="rounded-lg bg-muted/20 p-2 space-y-2"
            >
              <EpicCard
                epic={epic}
                onClick={() => onEpicClick?.(epic.id)}
              />
               {(epicTaskKeyMap.get(epic.task_key) || []).map((card) => (
                 <KanbanCard
                   key={card.session_id}
                   card={card}
                   onClick={() => handleCardClick(card.session_id)}
                   hasUnseenNotification={hasUnseenSession(card.session_id)}
                 />
               ))}
            </div>
          ))}

          {/* Epic session cards not matched to any epic in this column (orphaned) */}
          {(() => {
            const matchedIds = new Set(
              sortedEpics.flatMap((epic) =>
                (epicTaskKeyMap.get(epic.task_key) || []).map((c) => c.session_id)
              )
            );
            return epicCards
              .filter((c) => !matchedIds.has(c.session_id))
               .map((card) => (
                 <KanbanCard
                   key={card.session_id}
                   card={card}
                   onClick={() => handleCardClick(card.session_id)}
                   hasUnseenNotification={hasUnseenSession(card.session_id)}
                 />
               ));
          })()}

          {/* Regular session cards */}
           {regularCards.map((card) => (
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
