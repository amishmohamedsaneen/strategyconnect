# Feature Design: Document outline agent

**Status:** Accepted for the proof of concept. Follow-ups in Open questions are not built.
**Owner:** Take-home author
**Reviewers:** Marvin / StrategyConnect review
**Created:** 2026-10-02
**Last Updated:** 2026-10-02
**Related Docs:** `TASK.pdf`, `README.md`

---

## 1. Summary

A consultant edits a presentation outline by typing ordinary sentences. The page has the outline on the left and a chat on the right. A language-model agent turns each sentence into one or more of six tools. Those tools read and write `outline.json`. The left panel reloads when a tool finishes, and the chat shows tool activity and reply text while the turn is still running.

The interesting behavior is what the agent does when a sentence is ambiguous or names a slide that is not there. The proof of concept records those choices in the agent's standing instructions. The model never opens the file itself. It only sees tool names, descriptions, and Zod argument forms.

## 2. Problem / Motivation

Marvin builds and edits presentation decks through an agent. This take-home is a smaller version of that agent layer: tools a model can call, questions instead of guesses, and a stream of what the agent is doing so the page does not sit on a spinner.

The data is a six-slide outline. The test is eleven sentences in one chat, several of which do not map cleanly onto one slide. A correct-looking reply that guessed, or that edited a pretend file instead of `outline.json`, fails the exercise even if the page looks finished.

## 3. Goals

- Edit the outline from plain English, including sentences that need more than one tool call.
- Persist every change to `outline.json` and show the new order on the left as soon as a tool finishes.
- Stream tool activity and reply text during the turn.
- Keep one chat going across turns so an answer to the agent's question continues the same work.
- Resolve slide names to ids inside the agent. The user never types an id.
- Ask when more than one slide fits, and change nothing when none fit.
- Keep the model provider and API key in environment variables.

## 4. Non-Goals

- A database, user accounts, or more than one outline file.
- A seventh custom tool.
- NestJS. Express is the server for this proof of concept.
- Visual design, test coverage, and commit hygiene as scoring targets.
- Durable chat history after the server process stops.
- Hiding slide ids in the page. They are shown in small text so a walkthrough can see what the agent matched.

## 5. Current State

The proof of concept runs today.

- `npm run dev` starts Vite on port 5173 and Express on port 3001. Vite forwards `/api` to Express.
- The page loads `GET /api/outline`, shows the slides, and posts each chat message to `POST /api/chat` as a server-sent event stream.
- One `createDeepAgent` instance is created on the first chat and reused. `MemorySaver` keeps that chat in process memory, keyed by a thread id stored in the browser's `sessionStorage`.
- Six tools in `src/server/tools.ts` call `src/server/outline-store.ts`. The store is the only code that reads and writes `outline.json`.
- Standing instructions in `src/server/agent.ts` tell the model how to handle short names, missing slides, and renamed slides.
- `deepagents` 1.10.8 also registers its own file tools, a todo list, and subagents. The standing instructions tell the model not to use them. They are still callable. This is the main known gap.
- The chat renders `Working: <tool>` and `Done: <tool>`. The tool's JSON result is sent on the stream and then ignored by the page, so a failed tool does not show its error text.
- The typing box stays at the bottom of the chat column. Only the message list scrolls. The eleven walkthrough sentences sit in a list above the messages, capped so they cannot push the box off screen.

`outline.json` in the working tree may already differ from the original six slides if a session has been run. **Restore sample** writes the original list back.

## 6. Requirements

### Functional Requirements

These come from `TASK.pdf`.

- Two panels: outline on the left, chat on the right.
- Tools with these capabilities, and no seventh custom tool: list the outline with positions, replace it with a newly generated outline, add one slide, update one slide's title and/or description, move one slide to a target position, delete a list of ids.
- `create_outline` generates the items by calling a model. It does not copy them from a fixed list.
- Array order in `outline.json` is slide order. Position 1 is the first slide.
- Changes persist to `outline.json`. The outline panel shows the current file.
- The chat streams. A spinner that waits for the whole turn is not enough. Tool activity is required. Token streaming is included.
- The conversation is multi-turn. If the agent asks a question, the next user message continues that chat.
- Every instruction arrives as a sentence. The agent maps words to ids.
- The eleven prompts in the appendix are the acceptance walkthrough, run in order from a fresh `outline.json`, in one session.
- The model provider is selected by environment variables. Keys are not hard-coded.

