// ============================================================
// 🎮 CRUNK GAMING PLATFORM - BACKEND SERVER
// ============================================================
// Single-file Node.js backend using Express + Socket.io
// In-memory storage (no database required)
// Author: Crunk Platform
// ============================================================

// ─── DEPENDENCIES ────────────────────────────────────────────
require("dotenv").config();
const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const cors = require("cors");
const crypto = require("crypto");

// ─── APP INIT ────────────────────────────────────────────────
const app = express();
const server = http.createServer(app);

// ─── SOCKET.IO SETUP ─────────────────────────────────────────
// Attach Socket.io to the HTTP server and allow ALL origins
const io = new Server(server, {
  cors: {
    origin: "*",          // Allow all origins
    methods: ["GET", "POST"],
  },
});

// ─── MIDDLEWARE ───────────────────────────────────────────────
app.use(cors({ origin: "*" }));        // Allow all CORS origins
app.use(express.json());               // Parse incoming JSON bodies

// ─── ENV CONFIG ───────────────────────────────────────────────
const PORT = process.env.PORT || 3000;

// ============================================================
// 📦 IN-MEMORY STORAGE
// ============================================================
// These arrays act as our "database" while the server is running.
// Data will reset on server restart — use a real DB for production.

/** @type {Array<Object>} All registered users */
const users = [];

/** @type {Array<Object>} All created leagues */
const leagues = [];

/** @type {Array<Object>} All matches */
const matches = [];

/** @type {Map<string, string>} Maps token → userId for auth lookups */
const tokenStore = new Map();

// ============================================================
// 🛠️ UTILITY FUNCTIONS
// ============================================================

/**
 * generateId()
 * Generates a short random unique ID using Node's crypto module.
 * Example output: "a3f9c1b2"
 * @returns {string} An 8-character hex string
 */
function generateId() {
  return crypto.randomBytes(4).toString("hex");
}

/**
 * generateToken()
 * Generates a long random token used for user authentication.
 * Example output: "3f8a1d...c9e2" (32-byte hex = 64 chars)
 * @returns {string} A 64-character hex string
 */
function generateToken() {
  return crypto.randomBytes(32).toString("hex");
}

/**
 * authMiddleware()
 * Express middleware that protects routes requiring authentication.
 *
 * How it works:
 *   1. Reads "Authorization: Bearer <token>" from request headers
 *   2. Looks up the token in our tokenStore map
 *   3. Finds the matching user and attaches them to req.user
 *   4. If anything fails → responds with 401 Unauthorized
 *
 * Usage: app.get("/protected", authMiddleware, handler)
 */
function authMiddleware(req, res, next) {
  // Pull the Authorization header from the request
  const authHeader = req.headers["authorization"];

  // Make sure the header exists and follows "Bearer <token>" format
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return res.status(401).json({
      success: false,
      error: "Unauthorized: Missing or malformed token.",
    });
  }

  // Extract just the token part (everything after "Bearer ")
  const token = authHeader.split(" ")[1];

  // Look up which userId this token belongs to
  const userId = tokenStore.get(token);
  if (!userId) {
    return res.status(401).json({
      success: false,
      error: "Unauthorized: Invalid or expired token.",
    });
  }

  // Find the full user object from our users array
  const user = users.find((u) => u.id === userId);
  if (!user) {
    return res.status(401).json({
      success: false,
      error: "Unauthorized: User no longer exists.",
    });
  }

  // Attach user to the request object so route handlers can use it
  req.user = user;

  // Move on to the actual route handler
  next();
}

/**
 * autoJoinLeague()
 * Helper function to handle auto-joining a league by invite code.
 * Returns the joined league object or null if failed.
 */
function autoJoinLeague(userId, inviteCode) {
  if (!inviteCode) return null;
  
  const league = leagues.find((l) => l.inviteCode === inviteCode);
  if (!league) return null;
  
  // Check if already in league
  if (league.players.includes(userId)) return null;
  
  // Don't allow joining a started league
  if (league.status === "started") return null;
  
  // Add player to league
  league.players.push(userId);
  
  // Auto-start the league when it reaches maxPlayers
  if (league.players.length >= league.maxPlayers) {
    generateFixtures(league);
  }
  
  return league;
}

