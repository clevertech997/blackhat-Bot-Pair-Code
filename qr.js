import express from 'express'
import fs from 'fs'
import pino from 'pino'
import QRCode from 'qrcode'
import {
    makeWASocket,
    useMultiFileAuthState,
    makeCacheableSignalKeyStore,
    Browsers,
    jidNormalizedUser,
    fetchLatestBaileysVersion
} from '@whiskeysockets/baileys'

const router = express.Router()

/* ===============================
   🖤 BLACK HAT BOT QR SYSTEM
================================= */

// Safely remove folder
function removeSession(path) {
    try {
        if (fs.existsSync(path)) {
            fs.rmSync(path, { recursive: true, force: true })
            return true
        }
        return false
    } catch (err) {
        console.error("❌ Session delete error:", err)
        return false
    }
}

router.get('/', async (req, res) => {

    const sessionId = Date.now() + "_" + Math.random().toString(36).substring(2)
    const baseDir = './qr_sessions'
    const sessionDir = `${baseDir}/session_${sessionId}`

    if (!fs.existsSync(baseDir)) {
        fs.mkdirSync(baseDir, { recursive: true })
    }

    if (!fs.existsSync(sessionDir)) {
        fs.mkdirSync(sessionDir, { recursive: true })
    }

    let responseSent = false
    let qrGenerated = false
    let reconnectAttempts = 0
    const maxReconnect = 3

    try {

        const { state, saveCreds } = await useMultiFileAuthState(sessionDir)
        const { version } = await fetchLatestBaileysVersion()

        const socketConfig = {
            version,
            logger: pino({ level: 'silent' }),
            browser: Browsers.windows('Chrome'),
            auth: {
                creds: state.creds,
                keys: makeCacheableSignalKeyStore(
                    state.keys,
                    pino({ level: 'fatal' })
                )
            },
            markOnlineOnConnect: false,
            generateHighQualityLinkPreview: false,
            defaultQueryTimeoutMs: 60000,
            connectTimeoutMs: 60000,
            keepAliveIntervalMs: 30000
        }

        let sock = makeWASocket(socketConfig)

        const handleConnection = async (update) => {
            const { connection, lastDisconnect, qr } = update

            /* ========= QR GENERATION ========= */
            if (qr && !qrGenerated) {
                qrGenerated = true

                const qrDataURL = await QRCode.toDataURL(qr)

                if (!responseSent) {
                    responseSent = true
                    return res.json({
                        qr: qrDataURL,
                        message: "🖤 BLACK HAT BOT QR Generated!",
                        instructions: [
                            "1. Open WhatsApp",
                            "2. Go to Settings",
                            "3. Tap Linked Devices",
                            "4. Scan this QR Code"
                        ]
                    })
                }
            }

            /* ========= CONNECTED ========= */
            if (connection === 'open') {

                console.log("✅ BLACK HAT BOT Connected")

                try {
                    const sessionFile = fs.readFileSync(`${sessionDir}/creds.json`)
                    const userJid = sock.authState.creds.me?.id
                        ? jidNormalizedUser(sock.authState.creds.me.id)
                        : null

                    if (userJid) {

                        // Send session file
                        await sock.sendMessage(userJid, {
                            document: sessionFile,
                            mimetype: 'application/json',
                            fileName: 'creds.json'
                        })

                        // Send styled message
                        await sock.sendMessage(userJid, {
                            text: `
╔══════════════════════════╗
   🖤  *BLACK HAT BOT*  🖤
╚══════════════════════════╝

✅ *QR SESSION CONNECTED*

⚠️ SECURITY WARNING
Do NOT share this session file.
Anyone with it can control your WhatsApp.

┏━━━━━━━━━━━━━━━━━━━━━━━━━━┓
┃ 🛡️ Secure Connection Established
┃ ⚡ Fast • Stable • Private
┃ © 2026 Clever Tech
┗━━━━━━━━━━━━━━━━━━━━━━━━━━┛

🚀 Thank you for using BLACK HAT BOT
`
                        })

                        console.log("📄 Session sent to", userJid)
                    }

                } catch (err) {
                    console.error("❌ Send session error:", err)
                }

                // Cleanup after 15 seconds
                setTimeout(() => {
                    console.log("🧹 Cleaning session...")
                    removeSession(sessionDir)
                }, 15000)
            }

            /* ========= CONNECTION CLOSED ========= */
            if (connection === 'close') {

                const statusCode = lastDisconnect?.error?.output?.statusCode

                if (statusCode === 401) {
                    console.log("🔐 Logged out")
                    removeSession(sessionDir)
                } else {
                    reconnectAttempts++

                    if (reconnectAttempts <= maxReconnect) {
                        console.log(`🔁 Reconnecting (${reconnectAttempts}/${maxReconnect})`)
                        sock = makeWASocket(socketConfig)
                        sock.ev.on('connection.update', handleConnection)
                        sock.ev.on('creds.update', saveCreds)
                    } else {
                        console.log("❌ Max reconnect reached")
                        if (!responseSent) {
                            responseSent = true
                            res.status(503).json({ code: "Connection failed" })
                        }
                        removeSession(sessionDir)
                    }
                }
            }
        }

        sock.ev.on('connection.update', handleConnection)
        sock.ev.on('creds.update', saveCreds)

        // Timeout protection (30 sec)
        setTimeout(() => {
            if (!responseSent) {
                responseSent = true
                res.status(408).json({ code: "QR generation timeout" })
                removeSession(sessionDir)
            }
        }, 30000)

    } catch (err) {
        console.error("❌ Initialization error:", err)
        if (!responseSent) {
            responseSent = true
            res.status(503).json({ code: "Service Unavailable" })
        }
        removeSession(sessionDir)
    }
})

/* ========= GLOBAL ERROR FILTER ========= */

process.on('uncaughtException', (err) => {
    const ignore = [
        "conflict",
        "not-authorized",
        "Socket connection timeout",
        "rate-overlimit",
        "Connection Closed",
        "Timed Out",
        "Stream Errored",
        "statusCode: 515",
        "statusCode: 503"
    ]

    if (ignore.some(e => String(err).includes(e))) return

    console.error("🚨 Uncaught Exception:", err)
})

export default router
