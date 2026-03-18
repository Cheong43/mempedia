import * as fs from 'fs';
import * as path from 'path';
import { ToolAction } from '../mempedia/types.js';

type ChatClient = {
  chat: {
    completions: {
      create: (args: any) => Promise<any>;
    };
  };
};

export interface MemoryClassifierTraceEvent {
  type: 'thought' | 'action' | 'observation' | 'error';
  content: string;
}

export interface MemoryClassifierJob {
  input: string;
  traces: MemoryClassifierTraceEvent[];
  answer: string;
  reason: string;
  focus?: string;
  savePreferences: boolean;
  saveSkills: boolean;
  saveAtomic: boolean;
  saveEpisodic: boolean;
  branchId?: string;
}

interface MemoryExtraction {
  user_preferences: Array<{ topic: string; preference: string; evidence: string }>;
  agent_skills: Array<{ skill_id: string; title: string; content: string; tags: string[] }>;
  atomic_knowledge: Array<{ keyword: string; summary: string; description: string; evolution: string; relations: string[] }>;
}

interface MemoryClassifierOptions {
  chatClient: ChatClient;
  model: string;
  codeCliRoot: string;
  extractionMaxChars: number;
  memoryExtractTimeoutMs: number;
  memoryActionTimeoutMs: number;
  autoLinkEnabled: boolean;
  autoLinkMaxNodes: number;
  autoLinkLimit: number;
}

export interface MemoryClassifierContext {
  runId: string;
  conversationId: string;
  sendAction: (action: ToolAction) => Promise<any>;
  appendMemoryLog: (phase: string, data?: Record<string, unknown>) => void;
  appendNodeConversationMap: (nodeId: string, conversationId: string, reason: string) => void;
  resolveRelationTargets: (relations: string[]) => Promise<Array<{ label: string; target?: string }>>;
  mergeUserPreferencesMarkdown: (
    existing: string,
    preferences: Array<{ topic: string; preference: string; evidence: string }>,
    updatedAt: string
  ) => string;
}

export class MemoryClassifierAgent {
  private readonly chatClient: ChatClient;
  private readonly model: string;
  private readonly codeCliRoot: string;
  private readonly extractionMaxChars: number;
  private readonly memoryExtractTimeoutMs: number;
  private readonly memoryActionTimeoutMs: number;
  private readonly autoLinkEnabled: boolean;
  private readonly autoLinkMaxNodes: number;
  private readonly autoLinkLimit: number;

  constructor(options: MemoryClassifierOptions) {
    this.chatClient = options.chatClient;
    this.model = options.model;
    this.codeCliRoot = options.codeCliRoot;
    this.extractionMaxChars = options.extractionMaxChars;
    this.memoryExtractTimeoutMs = options.memoryExtractTimeoutMs;
    this.memoryActionTimeoutMs = options.memoryActionTimeoutMs;
    this.autoLinkEnabled = options.autoLinkEnabled;
    this.autoLinkMaxNodes = options.autoLinkMaxNodes;
    this.autoLinkLimit = options.autoLinkLimit;
  }

