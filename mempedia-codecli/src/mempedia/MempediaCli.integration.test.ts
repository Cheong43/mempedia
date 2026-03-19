import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { resolveMempediaBinaryPath } from '../config/projectPaths.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function createTempProjectRoot(prefix: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function mempediaBinaryPath(): string {
  return resolveMempediaBinaryPath(__dirname);
}

function runCli(projectRoot: string, payload: Record<string, unknown>, mode: 'stdin' | 'action' = 'stdin'): any {
  const args = ['--project', projectRoot];
  const json = JSON.stringify(payload);
  if (mode === 'stdin') {
    args.push('--stdin');
  } else {
    args.push('--action', json);
  }

  const result = spawnSync(mempediaBinaryPath(), args, {
    input: mode === 'stdin' ? json : undefined,
    encoding: 'utf-8',
  });

  assert.equal(result.status, 0, result.stderr || result.stdout || 'mempedia CLI exited with non-zero status');
  assert.ok(result.stdout.trim().length > 0, 'mempedia CLI returned empty stdout');
  return JSON.parse(result.stdout.trim());
}

test('mempedia CLI exposes help and resolves the project data dir', () => {
  const projectRoot = createTempProjectRoot('mempedia-cli-help-');
  const help = spawnSync(mempediaBinaryPath(), ['--help'], { encoding: 'utf-8' });
  assert.equal(help.status, 0, help.stderr || help.stdout);
  assert.match(help.stdout, /--action/);
  assert.match(help.stdout, /--stdin/);

  const dataDir = spawnSync(mempediaBinaryPath(), ['--project', projectRoot, '--print-data-dir'], { encoding: 'utf-8' });
  assert.equal(dataDir.status, 0, dataDir.stderr || dataDir.stdout);
  assert.equal(dataDir.stdout.trim(), path.join(projectRoot, '.mempedia', 'memory'));
});

test('mempedia CLI supports Layer 1 and project operations used by skills', () => {
  const projectRoot = createTempProjectRoot('mempedia-cli-layer1-');

  const project = runCli(projectRoot, {
    action: 'create_project',
    project_id: 'cli_project',
    name: 'CLI Project',
    description: 'Regression coverage for project actions',
    tags: ['cli'],
  }, 'action');
  assert.equal(project.kind, 'project_result');
  assert.equal(project.project.project_id, 'cli_project');

  const version = runCli(projectRoot, {
    action: 'ingest',
    node_id: 'cli_regression_node',
    title: 'CLI Regression Node',
    text: 'Regression body text for mempedia CLI tests.',
    summary: 'Regression summary',
    source: 'codecli-test',
    project: 'cli_project',
    importance: 0.8,
  });
  assert.equal(version.kind, 'version');
  assert.equal(version.version.node_id, 'cli_regression_node');

  const open = runCli(projectRoot, { action: 'open_node', node_id: 'cli_regression_node', markdown: false });
  assert.equal(open.kind, 'optional_version');
  assert.equal(open.version.node_id, 'cli_regression_node');

  const search = runCli(projectRoot, { action: 'search_nodes', query: 'Regression body', limit: 5 });
  assert.equal(search.kind, 'search_results');
  assert.ok(search.results.some((item: any) => item.node_id === 'cli_regression_node'));

  const history = runCli(projectRoot, { action: 'node_history', node_id: 'cli_regression_node', limit: 5 });
  assert.equal(history.kind, 'history');
  assert.ok(Array.isArray(history.items));
  assert.ok(history.items.length >= 1);

  const projects = runCli(projectRoot, { action: 'list_projects' });
  assert.equal(projects.kind, 'project_list');
  assert.ok(projects.projects.some((item: any) => item.project_id === 'cli_project'));

  const projectNodes = runCli(projectRoot, { action: 'list_project_nodes', project_id: 'cli_project' });
  assert.equal(projectNodes.kind, 'project_nodes');
  assert.ok(projectNodes.nodes.includes('cli_regression_node'));
});

test('mempedia CLI supports episodic memory and preferences operations used by skills', () => {
  const projectRoot = createTempProjectRoot('mempedia-cli-layer23-');

  const recorded = runCli(projectRoot, {
    action: 'record_episodic',
    scene_type: 'task',
    summary: 'Regression episodic event',
    tags: ['cli'],
  });
  assert.equal(recorded.kind, 'episodic_results');
  assert.ok(recorded.memories.some((item: any) => item.summary === 'Regression episodic event'));

  const listed = runCli(projectRoot, { action: 'list_episodic', limit: 5 });
  assert.equal(listed.kind, 'episodic_results');
  assert.ok(listed.memories.some((item: any) => item.summary === 'Regression episodic event'));

  const searched = runCli(projectRoot, { action: 'search_episodic', query: 'Regression episodic', limit: 5 });
  assert.equal(searched.kind, 'episodic_results');
  assert.ok(searched.memories.some((item: any) => item.summary === 'Regression episodic event'));

  const updatedPreferences = runCli(projectRoot, {
    action: 'update_user_preferences',
    content: '# User Preferences\n- Prefer concise technical answers',
  });
  assert.equal(updatedPreferences.kind, 'user_preferences');
  assert.match(updatedPreferences.content, /Prefer concise technical answers/);

  const readPreferences = runCli(projectRoot, { action: 'read_user_preferences' });
  assert.equal(readPreferences.kind, 'user_preferences');
  assert.match(readPreferences.content, /Prefer concise technical answers/);
});

test('mempedia CLI supports Layer 4 skill operations used by skills', () => {
  const projectRoot = createTempProjectRoot('mempedia-cli-layer4-');

  const upserted = runCli(projectRoot, {
    action: 'upsert_skill',
    skill_id: 'cli_skill',
    title: 'CLI Skill',
    content: 'Reusable workflow steps for regression tests.',
    tags: ['cli', 'test'],
  });
  assert.equal(upserted.kind, 'skill_result');
  assert.equal(upserted.skill_id, 'cli_skill');

  const listed = runCli(projectRoot, { action: 'list_skills' });
  assert.equal(listed.kind, 'skill_list');
  assert.ok(listed.skills.some((item: any) => item.id === 'cli_skill'));

  const read = runCli(projectRoot, { action: 'read_skill', skill_id: 'cli_skill' });
  assert.equal(read.kind, 'skill_result');
  assert.equal(read.title, 'CLI Skill');

  const searched = runCli(projectRoot, { action: 'search_skills', query: 'regression', limit: 5 });
  assert.equal(searched.kind, 'skill_results');
  assert.ok(searched.results.some((item: any) => item.skill_id === 'cli_skill'));
});