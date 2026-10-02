import { tool } from "langchain";
import { z } from "zod";
import type { ChatModel } from "./config.js";
import type { OutlineStore } from "./outline-store.js";

const outlineDraftSchema = z.object({
  items: z
    .array(
      z.object({
        title: z.string().describe("Slide title taken from the topic and requirements."),
        description: z
          .string()
          .describe("One short sentence taken from the topic and requirements."),
      }),
    )
    .min(1)
    .describe("Slides in outline order."),
});

function ok(data: unknown): string {
  return JSON.stringify({ ok: true, ...((data ?? {}) as object) });
}

function fail(error: unknown): string {
  const message = error instanceof Error ? error.message : "Something went wrong.";
  return JSON.stringify({ ok: false, error: message });
}

export function createOutlineTools(store: OutlineStore, model: ChatModel) {
  const listOutline = tool(
    async () => {
      try {
        const items = await store.list();
        return ok({ count: items.length, items });
      } catch (error) {
        return fail(error);
      }
    },
    {
      name: "list_outline",
      description:
        "Read the current slide outline. \
        Takes no arguments. \
        Returns every slide with a 1-based position, id, title, and description. \
        Position 1 is the first slide. \
        Call this before any change so you match the user's words to a real slide. \
        The user does not know ids.",
      schema: z.object({}),
    },
  );

  const createOutline = tool(
    async ({ topic, requirements, itemCount }) => {
      try {
        const count = itemCount ?? 6;
        const structured = model.withStructuredOutput(outlineDraftSchema);
        const draft = await structured.invoke([
          {
            role: "system",
            content:
              "Organize the topic and requirements into slides. Rephrase only. Do not add facts, numbers, dates, markets, or claims that were not supplied. Each description is one short sentence.",
          },
          {
            role: "user",
            content: `Write ${count} slides.\nTopic: ${topic}\nRequirements: ${requirements?.trim() || "None beyond the topic."}`,
          },
        ]);
        const items = await store.replace(draft.items.slice(0, count));
        return ok({
          replaced: true,
          topic,
          items,
        });
      } catch (error) {
        return fail(error);
      }
    },
    {
      name: "create_outline",
      description:
        "Throw away the current outline and replace it with a newly written one. " +
        "Use this only when the user clearly wants to start over or create a fresh outline. " +
        "Do not use it to add or edit a single slide. " +
        "Call it once. A successful call finishes the replacement. " +
        "topic is what the outline is about. " +
        "requirements is the user's constraints and requested content, copied through, not summarized away. " +
        "itemCount is optional and defaults to 6.",
      schema: z.object({
        topic: z.string().describe("What the new outline is about."),
        requirements: z
          .string()
          .optional()
          .describe(
            "The user's constraints and requested content, copied through. Do not drop details. Omit only when the user gave none beyond the topic.",
          ),
        itemCount: z
          .number()
          .int()
          .min(3)
          .max(10)
          .optional()
          .describe("How many slides to write. Defaults to 6."),
      }),
    },
  );

  const addItem = tool(
    async ({ title, description, position }) => {
      try {
        const result = await store.add({ title, description, position });
        return ok(result);
      } catch (error) {
        return fail(error);
      }
    },
    {
      name: "add_item",
      description:
        "Insert one new slide at a specific position. " +
        "Inspect the current outline when placement is relative to another slide. " +
        "To insert immediately before a slide at position N, use N; " +
        "immediately after it, use N + 1; " +
        "at the end, use current outline count + 1. " +
        "If placement cannot be determined, ask the user instead of calling this tool." +
        "Do not generate or infer a description. Only pass a description if the user explicitly provided one.",
      schema: z.object({
        title: z.string().describe("Title of the new slide."),
        description: z
          .string()
          .optional()
          .describe("Description provided by the user for the new slide. Do not generate or infer a description."),
        position: z
          .number()
          .int()
          .optional()
          .describe(
            "1-based insertion position. Before the slide at N, use N. After it, use N + 1. At the end, use the current count + 1.",
          ),
      }),
    },
  );

  const updateItem = tool(
    async ({ id, title, description }) => {
      try {
        const result = await store.update({ id, title, description });
        return ok(result);
      } catch (error) {
        return fail(error);
      }
    },
    {
      name: "update_item",
      description:
        "Change the title and/or description of one existing slide. \
        id must come from list_outline. \
        Pass only the fields that should change. \
        Use this to rename a slide.",
      schema: z.object({
        id: z.string().describe("Id of the slide to edit, copied from list_outline."),
        title: z.string().optional().describe("New title. Omit to leave the title as it is."),
        description: z
          .string()
          .optional()
          .describe("New description. Omit to leave the description as it is."),
      }),
    },
  );

  const moveItem = tool(
    async ({ id, position }) => {
      try {
        const result = await store.move({ id, position });
        return ok(result);
      } catch (error) {
        return fail(error);
      }
    },
    {
      name: "move_item",
      description:
        "Move one existing slide to a new position. " +
        "id must come from list_outline. " +
        "position is the slide's final 1-based position AFTER the move. " +
        "For relative moves, account for the moved slide being removed from its current position before determining the final position.",
      schema: z.object({
        id: z.string().describe("Id of the slide to move, copied from list_outline."),
        position: z
          .number()
          .int()
          .describe("Final 1-based position. 1 means the slide becomes first."),
      }),
    },
  );

  const deleteItem = tool(
    async ({ ids }) => {
      try {
        const result = await store.remove(ids);
        return ok(result);
      } catch (error) {
        return fail(error);
      }
    },
    {
      name: "delete_item",
      description:
        "Remove one or more slides by id. \
        ids is an array, even when deleting a single slide.\
        Only pass ids you just read from list_outline. \
        If the user's words match more than one slide, \
        do not call this; ask which slide they mean.",
      schema: z.object({
        ids: z
          .array(z.string())
          .min(1)
          .describe("Ids to remove, copied from list_outline."),
      }),
    },
  );

  return [listOutline, createOutline, addItem, updateItem, moveItem, deleteItem];
}
