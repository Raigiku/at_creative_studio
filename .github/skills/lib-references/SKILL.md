---
name: lib-references
description: 'Use when writing code that imports a third-party library, SDK, or framework (Go, Python, Node, Rust, etc.). Explains how to use `dev/lib_references/` to ground code in real API shapes, and the hard rule that it is documentation-only, never a build dependency.'
---

# Using `dev/lib_references/`

The `dev/lib_references/` folder contains vendored or cloned source code for third-party libraries the project depends on (for example, an SDK like `go-sdk-v0_5_16/`). Its purpose is for the agent to **read** and **understand** the library before writing code against it.

## The Hard Rule

`dev/lib_references/` is **reference material, not a runtime dependency.** It is excluded from builds, modules, manifests, and any other link or resolution step.

- Do not add a `replace` directive in `go.mod` pointing at it.
- Do not add a `path:` or `file:` link in `package.json`, `Cargo.toml`, `pyproject.toml`, etc.
- Do not `import` or `require` from a path like `dev/lib_references/...`.
- Do not assume a script in `dev/` will be present at build/runtime — keep it out of any production artifact.

When in doubt, the official public registry (Go module proxy, npm, PyPI, crates.io) is the right source. The reference folder is for the agent to look at, not for the compiler/runner to load.

> If a build or import step references `dev/lib_references/`, that is a bug. Flag it, fix it (remove the `replace`, the `path:` link, etc.), and use the public registry instead.

## When to Read It

Before writing code that calls into a third-party library — especially when the API has many options, typed enums, or version-specific behavior — read the actual source under `dev/lib_references/`:

- Confirm the exact method names, parameter names, and types.
- Confirm enum values (they are often string-typed and undocumented at the call site).
- Confirm return shapes (union types, nullable fields, etc.).
- Confirm option-helper names (e.g. `WithOperationTimeout` vs `WithTimeout`).

Do **not** guess field names from training data. Library APIs change, get renamed, or differ between versions. The reference folder is the source of truth for this project.

## Procedure

1. **Identify the package** the library lives in (e.g. `github.com/OpenRouterTeam/go-sdk`).
2. **Locate the reference** with `file_search` or `grep_search` against `dev/lib_references/<lib>/` to find the right file (request types, response types, enum definitions).
3. **Read the relevant struct definitions and enum constants** before writing the call site.
4. **Write the code** using the public registry as the actual dependency, not the local reference folder.
5. **If the reference folder is missing the version you need**, ask the user before cloning more — do not assume you should fetch it silently.

## Naming Convention

Each entry in `dev/lib_references/` is one library at one pinned version, named `<lib>-<version>/` (e.g. `go-sdk-v0_5_16/`). If you add a new one, follow that pattern.

## Quick Checklist

Before committing code that uses a third-party library:

- [ ] Source of the import is the public registry, not `dev/lib_references/`.
- [ ] No `replace`, `path:`, or `file:` directive points at `dev/lib_references/`.
- [ ] Method names, parameter names, and enum values were verified against `dev/lib_references/<lib>/`.
- [ ] The reference folder is not referenced from any build, test, or runtime script.
