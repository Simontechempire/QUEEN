import makeWASocket, {
  DisconnectReason,
  useMultiFileAuthState
} from "@whiskeysockets/baileys";
import pino from "pino";
import path from "path";
import fs from "fs";
import { handleMessage } from "../handlers/messages.js";

const AUTH_DIR = path.join(process.cwd(), "sessions");

// --- RENDER FIX: Restore session from ENV ---
if (process.env.SESSION_ID) {
  try {
    if (!fs.existsSync(AUTH_DIR)) {
      fs.mkdirSync(AUTH_DIR, { recursive: true });
    }
    // SESSION_ID can be base64 of creds.json OR full JSON string
    let sessionData = process.env.SESSION_ID;
    let credsJson;
    
    try {
      // Try base64 decode
      credsJson = Buffer.from(sessionData, 'base64').toString('utf-8');
      JSON.parse(credsJson); // validate
    } catch {
      // If not base64, assume it's raw JSON
      credsJson = sessionData;
    }
    
    fs.writeFileSync(path.join(AUTH_DIR, "creds.json"), credsJson);
    console.log("✅ Session restored from SESSION_ID env");
  } catch (e) {
    console.error("❌ Failed to restore session:", e.message);
  }
}

if (!fs.existsSync(AUTH_DIR)) {
  fs.mkdirSync(AUTH_DIR, { recursive: true });
}

let sock = null;
let connectionState = "closed";
let pairingInProgress = false;
let pairingReady = false;
let reconnectTimer = null;
let startPromise = null;

export function getConnectionStatus() {
  return { connected: connectionState === "open", state: connectionState, pairingReady };
}

export async function startWhatsApp() {
  if (startPromise) return startPromise;

  startPromise = (async () => {
    const { state, saveCreds } = await useMultiFileAuthState(AUTH_DIR);

    sock = makeWASocket({
      auth: state,
      logger: pino({ level: "silent" }),
      printQRInTerminal: false,
      markOnlineOnConnect: true,
      generateHighQualityLinkPreview: true,
      connectTimeoutMs: 60000,
      defaultQueryTimeoutMs: 60000,
      // Fix for Render pairing
      browser: ["WOLF BOT", "Chrome", "1.0.0"],
    });

    sock.ev.on("creds.update", saveCreds);

    sock.ev.on("messages.upsert", async ({ messages }) => {
      for (const msg of messages) {
        try { await handleMessage(sock, msg); } catch (error) { console.error("Message handler error:", error); }
      }
    });

    sock.ev.on("connection.update", async (update) => {
      const { connection, lastDisconnect, qr } = update;
      if (qr) {
        pairingReady = true;
        console.log("🔐 Pairing ready - you can now request code");
      }
      if (connection) {
        connectionState = connection;
        console.log(`WhatsApp connection: ${connection}`);
      }
      if (connection === "open") {
        pairingReady = false;
        console.log("✅ WhatsApp connected successfully.");
        // IMPORTANT: Log session for Render
        try {
          const credsPath = path.join(AUTH_DIR, "creds.json");
          if (fs.existsSync(credsPath)) {
            const creds = fs.readFileSync(credsPath);
            const base64 = Buffer.from(creds).toString('base64');
            console.log("\n--- SAVE THIS SESSION_ID TO RENDER ENV ---\n");
            console.log(base64.slice(0, 200) + "... [FULL CODE IN LOGS]");
            console.log("\n--- END SESSION ---\n");
          }
        } catch {}
      }
      if (connection === "close") {
        pairingReady = false;
        sock = null;
        const statusCode = lastDisconnect?.error?.output?.statusCode;
        const shouldReconnect = statusCode !== DisconnectReason.loggedOut;
        console.log(`Disconnected. Status: ${statusCode} Reconnect: ${shouldReconnect}`);
        if (shouldReconnect) {
          if (reconnectTimer) clearTimeout(reconnectTimer);
          reconnectTimer = setTimeout(() => {
            startPromise = null;
            startWhatsApp().catch(console.error);
          }, 5000);
        } else {
          // Logged out - delete session folder so fresh pairing can happen
          console.log("Logged out - deleting session");
          fs.rmSync(AUTH_DIR, { recursive: true, force: true });
          fs.mkdirSync(AUTH_DIR, { recursive: true });
        }
      }
    });
    return sock;
  })();

  try { return await startPromise; } catch (error) { startPromise = null; throw error; }
}

export async function requestPairingCode(number) {
  if (pairingInProgress) throw new Error("A pairing request is already in progress.");
  const phoneNumber = String(number).replace(/\D/g, "");
  if (!phoneNumber) throw new Error("Phone number required");
  if (phoneNumber.length < 10 || phoneNumber.length > 15) throw new Error("Invalid phone number. Use 234... without +");

  pairingInProgress = true;
  try {
    if (!sock) await startWhatsApp();

    if (!pairingReady) {
      console.log("⏳ Waiting for pairing readiness...");
      await new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
          cleanup();
          reject(new Error("Pairing not ready in 60s - restart bot"));
        }, 60000);
        const cleanup = () => { clearTimeout(timeout); sock?.ev.off("connection.update", listener); };
        const listener = (update) => {
          if (update.qr) { pairingReady = true; cleanup(); resolve(); }
          if (update.connection === "close") { cleanup(); reject(new Error("Connection closed before ready")); }
        };
        sock?.ev.on("connection.update", listener);
      });
    }

    if (!sock) throw new Error("Socket unavailable");
    if (sock.authState?.creds?.registered) {
      throw new Error("Already registered - delete sessions folder");
    }

    console.log(`🔐 Requesting code for ${phoneNumber}`);
    const code = await sock.requestPairingCode(phoneNumber);
    console.log(`✅ CODE: ${code} - Type it FAST without dash: ${code.replace(/-/g,'')}`);
    return code;
  } catch (error) {
    console.error("❌ Pairing error:", error);
    throw error;
  } finally { pairingInProgress = false; }
}
