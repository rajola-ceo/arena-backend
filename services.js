// ============================================================
// CRUNK GAMES - services.js
// All DB models, business logic, auth, and utilities
// ============================================================
import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { v2 as cloudinary } from 'cloudinary';
import dotenv from 'dotenv';
dotenv.config();

// Cloudinary config
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

// ─── SCHEMAS ──────────────────────────────────────────────────
const txSchema = new mongoose.Schema({
  amount: Number, reason: String, dir: { type: String, enum: ['in', 'out'] },
  date: { type: Date, default: Date.now }
}, { _id: false });

const playerSchema = new mongoose.Schema({
  name: String, pos: String, goals: { type: Number, default: 0 },
  assists: { type: Number, default: 0 }
}, { _id: false });

const UserSchema = new mongoose.Schema({
  uid: { type: String, unique: true },
  displayName: { type: String, required: true },
  email: { type: String, required: true, unique: true, lowercase: true },
  password: String,
  photoURL: { type: String, default: '' },
  isAdmin: { type: Boolean, default: false },
  isBanned: { type: Boolean, default: false },
  totalWins: { type: Number, default: 0 },
  totalLosses: { type: Number, default: 0 },
  totalDraws: { type: Number, default: 0 },
  coins: { type: Number, default: 500 },
  joinedLeagues: [String],
  lastDailyBonus: String,
  coinHistory: { type: [txSchema], default: [] },
  createdAt: { type: Date, default: Date.now },
  lastLogin: Date,
}, { timestamps: false });

const LeagueTeamSchema = new mongoose.Schema({
  teamId: String, teamName: String, ownerId: String, ownerName: String
}, { _id: false });

const LeagueSchema = new mongoose.Schema({
  id: { type: String, unique: true },
  name: { type: String, required: true },
  gameType: { type: String, required: true },
  format: { type: String, enum: ['round-robin', 'knockout'], default: 'round-robin' },
  maxTeams: { type: Number, default: 8 },
  entryFee: { type: Number, default: 0 },
  prizePool: { type: Number, default: 0 },
  description: String,
  status: { type: String, enum: ['registration', 'in-progress', 'completed'], default: 'registration' },
  ownerId: String,
  ownerName: String,
  teams: { type: [LeagueTeamSchema], default: [] },
  matchIds: [String],
  startDate: Date,
  endDate: Date,
  createdAt: { type: Date, default: Date.now },
});

const TeamSchema = new mongoose.Schema({
  id: { type: String, unique: true },
  name: { type: String, required: true },
  gameType: String,
  formation: String,
  ownerId: String,
  ownerName: String,
  players: [playerSchema],
  wins: { type: Number, default: 0 },
  draws: { type: Number, default: 0 },
  losses: { type: Number, default: 0 },
  goalsFor: { type: Number, default: 0 },
  goalsAgainst: { type: Number, default: 0 },
  createdAt: { type: Date, default: Date.now },
});

const MatchSchema = new mongoose.Schema({
  id: { type: String, unique: true },
  leagueId: String,
  leagueName: String,
  team1Id: String, team1Name: String, team1OwnerId: String,
  team2Id: String, team2Name: String, team2OwnerId: String,
  team1Score: { type: Number, default: null },
  team2Score: { type: Number, default: null },
  status: { type: String, enum: ['scheduled', 'submitted', 'completed', 'disputed'], default: 'scheduled' },
  winnerId: String,
  round: Number,
  screenshotUrl: String,
  submittedBy: String,
  disputeReason: String,
  matchDate: { type: Date, default: Date.now },
  completedAt: Date,
});

const MessageSchema = new mongoose.Schema({
  leagueId: String,
  uid: String,
  displayName: String,
  photoURL: String,
  text: String,
  createdAt: { type: Date, default: Date.now },
});

const AnnouncementSchema = new mongoose.Schema({
  id: { type: String, unique: true },
  title: String,
  msg: String,
  by: String,
  date: { type: Date, default: Date.now },
});

