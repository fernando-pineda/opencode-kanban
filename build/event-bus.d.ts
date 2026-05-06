import { EventEmitter } from 'events';
export declare const EVENT_TYPES: {
    readonly BOARD_UPDATED: "board_updated";
    readonly CARD_MOVED: "card_moved";
    readonly CARD_UPDATED: "card_updated";
    readonly CARD_CREATED: "card_created";
    readonly CARD_DELETED: "card_deleted";
    readonly SUBTASK_CREATED: "subtask_created";
    readonly SUBTASK_UPDATED: "subtask_updated";
    readonly AGENT_LOG_ADDED: "agent_log_added";
    readonly SESSION_STARTED: "session_started";
    readonly SESSION_ENDED: "session_ended";
    readonly OPENCODE_SESSION_STATUS: "opencode_session_status";
    readonly OPENCODE_MESSAGE_PART_UPDATED: "opencode_message_part_updated";
    readonly OPENCODE_MESSAGE_UPDATED: "opencode_message_updated";
    readonly EPIC_UPDATED: "epic_updated";
    readonly NOTIFICATION_CREATED: "notification_created";
    readonly NOTIFICATION_SEEN: "notification_seen";
};
export type KanbanEvents = (typeof EVENT_TYPES)[keyof typeof EVENT_TYPES];
export interface KanbanEventPayloads {
    board_updated: {
        board_id: number;
    };
    card_moved: {
        session_id: string;
        to_column: string;
    };
    card_updated: {
        session_id: string;
        progress: number;
        status_note?: string;
    };
    card_created: {
        session_id: string;
        board_id: number;
    };
    card_deleted: {
        session_id: string;
    };
    subtask_created: {
        session_id: string;
        agent_name: string;
    };
    subtask_updated: {
        session_id: string;
        status: string;
        progress: number;
    };
    agent_log_added: {
        session_id: string;
        agent_name: string;
        action: string;
    };
    session_started: {
        session_id: number;
        board_id: number;
    };
    session_ended: {
        session_id: number;
    };
    opencode_session_status: {
        sessionID: string;
        status: {
            type: string;
        };
    };
    opencode_message_part_updated: {
        sessionID: string;
        part: any;
    };
    opencode_message_updated: {
        sessionID: string;
        info: any;
    };
    epic_updated: {
        epic_id: number;
        board_id: number;
        status: string;
    };
    notification_created: {
        notification_id: number;
        board_id: number;
        session_id: string;
        type: string;
    };
    notification_seen: {
        notification_id: number;
        board_id: number;
    };
}
declare class KanbanEventBus extends EventEmitter {
    emit<E extends KanbanEvents>(event: E, payload: KanbanEventPayloads[E]): boolean;
    on<E extends KanbanEvents>(event: E, listener: (payload: KanbanEventPayloads[E]) => void): this;
    once<E extends KanbanEvents>(event: E, listener: (payload: KanbanEventPayloads[E]) => void): this;
    off<E extends KanbanEvents>(event: E, listener: (payload: KanbanEventPayloads[E]) => void): this;
}
export declare const bus: KanbanEventBus;
export declare function emitBoardChange<E extends KanbanEvents>(type: E, payload: KanbanEventPayloads[E]): void;
export {};
