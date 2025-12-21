const express = require("express");
const WebSocket = require("ws");
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");

// ─────────────────────────────────────────────────────────────
// Fragen laden
const QUESTIONS_PATH = path.join(__dirname, "questions.json");
const questions = JSON.parse(fs.readFileSync(QUESTIONS_PATH, "utf-8"));

if (!Array.isArray(questions.categories) || !Array.isArray(questions.values) || !Array.isArray(questions.clues)) {
  throw new Error("questions.json Formatfehler: categories/values/clues müssen Arrays sein.");
}
if (questions.clues.length !== questions.values.length) {
  throw new Error("questions.json Formatfehler: clues-Zeilen müssen gleich viele sein wie values.");
}

// ─────────────────────────────────────────────────────────────
// Express
const app = express();
app.use(express.static(path.join(__dirname, "public")));

const PORT = process.env.PORT || 3000;
const server = app.listen(PORT, () => console.log(`Server läuft auf http://localhost:${PORT}`));

const wss = new WebSocket.Server({ server });

// ─────────────────────────────────────────────────────────────
// HOST_KEY (auf Render als Environment Variable setzen!)
const HOST_KEY = process.env.HOST_KEY || crypto.randomBytes(12).toString("hex");
console.log("HOST_KEY:", HOST_KEY);

