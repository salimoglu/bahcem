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

    const usersSnap = await db.collection("users").get();
    console.log(`Kullanıcı sayısı: ${usersSnap.size}`);

    for (const userDoc of usersSnap.docs) {
      const uid = userDoc.id;
      console.log(`Kullanıcı: ${uid}`);

      const tokenDoc = await db.collection("users").doc(uid)
        .collection("settings").doc("fcm").get();
      
      if (!tokenDoc.exists) {
        console.log(`${uid}: FCM token yok`);
        continue;
      }
      const token = tokenDoc.data().token;
      console.log(`${uid}: Token var`);

      const gardensSnap = await db.collection("users").doc(uid).collection("gardens").get();
      console.log(`${uid}: ${gardensSnap.size} bahçe`);

      const overdueAll = [];

      for (const gardenDoc of gardensSnap.docs) {
        const g = gardenDoc.data();
        console.log(`Bahçe: ${g.name}, notifOn: ${g.notifOn}, notifHour: ${g.notifHour}`);

        if (!g.notifOn) { console.log("Bildirim kapalı, atlandı"); continue; }
        
        const gardenHour = g.notifHour ?? 8;
        if (gardenHour !== currentHour) {
          console.log(`Saat uyuşmuyor: bahçe=${gardenHour}, şu an=${currentHour}`);
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
            overdueAll.push({ name: p.nameTr || "Bitki", late: Math.abs(diffDays) });
          }
        }
      }

      console.log(`${uid}: ${overdueAll.length} sulanmamış bitki`);
      if (overdueAll.length === 0) continue;

      const count = overdueAll.length;
      const body = count === 1
        ? (overdueAll[0].late === 0 ? `${overdueAll[0].name} bugün sulanmalı 💧` : `${overdueAll[0].name} ${overdueAll[0].late} gündür sulanmadı 💧`)
        : `${overdueAll.slice(0,2).map(p=>p.name).join(", ")}${count>2?` +${count-2}`:""} sulama bekliyor 💧`;

      try {
        await fcm.send({
          token,
          notification: { title: "🌿 Bahçem — Sulama Zamanı", body },
          webpush: {
            notification: {
              icon: "https://salimoglu.github.io/bahcem/icons/icon-192.png",
              badge: "https://salimoglu.github.io/bahcem/icons/icon-192.png",
              requireInteraction: true,
              tag: "bahcem-water"
            },
            fcmOptions: { link: "https://salimoglu.github.io/bahcem/" }
          }
        });
        console.log(`✓ Bildirim gönderildi: ${uid}`);
      } catch (err) {
        console.error(`✗ FCM hatası: ${err.message}`);
        if (err.code === "messaging/registration-token-not-registered") {
          await db.collection("users").doc(uid).collection("settings").doc("fcm").delete();
        }
      }
    }
    console.log("Tamamlandı");
  }
);
