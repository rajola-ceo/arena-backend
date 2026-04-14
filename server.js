// ============================================================
// CRUNK GAMES - server.js
// Node.js + Express + Socket.IO + MongoDB
// ============================================================
import express from 'express';
import http from 'http';
import { Server } from 'socket.io';
import mongoose from 'mongoose';
import cors from 'cors';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import * as svc from './services.js';

dotenv.config();
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*', methods: ['GET', 'POST', 'PUT', 'DELETE'] }
});

app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// ─── DB CONNECT ───────────────────────────────────────────────
mongoose.connect(process.env.MONGO_URI)
  .then(() => console.log('✅ MongoDB connected'))
  .catch(err => { console.error('❌ MongoDB error:', err); process.exit(1); });

// ─── AUTH ROUTES ──────────────────────────────────────────────
app.post('/api/auth/register', async (req, res) => {
  try {
    const result = await svc.registerUser(req.body);
    io.emit('leaderboard:update');
    res.json(result);
  } catch (e) { res.status(400).json({ error: e.message }); }
});

app.post('/api/auth/login', async (req, res) => {
  try {
    const result = await svc.loginUser(req.body);
    res.json(result);
  } catch (e) { res.status(401).json({ error: e.message }); }
});

// ─── USER ROUTES ──────────────────────────────────────────────
app.get('/api/users/me', svc.authMiddleware, async (req, res) => {
  try {
    const user = await svc.getMe(req.userId);
    res.json(user);
  } catch (e) { res.status(404).json({ error: e.message }); }
});

app.put('/api/users/me', svc.authMiddleware, async (req, res) => {
  try {
    const user = await svc.updateProfile(req.userId, req.body);
    io.emit('leaderboard:update');
    res.json(user);
  } catch (e) { res.status(400).json({ error: e.message }); }
});

app.get('/api/users', svc.authMiddleware, async (req, res) => {
  try {
    const users = await svc.getAllUsers(req.userId);
    res.json(users);
  } catch (e) { res.status(403).json({ error: e.message }); }
});

app.put('/api/users/:uid/ban', svc.authMiddleware, async (req, res) => {
  try {
    const result = await svc.toggleBan(req.userId, req.params.uid, req.body.ban);
    io.emit('user:updated', { uid: req.params.uid });
    res.json(result);
  } catch (e) { res.status(403).json({ error: e.message }); }
});

app.put('/api/users/:uid/admin', svc.authMiddleware, async (req, res) => {
  try {
    const result = await svc.toggleAdmin(req.userId, req.params.uid, req.body.isAdmin);
    io.emit('user:updated', { uid: req.params.uid });
    res.json(result);
  } catch (e) { res.status(403).json({ error: e.message }); }
});

app.post('/api/users/daily-bonus', svc.authMiddleware, async (req, res) => {
  try {
    const result = await svc.claimDailyBonus(req.userId);
    io.to(req.userId).emit('coins:update', result);
    io.emit('leaderboard:update');
    res.json(result);
  } catch (e) { res.status(400).json({ error: e.message }); }
});

app.post('/api/users/admin/coins', svc.authMiddleware, async (req, res) => {
  try {
    const result = await svc.adminAdjustCoins(req.userId, req.body);
    io.to(req.body.targetUid).emit('coins:update', result);
    io.emit('leaderboard:update');
    res.json(result);
  } catch (e) { res.status(403).json({ error: e.message }); }
});

app.get('/api/users/:uid/coins/history', svc.authMiddleware, async (req, res) => {
  try {
    const result = await svc.getCoinHistory(req.userId, req.params.uid);
    res.json(result);
  } catch (e) { res.status(403).json({ error: e.message }); }
});

app.get('/api/users/coins/all', svc.authMiddleware, async (req, res) => {
  try {
    const result = await svc.getAllCoinHistory(req.userId);
    res.json(result);
  } catch (e) { res.status(403).json({ error: e.message }); }
});

