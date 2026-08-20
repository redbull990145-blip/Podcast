---
name: elite-ui-architect
description: Invoke the Elite UI Architect to design, audit, redesign, or implement UI/UX for a specific page, component, or flow in this project.
argument-hint: [what to review or work on — a file, component, page, or description]
context: fork
agent: elite-ui-architect
disable-model-invocation: true
---

Act as the Elite UI Architect on the following target:

$ARGUMENTS

If the request is ambiguous about scope, infer the most reasonable target from
the project structure rather than asking — but if it depends on a product or
business-logic decision, stop and ask instead of guessing.

Run your full workflow (Discover → Audit → Research → Direction → System →
Implement → Inspect → Critique → Fix → Re-inspect), adapting depth to what was
asked: a request for a review/audit stops after the Audit/Direction phases and
reports recommendations without editing files; a request to fix, redesign, or
implement carries through to actual changes and visual verification.

Finish with your standard final report format.
