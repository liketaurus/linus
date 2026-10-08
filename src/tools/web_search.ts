import { ask, prompt } from "../llm.ts";

// DuckDuckGo serves its own form over POST. A GET to the same place gets a captcha.
const DDG = "https://html.duckduckgo.com/html/";

// How many angles the model gets to attack one question from.
const QUERIES = 2;

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

const ENTITIES: Record<string, string> = {
  "&amp;": "&",
  "&lt;": "<",
  "&gt;": ">",
  "&quot;": '"',
  "&#39;": "'",
  "&#x27;": "'",
  "&nbsp;": " ",
};

const text = (raw: string) =>
  raw
    .replace(/<[^>]+>/g, "")
    .replace(/&[a-z#0-9]+;/gi, (e) => ENTITIES[e.toLowerCase()] ?? e)
    .trim();

async function search(query: string) {
  const res = await fetch(DDG, {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      "user-agent": "Mozilla/5.0",
    },
    body: new URLSearchParams({ q: query }).toString(),
  });

  const page = await res.text();
  if (page.includes("anomaly-modal")) {
    return { error: "duckduckgo asked for a captcha instead of answering" };
  }

  const links = [
    ...page.matchAll(/class="result__a"[^>]*href="([^"]+)"[^>]*>(.*?)<\/a>/gs),
  ];
  const snippets = [
    ...page.matchAll(/class="result__snippet"[^>]*>(.*?)<\/a>/gs),
  ];

  return {
    results: links.slice(0, 5).map(([, href, title], i) => ({
      title: text(title),
      // Every link is wrapped in a duckduckgo redirect; the real one is in uddg.
      url: new URL(href, "https://duckduckgo.com").searchParams.get("uddg") ?? href,
      snippet: snippets[i] ? text(snippets[i][1]) : "",
    })),
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

  // One at a time: two POSTs landing together looks more like a bot than a person.
  const results: { title: string; url: string; snippet: string }[] = [];
  const failures: string[] = [];

  for (const query of queries) {
    const found = await search(query);
    if (found.error) {
      failures.push(found.error);
      continue;
    }
    for (const hit of found.results!) {
      if (!results.some((seen) => seen.url === hit.url)) results.push(hit);
    }
  }

  if (results.length === 0) {
    return failures[0] ?? "the search returned nothing";
  }

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
