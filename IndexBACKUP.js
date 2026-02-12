import {
    default as makeWASocket,
    useMultiFileAuthState,
    fetchLatestBaileysVersion,
    DisconnectReason
} from "@whiskeysockets/baileys"

import autoReply from "./lib/autoReply.js"
import P from "pino"
import readline from "readline"
import fs from "fs"

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

// ================= START BOT =================
async function startBot(){

    if(isStarting) return
    isStarting = true

    const { state, saveCreds } = await useMultiFileAuthState("./session")
    const { version } = await fetchLatestBaileysVersion()

    const sock = makeWASocket({
        auth: state,
        logger: P({ level: "silent" }),
        version,
        printQRInTerminal: false
    })

    currentSock = sock

    sock.ev.on("creds.update", saveCreds)

    // OTP LOGIN
    if(!sock.authState.creds.registered){

        const phoneNumber = await question("Masukkan nomor WhatsApp (628xxx): ")

        const code = await sock.requestPairingCode(phoneNumber)

        logMessage("PAIRING CODE", code, colors.yellow)
    }

    // CONNECTION UPDATE
    sock.ev.on("connection.update", async (update) => {

        const { connection } = update

        if(connection === "open"){
            isStarting = false
            logMessage("STATUS","✅ Connected",colors.green)
        }

        if(connection === "close"){

            logMessage("STATUS","❌ Disconnected",colors.red)

            isStarting = false

            setTimeout(()=>{
                startBot()
            },2000)
        }
    })

    // ================= MESSAGE =================
    sock.ev.on("messages.upsert", async ({ messages }) => {

        const m = messages[0]
        if(!m.message || m.key.fromMe) return

        const text =
            m.message.conversation ||
            m.message.extendedTextMessage?.text ||
            ""

        const chatId = m.key.remoteJid

        logMessage("PESAN MASUK",`
[ Dari: ${chatId} ]
[ Teks: ${text} ]
`,colors.yellow)

        // ================= RECONNECT COMMAND =================
        if(text === "!reconnect"){

            logMessage("RECONNECT","♻️ Manual reconnect...",colors.magenta)

            try{
                currentSock.ws.close() // 🔥 force reconnect
            }catch{}

            return
        }

        await autoReply(sock, chatId, text, { id: chatId })
    })

    logMessage("BOT READY","🤖 Bot aktif",colors.blue)
}

startBot()
