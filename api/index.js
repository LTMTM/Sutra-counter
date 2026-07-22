const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(express.json());

// 建議部署時於環境變數設定 MONGODB_URI
const MONGODB_URI = process.env.MONGODB_URI || "mongodb+srv://leungtm13_db_user:s9ohdoPosz4xc4GM@cluster0.q0ca3wp.mongodb.net/buddhist_counter?retryWrites=true&w=majority";

// 全域連線快取 (相容 Vercel Serverless 與獨立 Node.js 伺服器)
let isConnected = false;

async function connectDB() {
    if (isConnected && mongoose.connection.readyState === 1) {
        return;
    }
    try {
        await mongoose.connect(MONGODB_URI, {
            serverSelectionTimeoutMS: 5000 // 設定 5 秒連線超時，避免 API 無限等待
        });
        isConnected = true;
        console.log("✅ Successfully connected to MongoDB Atlas!");
    } catch (err) {
        console.error("❌ MongoDB Connection Error:", err.message);
        throw new Error(`MongoDB 連線失敗: ${err.message}`);
    }
}

const LogSchema = new mongoose.Schema({
    id: Number,
    userId: String,
    userName: String,
    scriptureId: String,
    scriptureName: String,
    count: Number,
    note: String,
    timestamp: String
});

const ProfileSchema = new mongoose.Schema({
    name: String,
    jingang: { type: Number, default: 0 },
    dizang_shang: { type: Number, default: 0 },
    dizang_zhong: { type: Number, default: 0 },
    dizang_xia: { type: Number, default: 0 },
    dizang_full: { type: Number, default: 0 }
}, { _id: false });

const StateSchema = new mongoose.Schema({
    appId: { type: String, default: 'main_counter', unique: true },
    profiles: {
        dicky: { type: ProfileSchema, default: () => ({ name: 'Dicky' }) },
        hannah: { type: ProfileSchema, default: () => ({ name: 'Hannah' }) }
    },
    targets: {
        jingang: { type: Number, default: 108 },
        dizang_full: { type: Number, default: 100 }
    },
    logs: [LogSchema]
}, { timestamps: true });

const StateModel = mongoose.model('State', StateSchema);

const SCRIPTURE_NAMES = {
    jingang: '金剛經',
    dizang_shang: '地藏菩薩本願經 上卷',
    dizang_zhong: '地藏菩薩本願經 中卷',
    dizang_xia: '地藏菩薩本願經 下卷',
    dizang_full: '地藏經 完整部數'
};

async function getOrCreateState() {
    await connectDB(); // 確保每次請求前已成功建立連線
    let state = await StateModel.findOne({ appId: 'main_counter' });
    if (!state) {
        state = await StateModel.create({
            appId: 'main_counter',
            profiles: {
                dicky: { name: 'Dicky', jingang: 0, dizang_shang: 0, dizang_zhong: 0, dizang_xia: 0, dizang_full: 0 },
                hannah: { name: 'Hannah', jingang: 0, dizang_shang: 0, dizang_zhong: 0, dizang_xia: 0, dizang_full: 0 }
            },
            targets: { jingang: 108, dizang_full: 100 },
            logs: []
        });
    }
    return state;
}

function processAutoCarryOver(state, userId) {
    const profile = state.profiles[userId];
    if (!profile) return;

    let carryCount = 0;
    while (
        (profile.dizang_shang || 0) >= 1 &&
        (profile.dizang_zhong || 0) >= 1 &&
        (profile.dizang_xia || 0) >= 1
    ) {
        profile.dizang_shang -= 1;
        profile.dizang_zhong -= 1;
        profile.dizang_xia -= 1;
        profile.dizang_full = (profile.dizang_full || 0) + 1;
        carryCount++;
    }

    if (carryCount > 0) {
        state.logs.unshift({
            id: Date.now(),
            userId: userId,
            userName: profile.name,
            scriptureId: 'dizang_full',
            scriptureName: '地藏經 完整部數',
            count: carryCount,
            note: '🎉 上中下卷集齊，自動進位 +1 部完整地藏經！',
            timestamp: new Date().toLocaleString('zh-TW', { timeZone: 'Asia/Taipei', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })
        });
    }
}