/**
 * generateFixtures()
 * Generates round-robin fixtures for a league.
 * Each player plays every other player once.
 */
function generateFixtures(league) {
  if (league.status === "started") return;
  
  league.status = "started";
  const players = league.players;
  const fixtures = [];
  let round = 1;
  
  // Simple round-robin algorithm
  for (let i = 0; i < players.length; i++) {
    for (let j = i + 1; j < players.length; j++) {
      fixtures.push({
        id: generateId(),
        leagueId: league.id,
        player1: players[i],
        player2: players[j],
        score1: null,
        score2: null,
        status: "pending",
        round: round,
      });
      round++;
    }
  }
  
  // Push all matches to the matches array
  matches.push(...fixtures);
  
  // Emit a real-time event to everyone in the league room
  io.to(league.id).emit("league:started", {
    leagueId: league.id,
    message: `League "${league.name}" is full and has started!`,
    players: league.players,
    fixtures: fixtures,
  });
}

/**
 * calculateLeaderboard()
 * Calculates leaderboard for a given league.
 * Returns sorted array of player standings.
 */
function calculateLeaderboard(leagueId) {
  const league = leagues.find(l => l.id === leagueId);
  if (!league) return [];
  
  const leagueMatches = matches.filter(m => m.leagueId === leagueId && m.status === "completed");
  
  // Initialize stats for each player
  const stats = {};
  league.players.forEach(playerId => {
    stats[playerId] = {
      playerId: playerId,
      playerName: users.find(u => u.id === playerId)?.displayName || "Unknown",
      played: 0,
      won: 0,
      drawn: 0,
      lost: 0,
      goalsFor: 0,
      goalsAgainst: 0,
      goalDifference: 0,
      points: 0,
    };
  });
  
  // Calculate stats from completed matches
  leagueMatches.forEach(match => {
    const p1Id = match.player1;
    const p2Id = match.player2;
    const score1 = match.score1;
    const score2 = match.score2;
    
    // Update goals
    stats[p1Id].goalsFor += score1;
    stats[p1Id].goalsAgainst += score2;
    stats[p2Id].goalsFor += score2;
    stats[p2Id].goalsAgainst += score1;
    
    stats[p1Id].played++;
    stats[p2Id].played++;
    
    // Determine result
    if (score1 > score2) {
      // Player 1 wins
      stats[p1Id].won++;
      stats[p1Id].points += 3;
      stats[p2Id].lost++;
    } else if (score2 > score1) {
      // Player 2 wins
      stats[p2Id].won++;
      stats[p2Id].points += 3;
      stats[p1Id].lost++;
    } else {
      // Draw
      stats[p1Id].drawn++;
      stats[p1Id].points += 1;
      stats[p2Id].drawn++;
      stats[p2Id].points += 1;
    }
  });
  
  // Calculate goal difference
  Object.values(stats).forEach(stat => {
    stat.goalDifference = stat.goalsFor - stat.goalsAgainst;
  });
  
  // Sort by points DESC, then goals DESC
  const leaderboard = Object.values(stats).sort((a, b) => {
    if (a.points !== b.points) return b.points - a.points;
    return b.goalsFor - a.goalsFor;
  });
  
  return leaderboard;
}

// ============================================================
// 🌐 ROOT ROUTE
// ============================================================

/**
 * GET /
 * Health check route. Useful for deployment platforms (Render, Railway, etc.)
 * to verify the server is online.
 */
app.get("/", (req, res) => {
  res.json({ message: "Crunk backend is running" });
});

// ============================================================
// 🔐 AUTH ROUTES
// ============================================================

/**
 * POST /api/auth/register
 * Registers a new user account.
 *
 * Request body:
 *   { displayName: string, email: string, password: string }
 *
 * Query param (optional):
 *   invite: string - invite code for auto-joining a league
 *
 * Response (201):
 *   { success: true, token: string, user: {...}, joinedLeague: {...} }
 *
 * Errors:
 *   400 - Missing required fields
 *   409 - Email already registered
 */
