import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

import {
  executeMempediaCliAction,
  installWorkspaceSkillFromLibraryViaCli,
  listOrSearchEpisodicViaCli,
  readUserPreferencesViaCli,
  updateUserPreferencesViaCli,
} from './cli.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function createTempDir(prefix: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

test('skill library helper reads library records through the mempedia CLI', async () => {
  const projectRoot = createTempDir('mempedia-cli-helper-');

  const upserted = await executeMempediaCliAction(__dirname, projectRoot, {
    action: 'upsert_skill',
    skill_id: 'helper_skill',
    title: 'Helper Skill',
    content: 'Reusable workflow steps.',
    tags: ['cli'],
  });
  assert.equal((upserted as any).kind, 'skill_result');

  const listed = await executeMempediaCliAction(__dirname, projectRoot, { action: 'list_skills' });
  assert.equal((listed as any).kind, 'skill_list');
  assert.ok(((listed as any).skills || []).some((skill: any) => skill.id === 'helper_skill'));

  const read = await executeMempediaCliAction(__dirname, projectRoot, { action: 'read_skill', skill_id: 'helper_skill' });
  assert.equal((read as any).kind, 'skill_result');
  assert.equal((read as any).skill_id, 'helper_skill');
});

test('skill install helper downloads a library skill into local skills directory', async () => {
  const projectRoot = createTempDir('mempedia-cli-install-project-');
  const codeCliRoot = createTempDir('mempedia-cli-install-codecli-');
  fs.mkdirSync(path.join(codeCliRoot, 'skills'), { recursive: true });

  await executeMempediaCliAction(__dirname, projectRoot, {
    action: 'upsert_skill',
    skill_id: 'downloadable_skill',
    title: 'Downloadable Skill',
    content: 'Use this skill for download regression coverage.',
    tags: ['download'],
  });

  const installed = await installWorkspaceSkillFromLibraryViaCli(
    __dirname,
    projectRoot,
    'downloadable_skill',
    false,
    codeCliRoot,
  );

  assert.equal(installed.kind, 'skill_installed');
  assert.ok(installed.path);
  assert.ok(fs.existsSync(installed.path!));

  const markdown = fs.readFileSync(installed.path!, 'utf-8');
  assert.match(markdown, /^---/);
  assert.match(markdown, /name: downloadable_skill/);
  assert.match(markdown, /description: "Use this skill for download regression coverage\."/);
  assert.match(markdown, /Use this skill for download regression coverage\./);
});

test('preferences and episodic helpers read and write through the mempedia CLI', async () => {
  const projectRoot = createTempDir('mempedia-cli-pref-episodic-');

  const updatedPreferences = await updateUserPreferencesViaCli(
    __dirname,
    projectRoot,
    '# User Preferences\n- Prefer concise technical answers',
  );
  assert.equal((updatedPreferences as any).kind, 'user_preferences');
  assert.match(String((updatedPreferences as any).content || ''), /Prefer concise technical answers/);

  const readPreferences = await readUserPreferencesViaCli(__dirname, projectRoot);
  assert.equal((readPreferences as any).kind, 'user_preferences');
  assert.match(String((readPreferences as any).content || ''), /Prefer concise technical answers/);

  const recorded = await executeMempediaCliAction(__dirname, projectRoot, {
    action: 'record_episodic',
    scene_type: 'task',
    summary: 'CLI helper episodic regression',
    tags: ['cli'],
  });
  assert.equal((recorded as any).kind, 'episodic_results');

  const listed = await listOrSearchEpisodicViaCli(__dirname, projectRoot, { limit: 5 });
  assert.equal((listed as any).kind, 'episodic_results');
  assert.ok(((listed as any).memories || []).some((item: any) => item.summary === 'CLI helper episodic regression'));

  const searched = await listOrSearchEpisodicViaCli(__dirname, projectRoot, { query: 'episodic regression', limit: 5 });
  assert.equal((searched as any).kind, 'episodic_results');
  assert.ok(((searched as any).memories || []).some((item: any) => item.summary === 'CLI helper episodic regression'));
});