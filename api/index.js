const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');

const app = express();

app.use(cors());
app.use(express.json());

const MONGODB_URI = process.env.MONGODB_URI || "mongodb+srv://leungtm13_db_user:s9ohdoPosz4xc4GM@cluster0.q0ca3wp.mongodb.net/buddhist_counter?retryWrites=true&w=majority";

// Connection caching for Vercel Serverless Function
let cachedDb = null;

async function connectToDatabase() {
    if (cachedDb && mongoose.connection.readyState === 1) {
        return cachedDb;
    }
    
    mongoose.set('strictQuery', false);
    
    cachedDb = await mongoose.connect(MONGODB_URI, {
        serverSelectionTimeoutMS: 5000,
        bufferCommands: false
    });
    return cachedDb;
}

// Middleware to ensure DB connection
app.use(async (req, res, next) => {
    try {
        await connectToDatabase();
        next();
    } catch (error) {
        console.error('MongoDB Connection Error:', error);
        res.status(500).json({ success: false, error: 'Database connection failed: ' + error.message });
    }
});

// Schema Definitions
const UserSchema = new mongoose.Schema({
    userId: { type: String, required: true, unique: true },
    name: { type: String, required: true },
    counts: {
        jingang: { type: Number, default: 0 },
        dizang_shang: { type: Number, default: 0 },
        dizang_zhong: { type: Number, default: 0 },
        dizang_xia: { type: Number, default: 0 },
        dizang_full: { type: Number, default: 0 }
    },
    targets: {
        jingang: { type: Number, default: 108 },
        dizang_full: { type: Number, default: 100 }
    }
}, { timestamps: true });

const RecitationLogSchema = new mongoose.Schema({
    userId: { type: String, required: true },
    userName: { type: String, required: true },
    scriptureId: { type: String, required: true },
    scriptureName: { type: String, required: true },
    count: { type: Number, required: true },
    note: { type: String, default: '' },
    timestamp: { type: Date, default: Date.now }
});

const User = mongoose.models.User || mongoose.model('User', UserSchema);
const RecitationLog = mongoose.models.RecitationLog || mongoose.model('RecitationLog', RecitationLogSchema);

const SCRIPTURE_NAMES = {
    jingang: '金剛經',
    dizang_shang: '地藏菩薩本願經 上卷',
    dizang_zhong: '地藏菩薩本願經 中卷',
    dizang_xia: '地藏菩薩本願經 下卷',
    dizang_full: '地藏經 完整部數'
};

async function ensureDefaultUsers() {
    const count = await User.countDocuments();
    if (count === 0) {
        await User.create([
            { userId: 'dicky', name: 'Dicky' },
            { userId: 'hannah', name: 'Hannah' }
        ]);
    }
}

async function processAutoCarryOver(userDoc) {
    let carryCount = 0;
    while (
        userDoc.counts.dizang_shang >= 1 &&
        userDoc.counts.dizang_zhong >= 1 &&
        userDoc.counts.dizang_xia >= 1
    ) {
        userDoc.counts.dizang_shang -= 1;
        userDoc.counts.dizang_zhong -= 1;
        userDoc.counts.dizang_xia -= 1;
        userDoc.counts.dizang_full += 1;
        carryCount++;
    }

    if (carryCount > 0) {
        await userDoc.save();
        await RecitationLog.create({
            userId: userDoc.userId,
            userName: userDoc.name,
            scriptureId: 'dizang_full',
            scriptureName: SCRIPTURE_NAMES.dizang_full,
            count: carryCount,
            note: '🎉 上中下卷集齊，自動進位 +1 部地藏經！',
            timestamp: new Date()
        });
    }
}

async function getFullAppState() {
    await ensureDefaultUsers();
    
    const users = await User.find({});
    const logs = await RecitationLog.find({}).sort({ timestamp: -1 }).limit(30);

    const profiles = {
        dicky: { name: 'Dicky', jingang: 0, dizang_shang: 0, dizang_zhong: 0, dizang_xia: 0, dizang_full: 0 },
        hannah: { name: 'Hannah', jingang: 0, dizang_shang: 0, dizang_zhong: 0, dizang_xia: 0, dizang_full: 0 }
    };

    let targets = { jingang: 108, dizang_full: 100 };

    users.forEach(u => {
        if (profiles[u.userId]) {
            profiles[u.userId] = {
                name: u.name,
                ...u.counts.toObject()
            };
            if (u.targets) {
                targets = u.targets;
            }
        }
    });

    const formattedLogs = logs.map(l => ({
        id: l._id,
        userId: l.userId,
        userName: l.userName,
        scriptureId: l.scriptureId,
        scriptureName: l.scriptureName,
        count: l.count,
        note: l.note,
        timestamp: new Date(l.timestamp).toLocaleString('zh-TW', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })
    }));

    return { profiles, targets, logs: formattedLogs };
}

// API Routes
app.get('/api/state', async (req, res) => {
    try {
        const state = await getFullAppState();
        res.json({ success: true, data: state });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

app.post('/api/tap', async (req, res) => {
    try {
        const { userId, scriptureId, count = 1 } = req.body;
        
        let user = await User.findOne({ userId });
        if (!user) {
            user = await User.create({ userId, name: userId === 'dicky' ? 'Dicky' : 'Hannah' });
        }

        if (user.counts[scriptureId] !== undefined) {
            user.counts[scriptureId] += count;
            await user.save();

            await RecitationLog.create({
                userId: user.userId,
                userName: user.name,
                scriptureId: scriptureId,
                scriptureName: SCRIPTURE_NAMES[scriptureId] || scriptureId,
                count: count,
                timestamp: new Date()
            });

            await processAutoCarryOver(user);
        }

        const updatedState = await getFullAppState();
        res.json({ success: true, data: updatedState });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

app.post('/api/manual', async (req, res) => {
    try {
        const { userId, scriptureId, count, note } = req.body;
        
        let user = await User.findOne({ userId });
        if (!user) {
            user = await User.create({ userId, name: userId === 'dicky' ? 'Dicky' : 'Hannah' });
        }

        const incCount = parseInt(count) || 1;
        if (user.counts[scriptureId] !== undefined) {
            user.counts[scriptureId] += incCount;
            await user.save();

            await RecitationLog.create({
                userId: user.userId,
                userName: user.name,
                scriptureId: scriptureId,
                scriptureName: SCRIPTURE_NAMES[scriptureId] || scriptureId,
                count: incCount,
                note: note || '手動補錄',
                timestamp: new Date()
            });

            await processAutoCarryOver(user);
        }

        const updatedState = await getFullAppState();
        res.json({ success: true, data: updatedState });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

app.post('/api/targets', async (req, res) => {
    try {
        const { jingang, dizang_full } = req.body;
        
        await User.updateMany({}, {
            $set: {
                'targets.jingang': parseInt(jingang) || 108,
                'targets.dizang_full': parseInt(dizang_full) || 100
            }
        });

        const updatedState = await getFullAppState();
        res.json({ success: true, data: updatedState });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

app.delete('/api/logs', async (req, res) => {
    try {
        await RecitationLog.deleteMany({});
        const updatedState = await getFullAppState();
        res.json({ success: true, data: updatedState });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

module.exports = app;
