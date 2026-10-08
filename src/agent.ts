#!/usr/bin/env node
import { createInterface } from "node:readline/promises";
import { readFileSync } from "node:fs";
import { resolve, relative, isAbsolute } from "node:path";
import { ask, prompt, MODEL } from "./llm.ts";
import type { Msg } from "./llm.ts";
import { tools, handlers } from "./tools/index.ts";
import { select } from "./select.ts";

const allowList: { paths: string[]; commands: string[] } = JSON.parse(
  readFileSync(new URL("../allowList.json", import.meta.url), "utf8"),
);

const SYSTEM = prompt("system");

const DENIED = prompt("denied")
  .replace("{paths}", allowList.paths.join(", "))
  .replace("{commands}", allowList.commands.join(", "));

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

async function turn(input: string): Promise<void> {
  messages.push({ role: "user", content: input });

  // Fifty-five tools will not fit in a prompt worth sending. Shrink first.
  const picked = await select(input, tools);

  while (true) {
    const reply = await ask(messages, { tools: picked });
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
