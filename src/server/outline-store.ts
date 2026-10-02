import { randomBytes } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import type { Outline, OutlineItem } from "../shared/outline.js";
import { SAMPLE_OUTLINE } from "../shared/outline.js";

export type ListedItem = OutlineItem & { position: number };

function newId(existing: Set<string>): string {
  let id = "";
  do {
    id = randomBytes(3).toString("hex");
  } while (existing.has(id));
  return id;
}

function parseOutline(raw: string): Outline {
  const parsed: unknown = JSON.parse(raw);
  if (
    !parsed ||
    typeof parsed !== "object" ||
    !("items" in parsed) ||
    !Array.isArray(parsed.items)
  ) {
    throw new Error("outline.json must be an object with an items array.");
  }

  const items: OutlineItem[] = parsed.items.map((item, index) => {
    if (!item || typeof item !== "object") {
      throw new Error(`Item ${index + 1} is not an object.`);
    }
    const record = item as Record<string, unknown>;
    if (typeof record.id !== "string" || typeof record.title !== "string") {
      throw new Error(`Item ${index + 1} needs a string id and title.`);
    }
    return {
      id: record.id,
      title: record.title,
      description: typeof record.description === "string" ? record.description : "",
    };
  });

  return { items };
}

export function createOutlineStore(filePath: string) {
  let chain: Promise<unknown> = Promise.resolve();

  function withLock<T>(fn: () => Promise<T>): Promise<T> {
    const run = chain.then(fn, fn);
    chain = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  async function read(): Promise<Outline> {
    try {
      const raw = await readFile(filePath, "utf8");
      return parseOutline(raw);
    } catch (error) {
      if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
        await write(SAMPLE_OUTLINE);
        return structuredClone(SAMPLE_OUTLINE);
      }
      throw error;
    }
  }

  async function write(outline: Outline): Promise<void> {
    await writeFile(filePath, `${JSON.stringify(outline, null, 2)}\n`, "utf8");
  }

  function listed(outline: Outline): ListedItem[] {
    return outline.items.map((item, index) => ({
      position: index + 1,
      ...item,
    }));
  }

  return {
    read: () => withLock(read),

    reset: () =>
      withLock(async () => {
        const outline = structuredClone(SAMPLE_OUTLINE);
        await write(outline);
        return outline;
      }),

    list: () => withLock(async () => listed(await read())),

    add: (input: { title: string; description?: string; position?: number }) =>
      withLock(async () => {
        const title = input.title.trim();
        if (!title) {
          throw new Error("A new slide needs a title.");
        }
        const outline = await read();
        const position = input.position ?? outline.items.length + 1;
        const max = outline.items.length + 1;
        if (!Number.isInteger(position) || position < 1 || position > max) {
          throw new Error(
            `Position must be a whole number from 1 to ${max}. 1 is the top. ${max} appends after the last slide.`,
          );
        }
        const item: OutlineItem = {
          id: newId(new Set(outline.items.map((entry) => entry.id))),
          title,
          description: input.description?.trim() ?? "",
        };
        outline.items.splice(position - 1, 0, item);
        await write(outline);
        return { item, items: listed(outline) };
      }),

    update: (input: { id: string; title?: string; description?: string }) =>
      withLock(async () => {
        if (input.title === undefined && input.description === undefined) {
          throw new Error("Provide a new title, a new description, or both.");
        }
        const outline = await read();
        const item = outline.items.find((entry) => entry.id === input.id);
        if (!item) {
          throw new Error(
            `No slide with id "${input.id}". Call list_outline and use an id from that list.`,
          );
        }
        if (input.title !== undefined) {
          const title = input.title.trim();
          if (!title) throw new Error("Title cannot be empty.");
          item.title = title;
        }
        if (input.description !== undefined) {
          item.description = input.description.trim();
        }
        await write(outline);
        return { item, items: listed(outline) };
      }),

    move: (input: { id: string; position: number }) =>
      withLock(async () => {
        const outline = await read();
        const index = outline.items.findIndex((entry) => entry.id === input.id);
        if (index === -1) {
          throw new Error(
            `No slide with id "${input.id}". Call list_outline and use an id from that list.`,
          );
        }
        const max = outline.items.length;
        if (!Number.isInteger(input.position) || input.position < 1 || input.position > max) {
          throw new Error(`Position must be a whole number from 1 to ${max}. 1 is the top.`);
        }
        const [item] = outline.items.splice(index, 1);
        if (!item) throw new Error("Could not remove the slide before moving it.");
        outline.items.splice(input.position - 1, 0, item);
        await write(outline);
        return { item, items: listed(outline) };
      }),

    remove: (ids: string[]) =>
      withLock(async () => {
        if (ids.length === 0) throw new Error("Provide at least one id to delete.");
        const outline = await read();
        const known = new Set(outline.items.map((entry) => entry.id));
        const missing = ids.filter((id) => !known.has(id));
        const dropping = new Set(ids.filter((id) => known.has(id)));
        if (dropping.size === 0) {
          throw new Error(
            `None of these ids are in the outline: ${missing.join(", ")}. Nothing was deleted.`,
          );
        }
        outline.items = outline.items.filter((entry) => !dropping.has(entry.id));
        await write(outline);
        return {
          deleted: [...dropping],
          missing,
          items: listed(outline),
        };
      }),

    replace: (drafts: { title: string; description: string }[]) =>
      withLock(async () => {
        if (drafts.length === 0) throw new Error("A new outline needs at least one slide.");
        const used = new Set<string>();
        const items = drafts.map((draft) => {
          const title = draft.title.trim();
          if (!title) throw new Error("Every generated slide needs a title.");
          const id = newId(used);
          used.add(id);
          return { id, title, description: draft.description.trim() };
        });
        const outline = { items };
        await write(outline);
        return listed(outline);
      }),
  };
}

export type OutlineStore = ReturnType<typeof createOutlineStore>;
