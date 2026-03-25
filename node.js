// server.js - Express Backend
const express = require('express');
const cors = require('cors');
const admin = require('firebase-admin');
const app = express();

app.use(cors());
app.use(express.json());

// Initialize Firebase Admin
admin.initializeApp({
    credential: admin.credential.applicationDefault(),
    projectId: 'crunck-app'
});

const db = admin.firestore();

// ===================== AUTH MIDDLEWARE =====================
async function authenticate(req, res, next) {
    const token = req.headers.authorization?.split('Bearer ')[1];
    if (!token) {
        return res.status(401).json({ error: 'Unauthorized' });
    }
    
    try {
        const decodedToken = await admin.auth().verifyIdToken(token);
        req.user = decodedToken;
        next();
    } catch (error) {
        res.status(401).json({ error: 'Invalid token' });
    }
}

// ===================== USER ROUTES =====================
app.get('/api/users/:userId', authenticate, async (req, res) => {
    try {
        const userDoc = await db.collection('users').doc(req.params.userId).get();
        if (!userDoc.exists) {
            return res.status(404).json({ error: 'User not found' });
        }
        res.json({ id: userDoc.id, ...userDoc.data() });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.put('/api/users/:userId', authenticate, async (req, res) => {
    try {
        if (req.params.userId !== req.user.uid) {
            return res.status(403).json({ error: 'Forbidden' });
        }
        
        await db.collection('users').doc(req.params.userId).update({
            ...req.body,
            updatedAt: admin.firestore.FieldValue.serverTimestamp()
        });
        
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// ===================== COIN ROUTES =====================
app.get('/api/coins/:userId', authenticate, async (req, res) => {
    try {
        if (req.params.userId !== req.user.uid) {
            return res.status(403).json({ error: 'Forbidden' });
        }
        
        const coinDoc = await db.collection('userCoins').doc(req.params.userId).get();
        const balance = coinDoc.exists ? coinDoc.data().balance : 100;
        
        res.json({ balance });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.post('/api/coins/:userId/claim', authenticate, async (req, res) => {
    try {
        if (req.params.userId !== req.user.uid) {
            return res.status(403).json({ error: 'Forbidden' });
        }
        
        // Check last claim
        const claimDoc = await db.collection('dailyClaims').doc(req.params.userId).get();
        const lastClaim = claimDoc.exists ? claimDoc.data().lastClaim.toDate() : null;
        
        if (lastClaim && (Date.now() - lastClaim.getTime()) < 24 * 60 * 60 * 1000) {
            return res.status(400).json({ error: 'Already claimed today' });
        }
        
        // Add coins
        const coinRef = db.collection('userCoins').doc(req.params.userId);
        const coinDoc = await coinRef.get();
        const currentBalance = coinDoc.exists ? coinDoc.data().balance : 100;
        
        await coinRef.set({
            balance: currentBalance + 10,
            totalEarned: admin.firestore.FieldValue.increment(10),
            updatedAt: admin.firestore.FieldValue.serverTimestamp()
        }, { merge: true });
        
        // Record claim
        await db.collection('dailyClaims').doc(req.params.userId).set({
            userId: req.params.userId,
            lastClaim: admin.firestore.FieldValue.serverTimestamp(),
            amount: 10
        });
        
        // Record transaction
        await db.collection('transactions').add({
            userId: req.params.userId,
            amount: 10,
            type: 'earn',
            reason: 'daily_reward',
            timestamp: admin.firestore.FieldValue.serverTimestamp()
        });
        
        res.json({ success: true, amount: 10, newBalance: currentBalance + 10 });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// ===================== LEAGUE ROUTES =====================
app.get('/api/leagues', authenticate, async (req, res) => {
    try {
        let query = db.collection('leagues').orderBy('createdAt', 'desc');
        
        if (req.query.status) {
            query = query.where('status', '==', req.query.status);
        }
        
        const snapshot = await query.get();
        const leagues = [];
        snapshot.forEach(doc => {
            leagues.push({ id: doc.id, ...doc.data() });
        });
        
        res.json(leagues);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.get('/api/leagues/:leagueId', authenticate, async (req, res) => {
    try {
        const leagueDoc = await db.collection('leagues').doc(req.params.leagueId).get();
        if (!leagueDoc.exists) {
            return res.status(404).json({ error: 'League not found' });
        }
        
        res.json({ id: leagueDoc.id, ...leagueDoc.data() });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.post('/api/leagues', authenticate, async (req, res) => {
    try {
        const leagueData = {
            ...req.body,
            ownerId: req.user.uid,
            ownerName: req.body.ownerName || req.user.displayName,
            createdAt: admin.firestore.FieldValue.serverTimestamp(),
            status: 'registration',
            teams: [],
            matches: [],
            pendingRequests: []
        };
        
        const docRef = await db.collection('leagues').add(leagueData);
        res.json({ id: docRef.id, ...leagueData });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.post('/api/leagues/:leagueId/join', authenticate, async (req, res) => {
    try {
        const leagueRef = db.collection('leagues').doc(req.params.leagueId);
        const leagueDoc = await leagueRef.get();
        
        if (!leagueDoc.exists) {
            return res.status(404).json({ error: 'League not found' });
        }
        
        const league = leagueDoc.data();
        
        // Check if already joined
        if (league.teams?.some(t => t.ownerId === req.user.uid)) {
            return res.status(400).json({ error: 'Already joined' });
        }
        
        // Check if league is full
        if (league.teams?.length >= league.maxTeams) {
            return res.status(400).json({ error: 'League is full' });
        }
        
        // Check entry fee
        const coinDoc = await db.collection('userCoins').doc(req.user.uid).get();
        const userCoins = coinDoc.exists ? coinDoc.data().balance : 100;
        
        if (userCoins < league.entryFee) {
            return res.status(400).json({ error: 'Insufficient coins' });
        }
        
        // Deduct coins
        await db.collection('userCoins').doc(req.user.uid).set({
            balance: userCoins - league.entryFee,
            totalSpent: admin.firestore.FieldValue.increment(league.entryFee),
            updatedAt: admin.firestore.FieldValue.serverTimestamp()
        }, { merge: true });
        
        // Add team to league
        const newTeam = {
            id: `team_${Date.now()}`,
            name: `${req.body.teamName || req.user.displayName}'s Team`,
            ownerId: req.user.uid,
            ownerName: req.user.displayName,
            logo: req.user.photoURL,
            joinedAt: new Date().toISOString()
        };
        
        await leagueRef.update({
            teams: admin.firestore.FieldValue.arrayUnion(newTeam)
        });
        
        res.json({ success: true, team: newTeam });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// ===================== START SERVER =====================
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
