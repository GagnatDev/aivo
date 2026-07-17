---
name: plan-phased-work
description: Plan a medium-to-large task (new feature, technical upgrade, refactor) by writing one spec issue plus dependency-aware phased sub-issues that agents implement one phase at a time, each landing as its own PR on main. Use when the user wants to break down and plan sizeable work, not implement a small change.
---

# Plan phased work

Turn a sizeable task into a **spec issue + phased sub-issues** that agents can pick up
one at a time. Optimize for phases that each **merge to `main` independently**, while
recording dependencies so an agent can reason about what may run in parallel.

Exemplar to imitate: [`GagnatDev/unforked#84`](https://github.com/GagnatDev/unforked/issues/84)
and its sub-issues #85–#90.

## Planning principles

- **Planning is planning only — never implement while planning.** Producing a plan means
  writing the spec and sub-issues; it does **not** include code changes, edits, migrations,
  or any implementation work. Investigation is read-only (reading files, `file:line`
  grounding). Implementation happens later, one phase at a time, by the agent that picks up
  a sub-issue.
- **Plan so that risk decreases.** Slice the work to make each step as low-risk as
  possible: prefer incremental upgrades and small, self-contained changes over big-bang
  ones; sequence phases so a failure is isolated and easy to bisect; and **prioritize good
  test coverage** — each phase should land with (or add) the tests that prove it, and its
  "Done when" should include "no regression to X".

## Two-tier structure

- **One spec issue** — the single source of truth for the design. All the detail lives
  here; sub-issues link back to it and never duplicate it.
- **N phase sub-issues** (via GitHub sub-issues) — one per phase, thin, each pointing at
  the spec sections it implements.

## Spec issue contents

1. **Goal** — one paragraph on the outcome and why.
2. **Where we are today** — grounded in a real read of the code; cite `file:line`.
3. **Constraints** the design must respect.
4. **Design** — numbered, referenceable sections (e.g. `A1`, `A2`, …) so sub-issues can
  cite them precisely. Include a summary table when entities/cases differ.
5. **Resolved decisions** — every open question settled, with the choice, the rejected
  alternative, and which phase it drives. Plan is not ready to phase until these are closed.
6. **Suggested phasing** — the ordered phase list; note which phases stand alone and
  deliver felt value early.
7. **Agent implementation workflow** — the per-phase procedure (below).
8. End with a note on what the design was *grounded in* (files read).

## Phase sub-issue contents

Keep each thin and self-contained. Include:

- **Spec link + sections** — `Spec: #<spec>`, naming the exact design sections. Do not
  restate the design.
- **Depends on** — the phases this one needs, and the instruction to *read the latest
  status comment on each dependency's sub-issue before starting*. Phase 1 has none.
- **Scope** — what this phase builds.
- **Out of scope** — what it explicitly defers, naming the phase that owns it.
- **Done when** — observable acceptance criteria, including "no regression to X".
- A one-line pointer back to the Agent implementation workflow.

## Dependencies & parallelization

- State each sub-issue's dependencies explicitly so an agent can compute the order and
  spot phases with no unmet dependency that could run **in parallel**.
- **Prefer independence over parallelism.** Slice phases so each can become its own PR on
  `main` and merge on its own. Earlier phases should not need later ones; a phase that
  can't land cleanly alone should ship its largest self-consistent slice and note the
  deferral. When two phases are truly independent, say so — but a clean sequential chain
  where every phase is independently mergeable is the goal.

## Agent implementation workflow (put this in the spec)

Each phase goes to one agent at a time. The agent should:

1. **Read first** — the spec issue, the phase sub-issue, and the **latest status comment
  on each dependency's sub-issue** to learn the current state of the code.
2. **Branch from up-to-date `main`** (`git fetch origin main`; follow `AGENTS.md`).
3. **Implement** against the referenced design sections.
4. **Verify** — run the repo's build/test/typecheck (per `AGENTS.md`) before committing.
  The change must merge to `main` without breaking existing functionality; if it can't
  be fully done that way, ship the largest self-consistent slice and note what deferred.
5. **Always open a PR into `main` when the sub-issue's implementation is done** —
  reviewable and mergeable on its own. The PR body must include a sentence stating which
  issue it closes (`Closes #<phase>`), referencing the spec as well. Opening the PR is not
  optional and does not wait for the human to ask.
6. **Hand off — always, without being prompted.** Post a **status comment on the phase
  sub-issue** as soon as the work is done; never wait for the human to request it. Cover:
  what shipped, what was deferred, new modules/APIs/migrations, known gaps, and anything
  the next agent must know. This comment is the contract the next agent reads in step 1.
7. **Improve the workflow** — if the phase surfaced friction in this process or a way to
  make it work better, propose it for the user to fold in (see below); don't self-edit.

## Improving this skill

This workflow is expected to get better with use. When an agent hits friction in the
process itself — the spec/sub-issue split was wrong, dependencies were mis-stated, a phase
wasn't actually independently mergeable, the handoff missed something, a verify/branch step
didn't fit `AGENTS.md` — it should **propose the fix, never edit this skill itself**:

- Flag it in the phase's handoff status comment under a short "Workflow notes" heading, so
  it's visible to the planner and the next agent, and
- Describe the concrete suggested change (what to change and why) so the user can decide
  and fold it in. Do **not** modify `SKILL.md` as part of a phase PR — workflow changes go
  through the user separately, keeping implementation PRs focused.

The goal is a self-improving loop: each run leaves clear suggestions that make the skill a
little sharper for the next task.

## Producing the plan

1. **Investigate** the codebase first — the spec's "where we are today" and constraints
  must be grounded in real files, not assumptions.
2. **Resolve open decisions** with the user before phasing.
3. **Draft the spec**, then split into phases: smallest-first, independently mergeable,
  value early.
4. **Create the spec issue**, then each sub-issue, then link them as GitHub sub-issues
  (`sub_issue_write`, method `add`, using the child issue's **id**, not its number).
5. Confirm the phase list, dependencies, and resolved decisions with the user.
