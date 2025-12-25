const express = require("express");
const WebSocket = require("ws");
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");

// ─────────────────────────────────────────────
// Fragen laden
const QUESTIONS_PATH = path.join(__dirname, "questions.json");
const questions = JSON.parse(fs.readFileSync(QUESTIONS_PATH, "utf-8"));

if (!Array.isArray(questions.categories) || !Array.isArray(questions.values) || !Array.isArray(questions.clues)) {
  throw new Error("questions.json Formatfehler: categories/values/clues müssen Arrays sein.");
}
if (questions.clues.length !== questions.values.length) {
  throw new Error("questions.json Formatfehler: clues muss gleich viele Zeilen haben wie values.");
}

// ─────────────────────────────────────────────
// Express + Static
const app = express();
// Cache für Render/Browser deaktivieren (wichtig bei Deploys!)
app.use((req, res, next) => {
  res.setHeader("Cache-Control", "no-store");
  next();
});
app.use(express.static(path.join(__dirname, "public"), { etag: false, maxAge: 0 }));

const PORT = process.env.PORT || 3000;
const server = app.listen(PORT, () => console.log(`HTTP Server läuft auf http://localhost:${PORT}`));

// WebSocket
const wss = new WebSocket.Server({ server });

// Host Key (Render: als Environment Variable setzen!)
const HOST_KEY = process.env.HOST_KEY || crypto.randomBytes(12).toString("hex");
console.log("HOST_KEY (nur Host):", HOST_KEY);

// ─────────────────────────────────────────────
// Spielzustand
let game = {
  categories: questions.categories,

  players: [
    { id: "p1", name: "Spieler 1", score: 0 },
    { id: "p2", name: "Spieler 2", score: 0 }
  ],
  activePlayerId: "p1",

  board: questions.values.map((v) => questions.categories.map(() => ({ value: v, used: false }))),

  // aktuell offene Frage
  current: null, // { r, c } | null

  // Ablauf
  phase: "idle",            // "idle" | "clue" | "buzz"
  chooserPlayerId: null,    // der, der zuerst antwortet
  lockedBuzzPlayerId: null, // erster buzzer
  buzzedPlayerIds: []       // bereits falsch in dieser Buzz-Runde
};

function getClue(r, c) {
  return questions.clues[r]?.[c] || null;
}

function ensureActivePlayer() {
  if (!game.players.length) {
    game.activePlayerId = null;
    return;
  }
  if (!game.players.some(p => p.id === game.activePlayerId)) {
    game.activePlayerId = game.players[0].id;
  }
}

