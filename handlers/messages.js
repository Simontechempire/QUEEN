import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const commands = new Map();

async function loadCommands() {
  const commandsDir = path.join(
    __dirname,
    "..",
    "commands"
  );

  const files = fs
    .readdirSync(commandsDir)
    .filter(file => file.endsWith(".js"));

  for (const file of files) {
    const command = await import(
      `../commands/${file}`
    );

    if (command.default) {
      const data = command.default;

      commands.set(data.name, data);

      if (Array.isArray(data.aliases)) {
        for (const alias of data.aliases) {
          commands.set(alias, data);
        }
      }
    }
  }
}

await loadCommands();

export async function handleMessage(sock, msg) {
  try {
    if (!msg.message) return;

    if (msg.key.fromMe) return;

    const text =
      msg.message.conversation ||
      msg.message.extendedTextMessage?.text ||
      "";

    const prefix =
      process.env.PREFIX || ".";

    if (!text.startsWith(prefix)) return;

    const input = text.slice(prefix.length).trim();

    if (!input) return;

    const parts = input.split(/\s+/);

    const commandName =
      parts.shift().toLowerCase();

    const args = parts;

    const command =
      commands.get(commandName);

    if (!command) return;

    const sender =
      msg.key.participant ||
      msg.key.remoteJid;

    const context = {
      sender,
      prefix,
      command: commandName
    };

    await command.execute(
      sock,
      msg,
      args,
      context
    );

  } catch (error) {
    console.error(
      "Message handler error:",
      error
    );
  }
    }