  async persist(job: MemoryClassifierJob, context: MemoryClassifierContext): Promise<void> {
    const extractionNeeded = job.savePreferences || job.saveSkills || job.saveAtomic;
    const extractionStartedAt = Date.now();
    const extractionInput = [
      job.input,
      job.answer ? `Assistant answer:\n${job.answer}` : '',
    ].filter(Boolean).join('\n\n');
    let payload: MemoryExtraction = {
      user_preferences: [],
      agent_skills: [],
      atomic_knowledge: [],
    };

    if (extractionNeeded) {
      payload = await this.withTimeout(
        this.extractMemoryPayload(extractionInput, job.traces, job.answer),
        this.memoryExtractTimeoutMs,
        'memory extraction'
      );
      if (!job.savePreferences) {
        payload.user_preferences = [];
      }
      if (!job.saveSkills) {
        payload.agent_skills = [];
      }
      if (!job.saveAtomic) {
        payload.atomic_knowledge = [];
      }
      if (
        payload.user_preferences.length === 0
        && payload.agent_skills.length === 0
        && payload.atomic_knowledge.length === 0
      ) {
        const fallbackPayload = this.fallbackExtractMemory(extractionInput, job.answer);
        if (!job.savePreferences) {
          fallbackPayload.user_preferences = [];
        }
        if (!job.saveSkills) {
          fallbackPayload.agent_skills = [];
        }
        if (!job.saveAtomic) {
          fallbackPayload.atomic_knowledge = [];
        }
        if (
          fallbackPayload.user_preferences.length > 0
          || fallbackPayload.agent_skills.length > 0
          || fallbackPayload.atomic_knowledge.length > 0
        ) {
          payload = fallbackPayload;
        }
      }
    }

    context.appendMemoryLog('memory_extract_done', {
      elapsed_ms: Date.now() - extractionStartedAt,
      preferences: payload.user_preferences.length,
      skills: payload.agent_skills.length,
      atomic: payload.atomic_knowledge.length,
    });

    const nowIso = new Date().toISOString();
    const sendWithTimeout = (action: ToolAction) =>
      this.withTimeout(context.sendAction(action), this.memoryActionTimeoutMs, `memory action ${action.action}`);
    const runAction = async (stage: string, action: ToolAction) => {
      const stageStartedAt = Date.now();
      const nodeId = (action as any).node_id;
      context.appendMemoryLog(`${stage}_started`, {
        action: action.action,
        node_id: typeof nodeId === 'string' ? nodeId : null,
      });
      const result = await sendWithTimeout(action);
      if (result && (result as any).kind === 'error') {
        context.appendMemoryLog(`${stage}_error`, {
          action: action.action,
          node_id: typeof nodeId === 'string' ? nodeId : null,
          message: (result as any).message || 'unknown error',
        });
      }
      context.appendMemoryLog(`${stage}_done`, {
        action: action.action,
        node_id: typeof nodeId === 'string' ? nodeId : null,
        elapsed_ms: Date.now() - stageStartedAt,
      });
      return result;
    };

    const linkedNodes = new Set<string>();

    if (payload.atomic_knowledge.length > 0) {
      const atomicMap = new Map<string, { keyword: string; summary: string; description: string; evolution: string; relations: string[] }>();
      for (const item of payload.atomic_knowledge) {
        atomicMap.set(this.stableNodeId('atomic', item.keyword), item);
      }
      for (const [nodeId, item] of atomicMap) {
        const resolvedRelations = await context.resolveRelationTargets(item.relations || []);
        const evolutionSection = item.evolution && item.evolution.trim().length > 0
          ? item.evolution
          : '暂无';
        const descriptionSection = item.description && item.description.trim().length > 0
          ? item.description
          : item.summary;
        await runAction('atomic_upsert', {
          action: 'ingest',
          node_id: nodeId,
          title: item.keyword,
          text: `${descriptionSection}\n\nEvolution\n${evolutionSection}`,
          summary: item.summary,
          facts: {
            type: 'atomic_knowledge',
            updated_at: nowIso,
          },
          relations: resolvedRelations
            .filter((rel) => rel.target)
            .map((rel) => ({ target: rel.target as string, label: 'related', weight: 0.8 })),
          evidence: [
            `conversation:${context.conversationId}`,
            `memory_run:${context.runId}`,
          ],
          importance: 1.9,
          agent_id: 'mempedia-memory-classifier',
          reason: 'Automatic four-layer memory classification',
          source: 'kg_atomic',
        });
        linkedNodes.add(nodeId);
        context.appendNodeConversationMap(nodeId, context.conversationId, 'atomic_knowledge');
      }
    }

    if (payload.agent_skills.length > 0) {
      const skillMap = new Map<string, { skill_id: string; title: string; content: string; tags: string[] }>();
      for (const item of payload.agent_skills) {
        const skillId = this.toSlug(item.skill_id || item.title || 'general_skill').slice(0, 64);
        skillMap.set(skillId, {
          skill_id: skillId,
          title: item.title,
          content: item.content,
          tags: item.tags || [],
        });
      }
      for (const item of skillMap.values()) {
        await runAction('skill_upsert', {
          action: 'upsert_skill',
          skill_id: item.skill_id,
          title: item.title,
          content: item.content,
          tags: item.tags,
        });
      }
    }

    if (linkedNodes.size === 0) {
      context.appendMemoryLog('memory_payload_empty', { note: 'no selected memory nodes generated' });
    }

    if (this.autoLinkEnabled && this.autoLinkMaxNodes > 0 && linkedNodes.size > 0) {
      const nodeIds = Array.from(linkedNodes).slice(0, this.autoLinkMaxNodes);
      context.appendMemoryLog('auto_link_batch_started', {
        node_count: nodeIds.length,
        limit: this.autoLinkLimit,
      });
      for (const nodeId of nodeIds) {
        await runAction('auto_link', {
          action: 'auto_link_related',
          node_id: nodeId,
          limit: this.autoLinkLimit,
          min_score: 0.6,
        });
      }
      context.appendMemoryLog('auto_link_batch_done', { node_count: nodeIds.length });
    }

    if (job.saveEpisodic) {
      try {
        const episodicSummary = this.clipText(job.answer, 400)
          || this.clipText(job.input, 200)
          || `unspecified interaction at ${nowIso}`;
        const episodicTags = [
          ...payload.atomic_knowledge.slice(0, 5).map((item) => item.keyword),
          ...payload.user_preferences.slice(0, 3).map((item) => item.topic),
          ...payload.agent_skills.slice(0, 3).map((item) => item.skill_id),
        ].filter(Boolean);
        await sendWithTimeout({
          action: 'record_episodic',
          scene_type: 'conversation',
          summary: episodicSummary,
          raw_conversation_id: context.conversationId,
          importance: 1.0,
          core_knowledge_nodes: Array.from(linkedNodes),
          tags: episodicTags,
          agent_id: 'mempedia-memory-classifier',
        });
        context.appendMemoryLog('episodic_recorded', {
          conversation_id: context.conversationId,
          core_nodes: linkedNodes.size,
        });
      } catch (error: any) {
        context.appendMemoryLog('episodic_record_failed', {
          error: String(error?.message || error || 'unknown'),
        });
      }
    }

    if (payload.user_preferences.length > 0) {
      try {
        const prefRes = await sendWithTimeout({ action: 'read_user_preferences' });
        const existing = (prefRes as any).kind === 'user_preferences'
          ? String((prefRes as any).content || '')
          : '';
        const updatedPrefs = context.mergeUserPreferencesMarkdown(existing, payload.user_preferences, nowIso);
        await sendWithTimeout({
          action: 'update_user_preferences',
          content: updatedPrefs,
        });
        context.appendMemoryLog('preferences_synced', {
          preferences: payload.user_preferences.length,
        });
      } catch (error: any) {
        context.appendMemoryLog('preferences_sync_failed', {
          error: String(error?.message || error || 'unknown'),
        });
      }
    }
  }

