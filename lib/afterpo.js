export default async function afterPO(sock, from, lower){

    // ================= MENU =================
    if(lower.includes("menu")){
        await sock.sendMessage(from,{
            text:`🍜 *KATALOG MENU*

https://wa.me/c/6285832852878

Ketik *PO* untuk order`
        })
        return true
    }

    // ================= ONGKIR =================
    if(lower.includes("ongkir")){
        await sock.sendMessage(from,{
            text:`🚚 Ongkir:
- Batam Center / Botania / Bengkong: 10k
- Luar area: 13k`
        })
        return true
    }

    // ================= PENGIRIMAN =================
    if(lower.includes("pengantaran")){
        await sock.sendMessage(from,{
            text:`🚚 PENGANTARAN :

Mulai Jam 2 siang sampai selesai yaa kaa.`
        })
        return true
    }

    // jika tidak ada keyword cocok
    return false
}
