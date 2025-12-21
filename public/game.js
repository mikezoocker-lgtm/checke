// WebSocket
const proto = location.protocol === "https:" ? "wss" : "ws";
const socket = new WebSocket(`${proto}://${location.host}`);

// Host-Auth
const params = new URLSearchParams(location.search);
const hostKey = params.get("host");

socket.addEventListener("open", () => {
  if (hostKey) {
    socket.send(JSON.stringify({ type: "auth", key: hostKey }));
  }
});

// DOM
const boardEl = document.getElementById("board");
const dialog = document.getElementById("questionDialog");
const scoreAEl = document.getElementById("scoreA");
const scoreBEl = document.getElementById("scoreB");

let gameState = null;
let isHost = false;

// Nachrichten vom Server
socket.onmessage = (event) => {
  const msg = JSON.parse(event.data);

  if (msg.type === "state") {
    gameState = msg.game;
    render();
  }

  if (msg.type === "info") {
  isHost = msg.isHost === true;

  // Badge + Hinweis aktualisieren
  const badge = document.getElementById("roleBadge");
  const hint = document.getElementById("roleHint");

  if (badge) badge.textContent = isHost ? "HOST" : "ZUSCHAUER";
  if (hint) hint.style.display = isHost ? "none" : "block";

  // Buttons sperren/freigeben
  document.getElementById("activeA").disabled = !isHost;
  document.getElementById("activeB").disabled = !isHost;
  document.getElementById("correctBtn").disabled = !isHost;
  document.getElementById("wrongBtn").disabled = !isHost;
}
};

// Render-Funktion
function render() {
  if (!gameState) return;

  scoreAEl.textContent = gameState.scores.A;
  scoreBEl.textContent = gameState.scores.B;

  boardEl.innerHTML = "";

  // Kategorien
  gameState.categories.forEach(cat => {
    const div = document.createElement("div");
    div.className = "category";
    div.textContent = cat;
    boardEl.appendChild(div);
  });

  // Spielfelder
  gameState.board.forEach((row, r) => {
    row.forEach((cell, c) => {
      const btn = document.createElement("button");
      btn.className = "cell";
      btn.textContent = cell.value;

      if (cell.used) btn.classList.add("used");

      btn.onclick = () => {
 	if (!isHost) btn.disabled = true;
  	if (cell.used) return;
 	socket.send(JSON.stringify({ type: "open", r, c }));
      };

      boardEl.appendChild(btn);
    });
  });

  // Dialog
  if (gameState.current) {
    document.getElementById("questionTitle").textContent =
      `${gameState.current.category} – ${gameState.current.value} Punkte`;
    document.getElementById("questionText").textContent =
      gameState.current.q;

    if (!dialog.open) dialog.showModal();
  } else {
    if (dialog.open) dialog.close();
  }
}

// Buttons
document.getElementById("correctBtn").onclick = () => {
  socket.send(JSON.stringify({ type: "answer", correct: true }));
};

document.getElementById("wrongBtn").onclick = () => {
  socket.send(JSON.stringify({ type: "answer", correct: false }));
};

document.getElementById("activeA").onclick = () => {
  socket.send(JSON.stringify({ type: "team", team: "A" }));
};

document.getElementById("activeB").onclick = () => {
  socket.send(JSON.stringify({ type: "team", team: "B" }));
};