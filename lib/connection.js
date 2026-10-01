import makeWASocket, {
  DisconnectReason,
  useMultiFileAuthState
} from "@whiskeysockets/baileys";

import pino from "pino";
import path from "path";
import fs from "fs";

import { Boom } from "@hapi/boom";

const AUTH_DIR = path.join(process.cwd(), "sessions");

if (!fs.existsSync(AUTH_DIR)) {
  fs.mkdirSync(AUTH_DIR, { recursive: true });
}

let sock = null;
let pairingInProgress = false;
let connectionState = "closed";

export function getConnectionStatus() {
  return {
    connected: connectionState === "open",
    state: connectionState
  };
}

export async function startWhatsApp() {
  const { state, saveCreds } =
    await useMultiFileAuthState(AUTH_DIR);

  sock = makeWASocket({
    auth: state,
    logger: pino({
      level: "silent"
    }),
    browser: [
      "Simon Tech Bot",
      "Chrome",
      "1.0.0"
    ],
    printQRInTerminal: false,
    markOnlineOnConnect: false,
    generateHighQualityLinkPreview: false
  });

  sock.ev.on("creds.update", saveCreds);

  sock.ev.on("connection.update", async (update) => {
    const {
      connection,
      lastDisconnect
    } = update;

    if (connection) {
      connectionState = connection;
      console.log(`WhatsApp connection: ${connection}`);
    }

    if (connection === "open") {
      console.log("✅ WhatsApp connected successfully.");
    }

    if (connection === "close") {
      const statusCode =
        new Boom(lastDisconnect?.error)?.output?.statusCode;

      const shouldReconnect =
        statusCode !== DisconnectReason.loggedOut;

      console.log(
        `WhatsApp disconnected. Reconnect: ${shouldReconnect}`
      );

      sock = null;

      if (shouldReconnect) {
        setTimeout(() => {
          startWhatsApp().catch(console.error);
        }, 5000);
      }
    }
  });

  return sock;
}

export async function requestPairingCode(number) {
  if (pairingInProgress) {
    throw new Error(
      "A pairing request is already in progress."
    );
  }

  pairingInProgress = true;

  try {
    if (!sock) {
      await startWhatsApp();
    }

    let attempts = 0;

    while (
      sock?.ws?.readyState !== 1 &&
      attempts < 20
    ) {
      await new Promise(resolve =>
        setTimeout(resolve, 500)
      );

      attempts++;
    }

    const code =
      await sock.requestPairingCode(number);

    return code;

  } finally {
    pairingInProgress = false;
  }
  }
