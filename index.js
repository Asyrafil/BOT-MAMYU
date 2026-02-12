import {
    default as makeWASocket,
    useMultiFileAuthState,
    fetchLatestBaileysVersion,
    DisconnectReason
} from "@whiskeysockets/baileys"

import autoReply from "./lib/autoReply.js"
import P from "pino"
import readline from "readline"
import { Boom } from "@hapi/boom"
import { CONFIG } from "./config.js"

const DEFAULT_NUMBER = CONFIG.DEFAULT_NUMBER

// ================= COLORS =================
const colors = {
    reset: "\x1b[0m",
    red: "\x1b[31m",
    green: "\x1b[32m",
    yellow: "\x1b[33m",
    blue: "\x1b[34m",
    magenta: "\x1b[35m",
    cyan: "\x1b[36m",
    bold: "\x1b[1m"
}

function logMessage(title, message, color = colors.cyan){
    console.log(colors.bold + "───────────────────────────────" + colors.reset)
    console.log(`${color}📌 ${title}${colors.reset}`)
    console.log(`${message}`)
    console.log(colors.bold + "───────────────────────────────" + colors.reset)
}

// ================= INPUT =================
const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
})

const question = (text) => new Promise(resolve => rl.question(text, resolve))

// ================= GLOBAL =================
let isStarting = false
let currentSock = null
let isPairing = false
let pairingRetryCount = 0
const MAX_PAIRING_RETRIES = 5

export const BOT_STATUS = {
    startTime: Date.now(),
    connected: false,
    version: "Mamyu.bykar 9.18.28",
    lastPing: 0
}

// ================= START BOT =================
async function startBot(){

    if(isStarting) return
    isStarting = true

    console.log("🚀 Starting bot...")

    const { state, saveCreds } = await useMultiFileAuthState("./session")
    const { version } = await fetchLatestBaileysVersion()

    const sock = makeWASocket({
        auth: state,
        logger: P({ level: "silent" }),
        version,
        printQRInTerminal: false,
        syncFullHistory: false,
        browser: ["Chrome","Desktop","MultiDevice"]
    })

    currentSock = sock

    sock.ev.on("creds.update", saveCreds)

    // ================= PAIRING LOGIN (MULTIDEVICE FIX) =================
    if(!state.creds.registered){

        try{

            isPairing = true

            let phoneNumber = DEFAULT_NUMBER

            if(process.stdin.isTTY){
                const answer = await question(`Masukkan nomor WhatsApp (Enter = ${DEFAULT_NUMBER}) : `)
                if(answer && answer.trim() !== ""){
                    phoneNumber = answer.trim()
                }
            }else{
                console.log("Terminal non-interaktif terdeteksi, menggunakan nomor default.")
            }

            console.log("Menggunakan nomor:", phoneNumber)

            const code = await sock.requestPairingCode(phoneNumber)

            logMessage("PAIRING CODE", code, colors.yellow)
            pairingRetryCount = 0

        }catch(e){
            console.log("Pairing error:", e.message)
            isStarting = false

            const shouldRetry = e?.message !== "readline was closed"

            if(!shouldRetry){
                console.log("⏹️ Pairing dihentikan karena input terminal tidak tersedia.")
                return
            }

            pairingRetryCount += 1

            if(pairingRetryCount > MAX_PAIRING_RETRIES){
                console.log(`⏹️ Pairing dihentikan setelah ${MAX_PAIRING_RETRIES} kali percobaan gagal.`)
                return
            }

            const retryDelay = Math.min(3000 * pairingRetryCount, 15000)
            console.log(`🔁 Coba pairing ulang dalam ${retryDelay / 1000} detik... (${pairingRetryCount}/${MAX_PAIRING_RETRIES})`)

            setTimeout(() => {
                startBot()
            }, retryDelay)

            return
        }
    }

    // ================= CONNECTION UPDATE =================
    sock.ev.on("connection.update", async (update)=>{

        const { connection, lastDisconnect } = update

        if(connection === "open"){

            BOT_STATUS.connected = true
            isStarting = false
            isPairing = false
            pairingRetryCount = 0

            console.log("✅ Connected")
        }

        if(connection === "close"){

            BOT_STATUS.connected = false

            const reason = new Boom(lastDisconnect?.error)?.output?.statusCode

            console.log("Disconnected reason:", reason)

            try{
                currentSock?.ws.close()
            }catch{}

            isStarting = false

            setTimeout(()=>{
                console.log("🔄 Reconnecting...")
                startBot()
            },3000)
        }
    })

    // ================= MESSAGE HANDLER =================
    sock.ev.on("messages.upsert", async ({ messages })=>{

        const m = messages[0]
        if(!m.message || m.key.fromMe) return

        const text =
            m.message.conversation ||
            m.message.extendedTextMessage?.text ||
            m.message.buttonsResponseMessage?.selectedButtonId ||
            m.message.templateButtonReplyMessage?.selectedId ||
            m.message.listResponseMessage?.singleSelectReply?.selectedRowId ||
            ""

        const chatId = m.key.remoteJid

        logMessage("PESAN MASUK",`
[ Dari: ${chatId} ]
[ Teks: ${text} ]
`,colors.yellow)

        // manual reconnect
        if(text === "!ulang"){
            logMessage("RECONNECT","♻️ Manual reconnect...",colors.magenta)
            try{ currentSock?.ws.close() }catch{}
            return
        }

        await autoReply(sock, chatId, text, {
            id: chatId,
            botStatus: BOT_STATUS
        })
    })

    logMessage("BOT READY","🤖 Bot aktif",colors.blue)
}

startBot()
