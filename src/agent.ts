#!/usr/bin/env node
import { createInterface } from "node:readline/promises";
import { readFileSync } from "node:fs";
import { resolve, relative, isAbsolute } from "node:path";
import { tools, handlers } from "./tools/index.ts";

const OLLAMA = process.env.OLLAMA_HOST ?? "http://127.0.0.1:11434";
const MODEL = process.env.AGENT_MODEL ?? "granite4:tiny-h";

const allowList: { paths: string[]; commands: string[] } = JSON.parse(
  readFileSync(new URL("../allowList.json", import.meta.url), "utf8"),
);

const prompt = (name: string) =>
  readFileSync(new URL(`../prompts/${name}.md`, import.meta.url), "utf8").trim();

const SYSTEM = prompt("system");

const DENIED = prompt("denied")
  .replace("{paths}", allowList.paths.join(", "))
  .replace("{commands}", allowList.commands.join(", "));

type ToolCall = { function: { name: string; arguments: Record<string, any> } };

type Msg = {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  tool_calls?: ToolCall[];
  tool_name?: string;
};

function pathAllowed(p: string): boolean {
  const target = resolve(p);
  return allowList.paths.some((root) => {
    const rel = relative(resolve(root), target);
    return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
  });
}

// Anything that lets one command become two is refused outright.
const SHELL_METACHARACTERS = /[;&|<>`$(){}\n]/;

function commandAllowed(command: string): boolean {
  if (SHELL_METACHARACTERS.test(command)) return false;
  const [bin] = command.trim().split(/\s+/);
  return allowList.commands.includes(bin);
}

function allowed(name: string, args: any): boolean {
  if (name === "bash") return commandAllowed(args.command ?? "");
  if (name === "read_file" || name === "write_file") {
    return pathAllowed(args.path ?? "");
  }
  return true;
}

// The whole context strategy: one array, append forever, never trim.
const messages: Msg[] = [{ role: "system", content: SYSTEM }];

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
      if (!allowed(fn.name, fn.arguments)) {
        console.log(`  !! denied by allowList`);
        result = DENIED;
      } else {
        try {
          result =
            (await handlers[fn.name]?.(fn.arguments)) ??
            `unknown tool: ${fn.name}`;
        } catch (err: any) {
          result = `error: ${err.message}`;
        }
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