// ─────────────────────────────────────────────────────────────
// Spielzustand
let game = {
  categories: questions.categories,

  // Spieler (Teams = Spieler)
  players: [
    { id: "p1", name: "Spieler 1", score: 0 },
    { id: "p2", name: "Spieler 2", score: 0 }
  ],
  activePlayerId: "p1",

  board: questions.values.map((v) => questions.categories.map(() => ({ value: v, used: false }))),

  current: null, // { r, c } oder null

  // Ablauf/Phasen
  phase: "idle",            // "idle" | "clue" | "buzz"
  chooserPlayerId: null,    // wer hat gewählt (antwortet zuerst)
  lockedBuzzPlayerId: null, // wer hat gebuzzert und ist dran
  buzzedPlayerIds: []       // wer schon falsch war in dieser Buzz-Runde
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

function nextPlayer() {
  if (!game.players.length) {
    game.activePlayerId = null;
    return;
  }
  const idx = game.players.findIndex(p => p.id === game.activePlayerId);
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
  game.players = game.players.filter(p => p.id !== id);

  // wenn entfernte Person aktiv/chooser/locked war -> bereinigen
  if (game.activePlayerId === id) ensureActivePlayer();
  if (game.chooserPlayerId === id) game.chooserPlayerId = game.activePlayerId;
  if (game.lockedBuzzPlayerId === id) game.lockedBuzzPlayerId = null;
  game.buzzedPlayerIds = game.buzzedPlayerIds.filter(x => x !== id);

  // wenn keine Spieler mehr, Runde abbrechen
  if (!game.players.length) {
    game.current = null;
    game.phase = "idle";
    game.chooserPlayerId = null;
    game.lockedBuzzPlayerId = null;
    game.buzzedPlayerIds = [];
  }
}

function renamePlayer(id, name) {
  const p = game.players.find(p => p.id === id);
  if (p && typeof name === "string" && name.trim()) p.name = name.trim();
}

function setActivePlayer(id) {
  if (game.players.some(p => p.id === id)) game.activePlayerId = id;
}

function publicStateFor(ws) {
  let current = null;

  if (game.current) {
    const { r, c } = game.current;
    const clue = getClue(r, c);

    current = {
      r,
      c,
      category: game.categories[c],
      value: game.board[r]?.[c]?.value ?? 0,
      q: clue?.q ?? "❌ Frage fehlt"
    };

    // Nur Host sieht Antworten
    if (ws?.isHost) {
      current.answers = clue?.a ?? [];
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

function broadcast() {
  for (const c of wss.clients) {
    if (c.readyState === WebSocket.OPEN) {
      c.send(JSON.stringify({ type: "state", game: publicStateFor(c) }));
    }
  }
}

function sendState(ws) {
  ws.send(JSON.stringify({ type: "state", game: publicStateFor(ws) }));
}

wss.on("connection", (ws) => {
  ws.isHost = false;

  // initial
  sendState(ws);
  ws.send(JSON.stringify({ type: "info", isHost: ws.isHost }));

  ws.on("message", (raw) => {
    let msg;
    try {
      msg = JSON.parse(raw.toString());
    } catch {
      return;
    }

    // ── Auth (Host)
    if (msg.type === "auth") {
      ws.isHost = typeof msg.key === "string" && msg.key === HOST_KEY;
      ws.send(JSON.stringify({ type: "info", isHost: ws.isHost, error: ws.isHost ? undefined : "Falscher Host-Key" }));
      // direkt danach aktuellen State nochmal senden (damit Host sofort answers sieht)
      sendState(ws);
      return;
    }

    // ─────────────────────────────────────────────
    // BUZZ: darf auch von Nicht-Host kommen
    if (msg.type === "buzz") {
      if (game.phase !== "buzz") return;

      const playerId = msg.playerId;
      if (typeof playerId !== "string") return;

      // jemand ist schon gelockt
      if (game.lockedBuzzPlayerId) return;

      // Spieler darf nicht nochmal, wenn schon falsch
      if (game.buzzedPlayerIds.includes(playerId)) return;

      // optional: nur existierende Spieler
      if (!game.players.some(p => p.id === playerId)) return;

      game.lockedBuzzPlayerId = playerId;
      broadcast();
      return;
    }

    // ─────────────────────────────────────────────
    // Ab hier: Host-only
    if (!ws.isHost) return;

    // Frage öffnen
    if (msg.type === "open") {
      const { r, c } = msg;
      if (!Number.isInteger(r) || !Number.isInteger(c)) return;
      if (!game.board[r]?.[c]) return;
      if (game.board[r][c].used) return;

      ensureActivePlayer();

      game.current = { r, c };
      game.phase = "clue";
      game.chooserPlayerId = game.activePlayerId;

      game.lockedBuzzPlayerId = null;
      game.buzzedPlayerIds = [];

      broadcast();
      return;
    }

    // Host bewertet (richtig/falsch)
    if (msg.type === "judge") {
      if (!game.current) return;

      const cell = game.board[game.current.r]?.[game.current.c];
      if (!cell || cell.used) return;

      // wer antwortet gerade?
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

        // Gewinner darf als nächstes wählen (klassisch)
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

        if (game.phase === "clue") {
          // Buzz-Phase starten, chooser ist raus
          game.phase = "buzz";
          game.buzzedPlayerIds = [answeringId];
          game.lockedBuzzPlayerId = null;
          broadcast();
          return;
        }

        if (game.phase === "buzz") {
          // buzzer ist raus, buzz wieder frei
          if (!game.buzzedPlayerIds.includes(answeringId)) {
            game.buzzedPlayerIds.push(answeringId);
          }
          game.lockedBuzzPlayerId = null;
          broadcast();
          return;
        }
      }

      return;
    }

    // Weiter ohne Antwort (wenn niemand buzzert)
    if (msg.type === "end_clue_no_buzz") {
      if (!game.current) return;

      const cell = game.board[game.current.r]?.[game.current.c];
      if (cell) cell.used = true;

      // Runde beenden
      game.current = null;
      game.phase = "idle";
      game.chooserPlayerId = null;
      game.lockedBuzzPlayerId = null;
      game.buzzedPlayerIds = [];

      // optional: nächste Person ist dran
      nextPlayer();

      broadcast();
      return;
    }

    // Optionaler Reset
    if (msg.type === "reset") {
      game.players.forEach(p => p.score = 0);
      game.board = questions.values.map((v) => questions.categories.map(() => ({ value: v, used: false })));
      game.current = null;

      game.phase = "idle";
      game.chooserPlayerId = null;
      game.lockedBuzzPlayerId = null;
      game.buzzedPlayerIds = [];

      ensureActivePlayer();
      broadcast();
      return;
    }
  });
});