### Non-Functional Requirements

- TypeScript with `strict` enabled.
- `deepagents` 1.10.x, entered through `createDeepAgent({ model, tools, systemPrompt, checkpointer })`.
- Tool argument forms use Zod.
- One local user. No scale, latency budget, or multi-tenant requirement.
- Edits to the one JSON file must not lose a write when two tools pause between read and write.

### Operational Requirements

- `npm install` then `npm run dev` from a checkout, after copying `.env.example` to `.env`.
- Restart the process after changing `.env`. The key is read at startup, and the agent is built on the first chat.
- Chat memory is gone when the process stops. The outline file remains.
- Server logs print `tool start` and `tool end` to the terminal.

## 7. Proposed Architecture

```text
Browser (React, Vite :5173)
  outline panel  <---- GET /api/outline, POST /api/outline/reset
  chat panel     <---- POST /api/chat  (server-sent events)
        |
        |  /api proxied
        v
Express (:3001)
  getAgent()  ->  createDeepAgent
                    model from config.ts (OpenAI or Anthropic)
                    six tools from tools.ts
                    system prompt
                    MemorySaver (thread id)
                          |
                          v
                    outline-store.ts  --withLock-->  outline.json
```

The model is one reader of the tool menu. The store is the writer of the file. The page is another reader of the file, through `GET /api/outline`, after each tool finishes.

`deepagents` also attaches its own tools beside the six. Those tools are not part of the outline design. They are called out in Risks.

## 8. Detailed Design

### 8.1 Components

| Piece | File | Responsibility |
| --- | --- | --- |
| Slide shape and the original six slides | `src/shared/outline.ts` | Shared by the page and the server so both agree on `id`, `title`, and `description`. |
| File operations | `src/server/outline-store.ts` | Load, validate, and save `outline.json`. Add, update, move, delete, replace, and reset. |
| Tool menu | `src/server/tools.ts` | Names, descriptions, and Zod forms the model sees. Calls the store. `create_outline` calls the model for new titles, then `replace`. |
| Agent | `src/server/agent.ts` | `createDeepAgent` plus the standing instructions and the in-memory checkpointer. |
| Model selection | `src/server/config.ts` | `MODEL_PROVIDER` and `MODEL_NAME`. Requires the matching API key. |
| HTTP | `src/server/index.ts` | Outline read, reset, and the chat stream. Builds the agent once. |
| Page | `src/client/App.tsx` | Two panels, walkthrough sentences, streaming display, fixed composer. |

The three server files stay separate on purpose. A tool function could open `outline.json` itself. That works in a short script. It mixes three jobs: the menu the model reads, the file format, and, for `create_outline`, a second model call. The page also needs the same slide shape, so the shape lives in `outline.ts`, the file mechanic lives in the store, and the menu lives in `tools.ts`.

Functions return objects. There is no class for the store or the tools. A class would be the same methods with a constructor. The extension point is the set of methods the tools call (`list`, `add`, `update`, `move`, `remove`, `replace`). Another store with those methods can be passed in without the tools changing. A class hierarchy for "a database later" was rejected. The task forbids a database and a seventh tool. `ChatOpenAI` and `ChatAnthropic` are classes because those libraries require `new`.

### 8.2 Workflow / Sequence

1. The page loads and requests the outline.
2. The user sends a sentence with a thread id.
3. Express starts a server-sent event stream and calls `streamEvents` on the one agent, passing only the new sentence. The checkpointer already holds earlier turns for that thread id.
4. The model reads the standing instructions and the six tool forms. For any edit, it should call `list_outline` first and match the user's words to titles.
5. Each tool call runs the store under the lock, writes the file, and returns JSON `{ ok: true, ... }` or `{ ok: false, error }`.
6. The stream emits tool start, tool end, and reply text. Text produced while a tool is running, including the inner model call inside `create_outline`, is not forwarded as chat text.
7. On each tool end, the page requests the outline again and redraws the left panel.
8. If the sentence is ambiguous, the model asks one question and stops. The user's next message uses the same thread id.

### 8.3 Data Flow

