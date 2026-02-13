import express from 'express'
import fs from 'fs'
import pino from 'pino'
import QRCode from 'qrcode'
import {
    makeWASocket,
    useMultiFileAuthState,
    makeCacheableSignalKeyStore,
    Browsers,
    fetchLatestBaileysVersion
} from '@whiskeysockets/baileys'

const router = express.Router()
const BOT_NAME = "BLACKHAT BOT"

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

    if (!fs.existsSync(baseDir)) fs.mkdirSync(baseDir, { recursive: true })
    if (!fs.existsSync(sessionDir)) fs.mkdirSync(sessionDir, { recursive: true })

    let responseSent = false
    let qrGenerated = false
    let reconnectAttempts = 0
    const maxReconnect = 3

    try {
        const { state, saveCreds } = await useMultiFileAuthState(sessionDir)
        const { version } = await fetchLatestBaileysVersion()

        const sock = makeWASocket({
            version,
            logger: pino({ level: 'silent' }),
            browser: Browsers.windows('Chrome'),
            auth: {
                creds: state.creds,
                keys: makeCacheableSignalKeyStore(state.keys, pino({ level: 'fatal' }))
            },
            printQRInTerminal: false,
            markOnlineOnConnect: false
        })

        const handleConnection = async (update) => {
            const { connection, lastDisconnect, qr } = update

            // ===== QR GENERATION =====
            if (qr && !qrGenerated) {
                qrGenerated = true
                const qrDataURL = await QRCode.toDataURL(qr)

                if (!responseSent) {
                    responseSent = true
                    return res.json({
                        qr: qrDataURL,
                        message: `🖤✨ ${BOT_NAME} QR Generated ✨🖤`,
                        instructions: [
                            "1️⃣ Open WhatsApp",
                            "2️⃣ Go to Settings",
                            "3️⃣ Tap Linked Devices",
                            "4️⃣ Scan this QR Code"
                        ],
                        successMessage: `
╔══════════════════════════════╗
       🖤✨ *${BOT_NAME}* ✨🖤
╚══════════════════════════════╝

✅ *SESSION GENERATED SUCCESSFULLY* 🎉

⚠️ *SECURITY WARNING* ⚠️
🔒 Do NOT share this file with anyone!
🚫 Anyone with this file can access your WhatsApp.

┏━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┓
┃ 🛡️ Powered by Clever Tech
┃ ⚡ Secure • Fast • Stable
┃ © 2026 ${BOT_NAME}
┗━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┛

🚀 Enjoy using *${BOT_NAME}
`
                    })
                }
            }

            // ===== CONNECTED =====
            if (connection === 'open') {
                console.log("✅ BLACKHAT BOT Connected")
            }

            // ===== CONNECTION CLOSED =====
            if (connection === 'close') {
                const statusCode = lastDisconnect?.error?.output?.statusCode

                if (statusCode === 401) {
                    console.log("🔐 Logged out")
                    removeSession(sessionDir)
                } else {
                    reconnectAttempts++
                    if (reconnectAttempts <= maxReconnect) {
                        console.log(`🔁 Reconnecting (${reconnectAttempts}/${maxReconnect})`)
                        sock.ev.removeAllListeners()
                        makeWASocket({
                            version,
                            logger: pino({ level: 'silent' }),
                            browser: Browsers.windows('Chrome'),
                            auth: {
                                creds: state.creds,
                                keys: makeCacheableSignalKeyStore(state.keys, pino({ level: 'fatal' }))
                            }
                        })
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

// Global uncaught exception filter
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