// ─── LEAGUE ROUTES ────────────────────────────────────────────
app.get('/api/leagues', svc.authMiddleware, async (req, res) => {
  try {
    const leagues = await svc.getLeagues();
    res.json(leagues);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/leagues', svc.authMiddleware, async (req, res) => {
  try {
    const league = await svc.createLeague(req.userId, req.body);
    io.emit('leagues:update');
    res.json(league);
  } catch (e) { res.status(400).json({ error: e.message }); }
});

app.put('/api/leagues/:id', svc.authMiddleware, async (req, res) => {
  try {
    const league = await svc.updateLeague(req.userId, req.params.id, req.body);
    io.emit('leagues:update');
    res.json(league);
  } catch (e) { res.status(403).json({ error: e.message }); }
});

app.delete('/api/leagues/:id', svc.authMiddleware, async (req, res) => {
  try {
    await svc.deleteLeague(req.userId, req.params.id);
    io.emit('leagues:update');
    io.emit('matches:update');
    io.emit('leaderboard:update');
    res.json({ ok: true });
  } catch (e) { res.status(403).json({ error: e.message }); }
});

app.post('/api/leagues/:id/join', svc.authMiddleware, async (req, res) => {
  try {
    const result = await svc.joinLeague(req.userId, req.params.id, req.body.teamId);
    io.emit('leagues:update');
    io.to(req.userId).emit('coins:update', result.coinData);
    res.json(result);
  } catch (e) { res.status(400).json({ error: e.message }); }
});

app.post('/api/leagues/:id/leave', svc.authMiddleware, async (req, res) => {
  try {
    await svc.leaveLeague(req.userId, req.params.id);
    io.emit('leagues:update');
    res.json({ ok: true });
  } catch (e) { res.status(400).json({ error: e.message }); }
});

app.post('/api/leagues/:id/start', svc.authMiddleware, async (req, res) => {
  try {
    const result = await svc.startLeague(req.userId, req.params.id);
    io.emit('leagues:update');
    io.emit('matches:update');
    io.to(`league:${req.params.id}`).emit('league:started', { leagueId: req.params.id });
    res.json(result);
  } catch (e) { res.status(400).json({ error: e.message }); }
});

app.post('/api/leagues/:id/end', svc.authMiddleware, async (req, res) => {
  try {
    const result = await svc.endLeague(req.userId, req.params.id);
    io.emit('leagues:update');
    io.emit('leaderboard:update');
    io.to(`league:${req.params.id}`).emit('league:ended', result);
    res.json(result);
  } catch (e) { res.status(400).json({ error: e.message }); }
});

app.delete('/api/leagues/:id/teams/:teamId', svc.authMiddleware, async (req, res) => {
  try {
    const result = await svc.removeTeamFromLeague(req.userId, req.params.id, req.params.teamId);
    io.emit('leagues:update');
    res.json(result);
  } catch (e) { res.status(403).json({ error: e.message }); }
});

// ─── TEAM ROUTES ──────────────────────────────────────────────
app.get('/api/teams', svc.authMiddleware, async (req, res) => {
  try {
    const teams = await svc.getTeams(req.userId);
    res.json(teams);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/teams', svc.authMiddleware, async (req, res) => {
  try {
    const team = await svc.createTeam(req.userId, req.body);
    io.emit('leaderboard:update');
    res.json(team);
  } catch (e) { res.status(400).json({ error: e.message }); }
});

app.put('/api/teams/:id', svc.authMiddleware, async (req, res) => {
  try {
    const team = await svc.updateTeam(req.userId, req.params.id, req.body);
    io.emit('leaderboard:update');
    res.json(team);
  } catch (e) { res.status(403).json({ error: e.message }); }
});

app.delete('/api/teams/:id', svc.authMiddleware, async (req, res) => {
  try {
    await svc.deleteTeam(req.userId, req.params.id);
    io.emit('leagues:update');
    io.emit('leaderboard:update');
    res.json({ ok: true });
  } catch (e) { res.status(403).json({ error: e.message }); }
});

// ─── MATCH ROUTES ─────────────────────────────────────────────
app.get('/api/matches', svc.authMiddleware, async (req, res) => {
  try {
    const matches = await svc.getMatches(req.userId, req.query);
    res.json(matches);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/matches/:id/submit', svc.authMiddleware, async (req, res) => {
  try {
    const result = await svc.submitMatchResult(req.userId, req.params.id, req.body);
    io.emit('matches:update');
    io.emit('leagues:update');
    io.emit('leaderboard:update');
    // notify opponent
    io.to(result.opponentId).emit('notification', {
      type: 'info',
      msg: `Match result submitted. Please confirm: ${result.score}`
    });
    res.json(result);
  } catch (e) { res.status(400).json({ error: e.message }); }
});

app.post('/api/matches/:id/confirm', svc.authMiddleware, async (req, res) => {
  try {
    const result = await svc.confirmMatchResult(req.userId, req.params.id);
    io.emit('matches:update');
    io.emit('leaderboard:update');
    io.to(result.submitterId).emit('notification', { type: 'success', msg: 'Match result confirmed! +' + result.reward + ' coins' });
    io.to(result.submitterId).emit('coins:update', result.coinData);
    res.json(result);
  } catch (e) { res.status(400).json({ error: e.message }); }
});

app.post('/api/matches/:id/dispute', svc.authMiddleware, async (req, res) => {
  try {
    const result = await svc.disputeMatch(req.userId, req.params.id, req.body.reason);
    io.emit('matches:update');
    res.json(result);
  } catch (e) { res.status(400).json({ error: e.message }); }
});

app.post('/api/matches/:id/admin-override', svc.authMiddleware, async (req, res) => {
  try {
    const result = await svc.adminOverrideMatch(req.userId, req.params.id, req.body);
    io.emit('matches:update');
    io.emit('leaderboard:update');
    res.json(result);
  } catch (e) { res.status(403).json({ error: e.message }); }
});

// ─── LEADERBOARD ──────────────────────────────────────────────
app.get('/api/leaderboard/players', async (req, res) => {
  try {
    const data = await svc.getPlayersLeaderboard();
    res.json(data);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/leaderboard/teams', async (req, res) => {
  try {
    const data = await svc.getTeamsLeaderboard();
    res.json(data);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ─── ANNOUNCEMENTS ────────────────────────────────────────────
app.get('/api/announcements', async (req, res) => {
  try {
    const data = await svc.getAnnouncements();
    res.json(data);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/announcements', svc.authMiddleware, async (req, res) => {
  try {
    const a = await svc.postAnnouncement(req.userId, req.body);
    io.emit('announcements:update');
    io.emit('notification', { type: 'info', msg: `📢 ${a.title}` });
    res.json(a);
  } catch (e) { res.status(403).json({ error: e.message }); }
});

app.delete('/api/announcements/:id', svc.authMiddleware, async (req, res) => {
  try {
    await svc.deleteAnnouncement(req.userId, req.params.id);
    io.emit('announcements:update');
    res.json({ ok: true });
  } catch (e) { res.status(403).json({ error: e.message }); }
});

// ─── CHAT ─────────────────────────────────────────────────────
app.get('/api/chat/:leagueId', svc.authMiddleware, async (req, res) => {
  try {
    const messages = await svc.getChatMessages(req.params.leagueId);
    res.json(messages);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ─── UPLOAD (Cloudinary) ──────────────────────────────────────
app.post('/api/upload', svc.authMiddleware, async (req, res) => {
  try {
    const result = await svc.uploadImage(req.body.data, req.body.folder || 'matches');
    res.json(result);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ─── SOCKET.IO ────────────────────────────────────────────────
io.use(async (socket, next) => {
  try {
    const token = socket.handshake.auth.token;
    if (!token) return next(new Error('No token'));
    const payload = svc.verifyToken(token);
    socket.userId = payload.uid;
    next();
  } catch { next(new Error('Invalid token')); }
});

io.on('connection', (socket) => {
  const uid = socket.userId;
  console.log(`⚡ Socket connected: ${uid}`);
  socket.join(uid); // personal room

  socket.on('join:league', (leagueId) => socket.join(`league:${leagueId}`));
  socket.on('leave:league', (leagueId) => socket.leave(`league:${leagueId}`));

  socket.on('chat:send', async (data) => {
    try {
      const msg = await svc.saveChatMessage(uid, data.leagueId, data.text);
      io.to(`league:${data.leagueId}`).emit('chat:message', msg);
    } catch (e) { socket.emit('error', e.message); }
  });

  socket.on('disconnect', () => console.log(`❌ Socket disconnected: ${uid}`));
});

// ─── SERVE FRONTEND ───────────────────────────────────────────
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ─── START ────────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));
