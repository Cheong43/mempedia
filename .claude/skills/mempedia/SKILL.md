---
name: mempedia-conventions
description: Development conventions and patterns for mempedia. TypeScript project with mixed commits.
---

# Mempedia Conventions

> Generated from [Cheong43/mempedia](https://github.com/Cheong43/mempedia) on 2026-03-17

## Overview

This skill teaches Claude the development patterns and conventions used in mempedia.

## Tech Stack

- **Primary Language**: TypeScript
- **Architecture**: type-based module organization
- **Test Location**: mixed
- **Test Framework**: vitest

## When to Use This Skill

Activate this skill when:
- Making changes to this repository
- Adding new features following established patterns
- Writing tests that match project conventions
- Creating commits with proper message format

## Commit Conventions

Follow these commit message conventions based on 8 analyzed commits.

### Commit Style: Mixed Style

### Prefixes Used

- `feat`
- `refactor`
- `chore`
- `fix`

### Message Guidelines

- Average message length: ~63 characters
- Keep first line concise and descriptive
- Use imperative mood ("Add feature" not "Added feature")


*Commit message example*

```text
refactor: apply code review - use if let for Option guards, avoid HashMap clone in ensure_markdown_projection
```

*Commit message example*

```text
feat: enterprise KB architecture with project hierarchy, Notion-style parent nodes, and node types
```

*Commit message example*

```text
fix: address code review issues (hex validation, frontmatter parsing, ID collision, section replace bug, docs)
```

*Commit message example*

```text
chore: clean up mempedia knowledge graph and update gitignore
```

*Commit message example*

```text
Initial plan
```

*Commit message example*

```text
Add lodash.isequal and minimatch packages with necessary files
```

*Commit message example*

```text
Merge pull request #5 from Cheong43/copilot/restructure-knowledge-architecture
```

*Commit message example*

```text
Merge pull request #3 from Cheong43/copilot/refactor-mempedia-codecli-architecture-again
```

## Architecture

### Project Structure: Single Package

This project uses **type-based** module organization.

### Source Layout

```
src/
├── api/
├── core/
├── decay/
├── graph/
├── markdown/
├── merge/
├── promotion/
├── runtime/
├── storage/
├── versioning/
```

### Configuration Files

- `mempedia-codecli/node_modules/@alcalzone/ansi-tokenize/package.json`
- `mempedia-codecli/node_modules/@cspotcode/source-map-support/package.json`
- `mempedia-codecli/node_modules/@jridgewell/resolve-uri/package.json`
- `mempedia-codecli/node_modules/@jridgewell/sourcemap-codec/package.json`
- `mempedia-codecli/node_modules/@jridgewell/trace-mapping/package.json`
- `mempedia-codecli/node_modules/@tsconfig/node10/package.json`
- `mempedia-codecli/node_modules/@tsconfig/node10/tsconfig.json`
- `mempedia-codecli/node_modules/@tsconfig/node12/package.json`
- `mempedia-codecli/node_modules/@tsconfig/node12/tsconfig.json`
- `mempedia-codecli/node_modules/@tsconfig/node14/package.json`
- `mempedia-codecli/node_modules/@tsconfig/node14/tsconfig.json`
- `mempedia-codecli/node_modules/@tsconfig/node16/package.json`
- `mempedia-codecli/node_modules/@tsconfig/node16/tsconfig.json`
- `mempedia-codecli/node_modules/@types/ink/package.json`
- `mempedia-codecli/node_modules/@types/node-fetch/package.json`
- `mempedia-codecli/node_modules/@types/node/package.json`
- `mempedia-codecli/node_modules/@types/prop-types/package.json`
- `mempedia-codecli/node_modules/@types/react/package.json`
- `mempedia-codecli/node_modules/abort-controller/package.json`
- `mempedia-codecli/node_modules/acorn-walk/package.json`
- `mempedia-codecli/node_modules/acorn/package.json`
- `mempedia-codecli/node_modules/agentkeepalive/package.json`
- `mempedia-codecli/node_modules/ansi-escapes/package.json`
- `mempedia-codecli/node_modules/ansi-regex/package.json`
- `mempedia-codecli/node_modules/ansi-styles/package.json`
- `mempedia-codecli/node_modules/arg/package.json`
- `mempedia-codecli/node_modules/arr-rotate/package.json`
- `mempedia-codecli/node_modules/asynckit/package.json`
- `mempedia-codecli/node_modules/auto-bind/package.json`
- `mempedia-codecli/node_modules/balanced-match/package.json`
- `mempedia-codecli/node_modules/brace-expansion/package.json`
- `mempedia-codecli/node_modules/call-bind-apply-helpers/package.json`
- `mempedia-codecli/node_modules/call-bind-apply-helpers/tsconfig.json`
- `mempedia-codecli/node_modules/chalk/package.json`
- `mempedia-codecli/node_modules/cli-boxes/package.json`
- `mempedia-codecli/node_modules/cli-cursor/package.json`
- `mempedia-codecli/node_modules/cli-truncate/node_modules/slice-ansi/package.json`
- `mempedia-codecli/node_modules/cli-truncate/package.json`
- `mempedia-codecli/node_modules/code-excerpt/package.json`
- `mempedia-codecli/node_modules/combined-stream/package.json`
- `mempedia-codecli/node_modules/convert-to-spaces/package.json`
- `mempedia-codecli/node_modules/create-require/package.json`
- `mempedia-codecli/node_modules/csstype/package.json`
- `mempedia-codecli/node_modules/delayed-stream/package.json`
- `mempedia-codecli/node_modules/diff/package.json`
- `mempedia-codecli/node_modules/dotenv/package.json`
- `mempedia-codecli/node_modules/dunder-proto/package.json`
- `mempedia-codecli/node_modules/dunder-proto/tsconfig.json`
- `mempedia-codecli/node_modules/emoji-regex/package.json`
- `mempedia-codecli/node_modules/environment/package.json`
- `mempedia-codecli/node_modules/es-define-property/package.json`
- `mempedia-codecli/node_modules/es-define-property/tsconfig.json`
- `mempedia-codecli/node_modules/es-errors/package.json`
- `mempedia-codecli/node_modules/es-errors/tsconfig.json`
- `mempedia-codecli/node_modules/es-object-atoms/package.json`
- `mempedia-codecli/node_modules/es-object-atoms/tsconfig.json`
- `mempedia-codecli/node_modules/es-set-tostringtag/package.json`
- `mempedia-codecli/node_modules/es-set-tostringtag/tsconfig.json`
- `mempedia-codecli/node_modules/es-toolkit/package.json`
- `mempedia-codecli/node_modules/escape-string-regexp/package.json`
- `mempedia-codecli/node_modules/event-target-shim/package.json`
- `mempedia-codecli/node_modules/figures/node_modules/escape-string-regexp/package.json`
- `mempedia-codecli/node_modules/figures/package.json`
- `mempedia-codecli/node_modules/form-data-encoder/lib/cjs/package.json`
- `mempedia-codecli/node_modules/form-data-encoder/lib/esm/package.json`
- `mempedia-codecli/node_modules/form-data-encoder/package.json`
- `mempedia-codecli/node_modules/form-data/package.json`
- `mempedia-codecli/node_modules/formdata-node/lib/cjs/package.json`
- `mempedia-codecli/node_modules/formdata-node/lib/esm/package.json`
- `mempedia-codecli/node_modules/formdata-node/package.json`
- `mempedia-codecli/node_modules/function-bind/package.json`
- `mempedia-codecli/node_modules/get-east-asian-width/package.json`
- `mempedia-codecli/node_modules/get-intrinsic/package.json`
- `mempedia-codecli/node_modules/get-proto/package.json`
- `mempedia-codecli/node_modules/get-proto/tsconfig.json`
- `mempedia-codecli/node_modules/gopd/package.json`
- `mempedia-codecli/node_modules/gopd/tsconfig.json`
- `mempedia-codecli/node_modules/has-symbols/package.json`
- `mempedia-codecli/node_modules/has-symbols/tsconfig.json`
- `mempedia-codecli/node_modules/has-tostringtag/package.json`
- `mempedia-codecli/node_modules/has-tostringtag/tsconfig.json`
- `mempedia-codecli/node_modules/hasown/package.json`
- `mempedia-codecli/node_modules/hasown/tsconfig.json`
- `mempedia-codecli/node_modules/humanize-ms/package.json`
- `mempedia-codecli/node_modules/indent-string/package.json`
- `mempedia-codecli/node_modules/ink-select-input/package.json`
- `mempedia-codecli/node_modules/ink-text-input/package.json`
- `mempedia-codecli/node_modules/ink/package.json`
- `mempedia-codecli/node_modules/is-fullwidth-code-point/package.json`
- `mempedia-codecli/node_modules/is-in-ci/package.json`
- `mempedia-codecli/node_modules/is-unicode-supported/package.json`
- `mempedia-codecli/node_modules/js-tokens/package.json`
- `mempedia-codecli/node_modules/lodash.isequal/package.json`
- `mempedia-codecli/node_modules/loose-envify/package.json`
- `mempedia-codecli/node_modules/make-error/package.json`
- `mempedia-codecli/node_modules/math-intrinsics/package.json`
- `mempedia-codecli/node_modules/math-intrinsics/tsconfig.json`
- `mempedia-codecli/node_modules/mime-db/package.json`
- `mempedia-codecli/node_modules/mime-types/package.json`
- `mempedia-codecli/node_modules/mimic-fn/package.json`
- `mempedia-codecli/node_modules/minimatch/package.json`
- `mempedia-codecli/node_modules/ms/package.json`
- `mempedia-codecli/node_modules/node-domexception/package.json`
- `mempedia-codecli/node_modules/node-fetch/package.json`
- `mempedia-codecli/node_modules/onetime/package.json`
- `mempedia-codecli/node_modules/openai/node_modules/@types/node/package.json`
- `mempedia-codecli/node_modules/openai/node_modules/undici-types/package.json`
- `mempedia-codecli/node_modules/openai/package.json`
- `mempedia-codecli/node_modules/openai/src/tsconfig.json`
- `mempedia-codecli/node_modules/patch-console/package.json`
- `mempedia-codecli/node_modules/react-reconciler/package.json`
- `mempedia-codecli/node_modules/react/package.json`
- `mempedia-codecli/node_modules/restore-cursor/package.json`
- `mempedia-codecli/node_modules/scheduler/package.json`
- `mempedia-codecli/node_modules/signal-exit/package.json`
- `mempedia-codecli/node_modules/slice-ansi/node_modules/is-fullwidth-code-point/package.json`
- `mempedia-codecli/node_modules/slice-ansi/package.json`
- `mempedia-codecli/node_modules/stack-utils/package.json`
- `mempedia-codecli/node_modules/string-width/package.json`
- `mempedia-codecli/node_modules/strip-ansi/package.json`
- `mempedia-codecli/node_modules/tr46/package.json`
- `mempedia-codecli/node_modules/ts-node/node10/tsconfig.json`
- `mempedia-codecli/node_modules/ts-node/node12/tsconfig.json`
- `mempedia-codecli/node_modules/ts-node/node14/tsconfig.json`
- `mempedia-codecli/node_modules/ts-node/node16/tsconfig.json`
- `mempedia-codecli/node_modules/ts-node/package.json`
- `mempedia-codecli/node_modules/type-fest/package.json`
- `mempedia-codecli/node_modules/typescript/package.json`
- `mempedia-codecli/node_modules/undici-types/package.json`
- `mempedia-codecli/node_modules/v8-compile-cache-lib/package.json`
- `mempedia-codecli/node_modules/web-streams-polyfill/es5/package.json`
- `mempedia-codecli/node_modules/web-streams-polyfill/package.json`
- `mempedia-codecli/node_modules/web-streams-polyfill/polyfill/es5/package.json`
- `mempedia-codecli/node_modules/web-streams-polyfill/polyfill/package.json`
- `mempedia-codecli/node_modules/webidl-conversions/package.json`
- `mempedia-codecli/node_modules/whatwg-url/package.json`
- `mempedia-codecli/node_modules/widest-line/package.json`
- `mempedia-codecli/node_modules/wrap-ansi/package.json`
- `mempedia-codecli/node_modules/ws/package.json`
- `mempedia-codecli/node_modules/yn/package.json`
- `mempedia-codecli/node_modules/yoga-layout/package.json`
- `mempedia-codecli/node_modules/zod/package.json`
- `mempedia-codecli/package.json`
- `mempedia-codecli/tsconfig.json`

### Guidelines

- Group code by type (components, services, utils)
- Keep related functionality in the same type folder
- Avoid circular dependencies between type folders

## Code Style

### Language: TypeScript

### Naming Conventions

| Element | Convention |
|---------|------------|
| Files | camelCase |
| Functions | camelCase |
| Classes | PascalCase |
| Constants | SCREAMING_SNAKE_CASE |

### Import Style: Relative Imports

### Export Style: Named Exports


*Preferred import style*

```typescript
// Use relative imports
import { Button } from '../components/Button'
import { useAuth } from './hooks/useAuth'
```

*Preferred export style*

```typescript
// Use named exports
export function calculateTotal() { ... }
export const TAX_RATE = 0.1
export interface Order { ... }
```

## Testing

### Test Framework: vitest

### File Pattern: `*.test.ts`

### Test Types

- **Unit tests**: Test individual functions and components in isolation


*Test file structure*

```typescript
import { describe, it, expect } from 'vitest'

describe('MyFunction', () => {
  it('should return expected result', () => {
    const result = myFunction(input)
    expect(result).toBe(expected)
  })
})
```

## Error Handling

### Error Handling Style: Try-Catch Blocks


*Standard error handling pattern*

```typescript
try {
  const result = await riskyOperation()
  return result
} catch (error) {
  console.error('Operation failed:', error)
  throw new Error('User-friendly message')
}
```

## Common Workflows

These workflows were detected from analyzing commit patterns.

### Database Migration

Database schema changes with migration files

**Frequency**: ~5 times per month

**Steps**:
1. Create migration file
2. Update schema definitions
3. Generate/update types

**Files typically involved**:
- `**/types.ts`

**Example commit sequence**:
```
chore: rename project to mempedia and refresh dataset
chore: ignore .DS_Store files and add mempedia-openclaw skill
refactor(api): consolidate tool actions for simplified protocol
```

### Feature Development

Standard feature implementation workflow

**Frequency**: ~15 times per month

**Steps**:
1. Add feature implementation
2. Add tests for feature
3. Update documentation

**Files typically involved**:
- `mempedia-codecli/node_modules/@cspotcode/source-map-support/*`
- `mempedia-codecli/node_modules/@jridgewell/sourcemap-codec/src/*`
- `mempedia-codecli/node_modules/@types/node-fetch/*`
- `**/*.test.*`
- `**/api/**`

**Example commit sequence**:
```
Add incremental build artifacts for agent memory
update UI
Add M2W-UI web interface and project structure updates
```

### Refactoring

Code refactoring and cleanup workflow

**Frequency**: ~8 times per month

**Steps**:
1. Ensure tests pass before refactor
2. Refactor code structure
3. Verify tests still pass

**Files typically involved**:
- `src/**/*`

**Example commit sequence**:
```
Refactor code structure for improved readability and maintainability
Enhance exploration features: add suggest_exploration, explore_with_budget, and auto_link_related functions; update README and SKILL documentation; refine .gitignore
Update .gitignore to ignore .claude directory
```

### Feature Development Cross Layer

Implements a new feature or architectural layer that affects multiple core modules, updates types, tools, documentation, and tests.

**Frequency**: ~2 times per month

**Steps**:
1. Update Rust core modules (src/api/mod.rs, src/core/mod.rs, src/storage/mod.rs, etc.)
2. Update TypeScript types and tool definitions (mempedia-codecli/src/mempedia/types.ts, mempedia-codecli/src/tools/definitions.ts)
3. Update UI components if needed (mempedia-codecli/src/components/App.tsx, mempedia-ui/*)
4. Add or update documentation (readme.md, policies/KB_SCHEMA.md, policies/AGENT_KB_POLICY.md, SKILL.md, etc.)
5. Add or update tests
6. Update or add new project workflow examples in documentation

**Files typically involved**:
- `src/api/mod.rs`
- `src/core/mod.rs`
- `src/storage/mod.rs`
- `src/markdown/mod.rs`
- `src/versioning/mod.rs`
- `src/merge/mod.rs`
- `mempedia-codecli/src/mempedia/types.ts`
- `mempedia-codecli/src/tools/definitions.ts`
- `mempedia-codecli/src/components/App.tsx`
- `mempedia-ui/index.html`
- `mempedia-ui/script.js`
- `mempedia-ui/styles.css`
- `readme.md`
- `policies/KB_SCHEMA.md`
- `policies/AGENT_KB_POLICY.md`

**Example commit sequence**:
```
Update Rust core modules (src/api/mod.rs, src/core/mod.rs, src/storage/mod.rs, etc.)
Update TypeScript types and tool definitions (mempedia-codecli/src/mempedia/types.ts, mempedia-codecli/src/tools/definitions.ts)
Update UI components if needed (mempedia-codecli/src/components/App.tsx, mempedia-ui/*)
Add or update documentation (readme.md, policies/KB_SCHEMA.md, policies/AGENT_KB_POLICY.md, SKILL.md, etc.)
Add or update tests
Update or add new project workflow examples in documentation
```

### Api Action Consolidation Or Renaming

Consolidates, renames, or refactors API actions for clarity and protocol simplification, updating all references and documentation.

**Frequency**: ~2 times per month

**Steps**:
1. Update src/api/mod.rs to change action names or signatures
2. Update all references in documentation (readme.md, SKILL.md, agent YAMLs)
3. Update TypeScript types and tool definitions if required
4. Update .gitignore if new data or files are involved

**Files typically involved**:
- `src/api/mod.rs`
- `readme.md`
- `skills/*/SKILL.md`
- `skills/*/agents/*.yaml`

**Example commit sequence**:
```
Update src/api/mod.rs to change action names or signatures
Update all references in documentation (readme.md, SKILL.md, agent YAMLs)
Update TypeScript types and tool definitions if required
Update .gitignore if new data or files are involved
```

### Knowledge Graph Node Batch Update

Adds, updates, or removes large batches of knowledge graph nodes and objects, often as part of a schema or data migration.

**Frequency**: ~2 times per month

**Steps**:
1. Add or update Rust structures (NodeContent, NodePatch, etc.)
2. Update merge logic or storage logic for new fields
3. Add, update, or remove many files in .mempedia/memory/knowledge/nodes/ and .mempedia/memory/objects/
4. Update index/state files (.mempedia/memory/index/*.json)
5. Update documentation (SKILL.md, readme.md, KB_SCHEMA.md)
6. Update or clean up .gitignore as needed

**Files typically involved**:
- `.mempedia/memory/knowledge/nodes/*.md`
- `.mempedia/memory/objects/**/*.json`
- `.mempedia/memory/index/*.json`
- `src/core/mod.rs`
- `src/merge/mod.rs`
- `src/versioning/mod.rs`
- `skills/*/SKILL.md`
- `readme.md`
- `.gitignore`

**Example commit sequence**:
```
Add or update Rust structures (NodeContent, NodePatch, etc.)
Update merge logic or storage logic for new fields
Add, update, or remove many files in .mempedia/memory/knowledge/nodes/ and .mempedia/memory/objects/
Update index/state files (.mempedia/memory/index/*.json)
Update documentation (SKILL.md, readme.md, KB_SCHEMA.md)
Update or clean up .gitignore as needed
```

### Dependency And Node Modules Management

Adds or updates npm dependencies and manages node_modules for the mempedia-codecli project, including package-lock.json and initial state files.

**Frequency**: ~2 times per month

**Steps**:
1. Add or update node_modules files and folders
2. Update or create package-lock.json and package.json
3. Initialize or update memory state files if needed

**Files typically involved**:
- `mempedia-codecli/node_modules/**/*`
- `mempedia-codecli/package-lock.json`
- `mempedia-codecli/package.json`
- `.mempedia/memory/state.json`

**Example commit sequence**:
```
Add or update node_modules files and folders
Update or create package-lock.json and package.json
Initialize or update memory state files if needed
```

### Runtime Architecture Extension

Adds or restructures runtime layers (agent, governance, tools) in the mempedia-codecli runtime, updating multiple files in src/runtime/agent, src/runtime/governance, and src/runtime/tools.

**Frequency**: ~2 times per month

**Steps**:
1. Add or update files in mempedia-codecli/src/runtime/agent/
2. Add or update files in mempedia-codecli/src/runtime/governance/
3. Add or update files in mempedia-codecli/src/runtime/tools/
4. Update main agent entry point (mempedia-codecli/src/agent/index.ts)
5. Update or add types (mempedia-codecli/src/runtime/agent/types.ts, mempedia-codecli/src/runtime/governance/types.ts, mempedia-codecli/src/runtime/tools/types.ts)
6. Update documentation as needed

**Files typically involved**:
- `mempedia-codecli/src/agent/index.ts`
- `mempedia-codecli/src/runtime/agent/*`
- `mempedia-codecli/src/runtime/governance/*`
- `mempedia-codecli/src/runtime/tools/*`

**Example commit sequence**:
```
Add or update files in mempedia-codecli/src/runtime/agent/
Add or update files in mempedia-codecli/src/runtime/governance/
Add or update files in mempedia-codecli/src/runtime/tools/
Update main agent entry point (mempedia-codecli/src/agent/index.ts)
Update or add types (mempedia-codecli/src/runtime/agent/types.ts, mempedia-codecli/src/runtime/governance/types.ts, mempedia-codecli/src/runtime/tools/types.ts)
Update documentation as needed
```

### Ui And Readme Refactor

Refactors code structure for improved readability and maintainability, often touching UI files and readme.md.

**Frequency**: ~2 times per month

**Steps**:
1. Update UI files (mempedia-ui/index.html, script.js, styles.css, mempedia-codecli/src/components/App.tsx)
2. Update or refactor readme.md
3. Update or refactor TypeScript/JS entry points as needed

**Files typically involved**:
- `mempedia-ui/index.html`
- `mempedia-ui/script.js`
- `mempedia-ui/styles.css`
- `mempedia-codecli/src/components/App.tsx`
- `readme.md`

**Example commit sequence**:
```
Update UI files (mempedia-ui/index.html, script.js, styles.css, mempedia-codecli/src/components/App.tsx)
Update or refactor readme.md
Update or refactor TypeScript/JS entry points as needed
```


## Best Practices

Based on analysis of the codebase, follow these practices:

### Do

- Write tests using vitest
- Follow *.test.ts naming pattern
- Use camelCase for file names
- Prefer named exports

### Don't

- Don't skip tests for new features
- Don't deviate from established patterns without discussion

---

*This skill was auto-generated by [ECC Tools](https://ecc.tools). Review and customize as needed for your team.*
