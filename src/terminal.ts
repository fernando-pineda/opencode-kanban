import { WebSocketServer, WebSocket } from "ws";
import * as pty from "@lydell/node-pty";
import http from "http";
import os from "os";

interface TerminalMessage {
  type: "input" | "resize" | "output" | "kill";
  data?: string;
  cols?: number;
  rows?: number;
}

interface TerminalSession {
  process: pty.IPty;
  sockets: Set<WebSocket>;
  buffer: string[]; // output buffer while no client is connected (last N chunks)
  cwd: string;
  created: number;
}

const MAX_BUFFER = 500; // keep last 500 output chunks for reconnect

export function setupTerminalServer(server: http.Server): void {
  const wss = new WebSocketServer({ noServer: true });
  // board_id → TerminalSession
  const sessions = new Map<string, TerminalSession>();

  function getSession(boardId: string, cwd?: string): TerminalSession {
    let session = sessions.get(boardId);
    if (session) return session;

    const shellCwd = cwd || os.homedir();
    const shellProcess = pty.spawn("/bin/zsh", [], {
      name: "xterm-256color",
      cols: 80,
      rows: 24,
      cwd: shellCwd,
    });

    session = {
      process: shellProcess,
      sockets: new Set(),
      buffer: [],
      cwd: shellCwd,
      created: Date.now(),
    };
    sessions.set(boardId, session);

    // Send PTY output to all connected sockets (and buffer)
    shellProcess.onData((data) => {
      const str = data.toString();
      session!.buffer.push(str);
      if (session!.buffer.length > MAX_BUFFER) {
        session!.buffer.shift();
      }
      for (const socket of session!.sockets) {
        if (socket.readyState === WebSocket.OPEN) {
          socket.send(JSON.stringify({ type: "output", data: str }));
        }
      }
    });

    // If PTY exits (e.g. user typed `exit`), clean up
    shellProcess.onExit(() => {
      sessions.delete(boardId);
    });

    return session;
  }

  function killSession(boardId: string): void {
    const session = sessions.get(boardId);
    if (!session) return;
    try {
      session.process.kill();
    } catch {}
    // Close all connected sockets
    for (const socket of session.sockets) {
      try {
        socket.send(JSON.stringify({ type: "exited" }));
        socket.close();
      } catch {}
    }
    sessions.delete(boardId);
  }

  server.on("upgrade", (request, socket, head) => {
    const url = new URL(request.url || "/", `http://${request.headers.host}`);
    if (url.pathname === "/terminal") {
      wss.handleUpgrade(request, socket, head, (ws) => {
        wss.emit("connection", ws, request);
      });
    } else {
      socket.destroy();
    }
  });

  wss.on("connection", (ws, request) => {
    try {
      // Parse board_id and split_id from query: /terminal?board_id=6&split_id=abc
      const url = new URL(request.url || "/", `http://${request.headers.host}`);
      const boardId = url.searchParams.get("board_id");
      const splitId = url.searchParams.get("split_id") || "default";
      if (!boardId) {
        ws.send(JSON.stringify({ type: "error", data: "board_id is required" }));
        ws.close();
        return;
      }

      const sessionId = `${boardId}:${splitId}`;
      const session = getSession(sessionId);

      // Send buffered output so the reconnecting client sees history
      for (const chunk of session.buffer) {
        ws.send(JSON.stringify({ type: "output", data: chunk }));
      }

      session.sockets.add(ws);

      // Handle WebSocket messages
      ws.on("message", (raw: Buffer) => {
        try {
          const msg: TerminalMessage = JSON.parse(raw.toString());

          if (msg.type === "input" && msg.data) {
            session.process.write(msg.data);
          } else if (
            msg.type === "resize" &&
            typeof msg.cols === "number" &&
            typeof msg.rows === "number"
          ) {
            session.process.resize(msg.cols, msg.rows);
          } else if (msg.type === "kill") {
            killSession(sessionId);
          }
        } catch (error) {
          console.error("Error processing WebSocket message:", error);
        }
      });

      // Handle WebSocket close — detach but DON'T kill the PTY
      ws.on("close", () => {
        session.sockets.delete(ws);
      });
    } catch (error) {
      console.error("Error setting up terminal session:", error);
      ws.close();
    }
  });
}
