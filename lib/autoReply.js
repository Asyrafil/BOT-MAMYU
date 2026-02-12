import fs from "fs"
import path from "path"

const DB_FILE = path.join("./db.json")
const PO_DB_FILE = path.join("./po.json")
const GREETING_DB_FILE = path.join("./messageMap.json")

const lastReplyMap = new Map()
const REPLY_COOLDOWN = 3000
const PREFIX = "!"
const OWNER_GROUP_ID = "120363424315515183@g.us"

function safeReadJSON(filePath, fallback){
    if(!fs.existsSync(filePath)) return fallback

    try{
        return JSON.parse(fs.readFileSync(filePath, "utf8"))
    }catch(error){
        console.log(`JSON parse error on ${filePath}:`, error.message)
        return fallback
    }
}

function loadPO(){
    const data = safeReadJSON(PO_DB_FILE, [])
    return Array.isArray(data) ? data : []
}

function savePO(poList){
    fs.writeFileSync(PO_DB_FILE, JSON.stringify(poList, null, 2))
}

let poCompleted = new Set(loadPO())
let greetedCustomers = loadGreetedCustomers()


function loadGreetedCustomers(){
    const data = safeReadJSON(GREETING_DB_FILE, [])

    if(Array.isArray(data)) return new Set(data)

    if(data && typeof data === "object"){
        const greeted = Object.entries(data)
            .filter(([, value]) => Boolean(value))
            .map(([jid]) => jid)

        return new Set(greeted)
    }

    return new Set()
}

function saveGreetedCustomers(greetedCustomers){
    fs.writeFileSync(
        GREETING_DB_FILE,
        JSON.stringify([...greetedCustomers], null, 2)
    )
}

function loadDB(){
    const data = safeReadJSON(DB_FILE, { queue: [], poList: [] })

    return {
        queue: Array.isArray(data.queue) ? data.queue : [],
        poList: Array.isArray(data.poList) ? data.poList : []
    }
}

function saveDB(db){
    fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2))
}

function addToQueue(jid){
    const db = loadDB()
    if(!db.queue.includes(jid)){
        db.queue.push(jid)
        saveDB(db)
    }
}

function removeFromQueue(jid){
    const db = loadDB()
    db.queue = db.queue.filter(j => j !== jid)
    saveDB(db)
}

function isInQueue(jid){
    return loadDB().queue.includes(jid)
}

function getNumberFromJid(jid){
    return jid.split("@")[0]
}

const SHOP_CONFIG = {
    openDays: [0,1,2,3,4,5,6],
    closedMessage:
`🙏 Mohon maaf kak,
Hari ini kami sedang *TUTUP*.

Kami buka kembali hari Senin ya kak 😊`
}

function getWIBDate(){
    const now = new Date()
    return new Date(now.toLocaleString("en-US", { timeZone: "Asia/Jakarta" }))
}


function formatUptime(ms){
    const totalSeconds = Math.floor(ms / 1000)
    const days = Math.floor(totalSeconds / 86400)
    const hours = Math.floor((totalSeconds % 86400) / 3600)
    const minutes = Math.floor((totalSeconds % 3600) / 60)
    const seconds = totalSeconds % 60

    const parts = []
    if(days) parts.push(`${days} hari`)
    if(hours) parts.push(`${hours} jam`)
    if(minutes) parts.push(`${minutes} menit`)
    parts.push(`${seconds} detik`)

    return parts.join(" ")
}

function getFieldValue(lines, keyword){
    const line = lines.find(l => l.toLowerCase().includes(keyword))
    if(!line) return ""

    const [, ...valueParts] = line.split(":")
    return valueParts.join(":").trim()
}