- User sentence → chat request → agent messages.
- Model tool arguments → Zod check → store method → `outline.json`.
- Store result JSON → tool message → model → streamed reply text.
- `outline.json` → `GET /api/outline` → left panel.

Ids are created in the store with 3 random bytes hex-encoded, skipping ids already in the list. The model that writes a new outline returns titles and descriptions only. `replace` assigns ids.

Positions are not stored. `list` sets `position` to the 1-based index. For `move`, the position argument is where the slide should sit after the move. The implementation removes the slide, then inserts it at `position - 1`.

### 8.4 Configuration and Feature Flags

No feature flags.

| Variable | Role |
| --- | --- |
| `MODEL_PROVIDER` | `openai` (default) or `anthropic` |
| `MODEL_NAME` | Defaults to `gpt-4o-mini` or `claude-sonnet-4-5` |
| `OPENAI_API_KEY` / `ANTHROPIC_API_KEY` | Required for the chosen provider |
| `PORT` | API port, default 3001 |
| `OUTLINE_PATH` | Default `outline.json` in the project directory |

There is no runtime switch for the built-in `deepagents` tools.

### 8.5 Error Handling and Retries

The agent library decides whether to retry a model call. This project does not add its own retries.

Store methods throw on a bad title, a bad position, or an unknown id. Tools catch that and return `{ ok: false, error }` so the model gets a sentence it can correct from, instead of a crashed turn. `delete` removes the ids that exist and reports the rest as `missing`. If none exist, it throws and nothing is deleted.

`create_outline` asks the model for a JSON array, strips a markdown fence if present, and accepts either an array or `{ items: [...] }`. A bad payload leaves the file unchanged because `replace` runs only after parsing succeeds.

Chat validation failures (empty message or missing thread id) return HTTP 400 before the stream starts. A missing API key is sent as an error event on the stream, then `done`. The outline endpoints still work without a key.

There is no idempotency key. Sending the same sentence twice applies it twice.

### 8.6 Security

The API key stays in `.env`, which is gitignored. `.env.example` has empty key fields. The server has no authentication. It is a local process. Anyone who can reach port 3001 can read and edit the outline and spend the API key. Do not expose that port.

Tool results and the outline file contain slide text only.

### 8.7 Observability

The terminal logs `tool start: <name>` and `tool end: <name>`. The page shows the same names in the chat. There are no metrics, traces, or alerts. A tool's returned JSON is on the event stream as `detail` and is not rendered.

### 8.8 Concurrency

Node runs this server's JavaScript on one thread. The thread pauses at `await` while a file or the model is in progress, so two tool calls can overlap between read and write. `withLock` is a queue of promises: each edit waits until the previous edit finishes, including when the previous one failed. The caller still receives that failure. The tail of the queue ignores the failure so one bad edit does not block the next.

The page disables Send while a turn is in progress, so two user messages are unlikely to overlap. One sentence can still start two tools together, such as move and rename. That is the case the lock is for. Without it, both tools can read the same list and the second save can drop the first edit. The loss is silent.

The public store methods take the lock. The bodies call the inner `read` and `write`, which do not take it again. Calling a public method from inside a locked method would wait on itself.

### 8.9 Judgment rules

These are standing instructions, not separate tools. They are the decisions for the eleven sentences.

| Situation | Behavior |
| --- | --- |
| A short name matches one slide ("intro" → "Introduction") | Treat it as that slide. |
| The words match no slide ("appendix") | Say so. Do not create a slide and do not move a different one. |
| The words match more than one slide ("the pricing slide") | Ask which one. Change neither. |
| Part of the sentence is clear and part is not | Do the clear part, then ask. |
| The title was just renamed (Next Steps → Closing) | Ask whether they mean the renamed slide. Do not edit it silently. |
| One sentence needs two changes (move and rename) | Call both tools, then summarize the order in plain English. Do not mention tool names or ids. |
| The user clearly wants a new outline | `create_outline` replaces the file. Item count defaults to 6 and is clamped to 3–10 by the Zod form. |

`create_outline` is only for starting over. Adding or editing one slide uses the other tools.

## 9. Data Model Changes

No database. The file format is the whole model.

```json
{
  "items": [
    { "id": "a1", "title": "Introduction", "description": "Set context and agenda." }
  ]
}
```