app.post("/api/auth/register", (req, res) => {
  const { displayName, email, password } = req.body;
  const inviteCode = req.query.invite;

  // ── Validation ──────────────────────────────────────────
  if (!displayName || !email || !password) {
    return res.status(400).json({
      success: false,
      error: "All fields are required: displayName, email, password.",
    });
  }

  // Check if email is already taken (case-insensitive)
  const existingUser = users.find(
    (u) => u.email.toLowerCase() === email.toLowerCase()
  );
  if (existingUser) {
    return res.status(409).json({
      success: false,
      error: "An account with this email already exists.",
    });
  }

  // ── Create User Object ───────────────────────────────────
  const newUser = {
    id: generateId(),
    displayName: displayName.trim(),
    email: email.toLowerCase().trim(),
    password,              // ⚠️ In production: hash this with bcrypt!
    coins: 500,            // Every new player starts with 500 coins
    createdAt: new Date().toISOString(),
  };

  // Save to in-memory array
  users.push(newUser);

  // Generate a token and map it to this user's ID
  const token = generateToken();
  tokenStore.set(token, newUser.id);

  // Auto-join league if invite code provided
  const joinedLeague = autoJoinLeague(newUser.id, inviteCode);

  // Respond — never send back the password!
  return res.status(201).json({
    success: true,
    token,
    user: {
      id: newUser.id,
      displayName: newUser.displayName,
      email: newUser.email,
      coins: newUser.coins,
      createdAt: newUser.createdAt,
    },
    joinedLeague: joinedLeague || null,
  });
});

/**
 * POST /api/auth/login
 * Logs in an existing user and returns a fresh token.
 *
 * Request body:
 *   { email: string, password: string }
 *
 * Query param (optional):
 *   invite: string - invite code for auto-joining a league
 *
 * Response (200):
 *   { success: true, token: string, user: {...}, joinedLeague: {...} }
 *
 * Errors:
 *   400 - Missing fields
 *   401 - Invalid credentials
 */
app.post("/api/auth/login", (req, res) => {
  const { email, password } = req.body;
  const inviteCode = req.query.invite;

  // ── Validation ──────────────────────────────────────────
  if (!email || !password) {
    return res.status(400).json({
      success: false,
      error: "Email and password are required.",
    });
  }

  // Find user by email
  const user = users.find(
    (u) => u.email.toLowerCase() === email.toLowerCase()
  );

  // Check user exists and password matches
  // ⚠️ In production: use bcrypt.compare() instead of plain comparison
  if (!user || user.password !== password) {
    return res.status(401).json({
      success: false,
      error: "Invalid email or password.",
    });
  }

  // Generate a new token for this session
  const token = generateToken();
  tokenStore.set(token, user.id);

  // Auto-join league if invite code provided
  const joinedLeague = autoJoinLeague(user.id, inviteCode);

  return res.status(200).json({
    success: true,
    token,
    user: {
      id: user.id,
      displayName: user.displayName,
      email: user.email,
      coins: user.coins,
      createdAt: user.createdAt,
    },
    joinedLeague: joinedLeague || null,
  });
});

/**
 * GET /api/users/me
 * Returns the currently authenticated user's profile.
 * 🔒 Protected — requires valid Bearer token.
 *
 * Response (200):
 *   { success: true, user: { id, displayName, email, coins, createdAt } }
 */
app.get("/api/users/me", authMiddleware, (req, res) => {
  // req.user is set by authMiddleware
  const { id, displayName, email, coins, createdAt } = req.user;

  return res.status(200).json({
    success: true,
    user: { id, displayName, email, coins, createdAt },
  });
});

// ============================================================
// 🏆 LEAGUE ROUTES
// ============================================================

/**
 * POST /api/leagues/create
 * Creates a new league and auto-joins the creator.
 * 🔒 Protected — requires valid Bearer token.
 *
 * Request body:
 *   { name: string, game: string, maxPlayers: number }
 *
 * Response (201):
 *   { success: true, league: LeagueObject }
 *
 * Errors:
 *   400 - Missing required fields or invalid maxPlayers
 */
