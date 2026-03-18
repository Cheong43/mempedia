/**
 * Shared types for the agent runtime layer.
 */

/** A single step in the agent's ReAct loop. */
export type AgentStepKind = 'tool' | 'branch' | 'final';

interface AgentStepBase {
  /** Optional planner thought for tracing/debugging. */
  thought?: string;
}

/** A tool call planned by the agent. */
export interface PlannedToolCall {
  name: string;
  arguments: Record<string, unknown>;
  /** Optional hint about the call's purpose. */
  goal?: string;
}

/** A child branch planned by the agent. */
export interface PlannedBranch {
  label: string;
  goal: string;
  why?: string;
  priority?: number;
}

/** A finalized answer produced by the agent. */
export interface FinalAnswer extends AgentStepBase {
  kind: 'final';
  content: string;
  completionSummary?: string;
}

/** A tool-execution step. */
export interface ToolStep extends AgentStepBase {
  kind: 'tool';
  toolCalls: PlannedToolCall[];
}

/** A branch-spawning step. */
export interface BranchStep extends AgentStepBase {
  kind: 'branch';
  branches: PlannedBranch[];
}

export type AgentStep = ToolStep | BranchStep | FinalAnswer;

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
