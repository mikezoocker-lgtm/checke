// WebSocket: automatisch ws/wss korrekt wählen
const proto = location.protocol === "https:" ? "wss" : "ws";
const socket = new WebSocket(`${proto}://${location.host}`);

// Host-Auth via URL: ?host=DEINKEY
const params = new URLSearchParams(location.search);
const hostKey = params.get("host");

// DOM
const boardEl = document.getElementById("board");
const dialog = document.getElementById("questionDialog");

let gameState = null;
let isHost = false;

// Beim Connect ggf. Host-Key senden
socket.addEventListener("open", () => {
  if (hostKey) {
    socket.send(JSON.stringify({ type: "auth", key: hostKey }));
  }
});

// UI für Rolle anwenden
function applyRoleUI() {
  const badge = document.getElementById("roleBadge");
  const hint = document.getElementById("roleHint");

  if (badge) badge.textContent = isHost ? "HOST" : "ZUSCHAUER";
  if (hint) hint.style.display = isHost ? "none" : "block";

  // Buttons sperren/freigeben
  const ids = ["addPlayerBtn", "resetBtn", "correctBtn", "wrongBtn", "newPlayerName"];
  for (const id of ids) {
    const el = document.getElementById(id);
    if (el) el.disabled = !isHost;
  }
}

// Server-Nachrichten
socket.onmessage = (event) => {
  const msg = JSON.parse(event.data);

  if (msg.type === "state") {
    gameState = msg.game;
    render();
  }

  if (msg.type === "info") {
    isHost = msg.isHost === true;
    applyRoleUI();

    if (msg.error) {
      console.warn("Host auth:", msg.error);
    }
  }
};

// ─────────────────────────────────────────────────────────────
// Rendering
function render() {
  if (!gameState) return;

  renderBoard();
  renderPlayers();
  renderDialog();
}

function renderBoard() {
  boardEl.innerHTML = "";

  // Kategorien
  gameState.categories.forEach((cat) => {
    const div = document.createElement("div");
    div.className = "category";
    div.textContent = cat;
    boardEl.appendChild(div);
  });

  // Zellen
  gameState.board.forEach((row, r) => {
    row.forEach((cell, c) => {
      const btn = document.createElement("button");
      btn.className = "cell";
      btn.textContent = cell.value;

      if (cell.used) btn.classList.add("used");

      btn.onclick = () => {
        // Nur Host darf öffnen
        if (!isHost) return;
        if (cell.used) return;

        socket.send(JSON.stringify({ type: "open", r, c }));
      };

      boardEl.appendChild(btn);
    });
  });
}

function renderPlayers() {
  const list = document.getElementById("playersList");
  const label = document.getElementById("activePlayerLabel");
  if (!list || !label) return;

  list.innerHTML = "";

  const active = gameState.players.find((p) => p.id === gameState.activePlayerId);
  label.textContent = active ? `Aktiv: ${active.name}` : "Aktiv: –";

  for (const p of gameState.players) {
    const row = document.createElement("div");
    row.className = "playerRow";

    const dot = document.createElement("div");
    dot.className = "activeDot" + (p.id === gameState.activePlayerId ? " on" : "");
    row.appendChild(dot);

    const nameInput = document.createElement("input");
    nameInput.type = "text";
    nameInput.className = "playerName";
    nameInput.value = p.name;
    nameInput.disabled = !isHost;

    // Umbenennen bei "change" (wenn Fokus weg / Enter je nach Browser)
    nameInput.addEventListener("change", () => {
      socket.send(JSON.stringify({ type: "player_rename", id: p.id, name: nameInput.value }));
    });

    row.appendChild(nameInput);

    const score = document.createElement("div");
    score.className = "playerScore";
    score.textContent = `${p.score}`;
    row.appendChild(score);

    const setBtn = document.createElement("button");
    setBtn.textContent = "Aktiv";
    setBtn.disabled = !isHost;
    setBtn.onclick = () => socket.send(JSON.stringify({ type: "player_set_active", id: p.id }));
    row.appendChild(setBtn);

    const delBtn = document.createElement("button");
    delBtn.textContent = "Löschen";
    delBtn.disabled = !isHost;
    delBtn.onclick = () => socket.send(JSON.stringify({ type: "player_remove", id: p.id }));
    row.appendChild(delBtn);

    list.appendChild(row);
  }
}

function renderDialog() {
  if (gameState.current) {
    document.getElementById("questionTitle").textContent =
      `${gameState.current.category} – ${gameState.current.value} Punkte`;
    document.getElementById("questionText").textContent = gameState.current.q;

    if (!dialog.open) dialog.showModal();
  } else {
    if (dialog.open) dialog.close();
  }
}

// ─────────────────────────────────────────────────────────────
// Buttons
document.getElementById("addPlayerBtn").onclick = () => {
  if (!isHost) return;
  const inp = document.getElementById("newPlayerName");
  const name = inp.value;
  socket.send(JSON.stringify({ type: "player_add", name }));
  inp.value = "";
};

document.getElementById("resetBtn").onclick = () => {
  if (!isHost) return;
  socket.send(JSON.stringify({ type: "reset" }));
};

document.getElementById("correctBtn").onclick = () => {
  if (!isHost) return;
  socket.send(JSON.stringify({ type: "answer", correct: true }));
};

document.getElementById("wrongBtn").onclick = () => {
  if (!isHost) return;
  socket.send(JSON.stringify({ type: "answer", correct: false }));
};

// Initial UI state (falls info noch nicht da ist)
applyRoleUI();