---
name: Avoid compound commands that need approval
description: Don't use working directory paths in commands; cd first then run separately
type: feedback
---

Do not pass working directories inline in commands (e.g., `git -C <path>` or `npx --prefix <path>`). These trigger manual approval prompts.

**Why:** The user has to manually approve each compound or path-including command, slowing down the workflow.

**How to apply:** Use `cd` to change to the correct directory first (as a separate Bash call if needed), then run commands without path arguments. Or use relative paths from the current working directory. The key is to avoid patterns that trigger the "compound commands" approval gate.