  private async extractMemoryPayload(input: string, traces: MemoryClassifierTraceEvent[], answer: string): Promise<MemoryExtraction> {
    const traceLines = traces
      .slice(-30)
      .map((trace) => `${trace.type.toUpperCase()}: ${trace.content}`)
      .join('\n');
    const compactInput = this.clipText(input, this.extractionMaxChars);
    const compactTraces = this.clipText(traceLines, Math.max(2000, Math.floor(this.extractionMaxChars / 2)));
    const compactAnswer = this.clipText(answer, Math.max(1000, Math.floor(this.extractionMaxChars / 3)));
    const classifierSkill = this.loadMemoryClassifierSkill();
    const extractionPrompt = `你是一个独立的 MemoryClassifierAgent，运行在企业型知识库 Mempedia 中。你的任务是在每轮对话结束后，对对话进行四层分类，并只输出 JSON（不要 markdown）。\n\n${classifierSkill ? `Memory classification skill guidance:\n${classifierSkill}\n\n` : ''}输出格式：\n{\n  "user_preferences": [\n    { "topic": "偏好主题", "preference": "稳定偏好结论", "evidence": "证据摘要" }\n  ],\n  "agent_skills": [\n    { "skill_id": "稳定技能ID", "title": "技能标题", "content": "可复用步骤", "tags": ["tag1", "tag2"] }\n  ],\n  "atomic_knowledge": [\n    { "keyword": "核心关键词", "summary": "短摘要", "description": "完整描述", "evolution": "演进信息", "relations": ["相关项"] }\n  ]\n}\n\n规则：\n1. Layer 1 Core Knowledge：只提取稳定、可复用、对后续推理有价值的知识点。\n2. Layer 2 Episodic Memory：由宿主流程单独记录，你不需要输出 episodic 字段，但你的分类必须避免把短暂事件误提取到 Layer 1/3/4。\n3. Layer 3 User Preferences：仅提取稳定偏好，不要记录当前轮一次性要求。\n4. Layer 4 Skills：仅提取可复用工作流、策略、步骤，不要提取一次性执行日志。\n5. 如果内容明确来自 README、源码、配置、schema、项目结构或已验证接口，且回答总结了项目架构、模块职责、存储结构、API 能力、构建方式等稳定事实，应优先进入 atomic_knowledge。\n6. 忽略寒暄、临时状态、报错噪音、调度包装文本，以及类似 “Original user request”“Active branch”“Branch goal” 的控制信息。\n7. 如果某一层没有内容，返回空数组。`;

    const userPayload = `用户输入:\n${compactInput}\n\n执行轨迹:\n${compactTraces}\n\n最终回答:\n${compactAnswer}`;
    try {
      const extraction = await this.withTimeout(
        this.chatClient.chat.completions.create({
          model: this.model,
          messages: [
            { role: 'system', content: extractionPrompt },
            { role: 'user', content: userPayload },
          ],
          response_format: { type: 'json_object' },
        }),
        this.memoryExtractTimeoutMs,
        'memory extraction llm'
      );
      const content = extraction.choices[0]?.message?.content || '{}';
      const parsed = JSON.parse(content);
      const preferences = Array.isArray(parsed.user_preferences)
        ? parsed.user_preferences.map((item: any) => {
            if (typeof item === 'string') {
              const topic = item.replace(/\s+/g, ' ').trim().slice(0, 64) || 'general';
              return {
                topic,
                preference: this.normalizeSummary(item, topic),
                evidence: this.normalizeDetails(item, topic),
              };
            }
            const topic = typeof item?.topic === 'string'
              ? item.topic.replace(/\s+/g, ' ').trim().slice(0, 64)
              : '';
            const fallback = topic || item?.preference || 'general';
            return {
              topic: topic || this.toSlug(String(fallback)).slice(0, 64),
              preference: this.normalizeSummary(item?.preference, String(fallback)),
              evidence: this.normalizeDetails(item?.evidence, String(fallback)),
            };
          }).filter((item: any) => item.topic && item.preference)
        : [];
      const skills = Array.isArray(parsed.agent_skills)
        ? parsed.agent_skills.map((item: any) => {
            if (typeof item === 'string') {
              const skillId = `skill_${this.toSlug(item).slice(0, 56) || 'general'}`;
              return {
                skill_id: skillId,
                title: this.normalizeSummary(item, skillId),
                content: this.normalizeDetails(item, skillId),
                tags: ['auto'],
              };
            }
            const rawTitle = typeof item?.title === 'string' ? item.title.trim() : '';
            const rawSkillId = typeof item?.skill_id === 'string' ? item.skill_id.trim() : '';
            const fallback = rawTitle || rawSkillId || 'general_skill';
            const tags = Array.isArray(item?.tags)
              ? item.tags.map((tag: any) => String(tag || '').trim()).filter((tag: string) => tag.length > 0).slice(0, 8)
              : [];
            return {
              skill_id: rawSkillId || `skill_${this.toSlug(fallback).slice(0, 56) || 'general'}`,
              title: rawTitle || this.normalizeSummary(fallback, fallback),
              content: this.normalizeDetails(item?.content || item?.details || item?.summary, fallback),
              tags,
            };
          }).filter((item: any) => item.skill_id && item.title && item.content)
        : [];
      const atomic = Array.isArray(parsed.atomic_knowledge)
        ? parsed.atomic_knowledge.map((item: any) => {
            const keyword = typeof item?.keyword === 'string' ? item.keyword.replace(/\s+/g, ' ').trim() : '';
            if (!keyword) {
              return null;
            }
            const rawRelations = Array.isArray(item?.relations)
              ? item.relations
              : Array.isArray(item?.related_keywords)
                ? item.related_keywords
                : [];
            const relations = rawRelations
              .map((relation: any) => typeof relation === 'string' ? relation.replace(/\s+/g, ' ').trim() : '')
              .filter((relation: string) => relation.length > 0 && relation.toLowerCase() !== keyword.toLowerCase())
              .slice(0, 8);
            return {
              keyword,
              summary: this.normalizeSummary(item?.summary || item?.description, keyword),
              description: this.normalizeDetails(item?.description || item?.summary, keyword),
              evolution: this.normalizeOptional(item?.evolution || item?.details),
              relations,
            };
          }).filter((item: any) => Boolean(item))
        : [];

      return {
        user_preferences: preferences.slice(0, 12),
        agent_skills: skills.slice(0, 12),
        atomic_knowledge: atomic.slice(0, 20) as Array<{ keyword: string; summary: string; description: string; evolution: string; relations: string[] }>,
      };
    } catch {
      return this.fallbackExtractMemory(input, answer);
    }
  }

