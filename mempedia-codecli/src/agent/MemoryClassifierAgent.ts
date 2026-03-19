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

interface AtomicKnowledgeItem {
  keyword: string;
  summary: string;
  description: string;
  facts: string[];
  data_points: string[];
  truths: string[];
  viewpoints: string[];
  history: string[];
  uncertainties: string[];
  evidence: string[];
  relations: string[];
}

interface MemoryExtraction {
  user_preferences: Array<{ topic: string; preference: string; evidence: string }>;
  agent_skills: Array<{ skill_id: string; title: string; content: string; tags: string[] }>;
  atomic_knowledge: AtomicKnowledgeItem[];
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
      const atomicMap = new Map<string, AtomicKnowledgeItem>();
      for (const item of payload.atomic_knowledge) {
        atomicMap.set(this.stableNodeId('atomic', item.keyword), item);
      }
      for (const [nodeId, item] of atomicMap) {
        const resolvedRelations = await context.resolveRelationTargets(item.relations || []);
        const markdown = this.renderAtomicKnowledgeMarkdown(nodeId, item, resolvedRelations, nowIso, context.conversationId, context.runId);
        await runAction('atomic_upsert', {
          action: 'agent_upsert_markdown',
          node_id: nodeId,
          markdown,
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

  /**
   * Strips the "Internal skill guidance for this turn:" block that the agent framework
   * injects into job.input. These blocks contain Mempedia skill docs (including
   * backtick-quoted tool names like `edit`, `bash`, `read`, `search`, `web`) that the
   * LLM classifier would otherwise extract as false knowledge keywords.
   */
  private stripSkillGuidance(text: string): string {
    // Prefer the explicit "Actual User Request:" marker if present.
    const actualMatch = text.match(/\bActual User Request:\s*([\s\S]*?)(?:\n\nActive branch:|\n\nBranch goal:|$)/i);
    if (actualMatch) {
      return actualMatch[1].trim();
    }
    return text
      .replace(/\bInternal skill guidance for this turn:[\s\S]*?(?=\n\nActive branch:|\n\nBranch goal:|$)/gi, '')
      .replace(/^Original user request:\s*/im, '')
      .replace(/\n\nActive branch:[\s\S]*$/i, '')
      .replace(/\n\nBranch goal:[\s\S]*$/i, '')
      .trim() || text;
  }

  private async extractMemoryPayload(input: string, traces: MemoryClassifierTraceEvent[], answer: string): Promise<MemoryExtraction> {
    const traceLines = traces
      .slice(-30)
      .map((trace) => `${trace.type.toUpperCase()}: ${trace.content}`)
      .join('\n');
    // Strip skill guidance injected by the framework before sending to the LLM classifier.
    // Without this, tool names like `edit`, `bash`, `read` appear in backtick-quoted text
    // and the LLM may extract them as knowledge keywords.
    const strippedInput = this.stripSkillGuidance(input);
    const compactInput = this.clipText(strippedInput || input, this.extractionMaxChars);
    const compactTraces = this.clipText(traceLines, Math.max(2000, Math.floor(this.extractionMaxChars / 2)));
    const compactAnswer = this.clipText(answer, Math.max(1000, Math.floor(this.extractionMaxChars / 3)));
    const classifierSkill = this.loadMemoryClassifierSkill();
    const extractionPrompt = `你是一个独立的 MemoryClassifierAgent，运行在企业型知识库 Mempedia 中。你的任务是在每轮对话结束后，对对话进行四层分类，并只输出 JSON（不要 markdown）。\n\n${classifierSkill ? `Memory classification skill guidance:\n${classifierSkill}\n\n` : ''}输出格式：\n{\n  "user_preferences": [\n    { "topic": "偏好主题", "preference": "稳定偏好结论", "evidence": "证据摘要" }\n  ],\n  "agent_skills": [\n    { "skill_id": "稳定技能ID", "title": "技能标题", "content": "可复用步骤", "tags": ["tag1", "tag2"] }\n  ],\n  "atomic_knowledge": [\n    {\n      "keyword": "知识主题或实体名",\n      "summary": "短摘要",\n      "description": "完整描述，保留关键细节",\n      "facts": ["稳定事实1", "稳定事实2"],\n      "data_points": ["数字、版本、日期、阈值、配置值等数据点"],\n      "truths": ["已验证结论或明确为真的断言"],\n      "viewpoints": ["观点、立场、评价，必须保留归属或语气"],\n      "history": ["历史变迁、版本演进、前后变化"],\n      "uncertainties": ["尚未确认、条件性限制、已知未知"],\n      "evidence": ["README/源码/配置/回答中的证据摘要"],\n      "relations": ["相关项"]\n    }\n  ]\n}\n\n规则：\n1. Layer 1 Core Knowledge：只提取稳定、可复用、对后续推理有价值的知识点。\n2. Layer 2 Episodic Memory：由宿主流程单独记录，你不需要输出 episodic 字段，但你的分类必须避免把短暂事件误提取到 Layer 1/3/4。\n3. Layer 3 User Preferences：仅提取稳定偏好，不要记录当前轮一次性要求。\n4. Layer 4 Skills：仅提取可复用工作流、策略、步骤，不要提取一次性执行日志。\n5. 如果内容明确来自 README、源码、配置、schema、项目结构、已验证接口或用户明确提供的数据，应优先进入 atomic_knowledge。\n6. atomic_knowledge 要优先少而精，不要拆成很多空洞节点；每个节点都应尽可能完整，保留事实、描述、历史、真值结论、观点、数据和不确定性。\n7. 观点和事实必须分开；如果某段内容是评价、偏好、判断或立场，放入 viewpoints，并保留“谁这样认为/语气来源”这类归属信息。\n8. 严禁伪造事实；没有证据就不要补写。拿不准就放入 uncertainties，或者留空数组。\n9. 忽略寒暄、临时状态、报错噪音、调度包装文本。忽略所有框架控制文本（“Original user request”“Active branch”“Branch goal”“Internal skill guidance”“Actual User Request”）。工具名称 read、search、edit、bash、web 是框架内部工具，绝对不能成为 atomic_knowledge 的 keyword。\n10. 如果「最终回答」主要是报错、失败通知、无法完成说明，则 atomic_knowledge 必须返回空数组。\n11. 如果某一层没有内容，返回空数组。`;

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
            if (!keyword || this.isWeakAtomicKeyword(keyword)) {
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
            const facts = this.normalizeStringList(item?.facts ?? item?.claims ?? item?.key_facts, 12);
            const dataPoints = this.normalizeStringList(item?.data_points ?? item?.data ?? item?.numbers, 12);
            const truths = this.normalizeStringList(item?.truths ?? item?.verified_points ?? item?.verified_facts, 10);
            const viewpoints = this.normalizeStringList(item?.viewpoints ?? item?.opinions ?? item?.perspectives, 10);
            const history = this.normalizeStringList(item?.history ?? item?.historical_changes ?? item?.timeline ?? item?.evolution, 10);
            const uncertainties = this.normalizeStringList(item?.uncertainties ?? item?.unknowns ?? item?.open_questions, 10);
            const evidence = this.normalizeStringList(item?.evidence ?? item?.sources ?? item?.source_evidence, 12);
            const description = this.normalizeDetails(
              item?.description || item?.details || item?.summary || facts.slice(0, 3).join('\n'),
              keyword
            );
            const summary = this.normalizeSummary(item?.summary || description, keyword);
            // Reject items whose summary is still greeting-like or is a degenerate fallback.
            if (this.isGreetingText(summary) || summary === `${keyword} summary`) {
              return null;
            }
            return {
              keyword,
              summary,
              description,
              facts,
              data_points: dataPoints,
              truths,
              viewpoints,
              history,
              uncertainties,
              evidence,
              relations,
            };
          }).filter((item: any) => Boolean(item))
        : [];

      return {
        user_preferences: preferences.slice(0, 12),
        agent_skills: skills.slice(0, 12),
        atomic_knowledge: atomic.slice(0, 20) as AtomicKnowledgeItem[],
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
    // Mask URLs so dots inside them don't trigger false sentence boundaries.
    const masked = trimmed.replace(/https?:\/\/\S+/gi, (url) => 'U'.repeat(url.length));
    const match = masked.match(/^[^。.!?\n]{12,200}[。.!?\n]/u);
    if (match) {
      return trimmed.slice(0, match[0].length).replace(/[\n\r]+/g, ' ').trim();
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

    // Only scan the answer text — scanning input (which contains skill guidance with
    // backtick-wrapped tool names) causes framework tool names to be extracted as keywords.
    const textPool = answer;
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

    // For the user request line, strip skill guidance first so we don't extract tool names.
    const strippedRequest = this.stripSkillGuidance(input);
    const requestFirstLine = strippedRequest.split(/\r?\n/).map((line) => line.trim()).find((line) => line.length >= 8);
    if (requestFirstLine) {
      const trimmed = requestFirstLine.replace(/[\p{P}\p{S}]+/gu, ' ').trim();
      push(trimmed.slice(0, 60));
    }

    return candidates.slice(0, 8);
  }

  private isErrorOrFailureAnswer(answer: string): boolean {
    const compact = answer.replace(/\s+/g, ' ').trim();
    if (compact.length < 20) {
      return false;
    }
    if (/\b(no such file or directory|binary not found|command not found|cannot connect|connection refused|inaccessible or invalid|failed to fetch|unable to access|permission denied|404 not found|403 forbidden|requested wikipedia url)\b/i.test(compact)) {
      return true;
    }
    if (compact.length < 300 && /^(error|an error|the system encountered an error|failed to|could not|unable to|sorry|unfortunately)\b/i.test(compact)) {
      return true;
    }
    return false;
  }

  private fallbackExtractAtomic(input: string, answer: string): AtomicKnowledgeItem[] {
    if (this.isErrorOrFailureAnswer(answer)) {
      return [];
    }
    const candidates = this.collectAtomicCandidates(input, answer);
    if (candidates.length === 0) {
      return [];
    }
    const answerLines = answer
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line.length > 0 && this.isValuableKnowledgeLine(line));
    // Discard answers that are purely greeting text — they have no extractable knowledge.
    const safeSummarySeed = this.firstSentence(answer) || this.firstSentence(input) || '';
    const summarySeed = this.isGreetingText(safeSummarySeed) ? '' : safeSummarySeed;
    const candidateSet = new Set(candidates.map((candidate) => candidate.toLowerCase()));

    return candidates.map((candidate) => {
      const candidateLower = candidate.toLowerCase();
      const matchingLines = answerLines.filter((line) => line.toLowerCase().includes(candidateLower));
      const detailsSource = matchingLines.slice(0, 3).join('\n') || answerLines.slice(0, 3).join('\n') || summarySeed || candidate;
      const summarySource = matchingLines[0] || summarySeed || candidate;
      const history = detailsSource === summarySource ? [] : [detailsSource];
      const facts = matchingLines.slice(0, 4);
      const dataPoints = facts.filter((line) => /\d/.test(line)).slice(0, 4);
      const relations = candidates
        .filter((other) => other.toLowerCase() !== candidateLower && candidateSet.has(other.toLowerCase()))
        .slice(0, 4);
      const summary = this.normalizeSummary(summarySource, candidate);
      // Skip fallback candidates that can't produce a real summary.
      if (this.isGreetingText(summary) || summary === `${candidate} summary`) {
        return null;
      }
      return {
        keyword: candidate,
        summary,
        description: this.normalizeDetails(detailsSource, candidate),
        facts,
        data_points: dataPoints,
        truths: [],
        viewpoints: [],
        history,
        uncertainties: [],
        evidence: [],
        relations,
      };
    }).filter((item): item is NonNullable<typeof item> => item !== null && Boolean(item.keyword) && Boolean(item.summary)) as AtomicKnowledgeItem[];
  }

  private normalizeStringList(value: unknown, limit: number): string[] {
    if (Array.isArray(value)) {
      const out: string[] = [];
      const seen = new Set<string>();
      for (const item of value) {
        const cleaned = String(item || '').replace(/\s+/g, ' ').trim();
        if (!cleaned) {
          continue;
        }
        const key = cleaned.toLowerCase();
        if (seen.has(key)) {
          continue;
        }
        seen.add(key);
        out.push(cleaned);
        if (out.length >= limit) {
          break;
        }
      }
      return out;
    }
    if (typeof value === 'string') {
      return value
        .split(/\r?\n|[;；]/)
        .map((item) => item.replace(/^[-*+\d.\s]+/, '').replace(/\s+/g, ' ').trim())
        .filter(Boolean)
        .slice(0, limit);
    }
    return [];
  }

  private isWeakAtomicKeyword(keyword: string): boolean {
    const lower = keyword.trim().toLowerCase();
    if (/^(with|using|use|instead of|when|how|why|what|that|this|these|those|then|for|to|if|because)\b/.test(lower)) {
      return true;
    }
    // Reject framework tool names and generic programming/infra noise words.
    const toolAndNoiseWords = new Set([
      'edit', 'read', 'search', 'bash', 'web', 'tool', 'tools', 'mempedia', 'cli',
      'error', 'result', 'output', 'response', 'request', 'input', 'command',
      'action', 'function', 'method', 'status', 'code', 'message', 'data',
      'type', 'value', 'key', 'node', 'null', 'undefined', 'true', 'false', 'none', 'ok',
    ]);
    if (toolAndNoiseWords.has(lower)) {
      return true;
    }
    return false;
  }

  private isGreetingText(text: string): boolean {
    const compact = text.replace(/\s+/g, ' ').trim().toLowerCase();
    // Reject text that starts with a greeting phrase — these are chat noise, not knowledge summaries.
    return /^(hi|hello|hey|how can i|how may i|how can i help|how can i assist|greetings|good morning|good afternoon|good evening|nice to meet|你好|嗨|哈喽|很高兴|有什么我可以)\b/.test(compact);
  }

  private renderAtomicKnowledgeMarkdown(
    nodeId: string,
    item: AtomicKnowledgeItem,
    resolvedRelations: Array<{ label: string; target?: string }>,
    updatedAt: string,
    conversationId: string,
    runId: string,
  ): string {
    const relationLines = resolvedRelations
      .map((relation) => this.inlineValue(relation.target || relation.label))
      .filter(Boolean)
      .map((relation) => `- ${relation} | related | 0.8`);
    const evidenceLines = this.normalizeStringList([
      `conversation:${conversationId}`,
      `memory_run:${runId}`,
      ...item.evidence,
    ], 16).map((entry) => `- ${this.inlineValue(entry)}`);
    const facts = this.buildAtomicFacts(item, updatedAt);
    const sections = [
      this.renderBulletFactSection('Facts', facts),
      this.renderBulletListSection('Data', item.data_points),
      this.renderBulletListSection('History', item.history),
      this.renderBulletListSection('Viewpoints', item.viewpoints),
      this.renderBulletListSection('Uncertainties', item.uncertainties),
      relationLines.length > 0 ? ['## Relations', ...relationLines].join('\n') : '',
      evidenceLines.length > 0 ? ['## Evidence', ...evidenceLines].join('\n') : '',
    ].filter((section) => section.length > 0);

    return [
      '---',
      `node_id: "${this.yamlEscape(nodeId)}"`,
      `title: "${this.yamlEscape(item.keyword)}"`,
      `summary: "${this.yamlEscape(item.summary)}"`,
      'source: "kg_atomic"',
      'origin: "mempedia-memory-classifier"',
      'node_type: "reference"',
      '---',
      '',
      `# ${item.keyword}`,
      '',
      item.description.trim() || item.summary,
      ...(sections.length > 0 ? ['', ...sections] : []),
      '',
    ].join('\n');
  }

  private buildAtomicFacts(item: AtomicKnowledgeItem, updatedAt: string): Array<{ key: string; value: string }> {
    const facts: Array<{ key: string; value: string }> = [
      { key: 'summary', value: item.summary },
      { key: 'updated_at', value: updatedAt },
    ];
    item.facts.slice(0, 10).forEach((fact, index) => {
      facts.push({ key: `fact_${String(index + 1).padStart(2, '0')}`, value: fact });
    });
    item.truths.slice(0, 10).forEach((fact, index) => {
      facts.push({ key: `truth_${String(index + 1).padStart(2, '0')}`, value: fact });
    });
    item.data_points.slice(0, 10).forEach((fact, index) => {
      facts.push({ key: `data_point_${String(index + 1).padStart(2, '0')}`, value: fact });
    });
    return facts;
  }

  private renderBulletFactSection(title: string, facts: Array<{ key: string; value: string }>): string {
    const lines = facts
      .map(({ key, value }) => {
        const normalizedValue = this.inlineValue(value);
        return normalizedValue ? `- ${key}: ${normalizedValue}` : '';
      })
      .filter(Boolean);
    if (lines.length === 0) {
      return '';
    }
    return [`## ${title}`, ...lines].join('\n');
  }

  private renderBulletListSection(title: string, items: string[]): string {
    const lines = this.normalizeStringList(items, 12)
      .map((value) => `- ${this.inlineValue(value)}`)
      .filter((value) => value !== '- ');
    if (lines.length === 0) {
      return '';
    }
    return [`## ${title}`, ...lines].join('\n');
  }

  private inlineValue(value: string): string {
    return String(value || '').replace(/\s+/g, ' ').trim();
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
    if (compact.length >= 8 && !this.isGreetingText(compact)) {
      return compact.slice(0, 140);
    }
    const fb = fallback.replace(/\s+/g, ' ').trim();
    if (fb.length >= 8 && !this.isGreetingText(fb)) {
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

  private yamlEscape(value: string): string {
    return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\r?\n/g, ' ').trim();
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