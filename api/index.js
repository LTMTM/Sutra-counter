const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(express.json());

const MONGODB_URI = process.env.MONGODB_URI || "mongodb+srv://leungtm13_db_user:s9ohdoPosz4xc4GM@cluster0.q0ca3wp.mongodb.net/buddhist_counter?retryWrites=true&w=majority";

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

// Schema definition
const CounterSchema = new mongoose.Schema({
    key: { type: String, default: 'main_state', unique: true },
    counts: {
        Dicky: {
            金剛經: { type: Number, default: 0 },
            地藏經上: { type: Number, default: 0 },
            地藏經中: { type: Number, default: 0 },
            地藏經下: { type: Number, default: 0 },
            地藏經完整部數: { type: Number, default: 0 }
        },
        Hannah: {
            金剛經: { type: Number, default: 0 },
            地藏經上: { type: Number, default: 0 },
            地藏經中: { type: Number, default: 0 },
            地藏經下: { type: Number, default: 0 },
            地藏經完整部數: { type: Number, default: 0 }
        }
    },
    logs: [{
        user: String,
        sutra: String,
        amount: Number,
        timestamp: { type: Date, default: Date.now }
    }]
});

const CounterModel = mongoose.models.Counter || mongoose.model('Counter', CounterSchema);

async function getOrCreateState() {
    let doc = await CounterModel.findOne({ key: 'main_state' });
    if (!doc) {
        doc = await CounterModel.create({
            key: 'main_state',
            counts: {
                Dicky: { 金剛經: 0, 地藏經上: 0, 地藏經中: 0, 地藏經下: 0, 地藏經完整部數: 0 },
                Hannah: { 金剛經: 0, 地藏經上: 0, 地藏經中: 0, 地藏經下: 0, 地藏經完整部數: 0 }
            },
            logs: []
        });
    }
    return doc;
}

// Ignore favicon
app.get('/favicon.ico', (req, res) => res.status(204).end());
app.get('/favicon.png', (req, res) => res.status(204).end());

// API Routes
app.get(['/api/state', '/state'], async (req, res) => {
    try {
        await connectToDatabase();
        const doc = await getOrCreateState();
        res.json({ counts: doc.counts, logs: doc.logs.slice(-15).reverse() });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post(['/api/increment', '/increment'], async (req, res) => {
    try {
        await connectToDatabase();
        const { user, sutra, amount = 1 } = req.body;
        
        if (!['Dicky', 'Hannah'].includes(user)) {
            return res.status(400).json({ error: 'Invalid user' });
        }

        const doc = await getOrCreateState();
        
        // 1. Increment specific sutra for specific user
        doc.counts[user][sutra] = (doc.counts[user][sutra] || 0) + amount;

        // 2. Individual Ksitigarbha Auto Carry Logic (Each user calculated independently)
        const userData = doc.counts[user];
        if (userData.地藏經上 >= 1 && userData.地藏經中 >= 1 && userData.地藏經下 >= 1) {
            const minComplete = Math.min(userData.地藏經上, userData.地藏經中, userData.地藏經下);
            userData.地藏經上 -= minComplete;
            userData.地藏經中 -= minComplete;
            userData.地藏經下 -= minComplete;
            userData.地藏經完整部數 = (userData.地藏經完整部數 || 0) + minComplete;

            doc.logs.push({
                user,
                sutra: '地藏菩薩本願經 (完整一部)',
                amount: minComplete,
                timestamp: new Date()
            });
        }

        doc.logs.push({ user, sutra, amount, timestamp: new Date() });
        doc.markModified('counts');
        await doc.save();

        res.json({ counts: doc.counts, logs: doc.logs.slice(-15).reverse() });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

module.exports = app;