// ─── MODELS ───────────────────────────────────────────────────
const User = mongoose.model('User', UserSchema);
const League = mongoose.model('League', LeagueSchema);
const Team = mongoose.model('Team', TeamSchema);
const Match = mongoose.model('Match', MatchSchema);
const Message = mongoose.model('Message', MessageSchema);
const Announcement = mongoose.model('Announcement', AnnouncementSchema);

// ─── HELPERS ──────────────────────────────────────────────────
const genId = (prefix) => `${prefix}_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;

export const verifyToken = (token) => jwt.verify(token, process.env.JWT_SECRET);

const signToken = (uid) => jwt.sign({ uid }, process.env.JWT_SECRET, { expiresIn: '30d' });

export const authMiddleware = (req, res, next) => {
  const auth = req.headers.authorization;
  if (!auth?.startsWith('Bearer ')) return res.status(401).json({ error: 'No token' });
  try {
    const payload = verifyToken(auth.slice(7));
    req.userId = payload.uid;
    next();
  } catch { res.status(401).json({ error: 'Invalid token' }); }
};

const requireAdmin = async (uid) => {
  const u = await User.findOne({ uid });
  if (!u?.isAdmin) throw new Error('Admin access required');
  return u;
};

const safeUser = (u) => ({
  uid: u.uid, displayName: u.displayName, email: u.email,
  photoURL: u.photoURL, isAdmin: u.isAdmin, isBanned: u.isBanned,
  coins: u.coins, totalWins: u.totalWins, totalLosses: u.totalLosses,
  totalDraws: u.totalDraws, joinedLeagues: u.joinedLeagues,
  lastDailyBonus: u.lastDailyBonus, createdAt: u.createdAt, lastLogin: u.lastLogin,
});

const addCoinTx = async (uid, amount, reason, dir) => {
  const tx = { amount, reason, dir, date: new Date() };
  await User.updateOne({ uid }, {
    $inc: { coins: dir === 'in' ? amount : -amount },
    $push: { coinHistory: { $each: [tx], $position: 0, $slice: 200 } }
  });
  return tx;
};

// ─── AUTH ─────────────────────────────────────────────────────
export const registerUser = async ({ displayName, email, password }) => {
  if (!displayName || !email || !password) throw new Error('All fields required');
  if (password.length < 6) throw new Error('Password too short');
  const exists = await User.findOne({ email: email.toLowerCase() });
  if (exists) throw new Error('Email already registered');
  const count = await User.countDocuments();
  const uid = genId('u');
  const hashed = await bcrypt.hash(password, 10);
  const user = await User.create({
    uid, displayName, email: email.toLowerCase(), password: hashed,
    isAdmin: count === 0, coins: 500,
    coinHistory: [{ amount: 500, reason: 'Welcome bonus', dir: 'in', date: new Date() }]
  });
  const token = signToken(uid);
  return { token, user: safeUser(user) };
};

export const loginUser = async ({ email, password }) => {
  if (!email || !password) throw new Error('All fields required');
  const user = await User.findOne({ email: email.toLowerCase() });
  if (!user) throw new Error('Invalid email or password');
  if (user.isBanned) throw new Error('Your account has been banned');
  const ok = await bcrypt.compare(password, user.password);
  if (!ok) throw new Error('Invalid email or password');
  user.lastLogin = new Date();
  await user.save();
  const token = signToken(user.uid);
  return { token, user: safeUser(user) };
};

export const getMe = async (uid) => {
  const u = await User.findOne({ uid });
  if (!u) throw new Error('User not found');
  return safeUser(u);
};

export const updateProfile = async (uid, { displayName, photoURL, password }) => {
  if (!displayName) throw new Error('Name required');
  const update = { displayName, photoURL };
  if (password) {
    if (password.length < 6) throw new Error('Password min 6 chars');
    update.password = await bcrypt.hash(password, 10);
  }
  const u = await User.findOneAndUpdate({ uid }, update, { new: true });
  return safeUser(u);
};

export const getAllUsers = async (uid) => {
  await requireAdmin(uid);
  const users = await User.find({}).select('-password').lean();
  return users.map(u => safeUser(u));
};

export const toggleBan = async (uid, targetUid, ban) => {
  await requireAdmin(uid);
  await User.updateOne({ uid: targetUid }, { isBanned: ban });
  return { ok: true };
};

export const toggleAdmin = async (uid, targetUid, isAdmin) => {
  await requireAdmin(uid);
  await User.updateOne({ uid: targetUid }, { isAdmin });
  return { ok: true };
};

export const claimDailyBonus = async (uid) => {
  const user = await User.findOne({ uid });
  const today = new Date().toDateString();
  if (user.lastDailyBonus === today) throw new Error('Already claimed today');
  await addCoinTx(uid, 50, 'Daily login bonus', 'in');
  await User.updateOne({ uid }, { lastDailyBonus: today });
  const updated = await User.findOne({ uid });
  return { coins: updated.coins, lastDailyBonus: today };
};

export const adminAdjustCoins = async (uid, { targetUid, amount, reason }) => {
  await requireAdmin(uid);
  const amt = Math.abs(parseInt(amount));
  if (!targetUid || !amt) throw new Error('Invalid parameters');
  const dir = parseInt(amount) > 0 ? 'in' : 'out';
  await addCoinTx(targetUid, amt, reason || 'Admin adjustment', dir);
  const updated = await User.findOne({ uid: targetUid });
  return { coins: updated.coins };
};

export const getCoinHistory = async (uid, targetUid) => {
  const requester = await User.findOne({ uid });
  if (uid !== targetUid && !requester?.isAdmin) throw new Error('Forbidden');
  const u = await User.findOne({ uid: targetUid }).select('coinHistory');
  return u?.coinHistory || [];
};

export const getAllCoinHistory = async (uid) => {
  await requireAdmin(uid);
  const users = await User.find({}).select('displayName coinHistory uid').lean();
  const all = [];
  users.forEach(u => (u.coinHistory || []).forEach(h => all.push({ ...h, user: u.displayName, uid: u.uid })));
  return all.sort((a, b) => new Date(b.date) - new Date(a.date)).slice(0, 200);
};

// ─── LEAGUES ──────────────────────────────────────────────────
export const getLeagues = async () => League.find({}).lean();

export const createLeague = async (uid, { name, gameType, format, maxTeams, entryFee, description }) => {
  const user = await User.findOne({ uid });
  if (!name || !gameType) throw new Error('Name and game type required');
  const max = parseInt(maxTeams) || 8;
  const fee = parseInt(entryFee) || 0;
  const league = await League.create({
    id: genId('l'), name, gameType, format: format || 'round-robin',
    maxTeams: max, entryFee: fee, prizePool: max * fee * 0.8,
    description, ownerId: uid, ownerName: user.displayName,
    status: 'registration'
  });
  return league;
};

export const updateLeague = async (uid, leagueId, data) => {
  const league = await League.findOne({ id: leagueId });
  if (!league) throw new Error('League not found');
  const user = await User.findOne({ uid });
  if (league.ownerId !== uid && !user?.isAdmin) throw new Error('Unauthorized');
  const { name, gameType, format, maxTeams, entryFee, description } = data;
  const max = parseInt(maxTeams) || league.maxTeams;
  const fee = parseInt(entryFee) ?? league.entryFee;
  Object.assign(league, { name, gameType, format, maxTeams: max, entryFee: fee, prizePool: max * fee * 0.8, description });
  await league.save();
  return league;
};

export const deleteLeague = async (uid, leagueId) => {
  const league = await League.findOne({ id: leagueId });
  if (!league) throw new Error('League not found');
  const user = await User.findOne({ uid });
  if (league.ownerId !== uid && !user?.isAdmin) throw new Error('Unauthorized');
  // refund entry fees
  for (const t of league.teams) {
    if (t.ownerId !== league.ownerId && league.entryFee > 0) {
      await addCoinTx(t.ownerId, league.entryFee, `Refund: league "${league.name}" deleted`, 'in');
    }
  }
  await Match.deleteMany({ leagueId });
  await League.deleteOne({ id: leagueId });
};

export const joinLeague = async (uid, leagueId, teamId) => {
  const league = await League.findOne({ id: leagueId });
  if (!league) throw new Error('League not found');
  const user = await User.findOne({ uid });
  if (league.ownerId === uid) throw new Error('You own this league');
  if (user.joinedLeagues.includes(leagueId)) throw new Error('Already joined');
  if (league.teams.length >= league.maxTeams) throw new Error('League is full');
  if (league.status !== 'registration') throw new Error('Registration closed');
  if (user.coins < league.entryFee) throw new Error(`Not enough coins. Need ${league.entryFee}`);
  // get team
  let team = teamId ? await Team.findOne({ id: teamId, ownerId: uid }) : null;
  const teamEntry = {
    teamId: team?.id || `t_${uid}`,
    teamName: team?.name || `${user.displayName}'s Team`,
    ownerId: uid,
    ownerName: user.displayName
  };
  if (league.entryFee > 0) await addCoinTx(uid, league.entryFee, `Joined league: ${league.name}`, 'out');
  league.teams.push(teamEntry);
  await league.save();
  await User.updateOne({ uid }, { $push: { joinedLeagues: leagueId } });
  const updated = await User.findOne({ uid });
  return { ok: true, coinData: { coins: updated.coins } };
};

