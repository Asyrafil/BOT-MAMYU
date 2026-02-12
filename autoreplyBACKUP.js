import fs from "fs"
import path from "path"

const DB_FILE = path.join("./db.json")
const PO_DB_FILE = path.join("./po.json") // database untuk user yang sudah PO

const lastReplyMap = new Map()
const REPLY_COOLDOWN = 3000
const PREFIX = "!"

// 🔥 GANTI DENGAN JID GROUP OWNER
const OWNER_GROUP_ID = "120363424315515183@g.us"

// ==================== LOAD/ SAVE DATABASE PO ====================
function loadPO(){
    if(!fs.existsSync(PO_DB_FILE)) return []
    return JSON.parse(fs.readFileSync(PO_DB_FILE))
}

function savePO(poList){
    fs.writeFileSync(PO_DB_FILE, JSON.stringify(poList,null,2))
}

// ==================== MEMORY USER PO ====================
let poCompleted = new Set(loadPO()) // load dari file po.json

// ==================== DATABASE =================
function loadDB(){
    if(!fs.existsSync(DB_FILE)) return { queue: [], poList: [] }
    return JSON.parse(fs.readFileSync(DB_FILE))
}

function saveDB(db){
    fs.writeFileSync(DB_FILE, JSON.stringify(db,null,2))
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
    db.queue = db.queue.filter(j=>j!==jid)
    saveDB(db)
}

function isInQueue(jid){
    return loadDB().queue.includes(jid)
}

function getNumberFromJid(jid){
    return jid.split("@")[0]
}

// ================= JAM OPERASIONAL =================
const SHOP_CONFIG = {
    openDays: [0,1,2,3,4,5,6], // buka senin-sabtu
    closedMessage:
`🙏 Mohon maaf kak,
Hari ini kami sedang *TUTUP*.

Kami buka kembali hari Senin ya kak 😊`
}

// ================= REALTIME WIB =================
function getWIBDate(){
    const now = new Date()
    return new Date(
        now.toLocaleString("en-US",{ timeZone:"Asia/Jakarta" })
    )
}