function addPlayer(name) {
  const safeName = (typeof name === "string" && name.trim()) ? name.trim() : `Spieler ${game.players.length + 1}`;
  const id = `p_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
  game.players.push({ id, name: safeName, score: 0 });
  ensureActivePlayer();
}

function removePlayer(id) {
  if (typeof id !== "string") return;

  game.players = game.players.filter(p => p.id !== id);
  game.buzzedPlayerIds = game.buzzedPlayerIds.filter(x => x !== id);
  if (game.lockedBuzzPlayerId === id) game.lockedBuzzPlayerId = null;

  // falls chooser/active gelöscht wurde:
  if (game.chooserPlayerId === id) game.chooserPlayerId = null;
  if (game.activePlayerId === id) ensureActivePlayer();

  // wenn keine Spieler mehr -> Runde abbrechen
  if (!game.players.length) {
    game.current = null;
    game.phase = "idle";
    game.chooserPlayerId = null;
    game.lockedBuzzPlayerId = null;
    game.buzzedPlayerIds = [];
  }
}

function renamePlayer(id, name) {
  if (typeof id !== "string") return;
  if (typeof name !== "string" || !name.trim()) return;
  const p = game.players.find(p => p.id === id);
  if (p) p.name = name.trim();
}

function setActivePlayer(id) {
  if (game.players.some(p => p.id === id)) {
    game.activePlayerId = id;
  }
}

function resetGame() {
  game.players.forEach(p => p.score = 0);
  game.board = questions.values.map((v) => questions.categories.map(() => ({ value: v, used: false })));
  game.current = null;
  game.phase = "idle";
  game.chooserPlayerId = null;
  game.lockedBuzzPlayerId = null;
  game.buzzedPlayerIds = [];
  ensureActivePlayer();
}

// ─────────────────────────────────────────────
// Public State (Host sieht Antworten)
function publicStateFor(ws) {
  let current = null;

  if (game.current) {
    const { r, c } = game.current;
    const clue = getClue(r, c);

    current = {
      r, c,
      category: game.categories[c],
      value: game.board[r]?.[c]?.value ?? 0,
      q: clue?.q ?? "❌ Frage fehlt"
    };

    if (ws?.isHost) {
      current.answers = Array.isArray(clue?.a) ? clue.a : [];
    }
  }

  return {
    categories: game.categories,
    board: game.board,
    players: game.players,
    activePlayerId: game.activePlayerId,

    phase: game.phase,
    chooserPlayerId: game.chooserPlayerId,
    lockedBuzzPlayerId: game.lockedBuzzPlayerId,
    buzzedPlayerIds: game.buzzedPlayerIds,

    current
  };
}

function sendState(ws) {
  ws.send(JSON.stringify({ type: "state", game: publicStateFor(ws) }));
}

function broadcast() {
  for (const c of wss.clients) {
    if (c.readyState === WebSocket.OPEN) {
      c.send(JSON.stringify({ type: "state", game: publicStateFor(c) }));
    }
  }
}

// ─────────────────────────────────────────────
// WebSocket
wss.on("connection", (ws) => {
  ws.isHost = false;

  sendState(ws);
  ws.send(JSON.stringify({ type: "info", isHost: false }));

  ws.on("message", (raw) => {
    let msg;
    try { msg = JSON.parse(raw.toString()); } catch { return; }

    // AUTH
    if (msg.type === "auth") {
      ws.isHost = (typeof msg.key === "string" && msg.key === HOST_KEY);
      ws.send(JSON.stringify({ type: "info", isHost: ws.isHost, error: ws.isHost ? null : "Falscher Host-Key" }));
      sendState(ws); // Host bekommt direkt answers
      return;
    }

    // BUZZ: darf auch ohne Host
    if (msg.type === "buzz") {
      if (game.phase !== "buzz") return;

      const playerId = msg.playerId;
      if (typeof playerId !== "string") return;
      if (!game.players.some(p => p.id === playerId)) return;

      // lock schon gesetzt
      if (game.lockedBuzzPlayerId) return;

      // schon falsch in dieser Runde
      if (game.buzzedPlayerIds.includes(playerId)) return;

      game.lockedBuzzPlayerId = playerId;
      broadcast();
      return;
    }

    // Ab hier: Host-only
    if (!ws.isHost) return;

    // Spielerverwaltung
    if (msg.type === "player_add") {
      addPlayer(msg.name);
      broadcast();
      return;
    }

    if (msg.type === "player_remove") {
      removePlayer(msg.id);
      broadcast();
      return;
    }

    if (msg.type === "player_rename") {
      renamePlayer(msg.id, msg.name);
      broadcast();
      return;
    }

    if (msg.type === "player_set_active") {
      setActivePlayer(msg.id);
      broadcast();
      return;
    }

    if (msg.type === "reset") {
      resetGame();
      broadcast();
      return;
    }

    // Frage öffnen
    if (msg.type === "open") {
      const { r, c } = msg;
      if (!Number.isInteger(r) || !Number.isInteger(c)) return;
      if (!game.board[r]?.[c] || game.board[r][c].used) return;

      ensureActivePlayer();

      game.current = { r, c };
      game.phase = "clue";
      game.chooserPlayerId = game.activePlayerId;
      game.lockedBuzzPlayerId = null;
      game.buzzedPlayerIds = [];

      broadcast();
      return;
    }

    // Host bewertet
    if (msg.type === "judge") {
      if (!game.current) return;

      const cell = game.board[game.current.r]?.[game.current.c];
      if (!cell || cell.used) return;

      const answeringId =
        game.phase === "buzz" && game.lockedBuzzPlayerId
          ? game.lockedBuzzPlayerId
          : game.chooserPlayerId;

      if (!answeringId) return;

      const player = game.players.find(p => p.id === answeringId);
      if (!player) return;

      const value = cell.value;

      if (msg.result === "correct") {
        player.score += value;
        cell.used = true;

        // Gewinner wählt als nächstes (klassisch)
        game.activePlayerId = player.id;

        // Runde beenden
        game.current = null;
        game.phase = "idle";
        game.chooserPlayerId = null;
        game.lockedBuzzPlayerId = null;
        game.buzzedPlayerIds = [];

        broadcast();
        return;
      }

      if (msg.result === "wrong") {
        player.score -= value;

        // markiere diesen Spieler als "falsch gewesen"
        if (!game.buzzedPlayerIds.includes(answeringId)) {
          game.buzzedPlayerIds.push(answeringId);
        }

        // starte/bleibe in buzz phase
        game.phase = "buzz";
        game.lockedBuzzPlayerId = null;

        broadcast();
        return;
      }
    }

    // Weiter ohne Antwort
    if (msg.type === "end_clue_no_buzz") {
      if (!game.current) return;

      const cell = game.board[game.current.r]?.[game.current.c];
      if (cell) cell.used = true;

      game.current = null;
      game.phase = "idle";
      game.chooserPlayerId = null;
      game.lockedBuzzPlayerId = null;
      game.buzzedPlayerIds = [];

      // optional: nächster Spieler
      const idx = game.players.findIndex(p => p.id === game.activePlayerId);
      if (idx !== -1 && game.players.length) {
        game.activePlayerId = game.players[(idx + 1) % game.players.length].id;
      }

      broadcast();
      return;
    }
  });
});