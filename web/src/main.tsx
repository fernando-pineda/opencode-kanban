import React, { useState, useEffect } from "react";
import ReactDOM from "react-dom/client";
import "./index.css";
import { SidebarProvider, SidebarInset } from "@/components/ui/sidebar";
import KanbanBoard from "./components/kanban-board";
import BoardSidebar from "./components/board-sidebar";
import TerminalPanel from "./components/terminal-panel";
import SessionDetail from "./components/session-detail";
import { useKanban } from "./hooks/use-kanban";

function App() {
  const { boards, activeBoard, selectBoard, createBoard, removeBoard, connectionStatus, isLoading } = useKanban();
  const [terminalOpen, setTerminalOpen] = useState(false);
  const [selectedSession, setSelectedSession] = useState<string | null>(null);
  const [newSessionDir, setNewSessionDir] = useState<string | null>(null);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "j") {
        e.preventDefault();
        setTerminalOpen(prev => !prev);
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
        connectionStatus={connectionStatus}
      />
      <SidebarInset className="overflow-hidden flex flex-col">
        <main className="flex-1 overflow-hidden min-h-0">
          {activeBoard ? (
            <KanbanBoard board={activeBoard} onCardClick={(id) => { setSelectedSession(id); setNewSessionDir(null); }} onNewSession={handleNewSession} />
          ) : (
            <div className="flex items-center justify-center h-full">
              <div className="text-center space-y-2">
                <h2 className="text-xl font-semibold text-muted-foreground">No board selected</h2>
                <p className="text-sm text-muted-foreground">
                  {boards.length === 0
                    ? "Create a board by running an opencode agent task"
                    : "Select a board from the sidebar"}
                </p>
              </div>
            </div>
          )}
        </main>
        {terminalOpen && activeBoard && (
          <TerminalPanel
            boardId={activeBoard.board.id}
            onClose={() => setTerminalOpen(false)}
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
