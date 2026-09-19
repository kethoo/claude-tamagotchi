---
description: Change species (cat, bunny, bear) and color theme
argument-hint: "<species> [theme]"
allowed-tools: Bash(node *)
disable-model-invocation: true
---
Run this command with the Bash tool, quoting the arguments as needed:

node "${CLAUDE_PLUGIN_ROOT}/scripts/pet.js" species $ARGUMENTS

Then show its output to the user exactly as printed, inside one ```text code block. Don't add commentary.