Order in `items` is slide order. `description` may be an empty string if it was missing on read. A file that is not an object with an `items` array, or an item without a string `id` and `title`, fails the read. A missing file is created from `SAMPLE_OUTLINE`.

Reset replaces the file with that same sample. There is no migration.

## 10. API / Contract Changes

### `GET /api/outline`

Returns `{ items: [{ id, title, description }] }`.

### `POST /api/outline/reset`

Writes the sample outline and returns it. This is a page action, not a seventh agent tool.

### `POST /api/chat`

Request JSON: `{ message: string, threadId: string }`.

Response: `text/event-stream`. Each event is one JSON object:

| `type` | Fields | Meaning |
| --- | --- | --- |
| `token` | `text` | A piece of the reply, only when no tool is running |
| `tool` | `status: "start" \| "end"`, `name`, optional `detail` | A tool began or finished. `detail` is the tool output, cut at 500 characters |
| `error` | `message` | The turn failed, including a missing API key |
| `done` | | The stream is finished |

The page keeps sending only the newest sentence. It does not resend the whole chat. The checkpointer supplies the earlier turns.

### Tool results

Success is `{ ok: true, ... }`. Failure is `{ ok: false, error: string }`. `list` includes `count` and `items` with `position`. `add`, `update`, and `move` include the touched slide and the full positioned list. `delete` includes `deleted`, `missing`, and `items`. `create_outline` includes `replaced`, `topic`, and `items`.

## 11. Failure Modes and Retries

| Failure | What the user sees | File |
| --- | --- | --- |
| No API key | Error text in the chat. Outline still loads. | Unchanged |
| Model names a missing id | Tool returns an error telling it to call `list_outline` | Unchanged |
| Position out of range | Tool returns the legal range. 1 is the top. | Unchanged |
| Delete ids that are all missing | Error, nothing deleted | Unchanged |
| Delete a mix of real and missing ids | Real ids removed, missing ids listed | Updated |
| Generated outline is not a list | `create_outline` returns an error | Unchanged |
| Two tools write at once | The lock serializes them | Both edits kept |
| Built-in file tool runs instead of an outline tool | The chat may show that tool name. `outline.json` may not change. | Unchanged, which is the bug |
| Server restart | New chat memory. Outline file still there. | File kept |

No automatic retry loop was added around tool calls.

## 12. Observability

Covered in section 8.7. Success for a walkthrough is the terminal tool log plus the left panel matching `outline.json`, not a dashboard.

## 13. Security and Compliance

Covered in section 8.6. The outline is local slide text. The secret is the provider API key.

## 14. Rollout / Migration Plan

This is a local proof of concept, not a production deploy.

1. Copy `.env.example` to `.env` and set one provider key.
2. `npm install` and `npm run dev`.
3. Open `http://localhost:5173`.
4. For the official walkthrough, click **Restore sample**, then **New chat**, then run the eleven sentences in order in that chat.

Rollback of the outline is **Restore sample**, or replacing `outline.json` with the sample in `src/shared/outline.ts`. Rollback of a bad chat is **New chat** or restarting the process. There is no backfill.

## 15. Alternatives Considered

### Express instead of NestJS

Pros: One small server library. The task allows Express when NestJS would mean learning a framework and the agent library together.
Cons: NestJS is what the company runs. A later port would rewrite the route layer.
Selected: Express.

### Six tools that open `outline.json` themselves

Pros: Fewer files. A Python script would often `open()` the file inside the tool.
Cons: The page, the lock, validation, and the `create_outline` model call would sit in the tool menu. The model-facing descriptions would be mixed with file code.
Selected: `outline.ts` for the shape, the store for the file, `tools.ts` for the menu.

### Classes for the store and the tools

Pros: Familiar if most of your code is Python classes. `new OutlineStore(path)` is an obvious instance.
Cons: One file and six tools do not gain behavior from inheritance. Extensibility here is "same method names, different body," which the returned object already is.
Selected: functions. Libraries that require classes (`ChatOpenAI`) still use classes.

### No lock around the file

Pros: The page sends one message at a time, so the lock often never changes what you see. The promise queue is harder to read than the edits themselves.
Cons: Two tools in one turn can both `await` a read, both change a private copy, and the second write drops the first edit. That failure is silent.
Selected: keep `withLock`. A named mutex from a library would be easier to read. The behavior would be the same queue.