export const leaveLeague = async (uid, leagueId) => {
  const league = await League.findOne({ id: leagueId });
  if (!league) throw new Error('League not found');
  league.teams = league.teams.filter(t => t.ownerId !== uid);
  await league.save();
  await User.updateOne({ uid }, { $pull: { joinedLeagues: leagueId } });
};

export const startLeague = async (uid, leagueId) => {
  const league = await League.findOne({ id: leagueId });
  if (!league) throw new Error('League not found');
  const user = await User.findOne({ uid });
  if (league.ownerId !== uid && !user?.isAdmin) throw new Error('Unauthorized');
  if (league.teams.length < 2) throw new Error('Need at least 2 teams');
  league.status = 'in-progress';
  league.startDate = new Date();
  const matches = league.format === 'knockout'
    ? generateKnockout(league) : generateRoundRobin(league);
  await Match.insertMany(matches);
  league.matchIds = matches.map(m => m.id);
  await league.save();
  return league;
};

export const endLeague = async (uid, leagueId) => {
  const league = await League.findOne({ id: leagueId });
  if (!league) throw new Error('League not found');
  const user = await User.findOne({ uid });
  if (league.ownerId !== uid && !user?.isAdmin) throw new Error('Unauthorized');
  league.status = 'completed';
  league.endDate = new Date();
  await league.save();
  // calc winner and award prize
  const matches = await Match.find({ leagueId, status: 'completed' }).lean();
  const standings = calcStandings(league.teams, matches);
  let winner = null;
  if (standings.length > 0) {
    const top = standings[0];
    const prize = Math.round(league.prizePool);
    if (prize > 0) await addCoinTx(top.ownerId, prize, `League winner: ${league.name}`, 'in');
    winner = top;
  }
  return { league, winner };
};

