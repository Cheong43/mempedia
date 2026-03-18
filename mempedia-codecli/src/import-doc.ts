/**
 * import-doc: CLI sub-command for importing human-readable documents into the
 * mempedia core-knowledge layer.
 *
 * Usage:
 *   node src/index.tsx import-doc --file <path> [--node-id <id>] [--title <title>]
 *   node src/index.tsx import-doc --dir <directory> [--recursive]
 *
 * Each imported file becomes one or more core-knowledge nodes via the `ingest`
 * action.  Large files are split on H1/H2 headings to keep nodes focused.
 */

import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { MempediaClient } from './mempedia/client.js';
import { resolveMempediaBinaryPath } from './config/projectPaths.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const SUPPORTED_EXTENSIONS = new Set(['.md', '.txt', '.mdx']);
// 8000 characters per chunk keeps each ingested node well within the LLM
// context window while still allowing rich content.  Adjust via the
// MEMPEDIA_CHUNK_CHARS environment variable if needed.
const MAX_CHUNK_CHARS = parseInt(process.env.MEMPEDIA_CHUNK_CHARS || '8000', 10);
const SPLIT_HEADING_RE = /^#{1,2}\s+/m;

interface ImportOptions {
  file?: string;
  dir?: string;
  nodeId?: string;
  title?: string;
  recursive?: boolean;
  source?: string;
}

function parseArgs(args: string[]): ImportOptions {
  const opts: ImportOptions = {};
  let i = 0;
  while (i < args.length) {
    switch (args[i]) {
      case '--file':
        opts.file = args[++i];
        break;
      case '--dir':
        opts.dir = args[++i];
        break;
      case '--node-id':
        opts.nodeId = args[++i];
        break;
      case '--title':
        opts.title = args[++i];
        break;
      case '--source':
        opts.source = args[++i];
        break;
      case '--recursive':
        opts.recursive = true;
        break;
      default:
        console.error(`Unknown import-doc argument: ${args[i]}`);
    }
    i++;
  }
  return opts;
}

/**
 * Collect markdown/text files from a directory.
 */
function collectFiles(dir: string, recursive: boolean): string[] {
  const results: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (recursive) {
        results.push(...collectFiles(full, recursive));
      }
    } else if (SUPPORTED_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) {
      results.push(full);
    }
  }
  return results;
}

/**
 * Derive a stable node id from a file path and optional heading title.
 */
function deriveNodeId(filePath: string, chunkTitle?: string): string {
  const base = path
    .basename(filePath, path.extname(filePath))
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 48);
  if (chunkTitle) {
    const slug = chunkTitle
      .toLowerCase()
      // Allow ASCII alphanumeric and CJK unified ideographs (U+4E00–U+9FFF)
      .replace(/[^a-z0-9\u4e00-\u9fff]+/g, '_')
      .replace(/^_+|_+$/g, '')
      .slice(0, 32);
    return `doc_${base}_${slug}`;
  }
  return `doc_${base}`;
}

/**
 * Split a document into chunks on H1/H2 headings or by character limit.
 * Returns an array of { title, text } chunks.
 */
