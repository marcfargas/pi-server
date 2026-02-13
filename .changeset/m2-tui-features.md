---
"@marcfargas/pi-client": minor
---

Full TUI for coding sessions — tool output, thinking, multi-line editor.

- **Tool output rendering**: full lifecycle with ✓/✗ indicators, streaming partial output, truncation at 15 lines. Bash shows command text, read/write/edit show file path.
- **Thinking blocks**: streaming 💭 display while model reasons, dimmed and hidden once text starts.
- **Multi-line text editor**: Enter for newlines, Ctrl+D to submit, arrow key navigation, block cursor.
- **Message history**: Up/Down arrows recall previous prompts with draft preservation.
- **Client commands**: `//quit`, `//help`, `//clear`, `//status` — double-slash prefix avoids clashes with pi's `/` and `!` commands. Everything else passes through to pi.
