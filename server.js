// server.js - Veno-Arena Backend API
const express = require('express');
const cors = require('cors');
const admin = require('firebase-admin');
const path = require('path');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors({
    origin: ['http://localhost:5500', 'http://127.0.0.1:5500', 'https://rajola-ceo.github.io'],
    credentials: true
}));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Initialize Firebase Admin SDK
try {
    // For production on Render - use environment variables
    if (process.env.FIREBASE_PRIVATE_KEY) {
        admin.initializeApp({
            credential: admin.credential.cert({
                projectId: process.env.FIREBASE_PROJECT_ID,
                clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
                privateKey: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n')
            })
        });
    } else {
        // For local development - use service account file
        const serviceAccount = require('./serviceAccountKey.json');
        admin.initializeApp({
            credential: admin.credential.cert(serviceAccount)
        });
    }
    console.log('✅ Firebase Admin initialized');
} catch (error) {
    console.error('❌ Firebase Admin error:', error.message);
}

const db = admin.firestore();

// ===================== HEALTH CHECK =====================
app.get('/', (req, res) => {
    res.json({
        status: 'OK',
        message: 'Veno-Arena API is running',
        timestamp: new Date().toISOString(),
        endpoints: [
            '/api/users/:userId',
            '/api/coins/:userId',
            '/api/leagues',
            '/api/leagues/:leagueId',
            '/api/teams/:userId'
        ]
    });
});

// ===================== AUTH MIDDLEWARE =====================
async function authenticate(req, res, next) {
    const token = req.headers.authorization?.split('Bearer ')[1];
    if (!token) {
        return res.status(401).json({ error: 'Unauthorized - No token provided' });
    }
    
    try {
        const decodedToken = await admin.auth().verifyIdToken(token);
        req.user = decodedToken;
        next();
    } catch (error) {
        console.error('Auth error:', error);
        res.status(401).json({ error: 'Unauthorized - Invalid token' });
    }
}

// ===================== USER ROUTES =====================
// Get user profile
app.get('/api/users/:userId', authenticate, async (req, res) => {
    try {
        if (req.params.userId !== req.user.uid) {
            return res.status(403).json({ error: 'Forbidden' });
        }
        
        const userDoc = await db.collection('users').doc(req.params.userId).get();
        if (!userDoc.exists) {
            return res.status(404).json({ error: 'User not found' });
        }
        
        res.json({ id: userDoc.id, ...userDoc.data() });
    } catch (error) {
        console.error('Error getting user:', error);
        res.status(500).json({ error: error.message });
    }
});

// Create or update user profile
app.post('/api/users/:userId', authenticate, async (req, res) => {
    try {
        if (req.params.userId !== req.user.uid) {
            return res.status(403).json({ error: 'Forbidden' });
        }
        
        const userData = {
            ...req.body,
            uid: req.params.userId,
            updatedAt: admin.firestore.FieldValue.serverTimestamp()
        };
        
        await db.collection('users').doc(req.params.userId).set(userData, { merge: true });
        res.json({ success: true, user: userData });
    } catch (error) {
        console.error('Error creating user:', error);
        res.status(500).json({ error: error.message });
    }
});

// Update user profile
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
        console.error('Error updating user:', error);
        res.status(500).json({ error: error.message });
    }
});

// ===================== COIN ROUTES =====================
// Get user coins
app.get('/api/coins/:userId', authenticate, async (req, res) => {
    try {
        if (req.params.userId !== req.user.uid) {
            return res.status(403).json({ error: 'Forbidden' });
        }
        
        const coinDoc = await db.collection('userCoins').doc(req.params.userId).get();
        const balance = coinDoc.exists ? coinDoc.data().balance : 100;
        
        res.json({ balance });
    } catch (error) {
        console.error('Error getting coins:', error);
        res.status(500).json({ error: error.message });
    }
});

// Claim daily reward
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
        
        // Get current coins
        const coinDoc = await db.collection('userCoins').doc(req.params.userId).get();
        const currentBalance = coinDoc.exists ? coinDoc.data().balance : 100;
        const newBalance = currentBalance + 10;
        
        // Update coins
        await db.collection('userCoins').doc(req.params.userId).set({
            balance: newBalance,
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
        
        res.json({ success: true, amount: 10, newBalance });
    } catch (error) {
        console.error('Error claiming daily:', error);
        res.status(500).json({ error: error.message });
    }
});

// ===================== LEAGUE ROUTES =====================
// Get all leagues
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
        console.error('Error getting leagues:', error);
        res.status(500).json({ error: error.message });
    }
});