app.post("/api/leagues/create", authMiddleware, (req, res) => {
  const { name, game, maxPlayers } = req.body;

  // ── Validation ──────────────────────────────────────────
  if (!name || !game || !maxPlayers) {
    return res.status(400).json({
      success: false,
      error: "Fields required: name, game, maxPlayers.",
    });
  }

  const parsedMax = parseInt(maxPlayers, 10);
  if (isNaN(parsedMax) || parsedMax < 2) {
    return res.status(400).json({
      success: false,
      error: "maxPlayers must be a number of at least 2.",
    });
  }

  // Generate unique invite code
  let inviteCode;
  let isUnique = false;
  while (!isUnique) {
    inviteCode = generateId();
    const existingLeague = leagues.find((l) => l.inviteCode === inviteCode);
    if (!existingLeague) isUnique = true;
  }

  // ── Build League Object ──────────────────────────────────
  const newLeague = {
    id: generateId(),
    name: name.trim(),
    game: game.trim(),
    maxPlayers: parsedMax,
    players: [req.user.id],      // Creator is automatically the first player
    creatorId: req.user.id,
    status: "waiting",           // Starts in "waiting" until full
    inviteCode: inviteCode,      // Unique invite code for sharing
    createdAt: new Date().toISOString(),
  };

  leagues.push(newLeague);

  return res.status(201).json({
    success: true,
    league: newLeague,
  });
});

/**
 * GET /api/leagues
 * Returns all leagues (public — no auth required).
 * Useful for browsing available games.
 *
 * Response (200):
 *   { success: true, count: number, leagues: Array }
 */
app.get("/api/leagues", (req, res) => {
  return res.status(200).json({
    success: true,
    count: leagues.length,
    leagues,
  });
});

/**
 * GET /api/leagues/invite/:code
 * Returns a league by its invite code.
 *
 * Path param:
 *   code {string} - invite code of the league
 *
 * Response (200):
 *   { success: true, league: LeagueObject }
 *
 * Errors:
 *   404 - League not found
 */
app.get("/api/leagues/invite/:code", (req, res) => {
  const { code } = req.params;

  const league = leagues.find((l) => l.inviteCode === code);

  if (!league) {
    return res.status(404).json({
      success: false,
      error: "League not found with this invite code.",
    });
  }

  return res.status(200).json({
    success: true,
    league,
  });
});

/**
 * GET /api/leagues/:id/matches
 * Returns all matches for a specific league.
 *
 * Path param:
 *   id {string} - league ID
 *
 * Response (200):
 *   { success: true, count: number, matches: Array }
 *
 * Errors:
 *   404 - League not found
 */
app.get("/api/leagues/:id/matches", (req, res) => {
  const { id } = req.params;

  const league = leagues.find((l) => l.id === id);
  if (!league) {
    return res.status(404).json({
      success: false,
      error: "League not found.",
    });
  }

  const leagueMatches = matches.filter((m) => m.leagueId === id);

  return res.status(200).json({
    success: true,
    count: leagueMatches.length,
    matches: leagueMatches,
  });
});

/**
 * GET /api/leagues/:id/leaderboard
 * Returns the leaderboard for a specific league.
 *
 * Path param:
 *   id {string} - league ID
 *
 * Response (200):
 *   { success: true, leaderboard: Array }
 *
 * Errors:
 *   404 - League not found
 */
app.get("/api/leagues/:id/leaderboard", (req, res) => {
  const { id } = req.params;

  const league = leagues.find((l) => l.id === id);
  if (!league) {
    return res.status(404).json({
      success: false,
      error: "League not found.",
    });
  }

  const leaderboard = calculateLeaderboard(id);

  return res.status(200).json({
    success: true,
    leaderboard,
  });
});

/**
 * POST /api/leagues/join
 * Joins an existing league by its ID.
 * 🔒 Protected — requires valid Bearer token.
 *
 * Request body:
 *   { leagueId: string }
 *
 * Response (200):
 *   { success: true, message: string, league: LeagueObject }
 *
 * Errors:
 *   400 - Missing leagueId
 *   404 - League not found
 *   409 - Already in league, or league is full/started
 */
