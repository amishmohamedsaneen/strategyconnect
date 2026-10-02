# Document Outline Agent — Design

## Architecture

The app separates natural-language reasoning from deterministic outline mutations.

```mermaid
flowchart LR
    U[User] --> UI[React UI]
    UI -->|message + threadId| API[Express API]
    API --> AGENT[DeepAgent]
    AGENT <--> MEMORY[MemorySaver]
    AGENT --> MODEL[OpenAI / Anthropic]
    AGENT --> TOOLS[6 Outline Tools]
    TOOLS --> STORE[OutlineStore]
    STORE <--> JSON[(outline.json)]
    AGENT -->|tool events + tokens| API
    API -->|SSE| UI
```

**Flow:** The UI sends a natural-language instruction to DeepAgent. The agent inspects the outline, resolves the user's references, and chooses one or more tools. Zod validates tool arguments; OutlineStore validates state-dependent rules and persists changes to `outline.json`. Tool activity and response tokens stream back to the UI.

There are two kinds of state:

- `outline.json` — source of truth for the document.
- `MemorySaver` — conversation context for follow-ups and clarification.

Conversation history helps understand intent, but IDs and positions for mutations come from the current outline.

## Key Design Decisions

### 1. Put determinism at the right boundary

| Layer | Responsibility |
| --- | --- |
| DeepAgent | Understand language, resolve references, clarify ambiguity, sequence tools |
| System prompt | Cross-tool behavioral rules |
| Tool descriptions | Operation-specific semantics |
| Zod | Validate tool-call shape |
| OutlineStore | IDs, bounds, invariants, persistence |

The model handles semantics; deterministic code handles rules the application can guarantee.

### 2. Tool definitions are the agent API

The model chooses actions from tool names, descriptions, and schemas, so these are treated as an API for the model.

A test exposed an important distinction:

- `add_item.position` = insertion position. After item N means N + 1.
- `move_item.position` = final position after the move.

This logic belongs in each tool's description rather than the global prompt.

### 3. Always use fresh state before editing

**Observed:** The agent updated Next Steps using an ID remembered from conversation history without first listing the outline.

**Decision:** Before `add_item`, `update_item`, `move_item`, or `delete_item`, call `list_outline` once in the same turn. Memory is for conversation continuity, not current document state.

### 4. Clarify ambiguous references

**Observed:** With multiple pricing-related slides, "delete the pricing slide" could select the recently discussed slide.

**Decision:** Resolve references against the current outline. If multiple items plausibly match, ask the user instead of using conversation recency as a tie-breaker.

History may still resolve explicitly contextual references such as "the one I just added".

### 5. Keep compound requests atomic when ambiguous

For a request such as:

> Move Competitive Analysis to the top and delete the pricing slide.

if the move is clear but "pricing slide" is ambiguous, no mutation is performed yet. The agent preserves the understood intent, asks one clarification question, then completes the request.

This avoids partially applying a request before the full intent is known.

### 6. Do not invent missing user intent

**Placement:** A new slide needs a resolvable title and placement. Relative instructions such as "before Next Steps" or "at the end" are converted to positions from the current outline. If placement is absent, ask rather than silently append.

**Description:** Testing showed the model could invent a description even when the user supplied none. Zod cannot determine whether text was user-provided, so the prompt/tool contract explicitly says not to generate or infer one.

**Current gap:** `add_item.position` is still optional in the uploaded implementation and the store still defaults it to the end. The final design is to make placement required at the tool boundary.

## Failure Handling

Failures are handled where they can be detected reliably:

- **Zod:** invalid tool argument shape and basic constraints.
- **OutlineStore:** missing IDs, invalid positions, empty updates, persistence.
- **Agent:** ambiguous or unresolved natural-language references.
- **Tool wrapper:** model and file failures are returned safely instead of crashing the turn.

The store also serializes file operations to avoid overlapping mutations of `outline.json`.

## Alternatives Considered

**Model confidence scores** — rejected because model-generated confidence is not a reliable correctness boundary.

**Deterministic reference resolver** — useful for exact matches but weak for semantic references such as "the slide where we compare ourselves with competitors".

**Intent classifier / custom planner** — rejected for now because one request can require several ordered operations, and DeepAgent already provides multi-tool orchestration. A structured operation plan would be considered only if further testing shows the current approach is insufficient.

## What I'd Do With More Time

- Align `add_item.position` schema and store behavior with the final placement rule.
- Use structured model output for `create_outline` instead of parsing generated JSON text.
- Return structured tool error codes for more predictable recovery.
- Add agent regression/evaluation cases for ambiguous and multi-step instructions.
- For a real multi-instance deployment, replace in-memory checkpoints and JSON persistence with durable shared storage.

## Design Principle

Use the model where semantic understanding is necessary; use tool contracts to shape its behavior; use deterministic code for invariants the application can guarantee.

The design was refined through repeated test → observe failure → identify owning layer → change → retest cycles rather than special-casing the provided walkthrough prompts.
