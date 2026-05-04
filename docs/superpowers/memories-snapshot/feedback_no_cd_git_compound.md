---
name: No cd && git compound commands
description: Avoid compound bash commands with cd and git to prevent permission approval prompts
type: feedback
---

Do not use `cd <path> && git <command>` compound commands — they trigger a "Compound commands with cd and git require approval to prevent bare repository attacks" permission prompt.

**Why:** The user has to manually approve each one, slowing down the workflow.

**How to apply:** Use `git -C <path> <command>` instead, or run commands from the repo root without cd. For non-git commands that need a directory, run them separately or use absolute paths.
