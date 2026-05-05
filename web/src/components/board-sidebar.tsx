"use client";

import React, { useState, useCallback } from "react";
import ReactDOM from "react-dom";
import {
  Sidebar,
  SidebarContent,
  SidebarHeader,
  SidebarGroup,
  SidebarGroupLabel,
  SidebarGroupContent,
  SidebarMenu,
  SidebarMenuItem,
  SidebarMenuButton,
  SidebarTrigger,
  SidebarFooter,
} from "@/components/ui/sidebar";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { Board } from "../types";
import { Trash2, Settings, Plus } from "lucide-react";
import SettingsDialog from "./settings-dialog";
import WorkspacePicker from "./workspace-picker";

interface BoardSidebarProps {
  boards: Board[];
  activeBoard: Board | null;
  onSelectBoard: (board: Board) => void;
  onCreateBoard: (repoPath: string) => Promise<Board | null>;
  onRemoveBoard: (boardId: number) => Promise<void>;
  connectionStatus: "connected" | "connecting" | "disconnected";
}

const statusColors: Record<string, string> = {
  connected: "bg-emerald-500",
  connecting: "bg-amber-500",
  disconnected: "bg-destructive",
};

export default function BoardSidebar({
  boards,
  activeBoard,
  onSelectBoard,
  onCreateBoard,
  onRemoveBoard,
  connectionStatus,
}: BoardSidebarProps) {
  const [pickerOpen, setPickerOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState<Board | null>(null);

  const handleConfirmRemove = useCallback(async () => {
    if (confirmRemove) {
      await onRemoveBoard(confirmRemove.id);
      setConfirmRemove(null);
    }
  }, [confirmRemove, onRemoveBoard]);
  return (
    <Sidebar collapsible="icon">
      <SidebarHeader>
        <div className="flex flex-row items-center gap-2 group-data-[collapsible=icon]:justify-center">
          <div className="flex-1 min-w-0 flex items-center gap-2 group-data-[collapsible=icon]:hidden">
            <Tooltip>
              <TooltipTrigger asChild>
                <div
                  className={`w-2 h-2 rounded-full flex-shrink-0 cursor-default ${statusColors[connectionStatus]}`}
                />
              </TooltipTrigger>
              <TooltipContent side="right" className="text-xs">
                {connectionStatus === "connected"
                  ? "Backend connected"
                  : connectionStatus === "connecting"
                    ? "Backend connecting…"
                    : "Backend disconnected"}
              </TooltipContent>
            </Tooltip>
            <h1 className="text-sm font-bold truncate">OpenCode Kanban</h1>
          </div>
          <SidebarTrigger className="-mr-2 group-data-[collapsible=icon]:mr-0" />
        </div>
      </SidebarHeader>

      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel className="group-data-[collapsible=icon]:hidden">
            Boards
          </SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {boards.map((board) => (
                <SidebarMenuItem key={board.id}>
                  <ContextMenu>
                    <ContextMenuTrigger asChild>
                      <SidebarMenuButton
                        isActive={activeBoard?.id === board.id}
                        onClick={() => onSelectBoard(board)}
                        className="cursor-pointer group-data-[collapsible=icon]:data-[active=true]:bg-transparent"
                        tooltip={board.name}
                      >
                        <span className="flex items-center justify-center w-5 h-5 rounded bg-foreground text-background text-xs font-bold flex-shrink-0">
                          {board.name.charAt(0).toUpperCase()}
                        </span>
                        <span className="flex-1 min-w-0 group-data-[collapsible=icon]:hidden">
                          <div className="font-medium truncate">{board.name}</div>
                        </span>
                      </SidebarMenuButton>
                    </ContextMenuTrigger>
                    <ContextMenuContent>
                      <ContextMenuItem
                        variant="destructive"
                        onClick={() => setConfirmRemove(board)}
                      >
                        <Trash2 className="h-4 w-4" />
                        Remove workspace
                      </ContextMenuItem>
                    </ContextMenuContent>
                  </ContextMenu>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>

      <SidebarFooter>
        <div className="border-t border-sidebar-border my-1 group-data-[collapsible=icon]:hidden" />
        <button
           onClick={() => setPickerOpen(true)}
           title="Add workspace"
           className="flex w-full items-center gap-2 rounded-md p-3 text-xs text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground transition-colors cursor-pointer group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:p-0 group-data-[collapsible=icon]:size-7"
         >
          <Plus className="h-4 w-4 shrink-0" />
          <span className="flex-1 text-left truncate group-data-[collapsible=icon]:hidden">
            Add workspace
          </span>
        </button>
        <button
           onClick={() => setSettingsOpen(true)}
           title="Settings"
           className="flex w-full items-center gap-2 rounded-md p-3 text-xs text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground transition-colors cursor-pointer group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:p-0 group-data-[collapsible=icon]:size-7"
         >
          <Settings className="h-4 w-4 shrink-0" />
          <span className="flex-1 text-left truncate group-data-[collapsible=icon]:hidden">
            Settings
          </span>
        </button>
      </SidebarFooter>

      <SettingsDialog open={settingsOpen} onOpenChange={setSettingsOpen} />

      <WorkspacePicker
        open={pickerOpen}
        onOpenChange={setPickerOpen}
        onSelect={onCreateBoard}
      />

      {/* Confirmation dialog */}
      {confirmRemove && ReactDOM.createPortal(
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="bg-popover text-popover-foreground rounded-lg border p-4 shadow-lg max-w-sm mx-4 space-y-3">
            <h3 className="font-semibold text-sm">Remove workspace</h3>
            <p className="text-sm text-muted-foreground">
              Remove <strong>{confirmRemove.name}</strong> from your workspaces? The data won't be deleted.
            </p>
            <div className="flex justify-end gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setConfirmRemove(null)}
              >
                Cancel
              </Button>
              <Button
                variant="destructive"
                size="sm"
                onClick={handleConfirmRemove}
              >
                Remove
              </Button>
            </div>
          </div>
        </div>,
        document.body
      )}
    </Sidebar>
  );
}
