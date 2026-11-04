---
name: mindset-ctx
description: Generate and keep up to date the AI context files of a repository — CLAUDE.md, AGENTS.md, docs/ARCHITECTURE.md, CONTRIBUTING.md and .context/prompts.md — using the mindset-ctx CLI, then enrich them with project-specific knowledge. Optionally index the repo's git history into a searchable memory layer. Use when the user asks to create, refresh, fix or audit CLAUDE.md / AGENTS.md, document a repo's architecture for AI agents, "set up context" for Claude Code, Cursor or Codex, or when those files are missing or out of date after structural changes.
license: MIT
---

# mindset-ctx — AI-ready repository context

This skill drives the [`mindset-ctx`](https://www.npmjs.com/package/mindset-ctx)
CLI (`ctx`). The CLI does the deterministic part — scanning the repo and writing
the context files from what is actually there (languages, layout, scripts, CI).
You do the part a scanner can't: reading the code and writing down the
conventions, pitfalls and decisions a new contributor (human or agent) needs.

## What the CLI writes

| File | Purpose |
| --- | --- |
| `CLAUDE.md` | Context for Claude Code: overview, stack, layout, commands, conventions |
| `AGENTS.md` | Same context in the cross-agent format (Codex, Cursor, Copilot…) |
| `docs/ARCHITECTURE.md` | Module map and how the pieces fit together |
| `CONTRIBUTING.md` | Setup, test and PR workflow |
| `.context/prompts.md` | Reusable prompt templates for common tasks in this repo |

Every file contains this marker line:

```
<!-- ctx:manual — everything below this line is yours, never overwritten -->
```

Everything **above** the marker is regenerated on each run. Everything
**below** it is preserved verbatim. This is the single most important rule of
this skill: **only ever write project knowledge below the marker.** Edits above
it are silently lost at the next regeneration.

## Workflow

### 1. Inspect the current state

From the repository root:

- Check whether the context files already exist and whether they contain the
  `ctx:manual` marker.
  - **No files** → first-time setup.
  - **Files with the marker** → refresh: regenerate, keep the manual sections.
  - **Files without the marker** (hand-written) → before regenerating, tell the
    user that the files will be rewritten, and move their existing content
    below the marker afterwards (step 3) so nothing is lost. If they would
    rather keep their files untouched, stop and say so.
- Note whether the working tree is clean (`git status`), so the user can review
  the result as a diff.

### 2. Generate

```bash
npx -y mindset-ctx generate .
```

Use `ctx generate .` instead if `ctx` is already installed globally
(`npm install -g mindset-ctx`). Requires Node ≥ 20.

This runs **entirely locally**: nothing about the repo is sent anywhere.

Optional — narrative overview written by Claude:

```bash
npx -y mindset-ctx generate . --ai
```

Only use `--ai` if the user asks for it **and** `ANTHROPIC_API_KEY` is set.
It sends the repo analysis (layout, languages, scripts, git remote) and the
`README.md` to the Anthropic API — not the rest of the source. Say so before
running it.

### 3. Enrich below the marker

The generated part describes *what is there*. Add *what you can only learn by
reading the code*. Read the key entry points, configs, tests and recent history
(`git log --oneline -30`), then append to `CLAUDE.md` (and mirror into
`AGENTS.md`) below the marker, following
[`references/manual-section.md`](references/manual-section.md).

Rules for this section:

- **Specific over generic.** "Run `npm test` before committing" is already in
  the generated part. Write things like "the server rewrites
  `config/tenants.json` in place — never hand-edit it while it runs" (with
  the real file names of *this* repo).
- **Verifiable.** Every command, path and file name you mention must exist.
  Check before writing it.
- **Short.** Agents load this file on every task. Aim for 20–60 lines of
  manual content; link to docs for anything longer.
- **Preserve.** If a manual section already exists, keep it and update only
  what is now wrong. Never delete user-written content without asking.
- **No secrets.** Never copy tokens, keys, internal hostnames or `.env` values.

### 4. Optional — memory layer

If the user wants agents to reuse past decisions, index the history:

```bash
npx -y mindset-ctx index .                 # git commits → .context/memory.jsonl
npx -y mindset-ctx index . --github        # + PRs, issues, discussions (GITHUB_TOKEN for private repos)
npx -y mindset-ctx search "why did we drop X"
```

`--gitlab` and `--bitbucket` work the same way. These flags call the forge's
API; plain `index` stays local. Ask whether `.context/memory.jsonl` should be
committed or added to `.gitignore` — it can be large on old repos.

To let the agent query the context and memory on its own, the CLI also ships
an MCP server:

```bash
claude mcp add ctx -- npx -y mindset-ctx mcp .
```

### 5. Verify and report

- Re-run `npx -y mindset-ctx generate .` once: the manual sections must
  survive unchanged (`git diff` shows no change below the markers).
- Check that every command listed in `CLAUDE.md` exists (e.g. in
  `package.json` scripts, `Makefile`, `pyproject.toml`).
- Show the user a short summary: files created/updated, what you added below
  the marker, and anything you could not determine and left out.
- Do not commit unless the user asks.

## Keeping it fresh

Suggest regenerating after structural changes (new top-level directory, new
package manager scripts, new language, CI changes). The manual sections carry
over, so regeneration is always safe.

## Troubleshooting

- **`npx` not found / Node < 20** → ask the user to install Node 20+, or skip
  generation and write the files by hand following the table above, keeping
  the marker line so a later `ctx generate` can take over.
- **No network for `npx`** → same fallback.
- **`ctx: not found` inside the mindset-ctx repo itself** → `npx` resolves
  to the local, unbuilt package. Run `npm run build && node dist/cli.js
  generate .` instead.
- **Monorepo** → run `generate` at the root first; run it again inside a
  package only if the user wants per-package context files.