function splitDocument(content: string, docTitle: string): Array<{ title: string; text: string }> {
  const lines = content.split('\n');
  const chunks: Array<{ title: string; lines: string[] }> = [];
  let currentTitle = docTitle;
  let currentLines: string[] = [];

  for (const line of lines) {
    const headingMatch = line.match(/^(#{1,2})\s+(.+)$/);
    if (headingMatch) {
      if (currentLines.some((l) => l.trim().length > 0)) {
        chunks.push({ title: currentTitle, lines: currentLines });
      }
      currentTitle = headingMatch[2].trim();
      currentLines = [line];
    } else {
      currentLines.push(line);
    }
  }
  if (currentLines.some((l) => l.trim().length > 0)) {
    chunks.push({ title: currentTitle, lines: currentLines });
  }

  // Further split chunks that exceed MAX_CHUNK_CHARS
  const result: Array<{ title: string; text: string }> = [];
  for (const chunk of chunks) {
    const text = chunk.lines.join('\n').trim();
    if (text.length <= MAX_CHUNK_CHARS) {
      result.push({ title: chunk.title, text });
    } else {
      // Split on paragraph boundaries
      const paragraphs = text.split(/\n{2,}/);
      let sub = '';
      let subIdx = 0;
      for (const para of paragraphs) {
        if (sub.length + para.length + 2 > MAX_CHUNK_CHARS && sub.length > 0) {
          result.push({ title: `${chunk.title} (${subIdx + 1})`, text: sub.trim() });
          sub = para;
          subIdx++;
        } else {
          sub = sub ? `${sub}\n\n${para}` : para;
        }
      }
      if (sub.trim().length > 0) {
        result.push({ title: `${chunk.title}${subIdx > 0 ? ` (${subIdx + 1})` : ''}`, text: sub.trim() });
      }
    }
  }

  return result.filter((c) => c.text.length >= 20);
}

/**
 * Import a single file into mempedia core knowledge.
 */
async function importFile(
  client: MempediaClient,
  filePath: string,
  opts: ImportOptions
): Promise<number> {
  const content = fs.readFileSync(filePath, 'utf-8');
  const docTitle = opts.title
    || content.match(/^#\s+(.+)$/m)?.[1]?.trim()
    || path.basename(filePath, path.extname(filePath));

  const chunks = splitDocument(content, docTitle);
  const source = opts.source || `import-doc:${path.basename(filePath)}`;
  let successCount = 0;

  if (chunks.length === 1 && opts.nodeId) {
    // Single chunk with explicit node id
    const res = await client.send({
      action: 'ingest',
      node_id: opts.nodeId,
      title: chunks[0].title,
      text: chunks[0].text,
      source,
      agent_id: 'import-doc',
      reason: `Imported from ${path.basename(filePath)}`,
      importance: 1.5,
    });
    if ((res as any).kind === 'error') {
      console.error(`  ✗ ${opts.nodeId}: ${(res as any).message}`);
    } else {
      console.log(`  ✓ ${opts.nodeId}`);
      successCount++;
    }
    return successCount;
  }

  for (const chunk of chunks) {
    const nodeId = chunks.length === 1 && opts.nodeId
      ? opts.nodeId
      : deriveNodeId(filePath, chunks.length > 1 ? chunk.title : undefined);
    try {
      const res = await client.send({
        action: 'ingest',
        node_id: nodeId,
        title: chunk.title,
        text: chunk.text,
        source,
        agent_id: 'import-doc',
        reason: `Imported from ${path.basename(filePath)}`,
        importance: 1.5,
      });
      if ((res as any).kind === 'error') {
        console.error(`  ✗ ${nodeId}: ${(res as any).message}`);
      } else {
        console.log(`  ✓ ${nodeId} ("${chunk.title.slice(0, 60)}")`);
        successCount++;
      }
    } catch (e: any) {
      console.error(`  ✗ ${nodeId}: ${e.message}`);
    }
  }

  return successCount;
}

/**
 * Entry point for the `import-doc` sub-command.
 * Returns an exit code (0 = success, 1 = failure).
 */
export async function importDocCommand(
  args: string[],
  projectRoot: string
): Promise<number> {
  const opts = parseArgs(args);

  if (!opts.file && !opts.dir) {
    console.error('import-doc: requires --file <path> or --dir <directory>');
    console.error('Usage:');
    console.error('  import-doc --file <path> [--node-id <id>] [--title <title>]');
    console.error('  import-doc --dir <directory> [--recursive]');
    return 1;
  }

  const binaryPath = resolveMempediaBinaryPath(__dirname);

  const client = new MempediaClient(projectRoot, binaryPath);
  client.start();

  let totalFiles = 0;
  let totalNodes = 0;

  try {
    const files: string[] = [];

    if (opts.file) {
      if (!fs.existsSync(opts.file)) {
        console.error(`import-doc: file not found: ${opts.file}`);
        return 1;
      }
      files.push(opts.file);
    } else if (opts.dir) {
      if (!fs.existsSync(opts.dir)) {
        console.error(`import-doc: directory not found: ${opts.dir}`);
        return 1;
      }
      files.push(...collectFiles(opts.dir, opts.recursive ?? false));
      if (files.length === 0) {
        console.warn(`import-doc: no supported files found in ${opts.dir}`);
        return 0;
      }
    }

    for (const filePath of files) {
      console.log(`\nImporting: ${filePath}`);
      const fileOpts = files.length === 1 ? opts : { ...opts, nodeId: undefined, title: undefined };
      const count = await importFile(client, filePath, fileOpts);
      totalNodes += count;
      totalFiles++;
    }

    console.log(`\nDone: imported ${totalNodes} node(s) from ${totalFiles} file(s).`);
    return 0;
  } catch (e: any) {
    console.error(`import-doc failed: ${e.message}`);
    return 1;
  } finally {
    client.stop();
  }
}
