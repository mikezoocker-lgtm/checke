const express = require("express");
const WebSocket = require("ws");
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");

// ─────────────────────────────────────────────────────────────
// Fragen laden
const QUESTIONS_PATH = path.join(__dirname, "questions.json");
const questions = JSON.parse(fs.readFileSync(QUESTIONS_PATH, "utf-8"));

// ─────────────────────────────────────────────────────────────
// Express → public/ ausliefern
const app = express();
app.use(express.static(path.join(__dirname, "public")));

const PORT = process.env.PORT || 3000;
const server = app.listen(PORT, () => {
  console.log(`HTTP Server läuft auf http://localhost:${PORT}`);
});

const wss = new WebSocket.Server({ server });

// ─────────────────────────────────────────────────────────────
// HOST KEY
// Option A (empfohlen): Setze HOST_KEY als Environment Variable (Render -> Environment -> HOST_KEY)
// Option B: Falls nicht gesetzt, wird einmalig ein Key generiert und im Log ausgegeben.
const HOST_KEY = process.env.HOST_KEY || crypto.randomBytes(12).toString("hex");
console.log("HOST_KEY (nur Host benutzen):", HOST_KEY);

// ─────────────────────────────────────────────────────────────
// Spielzustand
let game = {
  categories: questions.categories,
  activeTeam: "A",
  scores: { A: 0, B: 0 },

  board: questions.values.map((value) =>
    questions.categories.map(() => ({ value, used: false }))
  ),

  current: null // { r, c }
};

function getClue(r, c) {
  return questions.clues[r]?.[c];
}

// Nur sichere Daten an Clients senden (keine Antworten)
function publicState() {
  let currentClue = null;

  if (game.current) {
    const { r, c } = game.current;
    const clue = getClue(r, c);

    currentClue = {
      r,
      c,
      category: game.categories[c],
      value: game.board[r][c].value,
      q: clue?.q ?? "❌ Frage fehlt"
    };
  }

  return {
    categories: game.categories,
    scores: game.scores,
    board: game.board,
    activeTeam: game.activeTeam,
    current: currentClue
  };
}

function broadcast() {
  const msg = JSON.stringify({ type: "state", game: publicState() });
  wss.clients.forEach((c) => {
    if (c.readyState === WebSocket.OPEN) c.send(msg);
  });
}

// Hilfsfunktion: nur Host darf steuern
function requireHost(ws) {
  return ws.isHost === true;
}

// ─────────────────────────────────────────────────────────────
// WebSocket
wss.on("connection", (ws) => {
  ws.isHost = false;

  // State an neuen Client
  ws.send(JSON.stringify({ type: "state", game: publicState() }));

  // Optional: Client-Info
  ws.send(JSON.stringify({ type: "info", isHost: ws.isHost }));

  ws.on("message", (raw) => {
    let msg;
    try {
      msg = JSON.parse(raw.toString());
    } catch {
      return;
    }

    // 1) AUTH: Client kann sich als Host ausweisen
    // Client sendet: { type:"auth", key:"..." }
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

    // Ab hier: nur Host darf steuern
    if (!requireHost(ws)) {
      // Nicht-Host darf nichts steuern → ignorieren
      return;
    }

    if (msg.type === "team") {
      if (msg.team === "A" || msg.team === "B") {
        game.activeTeam = msg.team;
        broadcast();
      }
      return;
    }

    if (msg.type === "open") {
      const { r, c } = msg;
      if (!Number.isInteger(r) || !Number.isInteger(c)) return;
      if (!game.board[r]?.[c] || game.board[r][c].used) return;

      game.current = { r, c };
      broadcast();
      return;
    }

    if (msg.type === "answer") {
      if (!game.current) return;

      const { r, c } = game.current;
      const cell = game.board[r]?.[c];
      if (!cell) return;

      cell.used = true;

      const value = cell.value;
      game.scores[game.activeTeam] += msg.correct ? value : -value;

      game.current = null;
      broadcast();
      return;
    }

    // Optional: reset-Button später
    if (msg.type === "reset") {
      game.scores = { A: 0, B: 0 };
      game.board = questions.values.map((value) =>
        questions.categories.map(() => ({ value, used: false }))
      );
      game.current = null;
      game.activeTeam = "A";
      broadcast();
      return;
    }
  });
});