### Guess when a sentence is ambiguous

Pros: The eleven prompts finish with no extra user reply.
Cons: "Delete the pricing slide" would delete two slides, or the wrong one. "Move the appendix" would invent a slide or move an unrelated one. The task is explicitly about this judgment.
Selected: ask on two matches, refuse on zero matches, and ask again when a title was just renamed.

### Put the judgment only in the system prompt

This is what the code does now.
Pros: One place to read the rules.
Cons: The model chooses tools from the tool descriptions and the JSON they return. Rules that live only in the prompt are easier to ignore, and the `deepagents` default prompt also tells the model to use its own file tools.
Not selected as the end state. It is the current implementation. Moving the rules into tool descriptions and error strings is an open follow-up.

### Disable the built-in deepagents tools

Not built.
Pros: The outline can change only through the six tools. A file tool cannot pretend the outline was edited.
Cons: `createDeepAgent` in 1.10.8 always installs those tools. Turning them off means extra middleware or a backend that rejects every file call, which is more code than the proof of concept started with.
Selected for now: the standing instructions forbid them. The follow-up is to make those calls fail.

### Show tool errors in the chat

Not built. The server already sends `detail`. The page prints only the tool name.
Selected for now: names only. Showing the error string is a follow-up.

## 16. Risks and Mitigations

| Risk | Impact | Mitigation |
| --- | --- | --- |
| Built-in file, todo, or subagent tools run | The model thinks it edited the outline. `outline.json` is unchanged. | Prompt forbids them. Follow-up: make those tools fail. Watch the terminal for any tool name outside the six. |
| Judgment rules live mainly in the prompt | "Delete the pricing slide" deletes both, or "appendix" creates a slide. | Re-run the eleven sentences from a fresh file. If it guesses, tighten that tool's description and the error text. |
| Tool failure text is hidden in the page | A bad call looks like `Done: delete_item`. | Read the terminal, or render `detail` in a follow-up. |
| `outline.json` committed after a session | A reviewer does not start from the sample six slides. | Restore sample before sending the repo. |
| Chat memory is in RAM | Restart wipes the thread. A follow-up answer loses the question. | Walk through in one process. Document this in the README. |
| `itemCount` limited to 3–10 | A request for 2 or 20 slides is rejected by Zod. | The task does not fix a count. Default 6 matches the sample size. |

## 17. Open Questions

- Turn off built-in `deepagents` tools, or keep the prompt-only ban and describe that choice in the README?
- Move the ask-versus-guess rules into each tool description and into `{ ok: false, error }` text?
- Render tool `detail` in the chat when a tool fails?
- After a clean eleven-prompt run, which sentences still guessed? Those are the only prompt edits worth making.
- The submission still needs `TRANSCRIPT.md`, a three-to-four minute unedited recording, and a README section on decisions and dropped approaches. This design doc holds the decisions. The README today only explains how to run the app.

## 18. Acceptance Criteria

- [ ] From a fresh sample outline, in one chat, each of the eleven sentences is handled as in section 8.9.
- [ ] "Delete the pricing slide" asks which pricing slide and deletes nothing until the user answers.
- [ ] "Move the appendix to the top" says there is no appendix and does not change the file.
- [ ] After the last slide is renamed to Closing, a later "Next Steps" sentence asks whether Closing is meant, and does not edit it until the user says yes.
- [ ] "Move Competitive Analysis to the top and rename it to Competitive Position" does both, and the left panel shows that title at position 1.
- [ ] "Start over with a new outline about our Q3 expansion into Southeast Asia" replaces `outline.json` with new slides about that topic.
- [ ] During a turn, the chat shows tool names before the reply finishes, and the reply text arrives in pieces.
- [ ] The typing box stays visible at the bottom while the messages scroll.
- [ ] `npm install` and `npm run dev` work from a checkout with a `.env` key. No key is hard-coded.
- [ ] A second overlapping tool call does not drop the first edit.

## 19. Implementation Contract for Agents

The proof of concept already exists. A follow-up change must keep the behavior in this document.

### New Components

None required for the current design.

### Modified Components

Only if a follow-up from Open questions is explicitly requested:

- `src/server/agent.ts` to narrow or replace the built-in tool set.
- `src/server/tools.ts` to put matching rules in descriptions and error strings.
- `src/client/App.tsx` to show tool `detail` on failure.

