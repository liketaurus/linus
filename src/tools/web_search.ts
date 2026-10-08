import { ask, prompt } from "../llm.ts";

const SERVICE = process.env.SEARCH_SERVICE ?? "http://127.0.0.1:8787";

// How many angles the model gets to attack one question from.
const QUERIES = 2;

// How many hits to ask each engine for.
const RESULTS = 5;

export const schema = {
  type: "function",
  function: {
    name: "web_search",
    description: "Search the web and answer a question from what comes back.",
    parameters: {
      type: "object",
      properties: { prompt: { type: "string" } },
      required: ["prompt"],
    },
  },
};

type Result = { title: string; url: string; snippet: string };

async function search(query: string) {
  const url = `${SERVICE}/search?q=${encodeURIComponent(query)}&n=${RESULTS}`;
  const res = await fetch(url).catch(() => null);
  if (!res) throw new Error(`search service is not running on ${SERVICE}`);
  return (await res.json()) as {
    duckduckgo: Result[];
    errors?: Record<string, string>;
  };
}

export const handler = async ({ prompt: question }: { prompt: string }) => {
  const planned = await ask(
    [
      {
        role: "user",
        content: prompt("search_query")
          .replace("{count}", String(QUERIES))
          .replace("{question}", question),
      },
    ],
    { format: "json" },
  );

  let queries: string[] = [];
  try {
    queries = JSON.parse(planned.content).queries ?? [];
  } catch {}

  queries = queries
    .filter((q) => typeof q === "string" && q.trim())
    .slice(0, QUERIES);

  if (queries.length === 0) queries = [question];

  // One at a time: two searches landing together looks more like a bot than a person.
  const results: Result[] = [];
  for (const query of queries) {
    const found = await search(query);
    for (const hit of found.duckduckgo) {
      if (!results.some((seen) => seen.url === hit.url)) results.push(hit);
    }
  }

  if (results.length === 0) return "the search returned nothing";

  const answer = await ask([
    {
      role: "user",
      content: prompt("search_answer")
        .replace("{question}", question)
        .replace("{results}", JSON.stringify(results)),
    },
  ]);

  return `searched: ${queries.join(" | ")}\n${answer.content.trim()}`;
};
