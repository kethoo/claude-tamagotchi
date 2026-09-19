---
description: Show the current quest, or add/tick/skip quests
argument-hint: "[add <title> <steps> | tick | skip]"
allowed-tools: Bash(node *)
disable-model-invocation: true
---
Run this command with the Bash tool, quoting the arguments as needed:

node "${CLAUDE_PLUGIN_ROOT}/scripts/pet.js" quests $ARGUMENTS

Then show its output to the user exactly as printed, inside one ```text code block. Don't add commentary.
