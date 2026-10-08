import { ask, prompt } from "./llm.ts";

// The dumbest thing that works: show the model ten tools at a time and ask
// which ones matter. Every batch is another round trip.
const BATCH = 10;

// How many survive to be offered to the agent loop.
const TOP_K = 5;

type Tool = { function: { name: string; description: string } };

export async function select<T extends Tool>(
  question: string,
  tools: T[],
): Promise<T[]> {
  const chosen = new Set<string>();

  for (let i = 0; i < tools.length; i += BATCH) {
    const batch = tools.slice(i, i + BATCH);
    const listed = batch
      .map((t) => `${t.function.name}: ${t.function.description}`)
      .join("\n");

    const reply = await ask(
      [
        {
          role: "user",
          content: prompt("select_tools")
            .replace("{tools}", listed)
            .replace("{question}", question),
        },
      ],
      { format: "json" },
    );

    try {
      for (const name of JSON.parse(reply.content).tools ?? []) {
        if (batch.some((t) => t.function.name === name)) chosen.add(name);
      }
    } catch {}
  }

  const picked = tools.filter((t) => chosen.has(t.function.name)).slice(0, TOP_K);

  // Picking nothing would leave the agent with no way to act at all.
  if (picked.length === 0) {
    console.log(`  ~~ nothing matched, falling back to all ${tools.length}`);
    return tools;
  }

  console.log(
    `  ~~ ${picked.length}/${tools.length}: ` +
      picked.map((t) => t.function.name).join(", "),
  );
  return picked;
}
