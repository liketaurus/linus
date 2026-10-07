import { execSync } from "node:child_process";

export const schema = {
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
};

export const handler = ({ command }: { command: string }) =>
  execSync(command, { encoding: "utf8", timeout: 30_000, stdio: "pipe" });