app.get('/api/state', async (req, res) => {
    try {
        const state = await getOrCreateState();
        res.json({ success: true, data: state });
    } catch (err) {
        console.error("GET /api/state Error:", err);
        res.status(500).json({ success: false, error: err.message });
    }
});

app.post('/api/tap', async (req, res) => {
    try {
        const { userId, scriptureId, count = 1 } = req.body;
        const state = await getOrCreateState();

        if (!state.profiles[userId]) {
            return res.status(400).json({ success: false, error: "Invalid user ID" });
        }

        state.profiles[userId][scriptureId] = (state.profiles[userId][scriptureId] || 0) + count;

        const timeStr = new Date().toLocaleString('zh-TW', { timeZone: 'Asia/Taipei', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });
        
        state.logs.unshift({
            id: Date.now(),
            userId: userId,
            userName: state.profiles[userId].name,
            scriptureId: scriptureId,
            scriptureName: SCRIPTURE_NAMES[scriptureId] || scriptureId,
            count: count,
            timestamp: timeStr
        });

        processAutoCarryOver(state, userId);

        if (state.logs.length > 50) {
            state.logs = state.logs.slice(0, 50);
        }

        state.markModified('profiles');
        state.markModified('logs');
        await state.save();

        res.json({ success: true, data: state });
    } catch (err) {
        console.error("POST /api/tap Error:", err);
        res.status(500).json({ success: false, error: err.message });
    }
});

app.post('/api/manual', async (req, res) => {
    try {
        const { userId, scriptureId, count = 1, note = '' } = req.body;
        const state = await getOrCreateState();

        if (!state.profiles[userId]) {
            return res.status(400).json({ success: false, error: "Invalid user ID" });
        }

        state.profiles[userId][scriptureId] = (state.profiles[userId][scriptureId] || 0) + count;

        const timeStr = new Date().toLocaleString('zh-TW', { timeZone: 'Asia/Taipei', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });

        state.logs.unshift({
            id: Date.now(),
            userId: userId,
            userName: state.profiles[userId].name,
            scriptureId: scriptureId,
            scriptureName: SCRIPTURE_NAMES[scriptureId] || scriptureId,
            count: count,
            note: note || '手動補錄',
            timestamp: timeStr
        });

        processAutoCarryOver(state, userId);

        if (state.logs.length > 50) {
            state.logs = state.logs.slice(0, 50);
        }

        state.markModified('profiles');
        state.markModified('logs');
        await state.save();

        res.json({ success: true, data: state });
    } catch (err) {
        console.error("POST /api/manual Error:", err);
        res.status(500).json({ success: false, error: err.message });
    }
});

app.post('/api/targets', async (req, res) => {
    try {
        const { jingang, dizang_full } = req.body;
        const state = await getOrCreateState();

        if (jingang !== undefined) state.targets.jingang = jingang;
        if (dizang_full !== undefined) state.targets.dizang_full = dizang_full;

        state.markModified('targets');
        await state.save();

        res.json({ success: true, data: state });
    } catch (err) {
        console.error("POST /api/targets Error:", err);
        res.status(500).json({ success: false, error: err.message });
    }
});

app.delete('/api/logs', async (req, res) => {
    try {
        const state = await getOrCreateState();
        state.logs = [];
        state.markModified('logs');
        await state.save();

        res.json({ success: true, data: state });
    } catch (err) {
        console.error("DELETE /api/logs Error:", err);
        res.status(500).json({ success: false, error: err.message });
    }
});

const PORT = process.env.PORT || 3000;
if (process.env.NODE_ENV !== 'test') {
    app.listen(PORT, () => {
        console.log(`🚀 Buddhist Counter Server running on port ${PORT}`);
    });
}

module.exports = app;
