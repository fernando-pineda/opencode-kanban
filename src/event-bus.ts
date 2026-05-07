import { EventEmitter } from 'events';

// ── Event type definitions ──────────────────────────────────

export const EVENT_TYPES = {
  BOARD_UPDATED: 'board_updated',
  CARD_MOVED: 'card_moved',
  CARD_UPDATED: 'card_updated',
  CARD_CREATED: 'card_created',
  CARD_DELETED: 'card_deleted',
  SUBTASK_CREATED: 'subtask_created',
  SUBTASK_UPDATED: 'subtask_updated',
  AGENT_LOG_ADDED: 'agent_log_added',
  SESSION_STARTED: 'session_started',
  SESSION_ENDED: 'session_ended',
  OPENCODE_SESSION_STATUS: 'opencode_session_status',
  OPENCODE_MESSAGE_PART_UPDATED: 'opencode_message_part_updated',
  OPENCODE_MESSAGE_UPDATED: 'opencode_message_updated',
  EPIC_UPDATED: 'epic_updated',
} as const;

export type KanbanEvents = (typeof EVENT_TYPES)[keyof typeof EVENT_TYPES];

export interface KanbanEventPayloads {
  board_updated: { board_id: number };
  card_moved: { session_id: string; to_column: string };
  card_updated: { session_id: string; progress: number; status_note?: string };
  card_created: { session_id: string; board_id: number };
  card_deleted: { session_id: string };
  subtask_created: { session_id: string; agent_name: string };
  subtask_updated: { session_id: string; status: string; progress: number };
  agent_log_added: { session_id: string; agent_name: string; action: string };
  session_started: { session_id: number; board_id: number };
  session_ended: { session_id: number };
  opencode_session_status: { sessionID: string; status: { type: string } };
  opencode_message_part_updated: { sessionID: string; part: any };
  opencode_message_updated: { sessionID: string; info: any };
  epic_updated: { epic_id: number; board_id: number; status: string };
}

// ── Typed event bus ─────────────────────────────────────────

class KanbanEventBus extends EventEmitter {
  emit<E extends KanbanEvents>(event: E, payload: KanbanEventPayloads[E]): boolean {
    return super.emit(event, payload);
  }

  on<E extends KanbanEvents>(
    event: E,
    listener: (payload: KanbanEventPayloads[E]) => void,
  ): this {
    return super.on(event, listener);
  }

  once<E extends KanbanEvents>(
    event: E,
    listener: (payload: KanbanEventPayloads[E]) => void,
  ): this {
    return super.once(event, listener);
  }

  off<E extends KanbanEvents>(
    event: E,
    listener: (payload: KanbanEventPayloads[E]) => void,
  ): this {
    return super.off(event, listener);
  }
}

// ── Singleton instance ──────────────────────────────────────

export const bus = new KanbanEventBus();
// Allow many concurrent SSE clients (each registers ~14 event listeners)
bus.setMaxListeners(50);

// ── Convenience function ────────────────────────────────────

export function emitBoardChange<E extends KanbanEvents>(
  type: E,
  payload: KanbanEventPayloads[E],
): void {
  bus.emit(type, payload);
}