export const removeTeamFromLeague = async (uid, leagueId, teamId) => {
  const league = await League.findOne({ id: leagueId });
  if (!league) throw new Error('League not found');
  const user = await User.findOne({ uid });
  if (league.ownerId !== uid && !user?.isAdmin) throw new Error('Unauthorized');
  const team = league.teams.find(t => t.teamId === teamId);
  if (team && league.entryFee > 0) {
    await addCoinTx(team.ownerId, league.entryFee, `Removed from league: ${league.name}`, 'in');
  }
  league.teams = league.teams.filter(t => t.teamId !== teamId);
  await league.save();
  return { ok: true };
};

// ─── TEAMS ────────────────────────────────────────────────────
export const getTeams = async (uid) => Team.find({ ownerId: uid }).lean();

export const createTeam = async (uid, { name, gameType, formation, players }) => {
  const user = await User.findOne({ uid });
  if (!name) throw new Error('Name required');
  const team = await Team.create({
    id: genId('t'), name, gameType, formation: formation || '4-4-2',
    ownerId: uid, ownerName: user.displayName, players: players || [],
  });
  return team;
};

export const updateTeam = async (uid, teamId, { name, gameType, formation, players }) => {
  const team = await Team.findOne({ id: teamId });
  if (!team) throw new Error('Team not found');
  const user = await User.findOne({ uid });
  if (team.ownerId !== uid && !user?.isAdmin) throw new Error('Unauthorized');
  Object.assign(team, { name, gameType, formation, players });
  await team.save();
  return team;
};

