# Linus

Linus is a small terminal-based coding agent powered by a local [Ollama](https://ollama.com/) model. It keeps the conversation in memory, lets the model choose relevant tools for each request, and restricts file and shell access through an allow list.

## Features

- Interactive CLI conversation with a locally running Ollama model.
- Tool selection before each model turn to keep the tool prompt small.
- Read and overwrite files within approved directories.
- Run only explicitly approved shell commands, without shell metacharacters.
- Current weather lookup through Open-Meteo.
- Web search through the included `linus-web-search` local service.

The tool catalog also contains placeholder integrations such as email, GitHub, Jira, and deployment actions. They are intentionally no-ops and return that they are not implemented.

## Requirements

- Node.js 22.6 or later, with TypeScript type stripping support.
- Ollama running locally, with a compatible model installed. The default is `granite4:tiny-h`.
- npm, to install the web-search service dependency.

## Quick start

1. Start Ollama and download the default model:

   ```powershell
   ollama pull granite4:tiny-h
   ```

2. Install and start the search service in a separate terminal:

   ```powershell
   cd external\linus-web-search
   npm install
   npm start
   ```

   The service listens on `http://127.0.0.1:8787` by default.

3. Start Linus from `playground`, so its default file access is limited to that directory:

   ```powershell
   cd playground
   node ..\src\agent.ts
   ```

4. Enter a request at the `>` prompt. Type `/exit` to quit.

## Configuration

| Variable | Default | Description |
| --- | --- | --- |
| `OLLAMA_HOST` | `http://127.0.0.1:11434` | Ollama server URL. |
| `AGENT_MODEL` | `granite4:tiny-h` | Ollama model used by Linus. |
| `SEARCH_SERVICE` | `http://127.0.0.1:8787` | URL of the local search service. |
| `PORT` | `8787` | Port used by `linus-web-search`. |

For example:

```powershell
$env:AGENT_MODEL = "qwen2.5-coder:7b"
node ..\src\agent.ts
```

## Access control

`allowList.json` defines the paths and commands that Linus may use. By default it permits file reads and writes only under the current directory (`.`), and the following commands:

```text
ls cat nl wc head tail echo pwd grep find
```

Shell commands containing chaining, redirects, substitutions, or other shell metacharacters are rejected. Update `allowList.json` deliberately before expanding access.

## Project structure

```text
src/
  agent.ts             Interactive agent loop and access checks
  llm.ts               Ollama client and prompt loader
  select.ts            Tool-selection model call
  tools/               File, shell, weather, and web-search tools
prompts/               System and tool-selection prompts
external/
  linus-web-search/    Local DuckDuckGo-backed search HTTP service
playground/            Safe default working directory for the agent
allowList.json         Permitted paths and shell commands
```

## Web search service

`linus-web-search` exposes:

```text
GET /search?q=<query>&n=<count>
```

It requests DuckDuckGo's HTML endpoint and returns up to 25 normalized results. The agent uses the service to formulate search queries and summarize the returned sources. If the service is not running, only requests that need web search fail; the rest of the agent remains usable.
