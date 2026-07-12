---
name: efficient-exploration
description: 'Use when exploring the codebase, searching for code patterns, locating definitions, navigating files, or understanding how existing code works — instead of reading whole files into context. Load before any search, navigation, or "find where X is defined" task so the response uses targeted tools (grep_search, semantic_search, file_search) over read_file.'
---
# Context-Efficient Codebase Exploration

Prefer tools that retrieve only the relevant information over tools that load entire files into context. This keeps the context window lean and avoids wasting tokens on unrelated code.

## Preferred Tools (use first)

| Tool | Use when |
|------|----------|
| `grep` | You know a string, variable name, or pattern to search for. Use regex alternation (`word1\|word2\|word3`) to search multiple terms at once. |
| `glob` | You need to find files by name or glob pattern (e.g., `**/*.test.ts`). |
| `read` with offset/limit | You need a specific section of a file. |
| `list_dir` | You need to see what files/folders exist inside a directory without reading any file contents. |
| `@explore` subagent | You need multi-step exploration that would otherwise require chaining several searches and reads. Delegates the work and returns a concise answer. |

## Last Resort (use only when targeted tools are insufficient)

| Tool | Guidance |
|------|----------|
| `read` (full file) | Only when you need full file context that search tools cannot provide. When you must use it, prefer reading large meaningful chunks over many small sequential reads. |

## Decision Flow

1. **Need to find something?** → `grep` or `glob`
2. **Need to understand a symbol's usage?** → `grep` for references
3. **Need to check for errors?** → `bash` with appropriate command
4. **Need to understand a file's structure?** → `grep` with a pattern that reveals structure (e.g., `^func \|^type \|^export \|^const \|^interface `)
5. **Need to browse a directory?** → `list_dir` (via `read` on a directory path)
6. **Need multi-step exploration?** → `@explore` subagent (returns a concise answer without cluttering context)
7. **None of the above give enough context?** → `read`, but read the largest relevant section in one call rather than many small reads.

## Anti-patterns

- **Reading a file just to find one function.** Use `grep` instead.
- **Reading multiple files sequentially to trace a call chain.** Use `grep` to follow references.
- **Reading an entire file to check for errors.** Use `bash` with the appropriate command instead.
- **Reading a file to find where a variable is defined.** Use `grep` with the variable name.
- **Chaining 3+ search/read calls to explore a codebase.** Use the `@explore` subagent to delegate the work.
