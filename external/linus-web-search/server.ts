import express from "express";

const PORT = Number(process.env.PORT ?? 8787);

type Result = { title: string; url: string; snippet: string };

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

// DuckDuckGo serves its own form over POST. A GET to the same place gets a captcha.
async function duckduckgo(query: string, n: number): Promise<Result[]> {
  const res = await fetch("https://html.duckduckgo.com/html/", {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      "user-agent": "Mozilla/5.0",
    },
    body: new URLSearchParams({ q: query }).toString(),
  });

  const page = await res.text();
  if (page.includes("anomaly-modal")) throw new Error("captcha");

  const links = [
    ...page.matchAll(/class="result__a"[^>]*href="([^"]+)"[^>]*>(.*?)<\/a>/gs),
  ];
  const snippets = [
    ...page.matchAll(/class="result__snippet"[^>]*>(.*?)<\/a>/gs),
  ];

  return links.slice(0, n).map(([, href, title], i) => ({
    title: text(title),
    // Every link is wrapped in a duckduckgo redirect; the real one is in uddg.
    url: new URL(href, "https://duckduckgo.com").searchParams.get("uddg") ?? href,
    snippet: snippets[i] ? text(snippets[i][1]) : "",
  }));
}

const app = express();

app.get("/search", async (req, res) => {
  const q = String(req.query.q ?? "").trim();
  const n = Math.min(Number(req.query.n ?? 5) || 5, 25);

  if (!q) {
    res.status(400).json({ error: "q is required, as in /search?q=cats&n=5" });
    return;
  }

  try {
    res.json({ query: q, count: n, duckduckgo: await duckduckgo(q, n) });
  } catch (err: any) {
    res.json({
      query: q,
      count: n,
      duckduckgo: [],
      errors: { duckduckgo: String(err?.message ?? err) },
    });
  }
});

app.listen(PORT, () =>
  console.log(`linus-web-search: http://127.0.0.1:${PORT}/search?q=cats&n=5`),
);
