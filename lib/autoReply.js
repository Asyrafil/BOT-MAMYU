import fs from "fs"
import path from "path"
import afterPO from "./afterpo.js"
import { safeSend } from "./selfHeal.js"
import { BOT_STATUS } from "../index.js"





const DB_FILE = path.join("./db.json")
const PO_DB_FILE = path.join("./po.json")
const FORWARD_MAP_FILE = path.join("./forwardMap.json")


const OWNER_GROUP_ID = "120363424315515183@g.us"


// ================= LOAD SAVE =================

function loadPO(){
    if(!fs.existsSync(PO_DB_FILE)) return []
    return JSON.parse(fs.readFileSync(PO_DB_FILE))
}

function savePO(data){
    fs.writeFileSync(PO_DB_FILE,JSON.stringify(data,null,2))
}

let poCompleted = new Set(loadPO())

function loadDB(){
    if(!fs.existsSync(DB_FILE)) return {queue:[],poList:[]}
    return JSON.parse(fs.readFileSync(DB_FILE))
}

function saveDB(db){
    fs.writeFileSync(DB_FILE,JSON.stringify(db,null,2))
}

function addToQueue(number){
    const db=loadDB()
    if(!db.queue.includes(number)){
        db.queue.push(number)
        saveDB(db)
    }
}

function removeFromQueue(number){
    const db=loadDB()
    db.queue=db.queue.filter(x=>x!==number)
    saveDB(db)
}

function isInQueue(number){
    return loadDB().queue.includes(number)
}

function getNumberFromJid(jid){
    return jid.split("@")[0]
}

function loadForwardMap(){
    if(!fs.existsSync(FORWARD_MAP_FILE)) return {}
    return JSON.parse(fs.readFileSync(FORWARD_MAP_FILE))
}

function saveForward(messageId, number){

    const map = loadForwardMap()

    map[messageId] = number

    fs.writeFileSync(FORWARD_MAP_FILE, JSON.stringify(map,null,2))
}


// ================= PARSE FORM =================

function parseForm(text){

    const lines=text.split("\n")

    let nama=null
    let alamat=null
    let hp=null
    let porsi=[]
    let capturePorsi=false

    for(const raw of lines){

        const line=raw.trim()
        const lower=line.toLowerCase()

        if(lower.startsWith("nama")){
            nama=line.split(":").slice(1).join(":").trim()
            continue
        }

        if(lower.startsWith("alamat")){
            alamat=line.split(":").slice(1).join(":").trim()
            continue
        }

        if(lower.includes("hp")){
            hp=line.split(":").slice(1).join(":").trim()
            continue
        }

        if(lower.includes("pesan berapa porsi")){

            const after=line.split(":").slice(1).join(":").trim()
            if(after) porsi.push(after)

            capturePorsi=true
            continue
        }

        if(capturePorsi){
            if(!line) continue
            if(lower.includes("ongkir")) break
            porsi.push(line)
        }
    }

    return{
        nama,
        alamat,
        hp,
        porsi:porsi.join("\n")
    }
}

// ================= AUTO REPLY =================

