# Template — manual section (below the `ctx:manual` marker)

Copy the headings that apply, drop the ones that don't. Every bullet must be
specific to this repository and checkable against the code.

```markdown
## Project knowledge

### Architecture in one paragraph
<How a request / command / job flows through the main modules. Name the files.>

### Conventions
- <Naming, error handling, module boundaries the code actually follows>
- <Where new code of type X goes (e.g. "new HTTP routes go in src/server.ts, one handler per route")>

### Pitfalls
- <Things that look safe but aren't: generated files, in-place rewrites, global state, ordering constraints>
- <Tests that are slow, flaky or need env vars — and how to run a subset>

### Decisions
- <Choice made + why, with a pointer (PR, commit, doc) — so agents don't undo it>

### Out of scope
- <Things agents should not touch without asking: billing, migrations, release workflow…>
```

Good bullet: "Tests run against `dist/`, not `src/` — always `npm run build`
before `node --test`, which `npm test` already does."

Bad bullet: "Write clean, maintainable code." (generic, not checkable)
