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
- `chore`
- `refactor`
- `fix`

### Message Guidelines

- Average message length: ~62 characters
- Keep first line concise and descriptive
- Use imperative mood ("Add feature" not "Added feature")


*Commit message example*

```text
fix: address code review issues (hex validation, frontmatter parsing, ID collision, section replace bug, docs)
```

*Commit message example*

```text
feat: implement 4-layer knowledge architecture (episodic memory, user preferences, skills, document import)
```

*Commit message example*

```text
refactor: simplify mempedia client request queue and remove timeout logic
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
Merge pull request #3 from Cheong43/copilot/refactor-mempedia-codecli-architecture-again
```

*Commit message example*

```text
feat: add governed runtime architecture (governance, tools, agent layers)
```

*Commit message example*

```text
Refactor code structure for improved readability and maintainability
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
- `mempedia-codecli/node_modules/asynckit/package.json`
- `mempedia-codecli/node_modules/auto-bind/package.json`
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
- `mempedia-codecli/node_modules/ink-text-input/package.json`
- `mempedia-codecli/node_modules/ink/package.json`
- `mempedia-codecli/node_modules/is-fullwidth-code-point/package.json`
- `mempedia-codecli/node_modules/is-in-ci/package.json`
- `mempedia-codecli/node_modules/js-tokens/package.json`
- `mempedia-codecli/node_modules/loose-envify/package.json`
- `mempedia-codecli/node_modules/make-error/package.json`
- `mempedia-codecli/node_modules/math-intrinsics/package.json`
- `mempedia-codecli/node_modules/math-intrinsics/tsconfig.json`
- `mempedia-codecli/node_modules/mime-db/package.json`
- `mempedia-codecli/node_modules/mime-types/package.json`
- `mempedia-codecli/node_modules/mimic-fn/package.json`
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

**Frequency**: ~16 times per month

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

**Frequency**: ~9 times per month

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

### Add Or Update Knowledge Graph Nodes

Adds or updates knowledge graph nodes and related memory index files, often with updates to node content, summaries, or new node types (facts, patterns, preferences, etc).

**Frequency**: ~2 times per month

**Steps**:
1. Create or update markdown files in .mempedia/memory/knowledge/nodes/
2. Update .mempedia/memory/index/heads.json, nodes.json, and state.json to reflect new/updated nodes
3. Optionally update .mempedia/memory/objects/ for new node objects
4. Update documentation (README, SKILL.md) if schema/fields change

**Files typically involved**:
- `.mempedia/memory/knowledge/nodes/*.md`
- `.mempedia/memory/index/heads.json`
- `.mempedia/memory/index/nodes.json`
- `.mempedia/memory/index/state.json`
- `.mempedia/memory/objects/**/*.json`
- `skills/*/SKILL.md`
- `mempedia-codecli/README.md`

**Example commit sequence**:
```
Create or update markdown files in .mempedia/memory/knowledge/nodes/
Update .mempedia/memory/index/heads.json, nodes.json, and state.json to reflect new/updated nodes
Optionally update .mempedia/memory/objects/ for new node objects
Update documentation (README, SKILL.md) if schema/fields change
```

### Refactor Or Expand Runtime Architecture

Refactors or expands the runtime and agent architecture, often introducing new layers (governance, tools, agent runtime) and updating multiple files in mempedia-codecli/src/runtime/ and mempedia-codecli/src/agent/.

**Frequency**: ~2 times per month

**Steps**:
1. Edit or add files in mempedia-codecli/src/runtime/ (agent, governance, tools, types, etc)
2. Edit mempedia-codecli/src/agent/index.ts
3. Update or add types in mempedia-codecli/src/runtime/agent/types.ts and related type files
4. Update mempedia-codecli/src/runtime/index.ts
5. Update or add documentation (README, strategy docs)

**Files typically involved**:
- `mempedia-codecli/src/runtime/**/*.ts`
- `mempedia-codecli/src/agent/index.ts`
- `mempedia-codecli/README.md`
- `mempedia-codecli/react_strategy.md`

**Example commit sequence**:
```
Edit or add files in mempedia-codecli/src/runtime/ (agent, governance, tools, types, etc)
Edit mempedia-codecli/src/agent/index.ts
Update or add types in mempedia-codecli/src/runtime/agent/types.ts and related type files
Update mempedia-codecli/src/runtime/index.ts
Update or add documentation (README, strategy docs)
```

### Feature Development With Docs And Ui

Implements a new feature or enhancement, updating core logic, UI components, and documentation in a coordinated way.

**Frequency**: ~2 times per month

**Steps**:
1. Edit or add implementation files (e.g., src/api/mod.rs, src/core/mod.rs, src/storage/mod.rs, mempedia-codecli/src/agent/index.ts, etc)
2. Update or add UI files (mempedia-ui/index.html, script.js, styles.css, or mempedia-codecli/src/components/App.tsx)
3. Update documentation (README.md, SKILL.md, strategy docs)
4. Optionally update memory index or data files if feature affects knowledge graph

**Files typically involved**:
- `src/api/mod.rs`
- `src/core/mod.rs`
- `src/storage/mod.rs`
- `mempedia-codecli/src/agent/index.ts`
- `mempedia-ui/index.html`
- `mempedia-ui/script.js`
- `mempedia-ui/styles.css`
- `mempedia-codecli/src/components/App.tsx`
- `mempedia-codecli/README.md`
- `readme.md`

**Example commit sequence**:
```
Edit or add implementation files (e.g., src/api/mod.rs, src/core/mod.rs, src/storage/mod.rs, mempedia-codecli/src/agent/index.ts, etc)
Update or add UI files (mempedia-ui/index.html, script.js, styles.css, or mempedia-codecli/src/components/App.tsx)
Update documentation (README.md, SKILL.md, strategy docs)
Optionally update memory index or data files if feature affects knowledge graph
```

### Api Action Consolidation Or Renaming

Consolidates or renames API actions, updating Rust API code, agent prompts, and documentation for protocol simplification.

**Frequency**: ~2 times per month

**Steps**:
1. Edit src/api/mod.rs to merge, rename, or update API actions
2. Update documentation (readme.md, SKILL.md)
3. Update agent configuration files (skills/*/agents/*.yaml)
4. Update .gitignore if needed for new/removed data

**Files typically involved**:
- `src/api/mod.rs`
- `readme.md`
- `skills/*/SKILL.md`
- `skills/*/agents/*.yaml`
- `.gitignore`

**Example commit sequence**:
```
Edit src/api/mod.rs to merge, rename, or update API actions
Update documentation (readme.md, SKILL.md)
Update agent configuration files (skills/*/agents/*.yaml)
Update .gitignore if needed for new/removed data
```

### Ui Web Interface Update

Updates or adds web UI components, including HTML, JS, and CSS files for the mempedia or M2W-UI interfaces.

**Frequency**: ~2 times per month

**Steps**:
1. Edit or add mempedia-ui/index.html, script.js, styles.css (or M2W-UI equivalents)
2. Update documentation (readme.md)
3. Optionally update SKILL.md if UI relates to agent skills

**Files typically involved**:
- `mempedia-ui/index.html`
- `mempedia-ui/script.js`
- `mempedia-ui/styles.css`
- `M2W-UI/index.html`
- `M2W-UI/script.js`
- `M2W-UI/styles.css`
- `readme.md`
- `skills/*/SKILL.md`

**Example commit sequence**:
```
Edit or add mempedia-ui/index.html, script.js, styles.css (or M2W-UI equivalents)
Update documentation (readme.md)
Optionally update SKILL.md if UI relates to agent skills
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