export default async function(sock,from,text,chatMetadata){
    const msg = chatMetadata?.msgObj

// detect admin reply di group
if(from === OWNER_GROUP_ID && msg){
    const handled = await handleAdminReply(sock, msg)
    if(handled) return
}


    if(!text) return

    const originalText=text
    const senderJid=chatMetadata?.participant || from
    const senderNumber=getNumberFromJid(senderJid)
    const lower=text.toLowerCase().trim()

    // ================= STATUS COMMAND =================

if(lower === "!status"){

    const uptimeMs = Date.now() - BOT_STATUS.startTime

    const seconds = Math.floor((uptimeMs/1000)%60)
    const minutes = Math.floor((uptimeMs/1000/60)%60)
    const hours = Math.floor((uptimeMs/1000/60/60))

    const memory = process.memoryUsage()

    const startPing = Date.now()

    const msg = await sock.sendMessage(from,{
        text:`⌛ Checking latency...`
    })

    BOT_STATUS.lastPing = Date.now() - startPing

    await sock.sendMessage(from,{
        text:`⚡ Ping: ${BOT_STATUS.lastPing} ms 

🤖 *STATUS BOT REALTIME*

🟢 Status: ${BOT_STATUS.connected ? "ONLINE" : "OFFLINE"}
📡 Mode Pairing: ${BOT_STATUS.connected ? "NO" : "YES"}

⏱️ Uptime:
${hours} jam ${minutes} menit ${seconds} detik

⚡ RAM Usage:
${Math.round(memory.rss/1024/1024)} MB

🚀 Version:
${BOT_STATUS.version}
`
        ,
        edit: msg.key
    })

    return
}


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
    const poKeywords = ["po","pesan","mau po"]

    const askMenu = menuKeywords.some(k=>lower.includes(k))
    const askOngkir = ongkirKeywords.some(k=>lower.includes(k))
    const askPengantaran = pengantaranKeywords.some(k=>lower.includes(k))
    const askPO = poKeywords.includes(lower)

    // ================= PROSES FORM =================

    if(isInQueue(senderNumber)){

        const form=parseForm(originalText)

        if(!form.nama || !form.alamat || !form.hp || !form.porsi){

            await sock.sendMessage(from,{
                text:`⚠️ Format belum lengkap

Nama:
Alamat:
No. HP:
Pesan berapa porsi:
- contoh item`
            })
            return
        }

        const waNumber = senderNumber

        const poText=`📌 *PO BARU*

👤 https://wa.me/${waNumber}

${originalText}`

        try{

            const sentMsg = await safeSend(sock, OWNER_GROUP_ID,{text:poText})


// simpan relasi messageID dengan nomor customer
if(sentMsg?.key?.id){
    saveForward(sentMsg.key.id, waNumber)
}


            await sock.sendMessage(from,{
                text:`✅ Order berhasil dikirim ke admin 😊`
            })

            poCompleted.add(waNumber)
            savePO([...poCompleted])

            const db=loadDB()

            db.poList.push({
                nama:form.nama,
                alamat:form.alamat,
                hp:waNumber,
                porsi:form.porsi,
                timestamp:new Date().toISOString()
            })

            saveDB(db)

        }catch(err){
            console.log("ERROR:",err)
        }

        removeFromQueue(senderNumber)
        return
    }

    // ================= START PO =================

    if(askPO){

        if(poCompleted.has(senderNumber)) return

        addToQueue(senderNumber)

        await sock.sendMessage(from,{
            text:`Hai Kak👋🏻
Yuk lengkapi data orderannya di
Mamyu.bykar ya 💕

Nama:
Alamat:
No. HP:
Pesan berapa porsi:
- item

🚚 Ongkir:
- Batam Center / Botania / Bengkong: 10k
- Diluar Batam center: 13k`
        })
        return
    }

    // ================= AFTER PO MODE =================

    if(poCompleted.has(senderNumber)){

    const handled = await afterPO(sock, from, lower)

    // 🔥 STOP semua flow lain
    if(handled) return
}


    // ================= NATURAL CHAT =================

    // ================= AUTO GREETING CUSTOMER BARU =================

// pastikan db ada
if(!global.userDB) global.userDB = new Set()

// ambil id user
const userId = sender

// jika user belum pernah chat
if(!global.userDB.has(userId)){

    // simpan user
    global.userDB.add(userId)

    await sock.sendMessage(from,{
        text:`Halo kak 👋

Selamat datang di Mamyu.bykar🥰
Silahkan ketik *menu* untuk melihat katalog yaa`
    })

    return
}


    if(askMenu){
        await sock.sendMessage(from,{
            image: fs.readFileSync("./mamyu.png"),
            caption:`🍜 *KATALOG MENU*

https://wa.me/c/6285832852878

Ketik *PO* untuk order`
        })
        return
    }

    if(askOngkir){
        await sock.sendMessage(from,{
            text:`🚚 ONGKIR :

- Batam Center / Botania / Bengkong: 10k
- Di luar Batam Center: 13k`
        })
        return
    }

    if(askPengantaran){
        await sock.sendMessage(from,{
            text:`🚚 PENGANTARAN :

Mulai Jam 2 siang sampai selesai yaa kaa.`
        })
        return
    }
    

}
