"use client";

import React, { useState, useEffect, useCallback, useMemo, useRef } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Folder, ArrowUp, Search } from "lucide-react";

interface DirEntry {
  name: string;
  path: string;
  has_children: boolean;
  is_symlink: boolean;
}

interface WorkspacePickerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSelect: (path: string) => void;
}

const API_BASE = "";

export default function WorkspacePicker({
  open,
  onOpenChange,
  onSelect,
}: WorkspacePickerProps) {
  const [homeDir, setHomeDir] = useState("/");
  const [currentPath, setCurrentPath] = useState("/");
  const [entries, setEntries] = useState<DirEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [history, setHistory] = useState<string[]>(["/"]);
  const [historyIndex, setHistoryIndex] = useState(0);
  const [search, setSearch] = useState("");
  const prevOpen = useRef(open);

  // Fetch home directory on mount
  useEffect(() => {
    fetch(`${API_BASE}/api/home`)
      .then((r) => r.json())
      .then((d) => {
        if (d.home) setHomeDir(d.home);
      })
      .catch(() => {});
  }, []);

  // Reset state when dialog closes
  useEffect(() => {
    if (prevOpen.current && !open) {
      setCurrentPath(homeDir);
      setEntries([]);
      setLoading(false);
      setHistory([homeDir]);
      setHistoryIndex(0);
      setSearch("");
    }
    prevOpen.current = open;
  }, [open, homeDir]);

  const fetchDir = useCallback(async (dirPath: string) => {
    setLoading(true);
    try {
      const res = await fetch(
        `${API_BASE}/api/filesystem?path=${encodeURIComponent(dirPath)}`,
      );
      const data = await res.json();
      if (data.error) {
        console.error("Failed to browse:", data.error);
        return;
      }
      setCurrentPath(data.path);
      setEntries(data.entries || []);
    } catch (err) {
      console.error("Failed to fetch directory:", err);
    } finally {
      setLoading(false);
    }
  }, []);

  // Fetch on open — browse to home directory
  useEffect(() => {
    if (open) {
      fetchDir(currentPath === "/" && homeDir !== "/" ? homeDir : currentPath);
    }
  }, [open, homeDir]); // eslint-disable-line react-hooks/exhaustive-deps

  const navigateTo = (dirPath: string) => {
    const newHistory = history.slice(0, historyIndex + 1);
    newHistory.push(dirPath);
    setHistory(newHistory);
    setHistoryIndex(newHistory.length - 1);
    fetchDir(dirPath);
    setSearch("");
  };

  const goUp = () => {
    // Go to parent directory
    const parent = currentPath.split("/").slice(0, -1).join("/") || "/";
    navigateTo(parent);
  };

  const goBack = () => {
    if (historyIndex > 0) {
      const newIndex = historyIndex - 1;
      setHistoryIndex(newIndex);
      fetchDir(history[newIndex]);
    }
  };

  const goForward = () => {
    if (historyIndex < history.length - 1) {
      const newIndex = historyIndex + 1;
      setHistoryIndex(newIndex);
      fetchDir(history[newIndex]);
    }
  };

  const handleSelect = () => {
    onSelect(currentPath);
    onOpenChange(false);
  };

  const displayPath = homeDir !== "/"
    ? currentPath.replace(new RegExp(`^${homeDir.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`), "~")
    : currentPath;

  const filtered = useMemo(() => {
    if (!search.trim()) return entries;
    try {
      const re = new RegExp(search.trim(), "i");
      return entries.filter((e) => re.test(e.name));
    } catch {
      // invalid regex — treat as plain substring
      const lower = search.toLowerCase();
      return entries.filter((e) => e.name.toLowerCase().includes(lower));
    }
  }, [entries, search]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="workspace-picker-content sm:max-w-lg p-0 flex flex-col h-[560px] gap-0 data-[state=closed]:animate-out-0 data-[state=open]:animate-in-0">
        <DialogHeader className="px-4 pt-4 pb-1 shrink-0">
          <DialogTitle className="text-base">Pick workspace</DialogTitle>
          <p className="text-xs text-muted-foreground font-mono mt-0.5 truncate" title={currentPath}>
            {currentPath}
          </p>
        </DialogHeader>

        {/* Breadcrumb */}
        <div className="px-4 py-2 flex items-center gap-1 text-xs text-muted-foreground border-b shrink-0">
          <button
            onClick={goBack}
            disabled={historyIndex <= 0}
            className="hover:text-foreground disabled:opacity-30 disabled:hover:text-muted-foreground transition-colors"
          >
            ◀
          </button>
          <button
            onClick={goForward}
            disabled={historyIndex >= history.length - 1}
            className="hover:text-foreground disabled:opacity-30 disabled:hover:text-muted-foreground transition-colors"
          >
            ▶
          </button>
          <button
            onClick={goUp}
            disabled={currentPath === "/"}
            className="hover:text-foreground disabled:opacity-30 disabled:hover:text-muted-foreground transition-colors"
          >
            <ArrowUp className="h-3 w-3" />
          </button>
          <span className="truncate font-mono" title={currentPath}>
            {displayPath}
          </span>
        </div>

        {/* Search */}
        <div className="px-4 py-2 border-b shrink-0">
          <div className="flex items-center gap-2 rounded-md border bg-background px-2.5 py-1.5">
            <Search className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search in this directory…"
              className="flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
            />
          </div>
        </div>

        {/* Directory listing */}
        <ScrollArea className="flex-1 min-h-0">
          <div className="px-2 py-1">
            {!loading && (search.trim() ? filtered : entries).length === 0 ? (
              <div className="text-center py-8 text-xs text-muted-foreground">
                {search.trim() ? "No matches" : "No subdirectories"}
              </div>
            ) : (
              (search.trim() ? filtered : entries).map((entry) => (
                <button
                  key={entry.path}
                  onClick={() => navigateTo(entry.path)}
                  className="w-full flex items-center gap-2 px-2 py-1.5 rounded-md text-sm hover:bg-accent transition-colors cursor-pointer text-left"
                >
                  <Folder className="h-4 w-4 text-muted-foreground shrink-0" />
                  <span className="truncate">{entry.name}</span>
                  {entry.is_symlink && (
                    <svg className="h-3 w-3 text-muted-foreground shrink-0 ml-auto" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M6 2h5.5L14 4.5V14a1 1 0 01-1 1H3a1 1 0 01-1-1V3a1 1 0 011-1h3zm0 0V1" />
                    </svg>
                  )}
                </button>
              ))
            )}
          </div>
        </ScrollArea>

        <DialogFooter className="px-4 py-3 border-t sm:justify-center">
          <Button onClick={handleSelect} className="w-full" size="sm">
            Use this folder
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
