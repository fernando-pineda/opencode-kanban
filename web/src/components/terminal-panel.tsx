import '@xterm/xterm/css/xterm.css';
import { useEffect, useRef, useCallback, useState } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { X, Columns, Trash2, GripHorizontal } from 'lucide-react';

interface TerminalPanelProps {
  boardId: number;
  onClose: () => void;
}

interface SplitTerm {
  id: string;
}

let splitCounter = 0;
function nextSplitId() {
  return `split_${++splitCounter}`;
}

function SingleTerminal({ boardId, splitId, onClose }: { boardId: number; splitId: string; onClose: () => void }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const terminalRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const wsRef = useRef<WebSocket | null>(null);

  useEffect(() => {
    const terminal = new Terminal({
      fontSize: 13,
      cursorBlink: true,
      cursorStyle: 'block',
      theme: {
        background: '#0d0d0d',
        foreground: '#e4e4e7',
        cursor: '#a1a1aa',
      },
    });

    terminalRef.current = terminal;

    const fitAddon = new FitAddon();
    fitAddonRef.current = fitAddon;
    terminal.loadAddon(fitAddon);

    if (containerRef.current) {
      terminal.open(containerRef.current);
      requestAnimationFrame(() => fitAddon.fit());
    }

    const wsUrl = `ws://${window.location.host}/terminal?board_id=${boardId}&split_id=${splitId}`;
    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;

    ws.onopen = () => {
      requestAnimationFrame(() => {
        fitAddon.fit();
        const { cols, rows } = terminal;
        ws.send(JSON.stringify({ type: 'resize', cols, rows }));
      });
    };

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        if (msg.type === 'output') terminal.write(msg.data);
        else if (msg.type === 'exited') terminal.write('\r\n[Process exited]\r\n');
      } catch {
        terminal.write(event.data);
      }
    };

    ws.onerror = () => {
      terminal.write('\r\nWebSocket error occurred\r\n');
    };

    terminal.onData((data) => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'input', data }));
      }
    });

    const handleResize = () => {
      if (fitAddonRef.current && terminalRef.current) {
        fitAddonRef.current.fit();
        const { cols, rows } = terminalRef.current;
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: 'resize', cols, rows }));
        }
      }
    };

    window.addEventListener('resize', handleResize);

    // Observe container size changes (for split resize)
    const observer = new ResizeObserver(() => {
      if (fitAddonRef.current) {
        fitAddonRef.current.fit();
        const { cols, rows } = terminalRef.current!;
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: 'resize', cols, rows }));
        }
      }
    });
    if (containerRef.current) {
      observer.observe(containerRef.current);
    }

    return () => {
      window.removeEventListener('resize', handleResize);
      observer.disconnect();
      terminal.dispose();
      terminalRef.current = null;
      ws.close();
      wsRef.current = null;
    };
  }, [boardId, splitId]);

  const killTerminal = () => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: 'kill' }));
    }
    onClose();
  };

  return (
    <div className="flex flex-col h-full min-w-0">
      <div
        ref={containerRef}
        className="w-full flex-1 overflow-hidden"
      />
      <div className="flex items-center justify-end px-1.5 py-0.5 h-6 shrink-0">
        <button
          onClick={killTerminal}
          className="p-0.5 hover:bg-white/10 rounded transition-colors"
          aria-label="Kill terminal"
        >
          <Trash2 className="w-3 h-3 text-zinc-500" />
        </button>
      </div>
    </div>
  );
}

export default function TerminalPanel({ boardId, onClose }: TerminalPanelProps) {
  const [splits, setSplits] = useState<SplitTerm[]>(() => [{ id: nextSplitId() }]);
  const [height, setHeight] = useState(280);
  const panelRef = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);
  const startY = useRef(0);
  const startHeight = useRef(0);

  const addSplit = useCallback(() => {
    setSplits((prev) => [...prev, { id: nextSplitId() }]);
  }, []);

  const removeSplit = useCallback((splitId: string) => {
    setSplits((prev) => {
      if (prev.length <= 1) return prev;
      return prev.filter((s) => s.id !== splitId);
    });
  }, []);

  // Resize drag handler
  const onMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    dragging.current = true;
    startY.current = e.clientY;
    startHeight.current = height;

    const onMouseMove = (e: MouseEvent) => {
      if (!dragging.current) return;
      const delta = startY.current - e.clientY;
      const newHeight = Math.max(120, Math.min(window.innerHeight * 0.7, startHeight.current + delta));
      setHeight(newHeight);
    };

    const onMouseUp = () => {
      dragging.current = false;
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
    };

    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
  }, [height]);

  return (
    <div
      ref={panelRef}
      className="flex-shrink-0 border-t border-border bg-background flex flex-col"
      style={{ height }}
    >
      {/* Drag handle + header */}
      <div
        onMouseDown={onMouseDown}
        className="flex items-center justify-between px-2 h-7 shrink-0 cursor-row-resize select-none border-b border-zinc-800/50 hover:bg-zinc-800/30 transition-colors"
      >
        <div className="flex items-center gap-1">
          <GripHorizontal className="w-3 h-3 text-zinc-600" />
        </div>
        <div className="flex items-center gap-0.5">
          <button
            onClick={addSplit}
            className="p-1 hover:bg-white/10 rounded transition-colors"
            aria-label="Split terminal"
          >
            <Columns className="w-3.5 h-3.5 text-zinc-500" />
          </button>
          <button
            onClick={onClose}
            className="p-1 hover:bg-white/10 rounded transition-colors"
            aria-label="Hide terminal"
          >
            <X className="w-3.5 h-3.5 text-zinc-500" />
          </button>
        </div>
      </div>

      {/* Terminal splits */}
      <div className="flex flex-1 min-h-0">
        {splits.map((split, i) => (
          <div key={split.id} className="relative flex-1 min-w-0">
            {i > 0 && (
              <div className="absolute left-0 top-0 bottom-0 w-px bg-zinc-800/50 z-10" />
            )}
            <SingleTerminal
              boardId={boardId}
              splitId={split.id}
              onClose={() => removeSplit(split.id)}
            />
          </div>
        ))}
      </div>
    </div>
  );
}
