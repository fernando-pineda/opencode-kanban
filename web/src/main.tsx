import React, { useState, useEffect, useRef } from "react";
import ReactDOM from "react-dom/client";
import "./index.css";
import { SidebarProvider, SidebarInset } from "@/components/ui/sidebar";
import KanbanBoard from "./components/kanban-board";
import BoardSidebar from "./components/board-sidebar";
import TerminalPanel from "./components/terminal-panel";
import SessionDetail from "./components/session-detail";
import { useKanban } from "./hooks/use-kanban";

function App() {
  const {
    boards,
    activeBoard,
    selectBoard,
    createBoard,
    removeBoard,
    reorderBoards,
    connectionStatus,
    isLoading,
  } = useKanban();
  const [terminalOpenMap, setTerminalOpenMap] = useState<
    Record<number, boolean>
  >({});
  const activeBoardIdRef = useRef<number | null>(null);
  const [selectedSession, setSelectedSession] = useState<string | null>(null);
  const [newSessionDir, setNewSessionDir] = useState<string | null>(null);

  // Keep activeBoardId ref in sync
  useEffect(() => {
    activeBoardIdRef.current = activeBoard?.board?.id ?? null;
  }, [activeBoard]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "j") {
        e.preventDefault();
        const boardId = activeBoardIdRef.current;
        if (boardId != null) {
          setTerminalOpenMap((prev) => ({
            ...prev,
            [boardId]: !prev[boardId],
          }));
        }
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-center space-y-2">
          <p className="text-muted-foreground">Loading boards...</p>
        </div>
      </div>
    );
  }

  const handleNewSession = () => {
    if (!activeBoard) return;
    setNewSessionDir(activeBoard.board.repo_path);
  };

  const handleSessionCreated = (sid: string) => {
    setNewSessionDir(null);
    setSelectedSession(sid);
  };

  return (
    <SidebarProvider className="h-full overflow-hidden">
        <BoardSidebar
          boards={boards}
          activeBoard={activeBoard?.board ?? null}
          onSelectBoard={selectBoard}
          onCreateBoard={createBoard}
          onRemoveBoard={removeBoard}
          onReorderBoards={reorderBoards}
          connectionStatus={connectionStatus}
        />
        <SidebarInset className="overflow-hidden flex flex-col">
          <main className="flex-1 overflow-hidden min-h-0">
            {activeBoard ? (
              <KanbanBoard
                board={activeBoard}
                boardId={activeBoard.board.id}
                onCardClick={(id) => {
                  setSelectedSession(id);
                  setNewSessionDir(null);
                }}
                onNewSession={handleNewSession}
              />
            ) : (
              <div className="flex items-center justify-center h-full">
                <div className="text-center space-y-2">
                  <h2 className="text-xl font-semibold text-muted-foreground">
                    No board selected
                  </h2>
                  <p className="text-sm text-muted-foreground">
                    {boards.length === 0
                      ? "Create a board by running an opencode agent task"
                      : "Select a board from the sidebar"}
                  </p>
                </div>
              </div>
            )}
          </main>
          {activeBoard && (
            <TerminalPanel
              boardId={activeBoard.board.id}
              onClose={() =>
                setTerminalOpenMap((prev) => ({
                  ...prev,
                  [activeBoard.board.id]: false,
                }))
              }
              visible={!!terminalOpenMap[activeBoard.board.id]}
            />
          )}
        </SidebarInset>

        <SessionDetail
          sessionId={selectedSession}
          open={!!selectedSession || !!newSessionDir}
          onOpenChange={(open) => {
            if (!open) {
              setSelectedSession(null);
              setNewSessionDir(null);
            }
          }}
          newSessionDirectory={newSessionDir}
          onSessionCreated={handleSessionCreated}
          boardId={activeBoard?.board.id ?? null}
        />

      </SidebarProvider>
  );
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
