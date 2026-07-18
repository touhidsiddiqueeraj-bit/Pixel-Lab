---
name: Feature Request
about: Suggest a new tool, filter, or improvement
title: "[Feature] "
labels: enhancement, needs-triage
assignees: ''
---

## Feature Description

<!-- A clear and concise description of what you want to happen. -->

## Motivation

<!-- Why do you want this? What problem does it solve? Include a real-world use case if possible. -->

## Proposed Solution

<!-- Describe the solution you'd like. If you've thought about the implementation, sketch it here. -->

## Alternatives Considered

<!-- Have you considered any alternative solutions or workarounds? -->

## Additional Context

<!-- Add any other context, screenshots, or references here. -->

---

### Categorization (maintainer will set, but feel free to suggest)

- **Type**: <!-- new tool / new filter / new AI agent tool / UX improvement / performance / bug-adjacent / docs -->
- **Area**: <!-- canvas / layers / filters / develop panel / color / vectorize / AI agent / mobile / theme / other -->
- **Effort**: <!-- small (1-2h) / medium (1 day) / large (1 week+) -->

### For AI Agent tool requests specifically

If you're requesting a new tool the AI agent can call (e.g. "the agent should be able to apply a curve adjustment"), describe:

- **Tool name** (e.g. `applyCurves`)
- **What it wraps** (e.g. the existing `applyCurves` in `image-processing.ts`)
- **Parameter schema** (e.g. `{ points: number[], channel: 'rgb' | 'r' | 'g' | 'b' }`)
- **Example prompt** that should trigger it (e.g. "increase contrast in the midtones")

See [`CONTRIBUTING.md → Adding a New Agent Tool`](../CONTRIBUTING.md#adding-a-new-agent-tool) for the implementation pattern.