### Files Expected to Change

No files need to change to match the accepted proof of concept. Do not rewrite the store into a class, do not add a database, and do not add a seventh outline tool unless a new request says so.

### Invariants

- `outline-store.ts` is the only writer of `outline.json`.
- Slide order is array order. Position 1 is the first slide. A move position is the final position.
- The model does not invent ids. `replace` and `add` assign them.
- Ambiguous matches ask. Zero matches change nothing.
- `create_outline` is the only tool that replaces the whole file, and only when the user wants a new outline.
- One agent instance per process, so the checkpointer survives the next message.
- Provider and API key come from the environment.

### Explicit Non-Goals for Implementation

- NestJS, a database, authentication, or a seventh custom tool.
- Replacing `withLock` with nothing.
- Collapsing the store into the tool functions.
- Teaching the model slide ids in the user-facing reply.

## Appendix

### A. The eleven sentences

Run these in order, in one chat, starting from the sample outline. Answer any question in a normal sentence, then continue.

1. What's in my outline?
2. Move the intro to the end.
3. Delete the pricing slide.
4. Move Pricing Details right after the Introduction.
5. Rename the last item to "Closing".
6. Change the description of Next Steps to "Owners, timeline, and budget sign-off."
7. Add a slide about implementation risks before Next Steps.
8. Move Competitive Analysis to the top and rename it to "Competitive Position".
9. Delete Market Landscape and Next Steps.
10. Move the appendix to the top.
11. Start over with a new outline about our Q3 expansion into Southeast Asia.

There is no appendix in the sample, and none is created by the earlier sentences. Sentence 10 must not invent one.

Sentence 6 is aimed at a title sentence 5 may have removed. If the last slide was Next Steps and it is now Closing, the agent asks. It does not guess.

### B. Design discussions

This is the record of the design conversations behind the decisions above.

**What the store is for.** `outline-store.ts` owns the file. It validates the list, saves after every change, numbers positions on read, and serializes edits. The agent and the page call it. They do not open the file.

**Why `outline.ts` and `tools.ts` exist if the store already touches the file.** `outline.ts` is the shared slide shape and the sample list. `tools.ts` is the menu: name, description, Zod form, and a function that calls the store and returns JSON. `create_outline` also calls the model, which does not belong in the file layer. A Python tool can `open("outline.json")` directly. That is a valid small-script shape. It was rejected here so the page, the file, and the model menu can change separately.

**`withLock`.** It is an async lock, the same idea as `asyncio.Lock`: each edit waits until the previous read-modify-save finishes, and a failed edit still releases the queue. It looked unnecessary because the page sends one message at a time and Node runs JavaScript on one thread. The thread still pauses at `await`, so two tools in one sentence can overlap. The lock stays because a lost write would be silent. A `Mutex` from a library would be easier to read than the hand-written promise chain.

**Classes.** JavaScript has classes. This code uses functions that return the operations. A class does not add extensibility the task can use. The method list on the store is the extension point. Inheritance for a future database was rejected with the database itself.

**Zod.** The schema on each tool is the argument list the model must fill in. TypeScript types are erased before the program runs, so they cannot check the model's JSON. Zod checks it, and the tool helper sends that field list to the model. `.describe()` is the hint beside each field. This is the same role as a Pydantic model on a Python tool. `tool()` requires a schema.

**Node and Express.** Node is the program that runs the server JavaScript, the way the Python interpreter runs a Python server. The browser runs the page. Express is the HTTP library: outline, reset, and the chat stream. Vite serves the page and proxies `/api`. The task prefers NestJS. Express was chosen so the proof of concept did not add a second framework.

**The typing box.** The chat column was growing with the messages, so the page scrolled and the input scrolled away. The column is now the height of the screen. The message list scrolls. The input stays at the bottom.

**What still needs work, after the app already completes a chat.** Finishing the eleven sentences is the starting bar. The review reads the decisions, the tool descriptions, and what happens on a bad request. The follow-ups are: write those decisions where a reviewer will read them, re-run from a restored outline and keep the transcript, stop the built-in tools from bypassing the six, put the matching rules in the tool text, and show a failed tool's error in the chat. Visual polish, NestJS, a database, and a seventh tool are out of scope.
