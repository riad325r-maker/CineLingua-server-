const express = require('express');
const cors = require('cors');
const { initializeApp, cert } = require('firebase-admin/app');
const { getMessaging } = require('firebase-admin/messaging');
const { getFirestore } = require('firebase-admin/firestore');

const app = express();
app.use(cors({ origin: '*' }));
app.use(express.json());

// ===== تهيئة Firebase Admin =====
const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);

initializeApp({
    credential: cert(serviceAccount),
    projectId: 'cinelingua-32f98'
});

const db = getFirestore();
const messaging = getMessaging();

// ===== حماية بسيطة بكلمة مرور =====
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'cinelingua2026';

function checkAuth(req, res, next) {
    const pass = req.headers['x-admin-password'];
    if (pass !== ADMIN_PASSWORD) {
        return res.status(401).json({ error: 'غير مصرح' });
    }
    next();
}

// ===== جلب عدد المشتركين =====
app.get('/subscribers', checkAuth, async (req, res) => {
    try {
        const snap = await db.collection('fcm_tokens').get();
        const tokens = [];
        snap.forEach(doc => {
            const data = doc.data();
            if (data.token) tokens.push({ token: data.token, platform: data.platform || 'unknown' });
        });
        res.json({ count: tokens.length, tokens });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// ===== إرسال إشعار للجميع =====
app.post('/send', checkAuth, async (req, res) => {
    const { title, body, url, type, icon } = req.body;

    if (!title || !body) {
        return res.status(400).json({ error: 'العنوان والنص مطلوبان' });
    }

    try {
        // جلب كل الـ tokens من Firestore
        const snap = await db.collection('fcm_tokens').get();
        const tokens = [];
        snap.forEach(doc => {
            const data = doc.data();
            if (data.token) tokens.push(data.token);
        });

        if (tokens.length === 0) {
            return res.json({ success: 0, fail: 0, message: 'لا يوجد مشتركون بعد' });
        }

        // إرسال على دفعات (FCM يقبل 500 في المرة)
        let successCount = 0;
        let failCount = 0;
        const chunks = [];
        for (let i = 0; i < tokens.length; i += 500) {
            chunks.push(tokens.slice(i, i + 500));
        }

        for (const chunk of chunks) {
            const message = {
                tokens: chunk,
                notification: {
                    title,
                    body,
                    imageUrl: icon || 'https://i.postimg.cc/J4xdc62M/20260305-233826.png'
                },
                webpush: {
                    notification: {
                        icon: icon || 'https://i.postimg.cc/J4xdc62M/20260305-233826.png',
                        badge: 'https://i.postimg.cc/J4xdc62M/20260305-233826.png',
                        click_action: url || 'https://riad325r-maker.github.io/cine-lingua.-/'
                    },
                    fcmOptions: {
                        link: url || 'https://riad325r-maker.github.io/cine-lingua.-/'
                    }
                },
                data: {
                    type: type || 'general',
                    url: url || 'https://riad325r-maker.github.io/cine-lingua.-/'
                }
            };

            const response = await messaging.sendEachForMulticast(message);
            successCount += response.successCount;
            failCount += response.failureCount;

            // حذف الـ tokens الباطلة من Firestore
            const failedTokens = [];
            response.responses.forEach((resp, idx) => {
                if (!resp.success) {
                    const err = resp.error?.code;
                    if (err === 'messaging/invalid-registration-token' ||
                        err === 'messaging/registration-token-not-registered') {
                        failedTokens.push(chunk[idx]);
                    }
                }
            });

            // حذف الـ tokens الباطلة
            for (const token of failedTokens) {
                await db.collection('fcm_tokens').doc(token).delete();
            }
        }

        res.json({
            success: successCount,
            fail: failCount,
            total: tokens.length,
            message: `✅ تم الإرسال لـ ${successCount} مستخدم`
        });

    } catch (e) {
        console.error(e);
        res.status(500).json({ error: e.message });
    }
});

// ===== تأكد السيرفر شغال =====
app.get('/', (req, res) => {
    res.json({ status: '✅ CineLingua Notifications Server', version: '1.0.0' });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));
