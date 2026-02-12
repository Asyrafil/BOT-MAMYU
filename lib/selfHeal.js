// ================= SELF HEAL SYSTEM =================

export async function safeSend(sock, jid, content){

    try{

        const result = await sock.sendMessage(jid, content)

        return result

    }catch(err){

        const msg = err?.message || ""

        // ================= FORBIDDEN GROUP =================
        if(msg.includes("forbidden") || err?.data === 403){

            console.log("🚨 SELF HEAL: Bot tidak punya akses ke group:", jid)

            return null
        }

        // ================= BAD MAC (SESSION ERROR) =================
        if(msg.includes("Bad MAC")){

            console.log("⚠️ SELF HEAL: Session corrupt detected")

            try{
                sock.ws.close()
            }catch{}

            return null
        }

        console.log("❌ SEND ERROR:", err)

        return null
    }
}
