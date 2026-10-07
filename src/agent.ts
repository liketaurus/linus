#!/usr/bin/env node
import { createInterface } from "node:readline/promises";
import { readFileSync, writeFileSync } from "node:fs";
import { execSync } from "node:child_process";

const OLLAMA = process.env.OLLAMA_HOST ?? "http://127.0.0.1:11434";
const MODEL = process.env.AGENT_MODEL ?? "granite4:tiny-h";

type ToolCall = { function: { name: string; arguments: Record<string, any> } };

type Msg = {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  tool_calls?: ToolCall[];
  tool_name?: string;
};

const tools = [
  {
    type: "function",
    function: {
      name: "read_file",
      description: "Read a file from disk and return its contents.",
      parameters: {
        type: "object",
        properties: { path: { type: "string" } },
        required: ["path"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "write_file",
      description: "Write content to a file, overwriting it.",
      parameters: {
        type: "object",
        properties: { path: { type: "string" }, content: { type: "string" } },
        required: ["path", "content"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "bash",
      description: "Run a shell command and return its output.",
      parameters: {
        type: "object",
        properties: { command: { type: "string" } },
        required: ["command"],
      },
    },
  },
];

const handlers: Record<string, (args: any) => string> = {
  read_file: ({ path }) => readFileSync(path, "utf8"),
  write_file: ({ path, content }) => {
    writeFileSync(path, content);
    return `wrote ${content.length} bytes to ${path}`;
  },
  bash: ({ command }) =>
    execSync(command, { encoding: "utf8", timeout: 30_000, stdio: "pipe" }),
};

// The whole context strategy: one array, append forever, never trim.
const messages: Msg[] = [
  {
    role: "system",
    content:
      "You are a coding agent. Use the tools to inspect and modify files. Be brief.",
  },
];

async function call(): Promise<Msg> {
  const res = await fetch(`${OLLAMA}/api/chat`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      model: MODEL,
      messages,
      tools,
      stream: false,
      options: { num_ctx: 8192, temperature: 0.2 },
    }),
  });
  const body = await res.json();
  if (body.error) throw new Error(body.error);
  return body.message;
}

async function turn(input: string): Promise<void> {
  messages.push({ role: "user", content: input });

  while (true) {
    const reply = await call();
    messages.push(reply);

    const calls = reply.tool_calls ?? [];
    if (calls.length === 0) {
      console.log(reply.content.trim() || "(no output)");
      return;
    }

    for (const { function: fn } of calls) {
      console.log(`  -> ${fn.name}(${JSON.stringify(fn.arguments)})`);
      let result: string;
      try {
        result = handlers[fn.name]?.(fn.arguments) ?? `unknown tool: ${fn.name}`;
      } catch (err: any) {
        result = `error: ${err.message}`;
      }
      messages.push({ role: "tool", tool_name: fn.name, content: String(result) });
    }
  }
}

const rl = createInterface({ input: process.stdin, output: process.stdout });
console.log(`linus | ${MODEL}`);
console.log(`type /exit to quit`);

process.stdout.write("\n> ");

for await (const raw of rl) {
  const line = raw.trim();
  if (line === "/exit") break;
  if (line) {
    try {
      await turn(line);
    } catch (err: any) {
      console.error(`error: ${err.message}`);
    }
  }
  process.stdout.write("\n> ");
}
rl.close();
