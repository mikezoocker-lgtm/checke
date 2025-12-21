// WebSocket: automatisch ws/wss
const proto = location.protocol === "https:" ? "wss" : "ws";
const socket = new WebSocket(`${proto}://${location.host}`);

// Host via URL: ?host=KEY (optional)
const params = new URLSearchParams(location.search);
const hostKey = params.get("host");

// UI
const boardEl = document.getElementById("board");
const dialog = document.getElementById("questionDialog");

let gameState = null;
let isHost = false;
let myPlayerId = localStorage.getItem("jeopardy_player_id") || "";

// Auth (wenn Host-Key vorhanden)
socket.addEventListener("open", () => {
  if (hostKey) {
    socket.send(JSON.stringify({ type: "auth", key: hostKey }));
  }
});

socket.onmessage = (event) => {
  const msg = JSON.parse(event.data);

  if (msg.type === "info") {
    isHost = msg.isHost === true;
  }

  if (msg.type === "state") {
    gameState = msg.game;
    render();
  }
};

function render() {
  if (!gameState) return;
  renderPlayers();
  renderBoard();
  renderDialog();
  renderBuzzUI();
}

function renderPlayers() {
  // Dropdown
  const sel = document.getElementById("playerSelect");
  sel.innerHTML = "";

  const opt0 = document.createElement("option");
  opt0.value = "";
  opt0.textContent = "— auswählen —";
  sel.appendChild(opt0);

  for (const p of gameState.players) {
    const opt = document.createElement("option");
    opt.value = p.id;
    opt.textContent = p.name;
    sel.appendChild(opt);
  }

  // Restore selection
  sel.value = myPlayerId;

  // If selected player vanished:
  if (myPlayerId && !gameState.players.some(p => p.id === myPlayerId)) {
    myPlayerId = "";
    localStorage.removeItem("jeopardy_player_id");
    sel.value = "";
  }

  // Score list
  const list = document.getElementById("playersList");
  list.innerHTML = "";
  for (const p of gameState.players) {
    const line = document.createElement("div");
    line.className = "playerLine";

    const dot = document.createElement("div");
    dot.className = "dot" + (p.id === gameState.activePlayerId ? " on" : "");
    line.appendChild(dot);

    const name = document.createElement("div");
    name.className = "name";
    name.textContent = p.name;
    line.appendChild(name);

    const score = document.createElement("div");
    score.className = "score";
    score.textContent = String(p.score);
    line.appendChild(score);

    list.appendChild(line);
  }

  // change handler (only set once safely)
  sel.onchange = (e) => {
    myPlayerId = e.target.value;
    if (myPlayerId) localStorage.setItem("jeopardy_player_id", myPlayerId);
    else localStorage.removeItem("jeopardy_player_id");
    renderBuzzUI();
  };
}

function renderBoard() {
  boardEl.innerHTML = "";

  // categories row
  for (const cat of gameState.categories) {
    const div = document.createElement("div");
    div.className = "category";
    div.textContent = cat;
    boardEl.appendChild(div);
  }

  // cells
  gameState.board.forEach((row, r) => {
    row.forEach((cell, c) => {
      const btn = document.createElement("button");
      btn.className = "cell";
      btn.textContent = cell.value;

      if (cell.used) btn.classList.add("used");

      btn.onclick = () => {
        if (!isHost) return;
        if (cell.used) return;
        socket.send(JSON.stringify({ type: "open", r, c }));
      };

      boardEl.appendChild(btn);
    });
  });
}

function renderDialog() {
  if (!gameState.current) {
    if (dialog.open) dialog.close();
    return;
  }

  document.getElementById("questionTitle").textContent =
    `${gameState.current.category} – ${gameState.current.value} Punkte`;

  document.getElementById("questionText").textContent =
    gameState.current.q;

  // Host sees answers
  const hostBox = document.getElementById("hostAnswerBox");
  if (isHost && Array.isArray(gameState.current.answers)) {
    hostBox.textContent = `Lösung(en): ${gameState.current.answers.join(" / ")}`;
    hostBox.style.display = "block";
  } else {
    hostBox.textContent = "";
    hostBox.style.display = "none";
  }

  if (!dialog.open) dialog.showModal();
}

function renderBuzzUI() {
  const buzzBtn = document.getElementById("buzzBtn");
  const status = document.getElementById("buzzStatus");

  // Status text
  if (!gameState.current) {
    status.textContent = "";
  } else if (gameState.phase === "clue") {
    const chooser = gameState.players.find(p => p.id === gameState.chooserPlayerId);
    status.textContent = chooser ? `Antwortet zuerst: ${chooser.name}` : "Antwortet zuerst: –";
  } else if (gameState.phase === "buzz") {
    if (gameState.lockedBuzzPlayerId) {
      const p = gameState.players.find(x => x.id === gameState.lockedBuzzPlayerId);
      status.textContent = p ? `Buzz gewonnen: ${p.name}` : "Buzz gewonnen.";
    } else {
      status.textContent = "Buzz-Phase: Jetzt buzzern!";
    }
  } else {
    status.textContent = "";
  }

  // Can buzz?
  const canBuzz =
    !!gameState.current &&
    gameState.phase === "buzz" &&
    !!myPlayerId &&
    !gameState.lockedBuzzPlayerId &&
    !gameState.buzzedPlayerIds.includes(myPlayerId);

  buzzBtn.disabled = !canBuzz;
}

// ─────────────────────────────────────────────
// Buttons

document.getElementById("buzzBtn").onclick = () => {
  if (!myPlayerId) {
    alert("Bitte zuerst 'Ich bin' auswählen.");
    return;
  }
  socket.send(JSON.stringify({ type: "buzz", playerId: myPlayerId }));
};

document.getElementById("correctBtn").onclick = () => {
  if (!isHost) return;
  socket.send(JSON.stringify({ type: "judge", result: "correct" }));
};

document.getElementById("wrongBtn").onclick = () => {
  if (!isHost) return;
  socket.send(JSON.stringify({ type: "judge", result: "wrong" }));
};

document.getElementById("endNoBuzzBtn").onclick = () => {
  if (!isHost) return;
  socket.send(JSON.stringify({ type: "end_clue_no_buzz" }));
};