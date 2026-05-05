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
};
// ── Typed event bus ─────────────────────────────────────────
class KanbanEventBus extends EventEmitter {
    emit(event, payload) {
        return super.emit(event, payload);
    }
    on(event, listener) {
        return super.on(event, listener);
    }
    once(event, listener) {
        return super.once(event, listener);
    }
    off(event, listener) {
        return super.off(event, listener);
    }
}
// ── Singleton instance ──────────────────────────────────────
export const bus = new KanbanEventBus();
// ── Convenience function ────────────────────────────────────
export function emitBoardChange(type, payload) {
    bus.emit(type, payload);
}
