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
- For Layer 1, prefer fewer but denser knowledge items. Each item should preserve the available facts, descriptions, data points, history, viewpoints, and uncertainty markers instead of reducing everything to one sentence.
- Separate truth claims from opinions. If the source expresses a viewpoint, preserve it as a viewpoint with attribution when possible.
- Preserve concrete values such as numbers, version identifiers, paths, limits, dates, and field names.
- Ignore scheduler wrappers, branch-control metadata, raw stack traces, and temporary execution noise.
- If a layer has no real payload, leave it empty.

## Save Standard

- Do not over-promote chit-chat into Layer 1.
- Do not bury stable user policies inside episodic memory.
- Do not create a Layer 4 skill from a one-off sequence unless it is clearly reusable.
- Never fabricate facts. If evidence is incomplete, preserve the gap explicitly rather than guessing.