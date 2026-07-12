# Silvaia Workspace

## Skill Loading Guide

When working on a task, load the skill(s) whose scope matches the task. The skills below are the canonical entry points — prefer them over re-deriving conventions from the code.

### Exploration

- Searching the codebase, locating definitions, or navigating files: load the `efficient-exploration` skill.

## Universal Rules

- **Never read or print secret files** — SOPS keys, `.env`, `secrets.yaml`, JWT private keys, API tokens, DB credentials. If a task requires them, ask the human to provide the specific value.
- Never use git worktrees or create isolated worktree environments for tasks or subagents.
- Always perform all file operations, subagent tasks, and terminal commands directly within the main working directory.