export const deleteTeam = async (uid, teamId) => {
  const team = await Team.findOne({ id: teamId });
  if (!team) throw new Error('Team not found');
  const user = await User.findOne({ uid });
  if (team.ownerId !== uid && !user?.isAdmin) throw new Error('Unauthorized');
  await Team.deleteOne({ id: teamId });
  await League.updateMany({}, { $pull: { teams: { teamId } } });
};

// ─── MATCHES ──────────────────────────────────────────────────
export const getMatches = async (uid, { leagueId, status } = {}) => {
  const q = {};
  if (leagueId) q.leagueId = leagueId;
  if (status) q.status = status;
  return Match.find(q).sort({ matchDate: -1 }).lean();
};

export const submitMatchResult = async (uid, matchId, { team1Score, team2Score, screenshotUrl }) => {
  const match = await Match.findOne({ id: matchId });
  if (!match) throw new Error('Match not found');
  if (match.status !== 'scheduled') throw new Error('Match already processed');
  if (match.team1OwnerId !== uid && match.team2OwnerId !== uid) throw new Error('Not your match');
  // suspicious score check
  if (Math.max(team1Score, team2Score) > 20) throw new Error('Suspicious score detected');
  match.team1Score = parseInt(team1Score);
  match.team2Score = parseInt(team2Score);
  match.status = 'submitted';
  match.submittedBy = uid;
  if (screenshotUrl) match.screenshotUrl = screenshotUrl;
  await match.save();
  const opponentId = uid === match.team1OwnerId ? match.team2OwnerId : match.team1OwnerId;
  return { ok: true, opponentId, score: `${team1Score} - ${team2Score}`, submitterId: uid };
};

export const confirmMatchResult = async (uid, matchId) => {
  const match = await Match.findOne({ id: matchId });
  if (!match) throw new Error('Match not found');
  if (match.status !== 'submitted') throw new Error('No result to confirm');
  if (match.submittedBy === uid) throw new Error('Cannot confirm your own submission');
  if (match.team1OwnerId !== uid && match.team2OwnerId !== uid) throw new Error('Not your match');
  match.status = 'completed';
  match.completedAt = new Date();
  const s1 = match.team1Score, s2 = match.team2Score;
  if (s1 > s2) match.winnerId = match.team1Id;
  else if (s2 > s1) match.winnerId = match.team2Id;
  await match.save();
  // update team stats
  const updateTeamStats = async (teamId, gf, ga, res) => {
    await Team.updateOne({ id: teamId }, {
      $inc: {
        goalsFor: gf, goalsAgainst: ga,
        wins: res === 'win' ? 1 : 0,
        draws: res === 'draw' ? 1 : 0,
        losses: res === 'loss' ? 1 : 0
      }
    });
  };
  const res1 = s1 > s2 ? 'win' : s1 < s2 ? 'loss' : 'draw';
  const res2 = s2 > s1 ? 'win' : s2 < s1 ? 'loss' : 'draw';
  await updateTeamStats(match.team1Id, s1, s2, res1);
  await updateTeamStats(match.team2Id, s2, s1, res2);
  // update user stats + coins
  const awardUser = async (ownerId, res) => {
    const inc = { totalDraws: 0, totalLosses: 0, totalWins: 0 };
    if (res === 'win') { inc.totalWins = 1; await addCoinTx(ownerId, 25, 'Match win reward', 'in'); return 25; }
    if (res === 'draw') { inc.totalDraws = 1; await addCoinTx(ownerId, 10, 'Match draw reward', 'in'); return 10; }
    inc.totalLosses = 1;
    await User.updateOne({ uid: ownerId }, { $inc: inc });
    return 0;
  };
  const reward = await awardUser(match.team1OwnerId, res1);
  await awardUser(match.team2OwnerId, res2);
  const updatedUser = await User.findOne({ uid: match.submittedBy });
  return { ok: true, submitterId: match.submittedBy, reward, coinData: { coins: updatedUser?.coins || 0 } };
};

