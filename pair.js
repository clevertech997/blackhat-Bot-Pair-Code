import express from 'express';
import fs from 'fs';
import pino from 'pino';
import {
    makeWASocket,
    useMultiFileAuthState,
    delay,
    makeCacheableSignalKeyStore,
    Browsers,
    jidNormalizedUser,
    fetchLatestBaileysVersion
} from '@whiskeysockets/baileys';
import pn from 'awesome-phonenumber';

const router = express.Router();

/* =========================
   BLACK HAT BOT SESSION
========================= */

// Remove session folder safely
function removeSession(folderPath) {
    try {
        if (fs.existsSync(folderPath)) {
            fs.rmSync(folderPath, { recursive: true, force: true });
        }
    } catch (err) {
        console.error('❌ Error deleting session:', err);
    }
}

router.get('/', async (req, res) => {
    let number = req.query.number;

    if (!number) {
        return res.status(400).json({
            code: 'Please provide a phone number in international format.'
        });
    }

    // Clean number
    number = number.replace(/[^0-9]/g, '');
    const phone = pn('+' + number);

    if (!phone.isValid()) {
        return res.status(400).json({
            code: 'Invalid phone number. Use full international format without + or spaces.'
        });
    }

    number = phone.getNumber('e164').replace('+', '');
    const sessionPath = './session_' + number;

    // Delete old session if exists
    removeSession(sessionPath);

    async function startBLACKHATBOT() {
        const { state, saveCreds } = await useMultiFileAuthState(sessionPath);
        const { version } = await fetchLatestBaileysVersion();

        const BLACK_HAT_BOT = makeWASocket({
            version,
            logger: pino({ level: "fatal" }),
            printQRInTerminal: false,
            browser: Browsers.windows('Chrome'),
            markOnlineOnConnect: false,
            auth: {
                creds: state.creds,
                keys: makeCacheableSignalKeyStore(
                    state.keys,
                    pino({ level: "fatal" })
                )
            }
        });

        /* ========= CONNECTION EVENTS ========= */

        BLACK_HAT_BOT.ev.on('connection.update', async (update) => {
            const { connection, lastDisconnect } = update;

            if (connection === 'open') {
                console.log("✅ BLACK HAT BOT Connected");

                try {
                    const creds = fs.readFileSync(sessionPath + '/creds.json');
                    const userJid = jidNormalizedUser(number + '@s.whatsapp.net');

                    // Send session file
                    await BLACK_HAT_BOT.sendMessage(userJid, {
                        document: creds,
                        mimetype: 'application/json',
                        fileName: 'BLACK_HAT_SESSION.json'
                    });

                    // Send success message
await BLACK_HAT_BOT.sendMessage(userJid, {
    text: `
╔═════════════════════════╗
 🖤  *BLACK HAT BOT*  🖤
╚═════════════════════════╝

✅ *SESSION GENERATED SUCCESSFULLY*

⚠️  *SECURITY WARNING*
Do NOT share this file with anyone.
Anyone with this file can access your WhatsApp.

┏━━━━━━━━━━━━━━━━━━━━━━━━━━━━┓
┃  🛡️ Powered by Clever Tech
┃  ⚡ Secure • Fast • Stable
┃  © 2026 BLACK HAT BOT
┗━━━━━━━━━━━━━━━━━━━━━━━━━━━━┛

🚀 Thank you for choosing BLACK HAT BOT
`
});


                    console.log("📄 Session sent successfully");

                    await delay(2000);
                    removeSession(sessionPath);
                    console.log("🧹 Session cleaned");

                } catch (err) {
                    console.error("❌ Error sending session:", err);
                    removeSession(sessionPath);
                }
            }

            if (connection === 'close') {
                const statusCode = lastDisconnect?.error?.output?.statusCode;

                if (statusCode !== 401) {
                    console.log("🔁 Reconnecting BLACK HAT BOT...");
                    startBLACKHATBOT();
                } else {
                    console.log("❌ Logged out. Generate new pairing code.");
                }
            }
        });

        /* ========= PAIRING CODE ========= */

        if (!state.creds.registered) {
            await delay(3000);

            try {
                let code = await BLACK_HAT_BOT.requestPairingCode(number);
                code = code?.match(/.{1,4}/g)?.join('-') || code;

                if (!res.headersSent) {
                    console.log("🔐 Pairing Code:", code);
                    return res.json({ code });
                }

            } catch (err) {
                console.error("❌ Pairing error:", err);
                if (!res.headersSent) {
                    return res.status(500).json({
                        code: 'Failed to generate pairing code.'
                    });
                }
            }
        }

        BLACK_HAT_BOT.ev.on('creds.update', saveCreds);
    }

    await startBLACKHATBOT();
});

/* ========= GLOBAL ERROR HANDLER ========= */

process.on('uncaughtException', (err) => {
    const ignoreErrors = [
        "conflict",
        "not-authorized",
        "Socket connection timeout",
        "rate-overlimit",
        "Connection Closed",
        "Timed Out",
        "Value not found",
        "Stream Errored",
        "statusCode: 515",
        "statusCode: 503"
    ];

    if (ignoreErrors.some(e => String(err).includes(e))) return;

    console.error("🚨 Uncaught Exception:", err);
});

export default router;
