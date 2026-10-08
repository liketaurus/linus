import { createServer } from "node:http";
import { createInterface } from "node:readline/promises";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { Api, TelegramClient } from "telegram";
import { StringSession } from "telegram/sessions/index.js";

const ENV_FILE = new URL(".env", import.meta.url).pathname;
const SESSION_FILE = new URL("session.txt", import.meta.url).pathname;
const PORT = Number(process.env.TG_PORT ?? 8787);

try {
  process.loadEnvFile(ENV_FILE);
} catch {}

const rl = createInterface({ input: process.stdin, output: process.stdout });

// api_id and api_hash come from my.telegram.org. Asked once, then kept in .env.
let apiId = process.env.TG_API_ID;
let apiHash = process.env.TG_API_HASH;

if (!apiId || !apiHash) {
  console.log("first run: get api_id and api_hash from https://my.telegram.org\n");
  apiId = await rl.question("api_id: ");
  apiHash = await rl.question("api_hash: ");
  writeFileSync(ENV_FILE, `TG_API_ID=${apiId}\nTG_API_HASH=${apiHash}\n`);
}

// The session is what lets us skip the phone dance next time.
const saved = existsSync(SESSION_FILE)
  ? readFileSync(SESSION_FILE, "utf8").trim()
  : "";

const client = new TelegramClient(
  new StringSession(saved),
  Number(apiId),
  apiHash,
  { connectionRetries: 5 },
);
client.setLogLevel((process.env.TG_LOG ?? "error") as any);

const log = (...parts: unknown[]) => console.log("  [auth]", ...parts);

function explain(err: any) {
  const name = err?.errorMessage ?? err?.className ?? err?.constructor?.name;
  log(`FAILED ${name ?? "unknown"}: ${err?.message ?? err}`);
  if (err?.seconds) log(`telegram wants you to wait ${err.seconds}s before retrying`);
  if (process.env.TG_LOG) console.error(err);
  return String(name ?? "");
}

log(`connecting (session ${saved ? "found" : "absent"})`);
await client.connect();
log(`connected, authorized=${await client.isUserAuthorized()}`);

if (!(await client.isUserAuthorized())) {
  const phone = (await rl.question("phone (+country code): ")).trim();
  log(`requesting a code for ${phone} (${phone.length} chars)`);

  let sent;
  try {
    sent = await client.sendCode({ apiId: Number(apiId), apiHash }, phone);
  } catch (err) {
    explain(err);
    process.exit(1);
  }

  log(`telegram accepted the request at ${new Date().toISOString()}`);
  log(`delivered via ${sent.isCodeViaApp ? "the TELEGRAM APP, not SMS" : "SMS"}`);
  if (sent.isCodeViaApp) {
    log(`look for a chat named "Telegram" in your app on any logged-in device`);
  }

  // A late or mistyped code should not cost a restart, which costs another code.
  while (!(await client.isUserAuthorized())) {
    const code = (await rl.question("code (blank to resend): ")).trim();

    if (!code) {
      const again = await client.invoke(
        new Api.auth.ResendCode({ phoneNumber: phone, phoneCodeHash: sent.phoneCodeHash }),
      );
      log(`resent, type is now ${(again as any).type?.className ?? "unknown"}`);
      continue;
    }

    try {
      await client.invoke(
        new Api.auth.SignIn({
          phoneNumber: phone,
          phoneCodeHash: sent.phoneCodeHash,
          phoneCode: code,
        }),
      );
    } catch (err: any) {
      const name = explain(err);
      if (name === "SESSION_PASSWORD_NEEDED") {
        await client.signInWithPassword(
          { apiId: Number(apiId), apiHash },
          {
            password: () => rl.question("2FA password: "),
            onError: async (e) => (explain(e), false),
          },
        );
      }
    }
  }
}

writeFileSync(SESSION_FILE, String(client.session.save()));
log(`session saved to ${SESSION_FILE}`);
rl.close();

const me = await client.getMe();
console.log(`logged in as ${(me as any).username ?? (me as any).firstName}`);

async function chats() {
  const dialogs = await client.getDialogs({ limit: 50 });
  return dialogs.map((d) => ({
    id: String(d.id),
    title: d.title ?? "(no title)",
    type: d.isUser ? "user" : d.isChannel ? "channel" : "group",
    unread: d.unreadCount,
  }));
}

async function resolve(chat: string) {
  const dialogs = await client.getDialogs({ limit: 50 });
  const wanted = chat.trim().toLowerCase();
  return (
    dialogs.find((d) => String(d.id) === chat.trim()) ??
    dialogs.find((d) => (d.title ?? "").toLowerCase() === wanted) ??
    dialogs.find((d) => (d.title ?? "").toLowerCase().includes(wanted))
  );
}

async function messages(chat: string, offset: number, limit: number) {
  const dialog = await resolve(chat);
  if (!dialog) return { error: `no chat matching "${chat}"` };

  const found = await client.getMessages(dialog.entity, {
    limit,
    addOffset: offset,
  });

  return {
    chat: dialog.title,
    messages: found.map((m) => ({
      id: m.id,
      date: new Date(m.date * 1000).toISOString(),
      from:
        (m.sender as any)?.username ??
        (m.sender as any)?.firstName ??
        (m.sender as any)?.title ??
        String(m.senderId ?? "unknown"),
      text: m.message ?? "",
    })),
  };
}

createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", `http://localhost:${PORT}`);
  res.setHeader("content-type", "application/json");

  try {
    if (url.pathname === "/chats") {
      res.end(JSON.stringify(await chats()));
      return;
    }

    if (url.pathname === "/messages") {
      const chat = url.searchParams.get("chat");
      if (!chat) {
        res.statusCode = 400;
        res.end(JSON.stringify({ error: "chat is required" }));
        return;
      }
      const offset = Number(url.searchParams.get("offset") ?? 0);
      const limit = Math.min(Number(url.searchParams.get("limit") ?? 20), 100);
      res.end(JSON.stringify(await messages(chat, offset, limit)));
      return;
    }

    res.statusCode = 404;
    res.end(JSON.stringify({ error: "try /chats or /messages?chat=&offset=&limit=" }));
  } catch (err: any) {
    res.statusCode = 500;
    res.end(JSON.stringify({ error: err.message }));
  }
}).listen(PORT, () => console.log(`telegram server: http://127.0.0.1:${PORT}`));
