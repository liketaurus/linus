import { ask, prompt } from "../llm.ts";

const SERVER = process.env.TELEGRAM_SERVER ?? "http://127.0.0.1:8787";

export const schema = {
  type: "function",
  function: {
    name: "telegram",
    description:
      "Answer a question about the user's Telegram chats and messages.",
    parameters: {
      type: "object",
      properties: { prompt: { type: "string" } },
      required: ["prompt"],
    },
  },
};

const get = async (path: string) => {
  const res = await fetch(`${SERVER}${path}`).catch(() => null);
  if (!res) return { error: `telegram server is not running on ${SERVER}` };
  return res.json();
};

export const handler = async ({ prompt: question }: { prompt: string }) => {
  const chats = await get("/chats");
  if (chats.error) return chats.error;

  const planned = await ask(
    [
      {
        role: "user",
        content: prompt("telegram_query")
          .replace("{chats}", JSON.stringify(chats))
          .replace("{question}", question),
      },
    ],
    { format: "json" },
  );

  let query: { chat?: string; offset?: number; limit?: number } = {};
  try {
    query = JSON.parse(planned.content);
  } catch {}

  const data: Record<string, unknown> = { chats };
  if (query.chat) {
    Object.assign(
      data,
      await get(
        `/messages?chat=${encodeURIComponent(query.chat)}` +
          `&offset=${Number(query.offset) || 0}` +
          `&limit=${Number(query.limit) || 20}`,
      ),
    );
  }

  const answer = await ask([
    {
      role: "user",
      content: prompt("telegram_answer")
        .replace("{question}", question)
        .replace("{data}", JSON.stringify(data)),
    },
  ]);

  return answer.content.trim();
};
