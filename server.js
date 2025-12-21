const express = require("express");
const WebSocket = require("ws");
const path = require("path");
const fs = require("fs");

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
// Spielzustand
let game = {
  categories: questions.categories,
  activeTeam: "A",
  scores: { A: 0, B: 0 },

  board: questions.values.map((value) =>
    questions.categories.map(() => ({
      value,
      used: false
    }))
  ),

  current: null // { r, c }
};

// Antworten bleiben serverseitig
function getClue(r, c) {
  return questions.clues[r]?.[c];
}

// Nur sichere Daten an Clients senden
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
  wss.clients.forEach(c => {
    if (c.readyState === WebSocket.OPEN) c.send(msg);
  });
}

// ─────────────────────────────────────────────────────────────
// WebSocket
wss.on("connection", (ws) => {
  ws.send(JSON.stringify({ type: "state", game: publicState() }));

  ws.on("message", (raw) => {
    const msg = JSON.parse(raw.toString());

    if (msg.type === "team") {
      game.activeTeam = msg.team;
      broadcast();
    }

    if (msg.type === "open") {
      const { r, c } = msg;
      if (!game.board[r]?.[c] || game.board[r][c].used) return;
      game.current = { r, c };
      broadcast();
    }

    if (msg.type === "answer") {
      if (!game.current) return;

      const { r, c } = game.current;
      const cell = game.board[r][c];
      cell.used = true;

      const value = cell.value;
      game.scores[game.activeTeam] += msg.correct ? value : -value;

      game.current = null;
      broadcast();
    }
  });
});