export const disputeMatch = async (uid, matchId, reason) => {
  const match = await Match.findOne({ id: matchId });
  if (!match) throw new Error('Match not found');
  if (match.team1OwnerId !== uid && match.team2OwnerId !== uid) throw new Error('Not your match');
  match.status = 'disputed';
  match.disputeReason = reason || 'No reason provided';
  await match.save();
  return { ok: true };
};

export const adminOverrideMatch = async (uid, matchId, { team1Score, team2Score }) => {
  await requireAdmin(uid);
  const match = await Match.findOne({ id: matchId });
  if (!match) throw new Error('Match not found');
  match.team1Score = parseInt(team1Score);
  match.team2Score = parseInt(team2Score);
  match.status = 'completed';
  match.completedAt = new Date();
  if (match.team1Score > match.team2Score) match.winnerId = match.team1Id;
  else if (match.team2Score > match.team1Score) match.winnerId = match.team2Id;
  match.submittedBy = uid;
  await match.save();
  return match;
};

// ─── LEADERBOARD ──────────────────────────────────────────────
export const getPlayersLeaderboard = async () => {
  const users = await User.find({ isBanned: false })
    .select('uid displayName photoURL totalWins totalLosses totalDraws coins isAdmin')
    .sort({ totalWins: -1, coins: -1 }).limit(100).lean();
  return users;
};

export const getTeamsLeaderboard = async () => {
  const teams = await Team.find({})
    .sort({ wins: -1, goalsFor: -1 }).limit(100).lean();
  return teams;
};

// ─── ANNOUNCEMENTS ────────────────────────────────────────────
export const getAnnouncements = async () =>
  Announcement.find({}).sort({ date: -1 }).limit(20).lean();

export const postAnnouncement = async (uid, { title, msg }) => {
  await requireAdmin(uid);
  if (!title || !msg) throw new Error('Title and message required');
  const a = await Announcement.create({ id: genId('a'), title, msg, by: (await User.findOne({ uid }))?.displayName || 'Admin' });
  return a;
};

export const deleteAnnouncement = async (uid, annId) => {
  await requireAdmin(uid);
  await Announcement.deleteOne({ id: annId });
};

// ─── CHAT ─────────────────────────────────────────────────────
export const getChatMessages = async (leagueId) =>
  Message.find({ leagueId }).sort({ createdAt: 1 }).limit(100).lean();

export const saveChatMessage = async (uid, leagueId, text) => {
  if (!text?.trim()) throw new Error('Empty message');
  const user = await User.findOne({ uid });
  const msg = await Message.create({
    leagueId, uid,
    displayName: user.displayName,
    photoURL: user.photoURL || '',
    text: text.trim()
  });
  return msg;
};

