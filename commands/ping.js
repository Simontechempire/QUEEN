export default {
  name: "ping",
  aliases: ["p"],
  category: "system",
  description: "Check bot response",

  async execute(sock, msg) {
    await sock.sendMessage(
      msg.key.remoteJid,
      {
        text: "𝗣𝗼𝗻𝗴! ⚡"
      },
      {
        quoted: msg
      }
    );
  }
};
