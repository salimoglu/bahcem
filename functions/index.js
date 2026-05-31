const { onSchedule } = require("firebase-functions/v2/scheduler");
const { initializeApp }  = require("firebase-admin/app");
const { getFirestore }   = require("firebase-admin/firestore");
const { getMessaging }   = require("firebase-admin/messaging");

initializeApp();
const db  = getFirestore();
const fcm = getMessaging();

exports.sulamaKontrol = onSchedule(
  { schedule: "0 * * * *", timeZone: "Europe/Istanbul", region: "europe-west1" },
  async () => {
    const now = new Date(new Date().toLocaleString("en-US", { timeZone: "Europe/Istanbul" }));
    const currentHour = now.getHours();
    console.log(`Çalışıyor: saat ${currentHour}:00`);

    // fcm_tokens koleksiyonundan tüm tokenları oku
    const tokensSnap = await db.collection("fcm_tokens").get();
    console.log(`FCM token sayısı: ${tokensSnap.size}`);

    for (const tokenDoc of tokensSnap.docs) {
      const uid   = tokenDoc.data().uid;
      const token = tokenDoc.data().token;
      if (!token || !uid) continue;
      console.log(`Kullanıcı: ${uid}`);

      const gardensSnap = await db.collection("users").doc(uid).collection("gardens").get();
      console.log(`${uid}: ${gardensSnap.size} bahçe`);

      const overdueAll = [];

      for (const gardenDoc of gardensSnap.docs) {
        const g = gardenDoc.data();
        if (!g.notifOn) continue;

        const gardenHour = g.notifHour ?? 8;
        if (gardenHour !== currentHour) {
          console.log(`${g.name}: saat uyuşmuyor (${gardenHour} != ${currentHour})`);
          continue;
        }

        const plantsSnap = await db
          .collection("users").doc(uid)
          .collection("gardens").doc(gardenDoc.id)
          .collection("plants").get();

        for (const plantDoc of plantsSnap.docs) {
          const p = plantDoc.data();
          const days = Math.max(1, Number(p.wateringIntervalDays) || 7);
          const base = p.lastWateredAt
            ? new Date(p.lastWateredAt).getTime()
            : new Date(p.createdAt || Date.now()).getTime();
          const next = base + days * 86400000;
          const diffDays = Math.round((next - Date.now()) / 86400000);
          if (diffDays <= 0) {
            overdueAll.push({ name: p.nameTr || "Bitki", late: Math.abs(diffDays), gardenName: g.name || "Bahçe" });
          }
        }
      }

      console.log(`${uid}: ${overdueAll.length} sulanmamış bitki`);
      if (overdueAll.length === 0) continue;

      const count = overdueAll.length;
      // Bahçe bazında grupla
      const byGarden = {};
      for (const p of overdueAll) {
        if (!byGarden[p.gardenName]) byGarden[p.gardenName] = [];
        byGarden[p.gardenName].push(p);
      }
      const gardenNames = Object.keys(byGarden);
      let title, body;
      if (gardenNames.length === 1) {
        const gName = gardenNames[0];
        const plants = byGarden[gName];
        title = `🌿 ${gName} — Sulama Zamanı`;
        if (plants.length === 1) {
          body = plants[0].late === 0
            ? `${plants[0].name} bugün sulanmalı 💧`
            : `${plants[0].name} ${plants[0].late} gündür sulanmadı 💧`;
        } else {
          const names = plants.slice(0,2).map(p=>p.name).join(", ");
          const more  = plants.length > 2 ? ` +${plants.length-2} bitki` : "";
          body = `${names}${more} sulama bekliyor 💧`;
        }
      } else {
        title = "🌿 Bahçem — Sulama Zamanı";
        const parts = gardenNames.map(g => `${g}: ${byGarden[g].length} bitki`);
        body = parts.join(" • ") + " sulama bekliyor 💧";
      }

      try {
        await fcm.send({
          token,
          data: { title, body },
          webpush: {
            headers: { Urgency: "high" },
            fcmOptions: { link: "https://salimoglu.github.io/bahcem/" }
          }
        });
        console.log(`✓ Bildirim gönderildi: ${uid}`);
      } catch (err) {
        console.error(`✗ FCM hatası: ${err.message}`);
        if (err.code === "messaging/registration-token-not-registered") {
          await tokenDoc.ref.delete();
        }
      }
    }
    console.log("Tamamlandı");
  }
);
