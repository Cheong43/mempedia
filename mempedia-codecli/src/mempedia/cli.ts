import * as fs from 'fs';
import * as path from 'path';
import { spawn } from 'child_process';

import { resolveMempediaBinaryPath } from '../config/projectPaths.js';
import type { SkillRecord, SkillSearchHit, ToolAction, ToolResponse } from './types.js';

export interface SkillInstalledResult {
  kind: 'skill_installed' | 'error';
  skill_id: string;
  path?: string;
  message: string;
}

type SkillListResponse = { kind: 'skill_list'; skills: SkillRecord[] };
type SkillResultsResponse = { kind: 'skill_results'; results: SkillSearchHit[] };
type SkillResultResponse = { kind: 'skill_result'; skill_id: string; title: string; content: string; tags: string[]; updated_at: number };

function yamlEscape(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

function firstSentence(text: string): string {
  const cleaned = text.replace(/\s+/g, ' ').trim();
  if (!cleaned) {
    return '';
  }
  const match = cleaned.match(/^(.+?[.!?。！？])(?:\s|$)/);
  return match ? match[1].trim() : cleaned.slice(0, 160).trim();
}

function toSlug(value: string): string {
  const normalized = value
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 72);
  return normalized || 'empty';
}

function ensureSkillMarkdown(skillId: string, title: string, content: string, tags: string[] = []): string {
  const trimmed = content.trim();
  if (/^---\s*[\r\n]+[\s\S]*?[\r\n]+---\s*/.test(trimmed)) {
    return trimmed.endsWith('\n') ? trimmed : `${trimmed}\n`;
  }
  const description = yamlEscape(firstSentence(trimmed) || title || skillId);
  const tagLine = tags.length > 0
    ? `tags: [${tags.map((tag) => `"${yamlEscape(tag)}"`).join(', ')}]\n`
    : '';
  return `---\nname: ${yamlEscape(skillId)}\ndescription: "${description}"\n${tagLine}---\n\n${trimmed}\n`;
}

export async function runMempediaCliAction(projectRoot: string, action: ToolAction, binaryPath?: string): Promise<ToolResponse> {
  const resolvedBinaryPath = resolveMempediaBinaryPath(import.meta.dirname, binaryPath);

  return await new Promise<ToolResponse>((resolve, reject) => {
    const child = spawn(resolvedBinaryPath, ['--project', projectRoot, '--stdin'], {
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });
    child.on('error', (error) => {
      reject(error);
    });
    child.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(stderr.trim() || stdout.trim() || `mempedia CLI exited with code ${code}`));
        return;
      }
      const text = stdout.trim();
      if (!text) {
        reject(new Error('mempedia CLI returned empty stdout'));
        return;
      }
      try {
        resolve(JSON.parse(text) as ToolResponse);
      } catch (error) {
        reject(new Error(`Failed to parse mempedia CLI response: ${text}`));
      }
    });

    child.stdin.write(JSON.stringify(action));
    child.stdin.end();
  });
}

export async function listSkillsViaCli(projectRoot: string, query?: string, limit?: number): Promise<SkillListResponse | SkillResultsResponse | { kind: 'error'; message: string }> {
  if (query && query.trim()) {
    return await runMempediaCliAction(projectRoot, {
      action: 'search_skills',
      query: query.trim(),
      limit,
    });
  }
  return await runMempediaCliAction(projectRoot, { action: 'list_skills' });
}

export async function readSkillViaCli(projectRoot: string, skillId: string): Promise<SkillResultResponse | { kind: 'error'; message: string }> {
  return await runMempediaCliAction(projectRoot, { action: 'read_skill', skill_id: skillId.trim() });
}

export async function upsertSkillViaCli(
  projectRoot: string,
  input: { skill_id: string; title: string; content: string; tags?: string[] }
): Promise<SkillResultResponse | { kind: 'error'; message: string }> {
  return await runMempediaCliAction(projectRoot, {
    action: 'upsert_skill',
    skill_id: input.skill_id,
    title: input.title,
    content: input.content,
    tags: input.tags,
  });
}

export async function installWorkspaceSkillFromLibrary(
  projectRoot: string,
  codeCliRoot: string,
  skillId: string,
  overwrite = false,
): Promise<SkillInstalledResult> {
  const normalizedSkillId = skillId.trim();
  if (!normalizedSkillId) {
    return { kind: 'error', skill_id: '', message: 'skill_id is required' };
  }

  const res = await readSkillViaCli(projectRoot, normalizedSkillId);
  if (res.kind !== 'skill_result') {
    return {
      kind: 'error',
      skill_id: normalizedSkillId,
      message: res.message || 'skill not found in mempedia library',
    };
  }

  const skillFolder = path.join(codeCliRoot, 'skills', toSlug(normalizedSkillId));
  const skillFilePath = path.join(skillFolder, 'SKILL.md');
  if (!overwrite && fs.existsSync(skillFilePath)) {
    return {
      kind: 'skill_installed',
      skill_id: normalizedSkillId,
      path: skillFilePath,
      message: 'local skill already exists',
    };
  }

  await fs.promises.mkdir(skillFolder, { recursive: true });
  const markdown = ensureSkillMarkdown(
    String(res.skill_id || normalizedSkillId),
    String(res.title || normalizedSkillId),
    String(res.content || ''),
    Array.isArray(res.tags) ? res.tags.filter((tag): tag is string => typeof tag === 'string') : [],
  );
  await fs.promises.writeFile(skillFilePath, markdown, 'utf-8');

  return {
    kind: 'skill_installed',
    skill_id: normalizedSkillId,
    path: skillFilePath,
    message: 'skill downloaded to local workspace',
  };
}