// Get single league
app.get('/api/leagues/:leagueId', authenticate, async (req, res) => {
    try {
        const leagueDoc = await db.collection('leagues').doc(req.params.leagueId).get();
        if (!leagueDoc.exists) {
            return res.status(404).json({ error: 'League not found' });
        }
        
        res.json({ id: leagueDoc.id, ...leagueDoc.data() });
    } catch (error) {
        console.error('Error getting league:', error);
        res.status(500).json({ error: error.message });
    }
});

// Create league
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
        console.error('Error creating league:', error);
        res.status(500).json({ error: error.message });
    }
});

// Join league
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
            return res.status(400).json({ error: 'Already joined this league' });
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
        
        // Record transaction
        await db.collection('transactions').add({
            userId: req.user.uid,
            amount: league.entryFee,
            type: 'spend',
            reason: 'join_league',
            leagueId: req.params.leagueId,
            timestamp: admin.firestore.FieldValue.serverTimestamp()
        });
        
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
        console.error('Error joining league:', error);
        res.status(500).json({ error: error.message });
    }
});

// Update league (for owner)
app.put('/api/leagues/:leagueId', authenticate, async (req, res) => {
    try {
        const leagueDoc = await db.collection('leagues').doc(req.params.leagueId).get();
        
        if (!leagueDoc.exists) {
            return res.status(404).json({ error: 'League not found' });
        }
        
        const league = leagueDoc.data();
        
        if (league.ownerId !== req.user.uid) {
            return res.status(403).json({ error: 'Only league owner can update' });
        }
        
        await db.collection('leagues').doc(req.params.leagueId).update({
            ...req.body,
            updatedAt: admin.firestore.FieldValue.serverTimestamp()
        });
        
        res.json({ success: true });
    } catch (error) {
        console.error('Error updating league:', error);
        res.status(500).json({ error: error.message });
    }
});

// ===================== TEAM ROUTES =====================
// Get user's teams
app.get('/api/teams/:userId', authenticate, async (req, res) => {
    try {
        if (req.params.userId !== req.user.uid) {
            return res.status(403).json({ error: 'Forbidden' });
        }
        
        const snapshot = await db.collection('teams')
            .where('ownerId', '==', req.params.userId)
            .orderBy('createdAt', 'desc')
            .get();
        
        const teams = [];
        snapshot.forEach(doc => {
            teams.push({ id: doc.id, ...doc.data() });
        });
        
        res.json(teams);
    } catch (error) {
        console.error('Error getting teams:', error);
        res.status(500).json({ error: error.message });
    }
});

// Create team
app.post('/api/teams', authenticate, async (req, res) => {
    try {
        const teamData = {
            ...req.body,
            ownerId: req.user.uid,
            ownerName: req.user.displayName,
            createdAt: admin.firestore.FieldValue.serverTimestamp(),
            stats: {
                wins: 0,
                draws: 0,
                losses: 0,
                matchesPlayed: 0,
                goalsFor: 0,
                goalsAgainst: 0
            }
        };
        
        const docRef = await db.collection('teams').add(teamData);
        res.json({ id: docRef.id, ...teamData });
    } catch (error) {
        console.error('Error creating team:', error);
        res.status(500).json({ error: error.message });
    }
});

// ===================== NOTIFICATION ROUTES =====================
// Get user's notifications
app.get('/api/notifications/:userId', authenticate, async (req, res) => {
    try {
        if (req.params.userId !== req.user.uid) {
            return res.status(403).json({ error: 'Forbidden' });
        }
        
        const snapshot = await db.collection('notifications')
            .where('userId', '==', req.params.userId)
            .orderBy('createdAt', 'desc')
            .limit(50)
            .get();
        
        const notifications = [];
        snapshot.forEach(doc => {
            notifications.push({ id: doc.id, ...doc.data() });
        });
        
        res.json(notifications);
    } catch (error) {
        console.error('Error getting notifications:', error);
        res.status(500).json({ error: error.message });
    }
});

// Mark notification as read
app.put('/api/notifications/:notificationId/read', authenticate, async (req, res) => {
    try {
        const notifDoc = await db.collection('notifications').doc(req.params.notificationId).get();
        
        if (!notifDoc.exists) {
            return res.status(404).json({ error: 'Notification not found' });
        }
        
        const notif = notifDoc.data();
        
        if (notif.userId !== req.user.uid) {
            return res.status(403).json({ error: 'Forbidden' });
        }
        
        await db.collection('notifications').doc(req.params.notificationId).update({
            read: true
        });
        
        res.json({ success: true });
    } catch (error) {
        console.error('Error marking notification read:', error);
        res.status(500).json({ error: error.message });
    }
});

// ===================== START SERVER =====================
app.listen(PORT, () => {
    console.log(`🚀 Server running on port ${PORT}`);
    console.log(`📍 Local: http://localhost:${PORT}`);
    console.log(`✅ Ready to accept requests`);
});
