import * as read_file from "./read_file.ts";
import * as write_file from "./write_file.ts";
import * as bash from "./bash.ts";
import * as weather from "./weather.ts";
import * as telegram from "./telegram.ts";

const all = [read_file, write_file, bash, weather, telegram];

export const tools = all.map((t) => t.schema);

export const handlers: Record<
  string,
  (args: any) => string | Promise<string>
> = Object.fromEntries(all.map((t) => [t.schema.function.name, t.handler]));