app.post("/api/leagues/join", authMiddleware, (req, res) => {
  const { leagueId } = req.body;

  // ── Validation ──────────────────────────────────────────
  if (!leagueId) {
    return res.status(400).json({
      success: false,
      error: "leagueId is required.",
    });
  }

  // Find the league
  const league = leagues.find((l) => l.id === leagueId);
  if (!league) {
    return res.status(404).json({
      success: false,
      error: "League not found.",
    });
  }

  // Prevent duplicate joins
  if (league.players.includes(req.user.id)) {
    return res.status(409).json({
      success: false,
      error: "You are already in this league.",
    });
  }

  // Don't allow joining a started league
  if (league.status === "started") {
    return res.status(409).json({
      success: false,
      error: "This league has already started. No more players can join.",
    });
  }

  // ── Add Player ───────────────────────────────────────────
  league.players.push(req.user.id);

  // Auto-start the league when it reaches maxPlayers
  if (league.players.length >= league.maxPlayers) {
    generateFixtures(league);
  }

  return res.status(200).json({
    success: true,
    message:
      league.status === "started"
        ? "Joined! The league is now full and has started."
        : `Joined league "${league.name}". Waiting for more players.`,
    league,
  });
});

/**
 * POST /api/leagues/join-by-code
 * Joins an existing league using its invite code.
 * 🔒 Protected — requires valid Bearer token.
 *
 * Request body:
 *   { inviteCode: string }
 *
 * Response (200):
 *   { success: true, message: string, league: LeagueObject }
 *
 * Errors:
 *   400 - Missing inviteCode
 *   404 - League not found
 *   409 - Already in league, or league is full/started
 */
app.post("/api/leagues/join-by-code", authMiddleware, (req, res) => {
  const { inviteCode } = req.body;

  // ── Validation ──────────────────────────────────────────
  if (!inviteCode) {
    return res.status(400).json({
      success: false,
      error: "inviteCode is required.",
    });
  }

  // Find the league by invite code
  const league = leagues.find((l) => l.inviteCode === inviteCode);
  if (!league) {
    return res.status(404).json({
      success: false,
      error: "League not found with this invite code.",
    });
  }

  // Prevent duplicate joins
  if (league.players.includes(req.user.id)) {
    return res.status(409).json({
      success: false,
      error: "You are already in this league.",
    });
  }

  // Don't allow joining a started league
  if (league.status === "started") {
    return res.status(409).json({
      success: false,
      error: "This league has already started. No more players can join.",
    });
  }

  // Check if league is full
  if (league.players.length >= league.maxPlayers) {
    return res.status(409).json({
      success: false,
      error: "This league is already full.",
    });
  }

  // ── Add Player ───────────────────────────────────────────
  league.players.push(req.user.id);

  // Auto-start the league when it reaches maxPlayers
  if (league.players.length >= league.maxPlayers) {
    generateFixtures(league);
  }

  return res.status(200).json({
    success: true,
    message:
      league.status === "started"
        ? "Joined via invite code! The league is now full and has started."
        : `Joined league "${league.name}" via invite code. Waiting for more players.`,
    league,
  });
});

// ============================================================
// 🎮 MATCHES & RESULTS ROUTES
// ============================================================

/**
 * POST /api/matches/result
 * Submits a result for a match.
 * 🔒 Protected — only league creator can submit results.
 *
 * Request body:
 *   { matchId: string, score1: number, score2: number }
 *
 * Response (200):
 *   { success: true, message: string, match: Object }
 *
 * Errors:
 *   400 - Missing fields or invalid scores
 *   403 - Not authorized (only league creator)
 *   404 - Match not found
 *   409 - Match already completed
 */
app.post("/api/matches/result", authMiddleware, (req, res) => {
  const { matchId, score1, score2 } = req.body;

  // ── Validation ──────────────────────────────────────────
  if (!matchId || score1 === undefined || score2 === undefined) {
    return res.status(400).json({
      success: false,
      error: "matchId, score1, and score2 are required.",
    });
  }

  const parsedScore1 = parseInt(score1, 10);
  const parsedScore2 = parseInt(score2, 10);

  if (isNaN(parsedScore1) || isNaN(parsedScore2) || parsedScore1 < 0 || parsedScore2 < 0) {
    return res.status(400).json({
      success: false,
      error: "Scores must be non-negative numbers.",
    });
  }

  // Find the match
  const match = matches.find((m) => m.id === matchId);
  if (!match) {
    return res.status(404).json({
      success: false,
      error: "Match not found.",
    });
  }

  // Check if match is already completed
  if (match.status === "completed") {
    return res.status(409).json({
      success: false,
      error: "This match has already been completed.",
    });
  }

  // Find the league
  const league = leagues.find((l) => l.id === match.leagueId);
  if (!league) {
    return res.status(404).json({
      success: false,
      error: "League not found for this match.",
    });
  }

  // Check if user is the league creator
  if (league.creatorId !== req.user.id) {
    return res.status(403).json({
      success: false,
      error: "Only the league creator can submit match results.",
    });
  }

  // ── Update Match ───────────────────────────────────────────
  match.score1 = parsedScore1;
  match.score2 = parsedScore2;
  match.status = "completed";

  // Emit real-time event to the league room
  io.to(league.id).emit("match:result", {
    matchId: match.id,
    leagueId: league.id,
    player1: match.player1,
    player2: match.player2,
    score1: parsedScore1,
    score2: parsedScore2,
    status: "completed",
  });

  return res.status(200).json({
    success: true,
    message: "Match result submitted successfully.",
    match,
  });
});

