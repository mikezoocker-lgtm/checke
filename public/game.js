const proto = location.protocol === "https:" ? "wss" : "ws";
const socket = new WebSocket(`${proto}://${location.host}`);

const boardEl = document.getElementById("board");
const dialog = document.getElementById("questionDialog");

const scoreAEl = document.getElementById("scoreA");
const scoreBEl = document.getElementById("scoreB");

let gameState = null;

// ───────── WebSocket ─────────
socket.onmessage = (event) => {
  const msg = JSON.parse(event.data);
  if (msg.type === "state") {
    gameState = msg.game;
    render();
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
};

// ───────── UI ─────────
function render() {
  scoreAEl.textContent = gameState.scores.A;
  scoreBEl.textContent = gameState.scores.B;

  boardEl.innerHTML = "";

  gameState.categories.forEach(cat => {
    const div = document.createElement("div");
    div.className = "category";
    div.textContent = cat;
    boardEl.appendChild(div);
  });

  gameState.board.forEach((row, r) => {
    row.forEach((cell, c) => {
      const btn = document.createElement("button");
      btn.className = "cell";
      btn.textContent = cell.value;

      if (cell.used) btn.classList.add("used");

      btn.onclick = () => {
        if (cell.used) return;
        socket.send(JSON.stringify({ type: "open", r, c }));
      };

      boardEl.appendChild(btn);
    });
  });
}

// ───────── Buttons ─────────
document.getElementById("correctBtn").onclick = () => {
  socket.send(JSON.stringify({ type: "answer", correct: true }));
  dialog.close();
};

document.getElementById("wrongBtn").onclick = () => {
  socket.send(JSON.stringify({ type: "answer", correct: false }));
  dialog.close();
};

document.getElementById("activeA").onclick = () => {
  socket.send(JSON.stringify({ type: "team", team: "A" }));
};

document.getElementById("activeB").onclick = () => {
  socket.send(JSON.stringify({ type: "team", team: "B" }));
};