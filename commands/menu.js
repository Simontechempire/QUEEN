export default {
  name: "menu",
  aliases: ["help", "cmd", "commands"],
  category: "system",
  description: "Show available commands",

  async execute(sock, msg) {
    const menuText = `
╭──────────────────────────────╮
│      SIMON TECH BOT          │
╰──────────────────────────────╯

├⊷ .ping
├⊷ .menu
├⊷ .help

╰━━━━━━━━━━━━━━━━━━━━━━━╯
`;

    await sock.sendMessage(
      msg.key.remoteJid,
      {
        text: menuText
      },
      {
        quoted: msg
      }
    );
  }
};