// ============================================================
// 🎮 GAME SYSTEM — STORAGE
// ============================================================
// Pre-seeded catalogue of playable games.
// Each game object carries a `url` field used by the frontend
// to launch the game inside a WebView or iframe.
//
// Shape:
//   id        — unique stable identifier
//   title     — display name shown in the UI
//   thumbnail — cover image URL (300×300 recommended)
//   url       — embeddable game URL (HTML5 / iframe compatible)
//   category  — genre tag for filtering (e.g. "football", "arcade")

/** @type {Array<Object>} Master catalogue of all Crunk games */
const games = [
  {
    id: "game1",
    title: "Penalty Shootout",
    thumbnail: "https://via.placeholder.com/300",
    url: "https://html5.gamedistribution.com/12345/",
    category: "football",
  },
  {
    id: "game2",
    title: "Arcade Runner",
    thumbnail: "https://via.placeholder.com/300",
    url: "https://html5.gamedistribution.com/67890/",
    category: "arcade",
  },
  {
    id: "game3",
    title: "Street Basketball",
    thumbnail: "https://via.placeholder.com/300",
    url: "https://html5.gamedistribution.com/11111/",
    category: "basketball",
  },
  {
    id: "game4",
    title: "Turbo Kart Racer",
    thumbnail: "https://via.placeholder.com/300",
    url: "https://html5.gamedistribution.com/22222/",
    category: "racing",
  },
  {
    id: "game5",
    title: "Pixel Shooter",
    thumbnail: "https://via.placeholder.com/300",
    url: "https://html5.gamedistribution.com/33333/",
    category: "arcade",
  },
  {
    id: "game6",
    title: "Chess Blitz",
    thumbnail: "https://via.placeholder.com/300",
    url: "https://html5.gamedistribution.com/44444/",
    category: "strategy",
  },
  {
    id: "game7",
    title: "Free Kick Frenzy",
    thumbnail: "https://via.placeholder.com/300",
    url: "https://html5.gamedistribution.com/55555/",
    category: "football",
  },
  {
    id: "game8",
    title: "Dungeon Crawler",
    thumbnail: "https://via.placeholder.com/300",
    url: "https://html5.gamedistribution.com/66666/",
    category: "rpg",
  },
  {
    id: "game9",
    title: "Tower Defense X",
    thumbnail: "https://via.placeholder.com/300",
    url: "https://html5.gamedistribution.com/77777/",
    category: "strategy",
  },
  {
    id: "game10",
    title: "Neon Dash",
    thumbnail: "https://via.placeholder.com/300",
    url: "https://html5.gamedistribution.com/88888/",
    category: "arcade",
  },
  {
    id: "game11",
    title: "Slam Dunk Heroes",
    thumbnail: "https://via.placeholder.com/300",
    url: "https://html5.gamedistribution.com/99999/",
    category: "basketball",
  },
  {
    id: "game12",
    title: "Rally Rush",
    thumbnail: "https://via.placeholder.com/300",
    url: "https://html5.gamedistribution.com/10101/",
    category: "racing",
  },
];

// ============================================================
// 🎮 GAME ROUTES
// ============================================================

