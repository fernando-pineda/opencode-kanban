"use client";

import React, { useState, useCallback, useMemo } from "react";
import {
  DndContext,
  DragOverlay,
  closestCenter,
  PointerSensor,
  useSensor,
  useSensors,
  type DragStartEvent,
  type DragEndEvent,
  type DragOverEvent,
} from "@dnd-kit/core";
import { BoardFull, Card } from "../types";
import KanbanColumn from "./kanban-column";
import MemoriesSheet from "./memories-sheet";
import GithubSheet from "./github-sheet";
import LinearSheet from "./linear-sheet";
import JiraSheet from "./jira-sheet";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { Input } from "@/components/ui/input";
import {
  Brain,
  Database,
  Github,
  Loader2,
  PlusCircle,
  Search,
} from "lucide-react";
import { useFileIndexing } from "@/hooks/use-file-indexing";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";

interface KanbanBoardProps {
  board: BoardFull;
  boardId: number;
  onCardClick?: (sessionId: string) => void;
  onNewSession?: () => void;
}

export default function KanbanBoard({
  board,
  boardId,
  onCardClick,
  onNewSession,
}: KanbanBoardProps) {
  const [memoriesOpen, setMemoriesOpen] = useState(false);
  const [githubOpen, setGithubOpen] = useState(false);
  const [linearOpen, setLinearOpen] = useState(false);
  const [jiraOpen, setJiraOpen] = useState(false);
  const {
    status: indexingStatus,
    progress: indexingProgress,
    startIndexing,
    stopIndexing,
    loading: indexingLoading,
  } = useFileIndexing(boardId);
  const [activeCard, setActiveCard] = useState<Card | null>(null);
  const [overId, setOverId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        delay: 200,
        tolerance: 5,
      },
    }),
  );

  const handleDragStart = useCallback(
    (event: DragStartEvent) => {
      const card = board.cards.find((c) => c.session_id === event.active.id);
      setActiveCard(card ?? null);
    },
    [board.cards],
  );

  const handleDragOver = useCallback((event: DragOverEvent) => {
    const { over } = event;
    setOverId(over ? String(over.id) : null);
  }, []);

  const handleDragEnd = useCallback(
    async (event: DragEndEvent) => {
      const { active, over } = event;
      setActiveCard(null);
      setOverId(null);

      if (!over) return;

      const activeCardData = board.cards.find(
        (c) => c.session_id === active.id,
      );
      if (!activeCardData) return;

      // over.id could be a column name (useDroppable) or a card id (useDroppable on card)
      let targetColumnName: string | null = null;

      // Check if dropped on a column
      const targetColumn = board.columns.find(
        (col) => col.name === String(over.id),
      );
      if (targetColumn) {
        targetColumnName = targetColumn.name;
      } else {
        // Dropped on a card — find that card's column
        const overCard = board.cards.find((c) => c.session_id === over.id);
        if (overCard) {
          targetColumnName = overCard.column_name;
        }
      }

      if (!targetColumnName) return;

      if (activeCardData.column_name !== targetColumnName) {
        try {
          await fetch(`/api/sessions/${activeCardData.session_id}/move`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              to_column_name: targetColumnName,
              board_id: boardId,
            }),
          });
        } catch {
          // Board will re-fetch on next polling cycle
        }
      }
    },
    [board.cards, board.columns, boardId],
  );

  // Compute filtered cards based on search query
  const filteredCards = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return board.cards;

    return board.cards.filter((card) => {
      // Match card title
      if (card.title.toLowerCase().includes(q)) return true;
      // Match card description
      if (card.description?.toLowerCase().includes(q)) return true;
      return false;
    });
  }, [board.cards, searchQuery]);

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Board Header — fixed, full width */}
      <div className="flex-shrink-0 px-6 pt-3 pb-2 flex items-start justify-between border-b">
        <div className="min-w-0">
          <h1 className="text-xl font-bold truncate">{board.board.name}</h1>
          <p className="text-xs text-muted-foreground mt-0.5 truncate font-mono">
            {board.board.repo_path}
          </p>
        </div>
        <TooltipProvider delayDuration={300}>
          <div className="flex items-center gap-1 shrink-0 mt-0.5">
            <div className="flex items-center gap-2 mr-1">
              <Search className="h-4 w-4 text-muted-foreground shrink-0" />
              <Input
                placeholder="Filter cards..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="h-7 w-44 text-xs border-0 shadow-none focus-visible:ring-0 bg-accent/50"
              />
            </div>
            <Popover>
              <Tooltip>
                <TooltipTrigger asChild>
                  <PopoverTrigger asChild>
                    <button
                      className={`p-1.5 rounded-md transition-colors relative ${
                        indexingStatus?.status === "indexing"
                          ? "text-blue-500 hover:text-blue-600 bg-blue-500/10"
                          : indexingStatus?.status === "watching"
                            ? "text-green-500 hover:text-green-600 bg-green-500/10"
                            : indexingStatus?.status === "error"
                              ? "text-destructive hover:text-destructive bg-destructive/10"
                              : "text-muted-foreground hover:text-foreground hover:bg-accent"
                      }`}
                    >
                      {indexingStatus?.status === "indexing" ? (
                        <Loader2 className="h-5 w-5 animate-spin" />
                      ) : (
                        <Database className="h-5 w-5" />
                      )}
                      {indexingStatus && indexingStatus.total_files > 0 && (
                        <span className="absolute -top-1 -right-1 text-[9px] font-mono bg-muted rounded-full px-1 leading-none">
                          {indexingStatus.total_files}
                        </span>
                      )}
                    </button>
                  </PopoverTrigger>
                </TooltipTrigger>
                <TooltipContent side="bottom" className="text-xs">
                  File Indexing
                </TooltipContent>
              </Tooltip>
              <PopoverContent className="w-72 p-3" align="end">
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-semibold">File Indexing</span>
                    <span className="text-xs text-muted-foreground capitalize">
                      {indexingStatus?.status || "idle"}
                    </span>
                  </div>

                  {indexingProgress && (
                    <div className="space-y-1">
                      <div className="flex justify-between text-xs text-muted-foreground">
                        <span>Indexing: {indexingProgress.current_file}</span>
                        <span>
                          {indexingProgress.indexed}/{indexingProgress.total}
                        </span>
                      </div>
                      <div className="w-full h-1.5 bg-muted rounded-full overflow-hidden">
                        <div
                          className="h-full bg-primary rounded-full transition-all"
                          style={{
                            width: `${indexingProgress.total > 0 ? (indexingProgress.indexed / indexingProgress.total) * 100 : 0}%`,
                          }}
                        />
                      </div>
                    </div>
                  )}

                  {indexingStatus && (
                    <div className="grid grid-cols-2 gap-2 text-xs">
                      <div>
                        <span className="text-muted-foreground">Files:</span>{" "}
                        {indexingStatus.total_files}
                      </div>
                      <div>
                        <span className="text-muted-foreground">Chunks:</span>{" "}
                        {indexingStatus.total_chunks}
                      </div>
                    </div>
                  )}

                  <div className="flex gap-2">
                    {(!indexingStatus ||
                      indexingStatus.status === "idle" ||
                      indexingStatus.status === "error") && (
                      <button
                        onClick={startIndexing}
                        disabled={indexingLoading}
                        className="flex-1 inline-flex items-center justify-center gap-1 rounded-md border px-3 py-1.5 text-xs font-medium hover:bg-accent transition-colors disabled:opacity-50"
                      >
                        {indexingLoading && (
                          <Loader2 className="h-3 w-3 animate-spin" />
                        )}
                        Start Indexing
                      </button>
                    )}
                    {(indexingStatus?.status === "watching" ||
                      indexingStatus?.status === "indexing") && (
                      <button
                        onClick={stopIndexing}
                        className="flex-1 inline-flex items-center justify-center rounded-md border px-3 py-1.5 text-xs font-medium hover:bg-accent transition-colors"
                      >
                        Stop
                      </button>
                    )}
                  </div>
                </div>
              </PopoverContent>
            </Popover>
            {[
              {
                icon: Brain,
                label: "Memories",
                onClick: () => setMemoriesOpen(true),
              },
              {
                icon: Github,
                label: "GitHub",
                onClick: () => setGithubOpen(true),
              },
              {
                icon: null,
                label: "Linear",
                onClick: () => setLinearOpen(true),
                customIcon: true,
              },
              {
                icon: null,
                label: "JIRA",
                onClick: () => setJiraOpen(true),
                customIcon: true,
              },
              {
                icon: PlusCircle,
                label: "New Session",
                onClick: onNewSession || (() => {}),
              },
            ].map(({ icon: Icon, label, onClick, customIcon }) => (
              <Tooltip key={label}>
                <TooltipTrigger asChild>
                  <button
                    onClick={onClick}
                    className="p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
                  >
                    {customIcon && label === "JIRA" ? (
                      <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none">
                        <rect
                          x="2"
                          y="2"
                          width="20"
                          height="20"
                          rx="4"
                          fill="#0052CC"
                        />
                        <path
                          d="M11.65 5.01c-.5.06-.93.37-1.14.81l-3.5 7.27a.75.75 0 0 0 .67 1.08h3.32v4.33a.5.5 0 0 0 .93.25l3.5-7.27a.75.75 0 0 0-.67-1.08H11.5V5.26a.5.5 0 0 0-.35-.48.49.49 0 0 0-.5.23z"
                          fill="white"
                        />
                      </svg>
                    ) : customIcon ? (
                      <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none">
                        <rect
                          x="2"
                          y="2"
                          width="20"
                          height="20"
                          rx="4"
                          fill="#5E6AD2"
                        />
                        <path
                          d="M8 7h2.5l3 5.5V7H16v10h-2.5l-3-5.5V17H8V7z"
                          fill="white"
                        />
                      </svg>
                    ) : Icon ? (
                      <Icon className="h-5 w-5" />
                    ) : null}
                  </button>
                </TooltipTrigger>
                <TooltipContent side="bottom" className="text-xs">
                  {label}
                </TooltipContent>
              </Tooltip>
            ))}
          </div>
        </TooltipProvider>
      </div>

      {/* Columns Container — scrollable horizontally */}
      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragStart={handleDragStart}
        onDragOver={handleDragOver}
        onDragEnd={handleDragEnd}
      >
        <DragOverlay dropAnimation={null}>
          {activeCard ? (
            <div className="w-[280px] rounded-lg border bg-card p-3 shadow-2xl opacity-95 rotate-1">
              <div className="flex items-start gap-3">
                <div className="text-sm font-medium line-clamp-2">
                  {activeCard.title}
                </div>
              </div>
            </div>
          ) : null}
        </DragOverlay>
        <div className="flex-1 overflow-x-auto overflow-y-hidden min-h-0">
          <div className="flex gap-6 px-6 pb-4 h-full min-h-0">
            {board.columns.map((column) => {
              const columnCards = filteredCards.filter(
                (card) => card.column_name === column.name,
              );
              return (
                <KanbanColumn
                  key={column.id}
                  column={column}
                  cards={columnCards}
                  onCardClick={onCardClick}
                  overId={overId}
                  activeCardId={activeCard?.session_id ?? null}
                  searchQuery={searchQuery}
                />
              );
            })}
          </div>
        </div>
      </DndContext>

      <MemoriesSheet
        repoPath={board.board.repo_path}
        open={memoriesOpen}
        onOpenChange={setMemoriesOpen}
      />
      <GithubSheet
        boardId={boardId}
        open={githubOpen}
        onOpenChange={setGithubOpen}
      />
      <LinearSheet
        boardId={boardId}
        open={linearOpen}
        onOpenChange={setLinearOpen}
      />
      <JiraSheet boardId={boardId} open={jiraOpen} onOpenChange={setJiraOpen} />
    </div>
  );
}
