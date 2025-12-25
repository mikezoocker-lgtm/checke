const proto = location.protocol === "https:" ? "wss" : "ws";
const socket = new WebSocket(`${proto}://${location.host}`);

const params = new URLSearchParams(location.search);
const hostKey = params.get("host");
console.log("URL =", location.href);
console.log("hostKey aus URL =", hostKey);

const boardEl = document.getElementById("board");
const dialog = document.getElementById("questionDialog");

let gameState = null;
let isHost = false;
let myPlayerId = localStorage.getItem("jeopardy_player_id") || "";

socket.addEventListener("open", () => {
  console.log("WebSocket offen");
  console.log("Sende Host-Key:", hostKey);

  if (hostKey) {
    socket.send(JSON.stringify({ type: "auth", key: hostKey }));
  }
});

socket.onmessage = (event) => {
  const msg = JSON.parse(event.data);

if (msg.type === "info") {
  console.log("INFO vom Server:", msg);
  isHost = msg.isHost === true;

  // Badge im UI setzen
  const badge = document.getElementById("roleBadge");
  if (badge) badge.textContent = isHost ? "HOST" : "ZUSCHAUER";

  // Wenn Key falsch: direkt anzeigen
  if (msg.error) alert(msg.error);
}
    document.getElementById("roleBadge").textContent = isHost ? "HOST" : "ZUSCHAUER";
    // Host-only controls enable/disable
    document.getElementById("addPlayerBtn").disabled = !isHost;
    document.getElementById("newPlayerName").disabled = !isHost;
    document.getElementById("resetBtn").disabled = !isHost;
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
  renderQuestionPanel();
  renderHostDialog();
  renderBuzzUI();
}

function renderPlayers() {
  // Dropdown "Ich bin"
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

  sel.value = myPlayerId;

  if (myPlayerId && !gameState.players.some(p => p.id === myPlayerId)) {
    myPlayerId = "";
    localStorage.removeItem("jeopardy_player_id");
    sel.value = "";
  }

  sel.onchange = (e) => {
    myPlayerId = e.target.value;
    if (myPlayerId) localStorage.setItem("jeopardy_player_id", myPlayerId);
    else localStorage.removeItem("jeopardy_player_id");
    renderBuzzUI();
  };

  // Active label
  const active = gameState.players.find(p => p.id === gameState.activePlayerId);
  document.getElementById("activeLabel").textContent = active ? `Aktiv: ${active.name}` : "Aktiv: –";

  // Liste (Host kann rename/delete/set active)
  const list = document.getElementById("playersList");
  list.innerHTML = "";

  for (const p of gameState.players) {
    const row = document.createElement("div");
    row.className = "playerRow";

    const dot = document.createElement("div");
    dot.className = "dot" + (p.id === gameState.activePlayerId ? " on" : "");
    row.appendChild(dot);

    if (isHost) {
      const inp = document.createElement("input");
      inp.className = "playerNameInput";
      inp.value = p.name;
      inp.addEventListener("change", () => {
        socket.send(JSON.stringify({ type: "player_rename", id: p.id, name: inp.value }));
      });
      row.appendChild(inp);
    } else {
      const name = document.createElement("div");
      name.textContent = p.name;
      row.appendChild(name);
    }

    const score = document.createElement("div");
    score.className = "playerScore";
    score.textContent = String(p.score);
    row.appendChild(score);

    if (isHost) {
      const setBtn = document.createElement("button");
      setBtn.textContent = "Aktiv";
      setBtn.onclick = () => socket.send(JSON.stringify({ type: "player_set_active", id: p.id }));
      row.appendChild(setBtn);

      const delBtn = document.createElement("button");
      delBtn.textContent = "Löschen";
      delBtn.className = "danger";
      delBtn.onclick = () => socket.send(JSON.stringify({ type: "player_remove", id: p.id }));
      row.appendChild(delBtn);
    }

    list.appendChild(row);
  }
}

function renderBoard() {
  boardEl.innerHTML = "";

  // Kategorien
  for (const cat of gameState.categories) {
    const div = document.createElement("div");
    div.className = "category";
    div.textContent = cat;
    boardEl.appendChild(div);
  }

  // Felder
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

function renderQuestionPanel() {
  const panel = document.getElementById("questionPanel");
  const title = document.getElementById("qpTitle");
  const text = document.getElementById("qpText");
  const phase = document.getElementById("qpPhase");

  if (!gameState.current) {
    panel.style.display = "none";
    return;
  }

  panel.style.display = "block";
  title.textContent = `${gameState.current.category} – ${gameState.current.value} Punkte`;
  text.textContent = gameState.current.q;

  phase.textContent =
    gameState.phase === "clue" ? "FRAGE" :
    gameState.phase === "buzz" ? "BUZZ!" :
    "—";
}

function renderHostDialog() {
  // Host sieht modal (bewerten), Spieler NICHT -> Buzz bleibt klickbar
  if (!isHost) {
    if (dialog.open) dialog.close();
    return;
  }

  if (!gameState.current) {
    if (dialog.open) dialog.close();
    return;
  }

  document.getElementById("questionTitle").textContent =
    `${gameState.current.category} – ${gameState.current.value} Punkte`;
  document.getElementById("questionText").textContent =
    gameState.current.q;

  const hostBox = document.getElementById("hostAnswerBox");
  if (Array.isArray(gameState.current.answers)) {
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

  const canBuzz =
    !!gameState.current &&
    gameState.phase === "buzz" &&
    !!myPlayerId &&
    !gameState.lockedBuzzPlayerId &&
    !gameState.buzzedPlayerIds.includes(myPlayerId);

  buzzBtn.disabled = !canBuzz;
}

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

document.getElementById("addPlayerBtn").onclick = () => {
  if (!isHost) return;
  const inp = document.getElementById("newPlayerName");
  socket.send(JSON.stringify({ type: "player_add", name: inp.value }));
  inp.value = "";
};

document.getElementById("resetBtn").onclick = () => {
  if (!isHost) return;
  socket.send(JSON.stringify({ type: "reset" }));
};