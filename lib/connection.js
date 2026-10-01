import makeWASocket, {
  DisconnectReason,
  useMultiFileAuthState
} from "@whiskeysockets/baileys";

import pino from "pino";
import path from "path";
import fs from "fs";

import { handleMessage } from "../handlers/messages.js";

const AUTH_DIR = path.join(process.cwd(), "sessions");

if (!fs.existsSync(AUTH_DIR)) {
  fs.mkdirSync(AUTH_DIR, {
    recursive: true
  });
}

let sock = null;
let connectionState = "closed";
let pairingInProgress = false;
let pairingReady = false;
let reconnectTimer = null;
let startPromise = null;

export function getConnectionStatus() {
  return {
    connected: connectionState === "open",
    state: connectionState,
    pairingReady
  };
}

export async function startWhatsApp() {
  if (startPromise) {
    return startPromise;
  }

  startPromise = (async () => {
    const { state, saveCreds } =
      await useMultiFileAuthState(AUTH_DIR);

    sock = makeWASocket({
      auth: state,

      logger: pino({
        level: "silent"
      }),

      /*
       * Do NOT use a custom browser label here.
       * The default/canonical browser information
       * is safer for phone-number pairing.
       */

      printQRInTerminal: false,

      markOnlineOnConnect: false,

      generateHighQualityLinkPreview: false,

      connectTimeoutMs: 60000,

      defaultQueryTimeoutMs: 60000
    });

    sock.ev.on(
      "creds.update",
      saveCreds
    );

    sock.ev.on(
      "messages.upsert",
      async ({ messages }) => {
        for (const msg of messages) {
          try {
            await handleMessage(sock, msg);
          } catch (error) {
            console.error(
              "Message handler error:",
              error
            );
          }
        }
      }
    );

    sock.ev.on(
      "connection.update",
      async (update) => {
        const {
          connection,
          lastDisconnect,
          qr
        } = update;

        /*
         * Baileys has reached the stage where
         * pairing code can safely be requested.
         */
        if (qr) {
          pairingReady = true;

          console.log(
            "🔐 WhatsApp pairing is ready."
          );
        }

        if (connection) {
          connectionState = connection;

          console.log(
            `WhatsApp connection: ${connection}`
          );
        }

        if (connection === "open") {
          pairingReady = false;

          console.log(
            "✅ WhatsApp connected successfully."
          );
        }

        if (connection === "close") {
          pairingReady = false;
          sock = null;

          const statusCode =
            lastDisconnect?.error?.output
              ?.statusCode;

          const shouldReconnect =
            statusCode !==
            DisconnectReason.loggedOut;

          console.log(
            `WhatsApp disconnected. ` +
            `Status: ${statusCode ?? "unknown"} ` +
            `Reconnect: ${shouldReconnect}`
          );

          if (shouldReconnect) {
            if (reconnectTimer) {
              clearTimeout(reconnectTimer);
            }

            reconnectTimer = setTimeout(
              () => {
                startPromise = null;

                startWhatsApp().catch(
                  console.error
                );
              },
              5000
            );
          }
        }
      }
    );

    return sock;
  })();

  try {
    return await startPromise;
  } catch (error) {
    startPromise = null;
    throw error;
  }
}

export async function requestPairingCode(number) {
  if (pairingInProgress) {
    throw new Error(
      "A pairing request is already in progress."
    );
  }

  const phoneNumber = String(number)
    .replace(/\D/g, "");

  if (!phoneNumber) {
    throw new Error(
      "WhatsApp phone number is required."
    );
  }

  if (
    phoneNumber.length < 10 ||
    phoneNumber.length > 15
  ) {
    throw new Error(
      "Invalid phone number. Use country code without +."
    );
  }

  pairingInProgress = true;

  try {
    if (!sock) {
      await startWhatsApp();
    }

    /*
     * If the socket has already emitted the QR
     * readiness event, we can request immediately.
     */
    if (!pairingReady) {
      console.log(
        "⏳ Waiting for WhatsApp pairing readiness..."
      );

      await new Promise(
        (resolve, reject) => {
          const timeout =
            setTimeout(() => {
              cleanup();

              reject(
                new Error(
                  "WhatsApp pairing did not become ready within 30 seconds."
                )
              );
            }, 30000);

          const cleanup = () => {
            clearTimeout(timeout);

            sock?.ev.off(
              "connection.update",
              listener
            );
          };

          const listener = (update) => {
            if (update.qr) {
              pairingReady = true;

              cleanup();
              resolve();
            }

            if (
              update.connection ===
              "close"
            ) {
              cleanup();

              reject(
                new Error(
                  "WhatsApp connection closed before pairing was ready."
                )
              );
            }
          };

          sock?.ev.on(
            "connection.update",
            listener
          );
        }
      );
    }

    if (!sock) {
      throw new Error(
        "WhatsApp socket is unavailable."
      );
    }

    if (sock.authState?.creds?.registered) {
      throw new Error(
        "This session is already registered."
      );
    }

    console.log(
      `🔐 Requesting pairing code for ${phoneNumber}`
    );

    const code =
      await sock.requestPairingCode(
        phoneNumber
      );

    console.log(
      `✅ Pairing code generated: ${code}`
    );

    return code;

  } catch (error) {
    console.error(
      "❌ Pairing code error:",
      error
    );

    throw error;

  } finally {
    pairingInProgress = false;
  }
}
