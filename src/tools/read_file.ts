import { readFileSync } from "node:fs";

export const schema = {
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
};

export const handler = ({ path }: { path: string }) => readFileSync(path, "utf8");