  private fallbackExtractMemory(input: string, answer: string): MemoryExtraction {
    const text = `${input}\n${answer}`;
    const preferences: Array<{ topic: string; preference: string; evidence: string }> = [];
    const skills: Array<{ skill_id: string; title: string; content: string; tags: string[] }> = [];

    const habitRegex = /(偏好|喜欢|习惯|不喜欢|讨厌|避免)[^。\\n]{0,120}/;
    const habitMatch = text.match(habitRegex);
    if (habitMatch) {
      const phrase = habitMatch[0].trim();
      const topic = phrase.slice(0, 32);
      preferences.push({
        topic,
        preference: this.normalizeSummary(phrase, topic),
        evidence: this.normalizeDetails(phrase, topic),
      });
    }

    const hasSteps = /步骤|流程|最佳实践|注意事项|操作方法|建议/.test(text) || /\\n\\s*\\d+\./.test(text);
    if (hasSteps) {
      const key = this.toSlug(answer.slice(0, 64) || 'general_skill').slice(0, 56) || 'general_skill';
      skills.push({
        skill_id: `skill_${key}`,
        title: this.normalizeSummary(answer.slice(0, 120), key),
        content: this.normalizeDetails(answer.slice(0, 600), key),
        tags: ['auto'],
      });
    }

    return {
      user_preferences: preferences.slice(0, 8),
      agent_skills: skills.slice(0, 8),
      atomic_knowledge: this.fallbackExtractAtomic(input, answer),
    };
  }

