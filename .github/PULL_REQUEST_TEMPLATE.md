# Pull Request

## Description

<!-- What does this PR do? Link any issues it closes with "Closes #123". -->

Closes #

## Type of Change

- [ ] Bug fix (non-breaking change which fixes an issue)
- [ ] New feature (non-breaking change which adds functionality)
- [ ] Breaking change (fix or feature that would cause existing functionality to not work as expected)
- [ ] Documentation update
- [ ] Refactor / performance improvement
- [ ] New tool / filter
- [ ] New AI agent tool

## Changes Made

<!-- Bullet list of concrete changes. -->

-

## How Has This Been Tested?

<!-- Describe how you verified your changes. For AI agent changes, mention which test scripts you ran. -->

- [ ] Manual testing in browser (desktop)
- [ ] Manual testing in browser (mobile viewport)
- [ ] Light + dark mode both work
- [ ] Undo/redo still works after my change
- [ ] `bun run lint` passes
- [ ] No new console errors

### AI Agent Changes Only (if applicable)

- [ ] API key never appears in localStorage (verified via DevTools → Application → Local Storage)
- [ ] No network calls with the API key go to any domain other than `generativelanguage.googleapis.com`
- [ ] Tool calls operate on the offscreen workspace, not the live editor-store
- [ ] Ran relevant test scripts from `/home/z/my-project/scripts/`:
  - [ ] `test-agent-loop.mjs` (single tool call)
  - [ ] `test-agent-cycle.mjs` (accept → history → undo)
  - [ ] `test-agent-reject.mjs` (reject → history unchanged)
  - [ ] `test-drawing-tools.mjs <scenario>` (if touching drawing tools)
  - [ ] `test-agent-multistep.mjs` (multi-step prompts)
  - [ ] `test-agent-max-calls.mjs` (hard stop)
  - [ ] `test-agent-cancel.mjs` (stop button)

## Screenshots / Recordings

<!-- If your change is visual, drag a before/after screenshot or screen recording here. -->

## Checklist

- [ ] My code follows the project's coding standards (see [CONTRIBUTING.md](../CONTRIBUTING.md))
- [ ] I've added/updated types in `editor-types.ts` if I added new tools or options
- [ ] I've updated the system prompt in `agent-runner.ts` if I added a new agent tool
- [ ] I've added a `describeToolCall` case if I added a new agent tool
- [ ] I've updated documentation (README / ARCHITECTURE / CONTRIBUTING) if my change is user-facing
- [ ] My commits follow [Conventional Commits](https://www.conventionalcommits.org/) where reasonable
- [ ] I've not committed any API keys, `.env` files, or `node_modules`

## Security Review (if touching the AI agent or any network code)

- [ ] No new external network calls introduced, OR I've documented them in `SECURITY_NOTES.md`
- [ ] No API key persistence introduced (no `localStorage.setItem` for anything containing the key)
- [ ] No new dependencies that exfiltrate data

## Notes for Reviewers

<!-- Anything reviewers should pay extra attention to? Hard-to-test edge cases? Design decisions you want feedback on? -->