// ─── UPLOAD ───────────────────────────────────────────────────
export const uploadImage = async (base64Data, folder) => {
  if (!base64Data) throw new Error('No data');
  const result = await cloudinary.uploader.upload(base64Data, {
    folder: `crunk/${folder}`,
    transformation: [{ width: 1280, quality: 'auto' }]
  });
  return { url: result.secure_url, publicId: result.public_id };
};

// ─── MATCH GENERATION ─────────────────────────────────────────
const generateRoundRobin = (league) => {
  const teams = league.teams;
  const matches = [];
  for (let i = 0; i < teams.length; i++) {
    for (let j = i + 1; j < teams.length; j++) {
      matches.push({
        id: genId('m'), leagueId: league.id, leagueName: league.name,
        team1Id: teams[i].teamId, team1Name: teams[i].teamName, team1OwnerId: teams[i].ownerId,
        team2Id: teams[j].teamId, team2Name: teams[j].teamName, team2OwnerId: teams[j].ownerId,
        status: 'scheduled', round: 1, matchDate: new Date(),
      });
    }
  }
  return matches;
};

const generateKnockout = (league) => {
  const teams = league.teams;
  const matches = [];
  for (let i = 0; i < teams.length - 1; i += 2) {
    matches.push({
      id: genId('m'), leagueId: league.id, leagueName: league.name,
      team1Id: teams[i].teamId, team1Name: teams[i].teamName, team1OwnerId: teams[i].ownerId,
      team2Id: teams[i + 1].teamId, team2Name: teams[i + 1].teamName, team2OwnerId: teams[i + 1].ownerId,
      status: 'scheduled', round: 1, matchDate: new Date(),
    });
  }
  return matches;
};

export const calcStandings = (teams, matches) => {
  const map = {};
  teams.forEach(t => { map[t.teamId] = { id: t.teamId, name: t.teamName, ownerId: t.ownerId, played: 0, wins: 0, draws: 0, losses: 0, gf: 0, ga: 0, points: 0 }; });
  matches.forEach(m => {
    if (!map[m.team1Id] || !map[m.team2Id]) return;
    const s1 = m.team1Score || 0, s2 = m.team2Score || 0;
    map[m.team1Id].played++; map[m.team2Id].played++;
    map[m.team1Id].gf += s1; map[m.team1Id].ga += s2;
    map[m.team2Id].gf += s2; map[m.team2Id].ga += s1;
    if (s1 > s2) { map[m.team1Id].wins++; map[m.team1Id].points += 3; map[m.team2Id].losses++; }
    else if (s2 > s1) { map[m.team2Id].wins++; map[m.team2Id].points += 3; map[m.team1Id].losses++; }
    else { map[m.team1Id].draws++; map[m.team1Id].points++; map[m.team2Id].draws++; map[m.team2Id].points++; }
  });
  return Object.values(map).map(s => ({ ...s, gd: s.gf - s.ga }))
    .sort((a, b) => b.points - a.points || b.gd - a.gd || b.gf - a.gf);
};

// ─── SEED ADMIN ───────────────────────────────────────────────
export const seedAdmin = async () => {
  const count = await User.countDocuments();
  if (count > 0) return;
  const uid = 'u_demo_admin';
  const hashed = await bcrypt.hash('admin123', 10);
  await User.create({
    uid, displayName: 'Demo Admin', email: 'admin@crunk.gg', password: hashed,
    isAdmin: true, coins: 1500,
    coinHistory: [
      { amount: 500, reason: 'Welcome bonus', dir: 'in', date: new Date(Date.now() - 86400000 * 3) },
      { amount: 1000, reason: 'Founder bonus', dir: 'in', date: new Date() }
    ]
  });
  await Announcement.create({
    id: 'a_seed', title: 'Welcome to Crunk Games!',
    msg: 'The competitive gaming platform is now live. Real-time. Multiplayer. Create leagues, build teams, and compete for glory!',
    by: 'System'
  });
  console.log('🌱 Seeded demo admin: admin@crunk.gg / admin123');
};

// auto-seed on startup
mongoose.connection.once('open', () => seedAdmin().catch(console.error));