  private loadMemoryClassifierSkill(): string {
    const skillPath = path.join(this.codeCliRoot, 'skills', 'memory-classification', 'SKILL.md');
    if (!fs.existsSync(skillPath)) {
      return '';
    }
    try {
      const markdown = fs.readFileSync(skillPath, 'utf-8');
      return markdown.replace(/^---\s*[\r\n]+[\s\S]*?[\r\n]+---\s*[\r\n]*/u, '').trim();
    } catch {
      return '';
    }
  }

  private isPreferenceLine(line: string): boolean {
    const lc = line.toLowerCase();
    return lc.includes('prefer')
      || lc.includes('preference')
      || lc.includes('习惯')
      || lc.includes('偏好')
      || lc.includes('默认')
      || lc.includes('希望')
      || lc.includes('请用')
      || lc.includes('请保持');
  }

  private isNoiseLine(line: string): boolean {
    const lc = line.toLowerCase();
    if (lc.length < 8) {
      return true;
    }
    return lc.includes('command executed successfully')
      || lc.includes('deprecatedwarning')
      || lc.includes('unknown tool')
      || lc.includes('initializing react agent context')
      || lc.includes('initializing branching react context')
      || lc.includes('mempedia process exited with code');
  }

  private isValuableKnowledgeLine(line: string): boolean {
    if (this.isNoiseLine(line)) {
      return false;
    }
    const cleaned = line.trim();
    if (cleaned.length < 12) {
      return false;
    }
    const lc = cleaned.toLowerCase();
    if (lc.includes('hello') || lc.includes('hi') || lc.includes('thanks') || lc.includes('你好')) {
      return false;
    }
    return true;
  }

  private firstSentence(text: string): string {
    const trimmed = text.replace(/\s+/g, ' ').trim();
    if (!trimmed) {
      return '';
    }
    const match = trimmed.match(/^[^。.!?\n]{12,200}[。.!?\n]/u);
    if (match) {
      return match[0].replace(/[\n\r]+/g, ' ').trim();
    }
    return trimmed.slice(0, 200);
  }

