---
name: project-discovery
description: "Use when the user asks for repository overview, README summary, architecture, project structure, module responsibilities, storage layout, or implementation inventory."
category: mempedia
priority: high
tags: [mempedia, discovery, project]
---

# Project Discovery

## Goal

Produce a grounded summary of the repository based on actual files.

## When To Use

- The user asks what is in the project.
- The user asks for architecture, module layout, features, APIs, or storage structure.
- The user asks for a README-based summary or onboarding overview.

## Workflow

1. Start from the most authoritative files such as `readme.md`, `Cargo.toml`, `package.json`, schema docs, and top-level module entrypoints.
2. Confirm claims against code, not just prose.
3. Group findings into stable facts: architecture, capabilities, storage layout, entrypoints, interfaces.
4. If the final summary contains reusable project facts, queue asynchronous memory save with Layer 1 enabled.

## Tool Guidance

- Prefer `read` for authoritative files and `search` for `grep` or `glob` repository discovery.
- If existing enterprise knowledge may already cover the project, use `bash` plus `search_nodes` or `list_projects`.
- If you deliberately persist normalized project facts, do it through `bash` with Layer 1 or project CLI actions, not through `read/search/edit` routing.
- Let the independent post-turn memory agent handle routine async persistence.

## Avoid

- Inferring architecture from filenames alone.
- Saving temporary conversational phrasing as knowledge.
- Inspecting or summarizing the agent's own `skills/` directory unless the user explicitly asked about skills.
*** Add File: /Users/mac/Documents/CodeProject/M2W/mempedia-codecli/skills/enterprise-kb-routing/SKILL.md
---
name: enterprise-kb-routing
description: "Use on every run inside Mempedia so the agent behaves like an enterprise knowledge-base operator: search evidence first, update the correct memory layer, and treat skills as reusable operating procedures."
category: mempedia
priority: high
always_include: true
tags: [mempedia, enterprise-kb, routing]
---

# Enterprise KB Routing

## Goal

Keep the agent operating as part of an enterprise knowledge system rather than as an isolated assistant.

## Core Behavior

1. Search before asserting when repository or memory evidence may exist.
2. Prefer the five top-level tools only: `read`, `search`, `edit`, `bash`, `web`.
3. Treat `read/search/edit` as routed interfaces that may target workspace files, Layer 1 knowledge, Layer 2 episodes, Layer 3 preferences, Layer 4 skills, or project records.
4. Prefer the narrowest valid memory layer instead of over-promoting information.
5. Let the independent post-turn memory agent classify the full turn across all four layers.

## When To Escalate To Memory

- Stable project facts: Layer 1 core knowledge.
- Short-lived chronology: Layer 2 episodic memory.
- Persistent user constraints: Layer 3 preferences.
- Reusable procedures: Layer 4 skills.

## Avoid

- Treating skills as answer content.
- Treating a skill name as a tool name.
- Skipping repository evidence when the question is project-specific.
*** Add File: /Users/mac/Documents/CodeProject/M2W/mempedia-codecli/skills/memory-classification/SKILL.md
---
name: memory-classification
description: "Use for the independent post-turn memory agent that classifies each completed conversation into the four Mempedia layers before saving."
category: mempedia
priority: high
tags: [mempedia, memory, classifier]
---

# Memory Classification

## Goal

Classify every completed turn against the four-layer Mempedia model and only persist what truly qualifies.

## Classification Rules

1. Layer 1 Core Knowledge: stable, reusable, evidence-grounded facts.
2. Layer 2 Episodic Memory: chronology, one-off events, greetings, transient updates.
3. Layer 3 Preferences: durable user constraints, working styles, formatting policies.
4. Layer 4 Skills: reusable workflows and procedures.

## Extraction Standard

- Prefer grounded project facts from README, source, configuration, schema, and verified outputs.
- Ignore scheduler wrappers, branch-control metadata, raw stack traces, and temporary execution noise.
- If a layer has no real payload, leave it empty.

## Save Standard

- Do not over-promote chit-chat into Layer 1.
- Do not bury stable user policies inside episodic memory.
- Do not create a Layer 4 skill from a one-off sequence unless it is clearly reusable.