/**
 * GET /api/games
 * Returns the full game catalogue with optional pagination.
 *
 * Query params (all optional):
 *   page  {number} — page number, 1-based (default: 1)
 *   limit {number} — items per page (default: 10, max: 50)
 *
 * Response (200):
 *   {
 *     success: true,
 *     count: <total games>,
 *     page: <current page>,
 *     totalPages: <total pages>,
 *     games: [...]
 *   }
 *
 * Examples:
 *   GET /api/games              → all games (page 1, limit 10)
 *   GET /api/games?page=2       → page 2
 *   GET /api/games?limit=5      → first 5 games
 *   GET /api/games?page=1&limit=4 → first 4 games
 */
app.get("/api/games", (req, res) => {
  // ── Pagination params ────────────────────────────────────
  // parseInt with fallback keeps things safe even if NaN is passed
  const page  = Math.max(1, parseInt(req.query.page)  || 1);
  const limit = Math.min(50, Math.max(1, parseInt(req.query.limit) || 10));

  // ── Slice the games array for the requested page ─────────
  const startIndex = (page - 1) * limit;
  const endIndex   = startIndex + limit;
  const paginated  = games.slice(startIndex, endIndex);

  const totalPages = Math.ceil(games.length / limit);

  return res.status(200).json({
    success: true,
    count: games.length,          // Total number of games in the catalogue
    page,                          // Current page number
    totalPages,                    // How many pages exist at this limit
    games: paginated,              // The games for this page
  });
});

/**
 * GET /api/games/search
 * ⚠️  MUST be defined BEFORE /api/games/:id so Express doesn't
 *     mistake "search" for an :id parameter.
 *
 * Searches the game catalogue by title (case-insensitive).
 * Also supports optional `category` filter to narrow results.
 *
 * Query params:
 *   q        {string} — search keyword matched against title
 *   category {string} — (optional) filter by category
 *
 * Response (200):
 *   { success: true, count: number, results: [...] }
 *
 * Examples:
 *   GET /api/games/search?q=football
 *   GET /api/games/search?q=arcade&category=arcade
 *   GET /api/games/search?q=            → returns all games
 */
app.get("/api/games/search", (req, res) => {
  const keyword  = (req.query.q        || "").toLowerCase().trim();
  const category = (req.query.category || "").toLowerCase().trim();

  // Start with the full catalogue and apply filters progressively
  let results = games;

  // ── Title filter ─────────────────────────────────────────
  // If a keyword was provided, keep only games whose title contains it
  if (keyword) {
    results = results.filter((g) =>
      g.title.toLowerCase().includes(keyword)
    );
  }

  // ── Category filter ──────────────────────────────────────
  // If a category was provided, narrow down further
  if (category) {
    results = results.filter((g) =>
      g.category.toLowerCase() === category
    );
  }

  return res.status(200).json({
    success: true,
    count: results.length,
    results,
  });
});

/**
 * GET /api/games/:id
 * Returns a single game by its unique ID.
 *
 * Path param:
 *   id {string} — the game's id field (e.g. "game1")
 *
 * Response (200):
 *   { success: true, game: GameObject }
 *
 * Errors:
 *   404 - No game found with the given ID
 *
 * Example:
 *   GET /api/games/game1  → returns Penalty Shootout
 */
app.get("/api/games/:id", (req, res) => {
  const { id } = req.params;

  // Search for the game in our catalogue
  const game = games.find((g) => g.id === id);

  if (!game) {
    return res.status(404).json({
      success: false,
      error: `Game with id "${id}" was not found.`,
    });
  }

  return res.status(200).json({
    success: true,
    game,
  });
});

// ============================================================
// ⚡ SOCKET.IO — REAL-TIME EVENTS
// ============================================================

