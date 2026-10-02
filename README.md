# Outline agent

A one-page app with a slide outline on the left and a chat on the right. You type what you want in plain English. The agent edits `outline.json`, and the outline panel updates while it works.

## Requirements

- Node.js 20 or newer
- An OpenAI or Anthropic API key

## Run it

From the project folder:

```bash
npm install
cp .env.example .env
```

Open `.env` and set the provider you have a key for.

OpenAI:

```bash
MODEL_PROVIDER=openai
MODEL_NAME=gpt-4o-mini
OPENAI_API_KEY=sk-...
```

Anthropic:

```bash
MODEL_PROVIDER=anthropic
MODEL_NAME=claude-sonnet-4-5
ANTHROPIC_API_KEY=sk-ant-...
```

Leave the unused key blank. Then start the app:

```bash
npm run dev
```

Open http://localhost:5173.

That command starts two processes:

- the web page on port 5173
- the API on port 3001

The page sends chat and outline requests to `/api`, and the page server forwards those to the API. Use the page URL above. You do not need to open port 3001 in the browser.

Stop the app with Ctrl+C in the same terminal.

## Using the page

The left panel lists the slides in `outline.json`. Order in the list is slide order.

The right panel is the chat. Numbered buttons fill in the eleven walkthrough sentences. Click one, then press Send. If the agent asks a question, answer it in the same chat and continue.

- **Restore sample** puts the original six slides back into `outline.json`.
- **New chat** starts a fresh conversation. The outline file stays as it is.

Edits are written to `outline.json` immediately. Chat memory lasts only until you stop the server or click New chat.

## If something does not start

Restart `npm run dev` after you change `.env`. The settings are read when the process starts.

If port 5173 or 3001 is already in use, stop the other process using that port and run `npm run dev` again.

A chat sent with no API key returns an error in the chat panel asking you to copy `.env.example` to `.env` and add a key. The outline panel still loads without a key.
