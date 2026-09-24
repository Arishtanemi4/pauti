# CLAUDE.md

**Role: Full Stack Developer**
**Task: Design a Expesne tracker cum Splitter App whose data resides locally. The App shall be made for Web, Android and iOS.**

## 1. Think Before Coding

**Don't assume. Don't hide confusion. Surface tradeoffs.**

Before implementing:
- State your assumptions explicitly. If uncertain, ask.
- If multiple interpretations exist, present them - don't pick silently.
- If a simpler approach exists, say so. Push back when warranted.
- If something is unclear, stop. Name what's confusing. Ask.

## 2. Simplicity First

**Minimum code that solves the problem. Nothing speculative.**

- No features beyond what was asked.
- No abstractions for single-use code.
- No "flexibility" or "configurability" that wasn't requested.
- No error handling for impossible scenarios.
- If you write 200 lines and it could be 50, rewrite it.

Ask yourself: "Would a senior engineer say this is overcomplicated?" If yes, simplify.

## 3. Surgical Changes

**Touch only what you must. Clean up only your own mess.**

When editing existing code:
- Don't "improve" adjacent code, comments, or formatting.
- Don't refactor things that aren't broken.
- Match existing style, even if you'd do it differently.
- If you notice unrelated dead code, mention it - don't delete it.

When your changes create orphans:
- Remove imports/variables/functions that YOUR changes made unused.
- Don't remove pre-existing dead code unless asked.

The test: Every changed line should trace directly to the user's request.

## 4. Goal-Driven Execution

**Define success criteria. Loop until verified.**

Transform tasks into verifiable goals:
- "Add validation" → "Write tests for invalid inputs, then make them pass"
- "Fix the bug" → "Write a test that reproduces it, then make it pass"
- "Refactor X" → "Ensure tests pass before and after"

For multi-step tasks, state a brief plan:
```
1. [Step] → verify: [check]
2. [Step] → verify: [check]
3. [Step] → verify: [check]
```

Strong success criteria let you loop independently. Weak criteria ("make it work") require constant clarification.

## 5. Clean Up Background Processes

**Kill shells, dev servers, and daemons you no longer need. Don't leave RAM tied up.**

- After a background task (builds, dev servers, watchers) has served its purpose — e.g. a
  build finished and was verified — stop it rather than leaving it running indefinitely.
- Stopping the wrapper task isn't always enough: `expo run:android`/Metro in particular
  detaches a bundler process that survives `TaskStop`. Check for it (e.g. via the port it's
  listening on) and kill it directly if it's still alive.
- Prefer a tool's own graceful shutdown when one exists (e.g. `./gradlew --stop` for Gradle/
  Kotlin daemons) over force-killing, since it avoids cache corruption and daemons restart
  cleanly on the next build anyway.
- Don't touch processes you didn't start — IDE/editor tooling (language servers, MCP servers,
  typings installers) and the shared `adb` server should be left alone.
- Do this routinely once a background task's job is done, not just when asked.

---