io.on("connection", (socket) => {
  // ── Connection Log ───────────────────────────────────────
  console.log(`[Socket.io] ✅ Client connected: ${socket.id}`);

  // ─────────────────────────────────────────────────────────
  // EVENT: "joinRoom"
  // Player joins a Socket.io room identified by leagueId.
  // This scopes all future events (chat, voice, emoji) to
  // only players in the same room.
  //
  // Payload: { leagueId: string, displayName: string }
  // ─────────────────────────────────────────────────────────
  socket.on("joinRoom", (data) => {
    const { leagueId, displayName } = data;

    if (!leagueId) {
      socket.emit("error", { message: "leagueId is required to join a room." });
      return;
    }

    // Join the Socket.io room
    socket.join(leagueId);

    console.log(
      `[Socket.io] 🏠 ${displayName || socket.id} joined room: ${leagueId}`
    );

    // Notify everyone else in the room that a new player joined
    socket.to(leagueId).emit("room:playerJoined", {
      socketId: socket.id,
      displayName: displayName || "A player",
      leagueId,
      timestamp: new Date().toISOString(),
    });

    // Confirm back to the joining player
    socket.emit("room:joined", {
      leagueId,
      message: `Successfully joined room ${leagueId}`,
    });
  });

  // ─────────────────────────────────────────────────────────
  // EVENT: "chat:send"
  // Broadcasts a chat message to everyone in the room.
  //
  // Payload: { roomId: string, message: string, displayName: string }
  // Emits:   "chat:receive" to all sockets in the room
  // ─────────────────────────────────────────────────────────
  socket.on("chat:send", (data) => {
    const { roomId, message, displayName } = data;

    if (!roomId || !message) {
      socket.emit("error", {
        message: "roomId and message are required for chat.",
      });
      return;
    }

    const chatPayload = {
      senderId: socket.id,
      displayName: displayName || "Anonymous",
      message: message.trim(),
      roomId,
      timestamp: new Date().toISOString(),
    };

    console.log(
      `[Chat] 💬 [Room: ${roomId}] ${chatPayload.displayName}: ${chatPayload.message}`
    );

    // Broadcast to ALL sockets in the room (including sender)
    io.to(roomId).emit("chat:receive", chatPayload);
  });

  // ─────────────────────────────────────────────────────────
  // EVENT: "voice"
  // Shares an audio URL with everyone in the room.
  // Useful for voice note / audio clip sharing in leagues.
  //
  // Payload: { roomId: string, audioUrl: string, displayName: string }
  // Emits:   "voice:receive" to all sockets in the room
  // ─────────────────────────────────────────────────────────
  socket.on("voice", (data) => {
    const { roomId, audioUrl, displayName } = data;

    if (!roomId || !audioUrl) {
      socket.emit("error", {
        message: "roomId and audioUrl are required for voice events.",
      });
      return;
    }

    const voicePayload = {
      senderId: socket.id,
      displayName: displayName || "Anonymous",
      audioUrl,
      roomId,
      timestamp: new Date().toISOString(),
    };

    console.log(
      `[Voice] 🎙️ [Room: ${roomId}] ${voicePayload.displayName} shared audio`
    );

    // Broadcast to everyone in the room
    io.to(roomId).emit("voice:receive", voicePayload);
  });

  // ─────────────────────────────────────────────────────────
  // EVENT: "emoji"
  // Broadcasts an emoji reaction to everyone in the room.
  // Used for quick expressive reactions during gameplay.
  //
  // Payload: { roomId: string, emoji: string, displayName: string }
  // Emits:   "emoji:receive" to all sockets in the room
  // ─────────────────────────────────────────────────────────
  socket.on("emoji", (data) => {
    const { roomId, emoji, displayName } = data;

    if (!roomId || !emoji) {
      socket.emit("error", {
        message: "roomId and emoji are required for emoji events.",
      });
      return;
    }

    const emojiPayload = {
      senderId: socket.id,
      displayName: displayName || "Anonymous",
      emoji,
      roomId,
      timestamp: new Date().toISOString(),
    };

    console.log(
      `[Emoji] ${emoji} [Room: ${roomId}] from ${emojiPayload.displayName}`
    );

    // Broadcast to everyone in the room
    io.to(roomId).emit("emoji:receive", emojiPayload);
  });

  // ─────────────────────────────────────────────────────────
  // EVENT: "disconnect"
  // Fires automatically when a client disconnects.
  // ─────────────────────────────────────────────────────────
  socket.on("disconnect", () => {
    console.log(`[Socket.io] ❌ Client disconnected: ${socket.id}`);
  });
});

// ============================================================
// 🚀 START SERVER
// ============================================================

server.listen(PORT, () => {
  console.log("");
  console.log("╔════════════════════════════════════════╗");
  console.log("║   🎮  CRUNK BACKEND IS RUNNING          ║");
  console.log(`║   🌐  http://localhost:${PORT}              ║`);
  console.log("║   ⚡  Socket.io ready                   ║");
  console.log("╚════════════════════════════════════════╝");
  console.log("");
});
