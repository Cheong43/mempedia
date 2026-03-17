/**
 * Shared types for the agent runtime layer.
 */

/** A single step in the agent's ReAct loop. */
export type AgentStepKind = 'tool' | 'final';

/** A tool call planned by the agent. */
export interface PlannedToolCall {
  name: string;
  arguments: Record<string, unknown>;
  /** Optional hint about the call's purpose. */
  goal?: string;
}

/** A finalized answer produced by the agent. */
export interface FinalAnswer {
  kind: 'final';
  content: string;
}

/** A tool-execution step. */
export interface ToolStep {
  kind: 'tool';
  toolCalls: PlannedToolCall[];
}

export type AgentStep = ToolStep | FinalAnswer;

/** Observation returned after executing a tool call. */
export interface ToolObservation {
  toolName: string;
  result: string;
  success: boolean;
}

/** A single turn in the agent's running transcript. */
export interface TranscriptMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

/** Trace event emitted by the agent runtime for UI/logging. */
export interface AgentTraceEvent {
  type: 'thought' | 'action' | 'observation' | 'error' | 'final';
  content: string;
  metadata?: Record<string, unknown>;
}
