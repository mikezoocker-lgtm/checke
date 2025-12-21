// server.js
const express = require("express");
const WebSocket = require("ws");
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");

// ─────────────────────────────────────────────────────────────
// 1) Fragen laden
const QUESTIONS_PATH = path.join(__dirname, "questions.json");
const questions = JSON.parse(fs.readFileSync(QUESTIONS_PATH, "utf-8"));

// Mini-Validierung (hilft bei JSON-Tippfehlern)
if (!Array.isArray(questions.categories) || !Array.isArray(questions.values) || !Array.isArray(questions.clues)) {
  throw new Error("questions.json Formatfehler: categories/values/clues fehlen oder sind nicht Arrays.");
}
if (questions.clues.length !== questions.values.length) {
  throw new Error("questions.json Formatfehler: clues-Zeilen müssen gleich viele sein wie values.");
}

// ─────────────────────────────────────────────────────────────
// 2) Express: public/ ausliefern
const app = express();
app.use(express.static(path.join(__dirname, "public")));

const PORT = process.env.PORT || 3000;
const server = app.listen(PORT, () => {
  console.log(`HTTP Server läuft auf http://localhost:${PORT}`);
});

// ─────────────────────────────────────────────────────────────
// 3) WebSocket-Server
const wss = new WebSocket.Server({ server });

// ─────────────────────────────────────────────────────────────
// 4) Host-Key (Render: Environment Variable HOST_KEY setzen!)
const HOST_KEY = process.env.HOST_KEY || crypto.randomBytes(12).toString("hex");
console.log("HOST_KEY (nur Host benutzen):", HOST_KEY);

// ─────────────────────────────────────────────────────────────
// 5) Spielzustand (Players statt Teams)
let game = {
  categories: questions.categories,

  // Spieler-Liste (Teams sind jetzt Spieler)
  players: [
    { id: "p1", name: "Spieler 1", score: 0 },
    { id: "p2", name: "Spieler 2", score: 0 }
  ],
  activePlayerId: "p1",

  // Board aus values/categories generieren
  board: questions.values.map((value) =>
    questions.categories.map(() => ({ value, used: false }))
  ),

  // aktuelle offene Frage: { r, c } oder null
  current: null
};

// ─────────────────────────────────────────────────────────────
// 6) Helpers: Fragen aus questions.json
function getClue(r, c) {
  return questions.clues[r]?.[c] || null;
}

// ─────────────────────────────────────────────────────────────
// 7) Helpers: Players
function getActiveIndex() {
  return game.players.findIndex((p) => p.id === game.activePlayerId);
}

function ensureActivePlayer() {
  if (!game.players.length) {
    game.activePlayerId = null;
    return;
  }
  if (getActiveIndex() === -1) {
    game.activePlayerId = game.players[0].id;
  }
}

function nextPlayer() {
  if (!game.players.length) {
    game.activePlayerId = null;
    return;
  }
  const idx = getActiveIndex();
  const nextIdx = idx === -1 ? 0 : (idx + 1) % game.players.length;
  game.activePlayerId = game.players[nextIdx].id;
}

function addPlayer(name) {
  const safeName = typeof name === "string" && name.trim() ? name.trim() : `Spieler ${game.players.length + 1}`;
  const id = `p_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
  game.players.push({ id, name: safeName, score: 0 });
  ensureActivePlayer();
}

function removePlayer(id) {
  if (typeof id !== "string") return;
  game.players = game.players.filter((p) => p.id !== id);
  ensureActivePlayer();
}

function renamePlayer(id, name) {
  if (typeof id !== "string") return;
  if (typeof name !== "string" || !name.trim()) return;
  const p = game.players.find((p) => p.id === id);
  if (p) p.name = name.trim();
}

// ─────────────────────────────────────────────────────────────
// 8) Public State (ohne Antworten)
function publicState() {
  let currentClue = null;

  if (game.current) {
    const { r, c } = game.current;
    const clue = getClue(r, c);

    currentClue = {
      r,
      c,
      category: game.categories[c],
      value: game.board[r]?.[c]?.value ?? 0,
      q: clue?.q ?? "❌ Frage fehlt"
    };
  }

  return {
    categories: game.categories,
    board: game.board,
    players: game.players,
    activePlayerId: game.activePlayerId,
    current: currentClue
  };
}

function sendState(ws) {
  ws.send(JSON.stringify({ type: "state", game: publicState() }));
}

function broadcast() {
  const msg = JSON.stringify({ type: "state", game: publicState() });
  for (const c of wss.clients) {
    if (c.readyState === WebSocket.OPEN) c.send(msg);
  }
}

// ─────────────────────────────────────────────────────────────
// 9) Host-Rechte
function requireHost(ws) {
  return ws.isHost === true;
}

// ─────────────────────────────────────────────────────────────
// 10) WebSocket Handling
wss.on("connection", (ws) => {
  ws.isHost = false;

  // Initial State
  sendState(ws);
  ws.send(JSON.stringify({ type: "info", isHost: ws.isHost }));

  ws.on("message", (raw) => {
    let msg;
    try {
      msg = JSON.parse(raw.toString());
    } catch {
      return;
    }

    // ── AUTH: Client kann Host-Key senden
    // { type: "auth", key: "..." }
    if (msg.type === "auth") {
      if (typeof msg.key === "string" && msg.key === HOST_KEY) {
        ws.isHost = true;
        ws.send(JSON.stringify({ type: "info", isHost: true }));
      } else {
        ws.isHost = false;
        ws.send(JSON.stringify({ type: "info", isHost: false, error: "Falscher Host-Key" }));
      }
      return;
    }

    // Alles ab hier: nur Host darf steuern
    if (!requireHost(ws)) return;

    // ── Spieler verwalten
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
      if (game.players.some((p) => p.id === msg.id)) {
        game.activePlayerId = msg.id;
      }
      broadcast();
      return;
    }

    // ── Frage öffnen
    if (msg.type === "open") {
      const { r, c } = msg;
      if (!Number.isInteger(r) || !Number.isInteger(c)) return;
      if (!game.board[r]?.[c]) return;
      if (game.board[r][c].used) return;

      game.current = { r, c };
      broadcast();
      return;
    }

    // ── Antwort werten (Score + Auto-Spielerwechsel)
    if (msg.type === "answer") {
      if (!game.current) return;

      ensureActivePlayer();
      if (!game.activePlayerId) return;

      const { r, c } = game.current;
      const cell = game.board[r]?.[c];
      if (!cell) return;

      // Nicht doppelt werten
      if (cell.used) {
        game.current = null;
        broadcast();
        return;
      }

      cell.used = true;

      const value = cell.value;
      const active = game.players.find((p) => p.id === game.activePlayerId);

      if (active) {
        if (msg.correct === true) active.score += value;
        else if (msg.correct === false) active.score -= value;
      }

      // Schließen + weiter zum nächsten Spieler
      game.current = null;
      nextPlayer();

      broadcast();
      return;
    }

    // ── Reset (optional)
    if (msg.type === "reset") {
      game.players.forEach((p) => (p.score = 0));
      game.board = questions.values.map((value) =>
        questions.categories.map(() => ({ value, used: false }))
      );
      game.current = null;
      ensureActivePlayer();
      broadcast();
      return;
    }
  });

  ws.on("close", () => {
    // optional: logging
  });
});