// ================= AUTO REPLY =================
export default async function(sock, from, text, chatMetadata){

    if(!text) return

    text = text.toLowerCase().trim()
    const sender = chatMetadata?.participant || from

    // ================= CHECK HARI BUKA =================
    const wib = getWIBDate()
    const today = wib.getDay()
    if(!SHOP_CONFIG.openDays.includes(today)){
        await sock.sendMessage(from,{ text: SHOP_CONFIG.closedMessage })
        return
    }

    // ================= ANTI SPAM =================
    const spamKey = from+"-"+sender
    const now = Date.now()
    const lastReply = lastReplyMap.get(spamKey) || 0
    if(now - lastReply < REPLY_COOLDOWN) return
    lastReplyMap.set(spamKey, now)

    // ================= KEYWORDS =================
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

    const askMenu = menuKeywords.some(k=>text.includes(k))
    const askOngkir = ongkirKeywords.some(k=>text.includes(k))
    const askPengantaran = pengantaranKeywords.some(k=>text.includes(k))
    const askPO = poKeywords.some(k=>text.includes(k))
    const askCancel = cancelKeywords.some(k=>text.includes(k))

    // ================= CEK USER SUDAH PO =================
    if(poCompleted.has(sender)){
        console.log("User sudah submit PO, bot tidak membalas:", sender)
        return
    }

    // ================= CANCEL PO =================
    if(askCancel && isInQueue(sender)){
        removeFromQueue(sender)
        await sock.sendMessage(from,{
            text:`❌ Oke kak, PO kamu dibatalkan. Kamu bisa PO lagi kapan saja.`
        })
        return
    }

    // ================= MODE ANTRIAN PO =================
    if(isInQueue(sender)){
        const lines = text.split("\n")

        // Ambil isi setiap field
        const nama = lines.find(l=>l.toLowerCase().includes("nama"))?.split(":")[0]?.trim()
        const alamat = lines.find(l=>l.toLowerCase().includes("alamat"))?.split(":")[0]?.trim()
        let hp = lines.find(l=>l.toLowerCase().includes("hp"))?.split(":")[0]?.trim()
        const porsi = lines.find(l=>l.toLowerCase().includes("porsi"))?.split(":")[0]?.trim()

        // VALIDASI FIELD TIDAK BOLEH KOSONG
        if(!nama || !alamat || !hp || !porsi){
            await sock.sendMessage(from,{
                text:`⚠️ Format PO belum lengkap atau ada yang kosong!

Silakan isi format PO dengan benar:

Nama:
Alamat:
No. HP:
Pesan berapa porsi?: 

🚚 ONGKIR :
- Batam Center / Botania / Bengkong: 10k
- Di luar Batam Center: 13k
`
            })
            return
        }

        // ===================== VALIDASI & KONVERSI NOMOR HP =====================

        // KONVERSI ke format WA
        let waNumber = hp
        if(waNumber.startsWith("0")){
            waNumber = "62" + waNumber.slice(1)
        } else if(waNumber.startsWith("+")){
            waNumber = waNumber.slice(1)
        } // jika sudah mulai 62 atau kode negara lain, biarkan

        // ===================== KIRIM PO KE ADMIN =====================
  const senderNumber = getNumberFromJid(sender)

const poText =
`📌 *PO BARU*

👤 https://wa.me/${senderNumber}

${text}`

        try{
            await sock.sendMessage(OWNER_GROUP_ID,{ text: poText })

            await sock.sendMessage(from,{
                text:`✅ Terima kasih kak 💕
Order kamu sudah terkirim ke admin, Mohon menunggu Balasan Admin ya ka😊`
            })

            // ===================== TANDA SUDAH PO =====================
            poCompleted.add(waNumber)
            savePO([...poCompleted]) // simpan ke po.json

            // ===================== SIMPAN KE DB.JSON =====================
            const db = loadDB()
            if(!db.poList) db.poList = []

            // simpan sebagai objek dengan field lengkap
            db.poList.push({
                nama,
                alamat,
                hp: waNumber,
                porsi,
                timestamp: new Date().toISOString()
            })
            saveDB(db)

        }catch(err){
            console.log("ERROR kirim group:",err)
        }

        removeFromQueue(sender)
        return
    }

    // ================= NATURAL CHAT =================
    if(text.includes("halo") || text.includes("hai") || text==="p"){
        await sock.sendMessage(from,{
            text:`Halo kak 👋

Selamat datang di Mamyu.bykar🥰
Ada yang Bisa saya bantu? Silahkan ketik Menu Untuk Menampilkan Menu kami ya kaa.. `
        })
        return
    }

    if(askMenu){
        await sock.sendMessage(from,{
            image: fs.readFileSync("./mamyu.png"),
            caption:`🍜 *KATALOG MENU*

Silahkan Buka link untuk Melihat katalog
https://wa.me/c/6285832852878

Ketik *"PO"*, *"PESAN"* Untuk Melanjutkan List Pesanan ‼️‼️`
        })
        return
    }

    if(askOngkir){
        await sock.sendMessage(from,{
            text:`🚚 ONGKIR :

- Batam Center / Botania / Bengkong: 10k
- Di luar Batam Center: 13k

Ketik *"PO"*, *"PESAN"* Untuk Melanjutkan List Pesanan ‼️‼️`
        })
        return
    }

    if(askPengantaran){
        await sock.sendMessage(from,{
            text:`🚚 PENGANTARAN :

Mulai Jam 2 siang sampai selesai yaa kaa.

Ketik *"PO"*, *"PESAN"* Untuk Melanjutkan List Pesanan ‼️‼️`
        })
        return
    }

    if(askPO){
        addToQueue(sender)
        await sock.sendMessage(from,{
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

    // ================= PREFIX COMMAND =================
    if(text.startsWith(PREFIX)){
        const command = text.slice(1)
        if(command==="jid"){
            await sock.sendMessage(from,{
                text:`JID: ${chatMetadata.id}`
            })
        }
    }
}