  private collectAtomicCandidates(input: string, answer: string): string[] {
    const candidates: string[] = [];
    const seen = new Set<string>();
    const push = (value: string) => {
      const cleaned = value.replace(/\s+/g, ' ').trim();
      if (cleaned.length < 2 || cleaned.length > 80) {
        return;
      }
      if (this.isPreferenceLine(cleaned)) {
        return;
      }
      const slug = this.toSlug(cleaned);
      if (seen.has(slug)) {
        return;
      }
      seen.add(slug);
      candidates.push(cleaned);
    };

    const backtickRegex = /`([^`]{2,80})`/g;
    const quotedRegex = /"([^"]{2,80})"/g;
    const pathRegex = /\b[\w.-]+\/[\w./-]+\b/g;

    const textPool = `${answer}\n${input}`;
    let match: RegExpExecArray | null = null;
    while ((match = backtickRegex.exec(textPool))) {
      push(match[1]);
    }
    while ((match = quotedRegex.exec(textPool))) {
      push(match[1]);
    }
    while ((match = pathRegex.exec(textPool))) {
      push(match[0]);
    }

    const answerLines = answer.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
    for (const line of answerLines) {
      if (line.startsWith('#')) {
        push(line.replace(/^#+\s*/, ''));
        continue;
      }
      const colonIndex = line.indexOf(':') >= 0 ? line.indexOf(':') : line.indexOf('：');
      if (colonIndex > 1 && colonIndex < 60) {
        push(line.slice(0, colonIndex));
        continue;
      }
      if (line.includes(' - ')) {
        const [left] = line.split(' - ');
        push(left);
      }
    }

    const inputLine = input.split(/\r?\n/).map((line) => line.trim()).find((line) => line.length >= 8);
    if (inputLine) {
      const trimmed = inputLine.replace(/[\p{P}\p{S}]+/gu, ' ').trim();
      push(trimmed.slice(0, 60));
    }

    return candidates.slice(0, 8);
  }

  private fallbackExtractAtomic(input: string, answer: string): Array<{ keyword: string; summary: string; description: string; evolution: string; relations: string[] }> {
    const candidates = this.collectAtomicCandidates(input, answer);
    if (candidates.length === 0) {
      return [];
    }
    const answerLines = answer
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line.length > 0 && this.isValuableKnowledgeLine(line));
    const summarySeed = this.firstSentence(answer) || this.firstSentence(input) || '';
    const candidateSet = new Set(candidates.map((candidate) => candidate.toLowerCase()));

    return candidates.map((candidate) => {
      const candidateLower = candidate.toLowerCase();
      const matchingLines = answerLines.filter((line) => line.toLowerCase().includes(candidateLower));
      const detailsSource = matchingLines.slice(0, 3).join('\n') || answerLines.slice(0, 3).join('\n') || summarySeed || candidate;
      const summarySource = matchingLines[0] || summarySeed || candidate;
      const evolutionSource = detailsSource === summarySource ? '' : detailsSource;
      const relations = candidates
        .filter((other) => other.toLowerCase() !== candidateLower && candidateSet.has(other.toLowerCase()))
        .slice(0, 4);
      return {
        keyword: candidate,
        summary: this.normalizeSummary(summarySource, candidate),
        description: this.normalizeDetails(detailsSource, candidate),
        evolution: this.normalizeOptional(evolutionSource),
        relations,
      };
    }).filter((item) => item.keyword && item.summary);
  }

  private clipText(value: string, maxChars: number): string {
    if (maxChars <= 0 || value.length <= maxChars) {
      return value;
    }
    return value.slice(value.length - maxChars);
  }

  private normalizeSummary(summary: unknown, fallback: string): string {
    const raw = typeof summary === 'string' ? summary : '';
    const compact = raw.replace(/\s+/g, ' ').trim();
    if (compact.length >= 8) {
      return compact.slice(0, 140);
    }
    const fb = fallback.replace(/\s+/g, ' ').trim();
    if (fb.length >= 8) {
      return fb.slice(0, 140);
    }
    return `${(fb || 'memory').slice(0, 120)} summary`;
  }

  private normalizeDetails(details: unknown, fallback: string): string {
    const raw = typeof details === 'string' ? details : '';
    const compact = raw.trim();
    if (compact.length > 0) {
      return compact;
    }
    return fallback;
  }

  private normalizeOptional(details: unknown): string {
    const raw = typeof details === 'string' ? details : '';
    return raw.trim();
  }

  private toSlug(value: string): string {
    const normalized = value
      .toLowerCase()
      .replace(/[^\p{L}\p{N}]+/gu, '_')
      .replace(/^_+|_+$/g, '')
      .slice(0, 72);
    return normalized || 'empty';
  }

  private stableNodeId(type: 'atomic', text: string): string {
    return `kg_${type}_${this.toSlug(text)}`;
  }

  private async withTimeout<T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> {
    if (timeoutMs <= 0) {
      return promise;
    }
    let timer: NodeJS.Timeout | null = null;
    try {
      return await Promise.race([
        promise,
        new Promise<T>((_, reject) => {
          timer = setTimeout(() => reject(new Error(`${label} timeout after ${timeoutMs}ms`)), timeoutMs);
        }),
      ]);
    } finally {
      if (timer) {
        clearTimeout(timer);
      }
    }
  }
}