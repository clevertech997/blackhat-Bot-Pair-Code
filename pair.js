// blackhatBotRouter.js
import express from 'express';
import fs from 'fs';
import pino from 'pino';
import { 
    makeWASocket, 
    useMultiFileAuthState, 
    makeCacheableSignalKeyStore, 
    Browsers, 
    jidNormalizedUser, 
    fetchLatestBaileysVersion, 
    delay 
} from '@whiskeysockets/baileys';
import pn from 'awesome-phonenumber';

const router = express.Router();
const BOT_NAME = "BLACKHAT BOT";

// Remove existing folder/session
function removeFile(filePath) {
    try {
        if (!fs.existsSync(filePath)) return false;
        fs.rmSync(filePath, { recursive: true, force: true });
        return true;
    } catch (e) {
        console.error('❌ Error removing file:', e);
        return false;
    }
}

// Main route for generating pair code / QR
router.get('/', async (req, res) => {
    let num = req.query.number;
    if (!num) return res.status(400).send({ code: "Phone number is required" });

    const sessionDir = './sessions/' + num.replace(/[^0-9]/g, '');

    // Remove previous session if exists
    removeFile(sessionDir);

    // Validate phone number
    const phone = pn(num.startsWith('+') ? num : '+' + num);
    if (!phone.isValid()) {
        return res.status(400).send({ code: "Invalid phone number. Include full international code." });
    }

    // Format number properly for WhatsApp
    const waNumber = phone.getNumber('e164').replace('+', '');

    async function startSession() {
        const { state, saveCreds } = await useMultiFileAuthState(sessionDir);

        try {
            const { version } = await fetchLatestBaileysVersion();

            const sock = makeWASocket({
                version,
                auth: {
                    creds: state.creds,
                    keys: makeCacheableSignalKeyStore(state.keys, pino({ level: "fatal" }))
                },
                printQRInTerminal: false,
                logger: pino({ level: "fatal" }),
                browser: Browsers.windows("Chrome"),
                markOnlineOnConnect: false,
                generateHighQualityLinkPreview: false,
                defaultQueryTimeoutMs: 60000,
                connectTimeoutMs: 60000,
                keepAliveIntervalMs: 30000
            });

            sock.ev.on('connection.update', async (update) => {
                const { connection, lastDisconnect, isNewLogin } = update;

                if (connection === 'open') {
                    console.log(`✅ ${BOT_NAME} Connected successfully`);

                    try {
                        const credsFile = fs.readFileSync(`${sessionDir}/creds.json`);
                        const userJid = jidNormalizedUser(waNumber + '@s.whatsapp.net');

                        // Send creds.json to user
                        await sock.sendMessage(userJid, {
                            document: credsFile,
                            mimetype: 'application/json',
                            fileName: 'creds.json'
                        });
                        console.log("📄 Session file sent successfully");

                        // Send styled warning message
                        await sock.sendMessage(userJid, {
                            text: `
╔══════════════════════════════╗
       🖤✨ *${BOT_NAME}* ✨🖤
╚══════════════════════════════╝

✅ *SESSION GENERATED SUCCESSFULLY* 🎉

⚠️ *SECURITY WARNING* ⚠️
🔒 Do NOT share this file with anyone!
🚫 Anyone with this file can access your WhatsApp.

┏━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┓
┃ 🛡️ Powered by anonymous user
┃ ⚡ Secure • Fast • Stable
┃ © 2026 ${BOT_NAME}
┗━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┛

🚀 Enjoy using * ${BOT_NAME}
`
                        });
                        console.log("⚠️ Warning message sent successfully");

                        // Cleanup session after use
                        console.log("🧹 Cleaning up session...");
                        await delay(2000);
                        removeFile(sessionDir);
                        console.log("✅ Session cleaned up successfully");

                    } catch (err) {
                        console.error("❌ Error sending session/messages:", err);
                        removeFile(sessionDir);
                    }
                }

                if (isNewLogin) console.log("🔐 New login via pair code");

                if (connection === 'close') {
                    const statusCode = lastDisconnect?.error?.output?.statusCode;
                    if (statusCode === 401) {
                        console.log("❌ Logged out. Generate a new pair code.");
                    } else {
                        console.log("🔁 Connection closed, retrying...");
                        await delay(2000);
                        startSession();
                    }
                }
            });

            sock.ev.on('creds.update', saveCreds);

            // Request Pair Code if not registered
            if (!sock.authState.creds.registered) {
                try {
                    let pairCode = await sock.requestPairingCode(waNumber);
                    pairCode = pairCode?.match(/.{1,4}/g)?.join('-') || pairCode;
                    if (!res.headersSent) res.send({ code: pairCode });
                } catch (err) {
                    console.error("❌ Failed to request pair code:", err);
                    if (!res.headersSent) res.status(503).send({ code: "Failed to request pair code" });
                }
            }

        } catch (err) {
            console.error("❌ Error initializing session:", err);
            if (!res.headersSent) res.status(503).send({ code: "Service Unavailable" });
        }
    }

    await startSession();
});

// Global uncaught exception handler
process.on('uncaughtException', (err) => {
    const ignoreErrors = [
        "conflict",
        "not-authorized",
        "Socket connection timeout",
        "rate-overlimit",
        "Connection Closed",
        "Timed Out",
        "Stream Errored",
        "statusCode: 515",
        "statusCode: 503"
    ];
    if (!ignoreErrors.some(e => String(err).includes(e))) {
        console.error("🚨 Uncaught Exception:", err);
    }
});

export default router;
