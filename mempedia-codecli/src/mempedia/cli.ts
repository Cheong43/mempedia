import { spawn } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';

import { resolveCodeCliRoot, resolveMempediaBinaryPath } from '../config/projectPaths.js';
import type { ToolAction, ToolResponse } from './types.js';

type SkillInstallResult = { kind: string; skill_id: string; path?: string; message: string };

function toSlug(value: string): string {
  const normalized = value
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 72);
  return normalized || 'empty';
}

function yamlEscape(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

function firstSentence(text: string): string {
  const trimmed = text.trim();
  if (!trimmed) {
    return '';
  }
  const match = trimmed.match(/^(.+?[。！？!?\.]|.+$)/s);
  return match ? match[1].trim() : trimmed;
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

export async function executeMempediaCliAction(
  moduleDir: string,
  projectRoot: string,
  payload: ToolAction | Record<string, unknown>,
): Promise<ToolResponse | Record<string, unknown>> {
  const binaryPath = resolveMempediaBinaryPath(moduleDir);
  const serialized = JSON.stringify(payload);

  return await new Promise((resolve, reject) => {
    const child = spawn(binaryPath, ['--project', projectRoot, '--stdin'], {
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';

    child.stdout.setEncoding('utf-8');
    child.stderr.setEncoding('utf-8');

    child.stdout.on('data', (chunk: string) => {
      stdout += chunk;
    });
    child.stderr.on('data', (chunk: string) => {
      stderr += chunk;
    });
    child.on('error', (error) => {
      reject(error);
    });
    child.on('close', (code) => {
      if (code !== 0) {
        reject(new Error((stderr || stdout || `mempedia exited with code ${code}`).trim()));
        return;
      }
      const trimmed = stdout.trim();
      if (!trimmed) {
        reject(new Error('mempedia CLI returned empty stdout'));
        return;
      }
      try {
        resolve(JSON.parse(trimmed) as ToolResponse | Record<string, unknown>);
      } catch (error: any) {
        reject(new Error(`Failed to parse mempedia CLI JSON: ${error?.message || String(error)}\n${trimmed}`));
      }
    });

    child.stdin.end(serialized);
  });
}

export async function readUserPreferencesViaCli(
  moduleDir: string,
  projectRoot: string,
): Promise<ToolResponse | Record<string, unknown>> {
  return executeMempediaCliAction(moduleDir, projectRoot, { action: 'read_user_preferences' });
}

export async function updateUserPreferencesViaCli(
  moduleDir: string,
  projectRoot: string,
  content: string,
): Promise<ToolResponse | Record<string, unknown>> {
  return executeMempediaCliAction(moduleDir, projectRoot, {
    action: 'update_user_preferences',
    content,
  });
}

export async function listOrSearchEpisodicViaCli(
  moduleDir: string,
  projectRoot: string,
  options: { query?: string; limit?: number; beforeTs?: number } = {},
): Promise<ToolResponse | Record<string, unknown>> {
  const query = options.query?.trim();
  if (query) {
    return executeMempediaCliAction(moduleDir, projectRoot, {
      action: 'search_episodic',
      query,
      limit: options.limit,
    });
  }
  return executeMempediaCliAction(moduleDir, projectRoot, {
    action: 'list_episodic',
    limit: options.limit,
    before_ts: options.beforeTs,
  });
}

export async function installWorkspaceSkillFromLibraryViaCli(
  moduleDir: string,
  projectRoot: string,
  skillId: string,
  overwrite = false,
  codeCliRoot = resolveCodeCliRoot(moduleDir),
): Promise<SkillInstallResult> {
  const normalizedSkillId = skillId.trim();
  if (!normalizedSkillId) {
    return { kind: 'error', skill_id: '', message: 'skill_id is required' };
  }

  const res = await executeMempediaCliAction(moduleDir, projectRoot, {
    action: 'read_skill',
    skill_id: normalizedSkillId,
  });
  if ((res as any)?.kind !== 'skill_result') {
    return {
      kind: 'error',
      skill_id: normalizedSkillId,
      message: (res as any)?.message || 'skill not found in mempedia library',
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

  fs.mkdirSync(skillFolder, { recursive: true });
  const markdown = ensureSkillMarkdown(
    String((res as any).skill_id || normalizedSkillId),
    String((res as any).title || normalizedSkillId),
    String((res as any).content || ''),
    Array.isArray((res as any).tags) ? (res as any).tags.filter((tag: unknown): tag is string => typeof tag === 'string') : [],
  );
  fs.writeFileSync(skillFilePath, markdown, 'utf-8');
  return {
    kind: 'skill_installed',
    skill_id: normalizedSkillId,
    path: skillFilePath,
    message: 'skill downloaded to local workspace',
  };
}