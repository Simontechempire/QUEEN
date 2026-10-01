import "dotenv/config";
import express from "express";
import path from "path";
import { fileURLToPath } from "url";

import {
  startWhatsApp,
  requestPairingCode,
  getConnectionStatus
} from "./lib/connection.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();

const PORT = process.env.PORT || 3000;
const HOST = process.env.HOST || "0.0.0.0";

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use(express.static(path.join(__dirname, "public")));

app.get("/api/status", (req, res) => {
  res.json(getConnectionStatus());
});

app.post("/api/pair", async (req, res) => {
  try {
    const number = String(req.body.number || "")
      .replace(/\D/g, "");

    if (!number) {
      return res.status(400).json({
        success: false,
        error: "WhatsApp number is required"
      });
    }

    if (number.length < 10) {
      return res.status(400).json({
        success: false,
        error: "Enter a valid WhatsApp number with country code"
      });
    }

    const code = await requestPairingCode(number);

    res.json({
      success: true,
      code
    });

  } catch (error) {
    console.error("Pairing error:", error);

    res.status(500).json({
      success: false,
      error: error.message || "Unable to generate pairing code"
    });
  }
});

app.get("*", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

app.listen(PORT, HOST, async () => {
  console.log(`
╭──────────────────────────────╮
│      SIMON TECH BOT          │
│                              │
│      Server: ONLINE          │
│      Port: ${PORT}              │
╰──────────────────────────────╯
`);

  try {
    await startWhatsApp();
  } catch (error) {
    console.error("WhatsApp startup error:", error);
  }
});