export default async function autoReply(sock, from, text, chatMetadata){
    if(!text) return

    const rawText = String(text).trim()
    const normalizedText = rawText.toLowerCase()
    const sender = chatMetadata?.participant || from

    if(!greetedCustomers.has(sender)){
        greetedCustomers.add(sender)
        saveGreetedCustomers(greetedCustomers)

        await sock.sendMessage(from, {
            text: `Halo kak 👋

Selamat datang di Mamyu.bykar🥰
Ada yang bisa saya bantu hari ini?`
        })
    }

    const wib = getWIBDate()
    const today = wib.getDay()

    if(!SHOP_CONFIG.openDays.includes(today)){
        await sock.sendMessage(from, { text: SHOP_CONFIG.closedMessage })
        return
    }

    const spamKey = `${from}-${sender}`
    const now = Date.now()
    const lastReply = lastReplyMap.get(spamKey)
    const isDuplicateFastMessage =
        lastReply &&
        lastReply.text === normalizedText &&
        now - lastReply.time < REPLY_COOLDOWN

    if(isDuplicateFastMessage) return

    lastReplyMap.set(spamKey, { text: normalizedText, time: now })

    const menuKeywords = [
        "menu","katalog","harga","list",
        "jual apa","menu apa","ada apa",
        "jualan apa","menu dong","menu nya",
        "kak menu","menu apa ya",
        "minta menu","kak minta menu"
    ]
    const ongkirKeywords = ["ongkir","biaya"]
    const pengantaranKeywords = ["pengantaran","jam pengantaran"]
    const poKeywords = ["po","mau po","list po","pesan po","pesan"]
    const cancelKeywords = ["tidak jadi","batal po","gak jadi","batal"]

    const askMenu = menuKeywords.some(k => normalizedText.includes(k))
    const askOngkir = ongkirKeywords.some(k => normalizedText.includes(k))
    const askPengantaran = pengantaranKeywords.some(k => normalizedText.includes(k))
    const askPO = poKeywords.some(k => normalizedText.includes(k))
    const askCancel = cancelKeywords.some(k => normalizedText.includes(k))

    if(poCompleted.has(sender)){
        console.log("User sudah submit PO, bot tidak membalas:", sender)
        return
    }

    if(askCancel && isInQueue(sender)){
        removeFromQueue(sender)
        await sock.sendMessage(from, {
            text: "❌ Oke kak, PO kamu dibatalkan. Kamu bisa PO lagi kapan saja."
        })
        return
    }

    if(isInQueue(sender)){
        const lines = rawText.split("\n")

        const nama = getFieldValue(lines, "nama")
        const alamat = getFieldValue(lines, "alamat")
        const hp = getFieldValue(lines, "hp") || getFieldValue(lines, "no. hp")
        const porsi = getFieldValue(lines, "porsi")

        if(!nama || !alamat || !hp || !porsi){
            await sock.sendMessage(from, {
                text:`⚠️ Format PO belum lengkap atau ada yang kosong!

Silakan isi format PO dengan benar:

Nama:
Alamat:
No. HP:
Pesan berapa porsi?: 

🚚 ONGKIR :
- Batam Center / Botania / Bengkong: 10k
- Di luar Batam Center: 13k`
            })
            return
        }

        let waNumber = hp
        if(waNumber.startsWith("0")){
            waNumber = `62${waNumber.slice(1)}`
        }else if(waNumber.startsWith("+")){
            waNumber = waNumber.slice(1)
        }

        const senderNumber = getNumberFromJid(sender)
        const poText = `📌 *PO BARU*\n\n👤 https://wa.me/${senderNumber}\n\n${rawText}`

        try{
            await sock.sendMessage(OWNER_GROUP_ID, { text: poText })
            await sock.sendMessage(from, {
                text:`✅ Terima kasih kak 💕
Order kamu sudah terkirim ke admin, Mohon menunggu Balasan Admin ya ka😊`
            })

            poCompleted.add(waNumber)
            savePO([...poCompleted])

            const db = loadDB()
            db.poList.push({
                nama,
                alamat,
                hp: waNumber,
                porsi,
                timestamp: new Date().toISOString()
            })
            saveDB(db)
        }catch(error){
            console.log("ERROR kirim group:", error)
        }

        removeFromQueue(sender)
        return
    }

    if(normalizedText.includes("halo") || normalizedText.includes("hai") || normalizedText === "p"){
        await sock.sendMessage(from, {
            text:`Halo kak 👋

Selamat datang di Mamyu.bykar🥰
Ada yang Bisa saya bantu? Silahkan ketik Menu Untuk Menampilkan Menu kami ya kaa.. `
        })
        return
    }

    if(askMenu){
        await sock.sendMessage(from, {
            image: fs.readFileSync("./mamyu.png"),
            caption:`🍜 *KATALOG MENU*

Silahkan Buka link untuk Melihat katalog
https://wa.me/c/6285832852878

Ketik *"PO"*, *"PESAN"* Untuk Melanjutkan List Pesanan ‼️‼️`
        })
        return
    }

    if(askOngkir){
        await sock.sendMessage(from, {
            text:`🚚 ONGKIR :

- Batam Center / Botania / Bengkong: 10k
- Di luar Batam Center: 13k

Ketik *"PO"*, *"PESAN"* Untuk Melanjutkan List Pesanan ‼️‼️`
        })
        return
    }

    if(askPengantaran){
        await sock.sendMessage(from, {
            text:`🚚 PENGANTARAN :

Mulai Jam 2 siang sampai selesai yaa kaa.

Ketik *"PO"*, *"PESAN"* Untuk Melanjutkan List Pesanan ‼️‼️`
        })
        return
    }

    if(askPO){
        addToQueue(sender)
        await sock.sendMessage(from, {
            text:`Hai kak 👋

Silakan isi format order:

Nama:
Alamat:
No. HP:
Pesan berapa porsi?

🚚 ONGKIR :
- Batam Center / Botania / Bengkong: 10k
- Di luar Batam Center: 13k`
        })
        return
    }

    if(normalizedText.startsWith(PREFIX)){
        const command = normalizedText.slice(1)

        if(command === "jid"){
            await sock.sendMessage(from, {
                text: `JID: ${chatMetadata.id}`
            })
            return
        }

        if(command === "status"){
            const botStatus = chatMetadata?.botStatus || {}
            const startTime = botStatus.startTime || Date.now()
            const uptime = formatUptime(Date.now() - startTime)
            const version = botStatus.version || "unknown"
            const connected = botStatus.connected ? "online" : "offline"

            await sock.sendMessage(from, {
                text: `📊 *STATUS BOT*

Version: ${version}
Koneksi: ${connected}
Uptime: ${uptime}`
            })
            return
        }
    }
}
