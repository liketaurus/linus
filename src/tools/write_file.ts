import { writeFileSync } from "node:fs";

export const schema = {
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
};

export const handler = ({ path, content }: { path: string; content: string }) => {
  writeFileSync(path, content);
  return `wrote ${content.length} bytes to ${path}`;
};
