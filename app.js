/* Frontend logic: socket.io + UI + simple game clients for Ludo & Chess
   Note: This is a single-file frontend to keep root-folder-only constraint.
*/

const socket = io(); // connects to same host

// UI elements
const nameInput = document.getElementById('nameInput');
const gameSelect = document.getElementById('gameSelect');
const createBtn = document.getElementById('createBtn');
const joinBtn = document.getElementById('joinBtn');
const joinCode = document.getElementById('joinCode');
const secretInput = document.getElementById('secretInput');

const roomBox = document.getElementById('roomBox');
const roomCodeSpan = document.getElementById('roomCodeSpan');
const playersList = document.getElementById('playersList');
const startBtn = document.getElementById('startBtn');
const leaveBtn = document.getElementById('leaveBtn');
const readyHint = document.getElementById('readyHint');

const lobby = document.getElementById('lobby');
const gameArea = document.getElementById('gameArea');
const roomCodeTop = document.getElementById('roomCodeTop');
const playerA = document.getElementById('playerA');
const playerB = document.getElementById('playerB');
const backLobbyBtn = document.getElementById('backLobbyBtn');

const gameContainer = document.getElementById('gameContainer');
const diceArea = document.getElementById('diceArea');
const rollBtn = document.getElementById('rollBtn');
const diceVal = document.getElementById('diceVal');
const chessControls = document.getElementById('chessControls');
const resignBtn = document.getElementById('resignBtn');

let myName = '';
let mySid = null;
let room = null;
let gameType = null;
let amHost = false;
let meSetSecret = false;
let opponentSetSecret = false;

// Helper show/hide
function showLobby(){ lobby.style.display='block'; gameArea.style.display='none'; }
function showGame(){ lobby.style.display='none'; gameArea.style.display='block'; }

// Create room
createBtn.onclick = () => {
  myName = nameInput.value.trim() || 'Player';
  gameType = gameSelect.value;
  socket.emit('create_room',{name:myName,game:gameType});
};

// Join room
joinBtn.onclick = () => {
  myName = nameInput.value.trim() || 'Player';
  const code = joinCode.value.trim().toUpperCase();
  if(!code) { alert('Enter room code'); return; }
  socket.emit('join_room',{name:myName,code});
};

// Set secret message (auto when creating/joining)
function setSecretIfAny(){
  const s = (secretInput.value || '').trim();
  if(!s) return;
  socket.emit('set_secret',{room,secret:s});
  meSetSecret = true;
  updateReadyHint();
}

// Start
startBtn.onclick = () => {
  socket.emit('start_game',{room});
};

// Leave
leaveBtn.onclick = () => {
  socket.emit('leave_room',{room});
  resetLobby();
};

// Back to lobby
backLobbyBtn.onclick = () => {
  socket.emit('leave_room',{room});
  resetLobby();
};

// Roll dice (Ludo)
rollBtn.onclick = () => {
  socket.emit('roll_dice',{room});
  rollBtn.disabled = true;
};

// Resign (Chess)
resignBtn.onclick = () => {
  if(confirm('Resign?')) socket.emit('resign',{room});
};

// socket events
socket.on('connect', ()=>{ mySid = socket.id; });
socket.on('room_created', data => {
  room = data.code; amHost=true; gameType = data.game;
  roomCodeSpan.textContent = room;
  roomCodeTop.textContent = `Room: ${room} • ${gameType.toUpperCase()}`;
  roomBox.style.display='block';
  setPlayersDisplay(data.players);
  showLobby();
  setSecretIfAny();
});

socket.on('room_joined', data => {
  room = data.code; gameType = data.game; amHost=false;
  roomCodeSpan.textContent = room;
  roomCodeTop.textContent = `Room: ${room} • ${gameType.toUpperCase()}`;
  roomBox.style.display='block';
  setPlayersDisplay(data.players);
  showLobby();
  setSecretIfAny();
});

socket.on('players_update', data => {
  setPlayersDisplay(data.players);
  opponentSetSecret = data.players.some(p => p.sid !== mySid && p.secretSet);
  meSetSecret = data.players.some(p => p.sid === mySid && p.secretSet);
  updateReadyHint();
  // enable start only for host and when both players present & secrets set
  startBtn.disabled = !(amHost && data.players.length===2 && data.players.every(p=>p.secretSet));
});

socket.on('start_ack', data => {
  // build board according to gameType
  buildGameUI(gameType, data.state, data.players);
  showGame();
});

socket.on('dice_result', data => {
  diceVal.textContent = data.val;
  // front-end should reflect moves - server will emit state_update
});

socket.on('state_update', data => {
  // update UI according to new game state
  if(gameType === 'ludo') renderLudoState(data.state);
  else renderChessState(data.state);
});

socket.on('your_turn', ()=>{ /* maybe highlight */ });

socket.on('game_over', data => {
  // data: winnerSid
  const winner = data.winnerName || 'Winner';
  alert(`${winner} won!`);
  // reveal secret to winner only (server emits private event 'reveal_secret' to winner)
});

socket.on('reveal_secret', data => {
  // only emitted to winner
  alert(`Secret for winner 💌:\n\n${data.secret}`);
});

socket.on('left_room', ()=>{ resetLobby(); });

// helper funcs
function setPlayersDisplay(players){
  playersList.textContent = players.map(p=>p.name + (p.secretSet? ' ✅':'')).join(' | ');
  playerA.textContent = players[0]? players[0].name:'—';
  playerB.textContent = players[1]? players[1].name:'—';
}

function updateReadyHint(){
  if(!meSetSecret) readyHint.textContent = 'Set your secret message in the input above.';
  else if(!opponentSetSecret) readyHint.textContent = 'Waiting for your partner to set secret...';
  else readyHint.textContent = 'Both set! Host can start the game.';
}

function resetLobby(){
  room = null; amHost=false; meSetSecret=false; opponentSetSecret=false;
  roomBox.style.display='none'; startBtn.disabled=true;
  showLobby();
}

// ----------------- GAME UI BUILDERS -----------------
function buildGameUI(type, state, players){
  gameContainer.innerHTML = '';
  diceArea.style.display = 'none';
  chessControls.style.display = 'none';

  if(type === 'ludo'){
    diceArea.style.display = 'block';
    buildLudoBoard();
  } else {
    chessControls.style.display = 'block';
    buildChessBoard();
  }
}

// ------------- LUDO Implementation (frontend rendering + basic interaction) -------------

let ludoState = null;

function buildLudoBoard(){
  // simple placeholder board: we'll render tokens and click targets
  const wrap = document.createElement('div');
  wrap.className = 'ludo-wrap';
  wrap.innerHTML = `
    <div style="text-align:center">
      <h3 style="font-family:'Great Vibes',cursive">Ludo — Roll & Move</h3>
      <div id="ludoBoard" style="width:520px;height:520px;margin:0 auto;position:relative;background:#fff0f5;border-radius:8px;box-shadow:0 8px 20px rgba(0,0,0,0.06);"></div>
    </div>
  `;
  gameContainer.appendChild(wrap);
  // board is drawn by renderLudoState via server state updates
}

function renderLudoState(state){
  ludoState = state;
  const board = document.getElementById('ludoBoard');
  if(!board) return;
  board.innerHTML = '';
  // draw 40 squares in circle for simplicity
  const size = 520;
  const center = size/2;
  const r = 180;
  for(let i=0;i<40;i++){
    const angle = (i/40)*Math.PI*2;
    const x = center + Math.cos(angle)*r - 18;
    const y = center + Math.sin(angle)*r - 18;
    const el = document.createElement('div');
    el.style.position='absolute';
    el.style.left=`${x}px`;
    el.style.top=`${y}px`;
    el.style.width='36px';el.style.height='36px';el.style.borderRadius='8px';
    el.style.display='flex';el.style.alignItems='center';el.style.justifyContent='center';
    el.style.fontSize='12px';
    el.style.background='rgba(255,255,255,0.9)';
    el.style.boxShadow='0 4px 10px rgba(0,0,0,0.06)';
    el.textContent = i+1;
    board.appendChild(el);
  }

  // render tokens from state.tokens: {playerSid: [{pos:-1..}], ...}
  const tokenColors = ['#ff6b8a','#7ad0ff','#ffd57a','#b7ffb2'];
  if(state && state.tokens){
    Object.keys(state.tokens).forEach((sid, idx) => {
      const tokens = state.tokens[sid];
      const color = tokenColors[idx%tokenColors.length];
      tokens.forEach((t,i) => {
        const pos = t.pos; // -1 means home; >=0 means on board index 0..39; 100+ means finished
        const tokenEl = document.createElement('div');
        tokenEl.className='ludo-token';
        tokenEl.style.position='absolute';
        tokenEl.style.width='26px';tokenEl.style.height='26px';tokenEl.style.borderRadius='50%';
        tokenEl.style.background=color;tokenEl.style.display='flex';tokenEl.style.alignItems='center';tokenEl.style.justifyContent='center';
        tokenEl.style.color='#fff';tokenEl.style.fontSize='12px';tokenEl.style.cursor='pointer';
        tokenEl.textContent = i+1;
        if(pos>=0 && pos<40){
          const angle = (pos/40)*Math.PI*2;
          const x = center + Math.cos(angle)*r - 13;
          const y = center + Math.sin(angle)*r - 13;
          tokenEl.style.left = `${x}px`; tokenEl.style.top = `${y}px`;
        } else {
          // arrange home tokens off-board
          const hx = 20 + idx*60 + i*14;
          tokenEl.style.left = `${hx}px`; tokenEl.style.top = `20px`;
        }
        tokenEl.onclick = ()=> {
          // request move token
          socket.emit('move_token',{room,tokenIndex:i});
        };
        board.appendChild(tokenEl);
      });
    });
  }
}

// ---------------- CHESS Implementation (simple) ----------------

let chessState = null;

function buildChessBoard(){
  const wrap = document.createElement('div');
  wrap.className='chess-wrap';
  wrap.innerHTML = `
    <div style="text-align:center">
      <h3 style="font-family:'Great Vibes',cursive">Chess — Capture the King</h3>
      <div id="chessBoard" style="width:520px;height:520px;margin:0 auto;display:grid;grid-template-columns:repeat(8,1fr);grid-template-rows:repeat(8,1fr);border-radius:8px;overflow:hidden;box-shadow:0 8px 20px rgba(0,0,0,0.06)"></div>
    </div>
  `;
  gameContainer.appendChild(wrap);
  // rendered by renderChessState
}

let selectedSquare = null;
function renderChessState(state){
  chessState = state;
  const board = document.getElementById('chessBoard');
  if(!board) return;
  board.innerHTML = '';
  const size = 520;
  for(let r=0;r<8;r++){
    for(let c=0;c<8;c++){
      const sq = document.createElement('div');
      const isLight = (r+c)%2===0;
      sq.style.background = isLight? '#f6eefa':'#bfa9c0';
      sq.style.width='100%';sq.style.height='100%';sq.style.display='flex';sq.style.alignItems='center';sq.style.justifyContent='center';
      sq.style.fontSize='22px';sq.style.cursor='pointer';
      sq.dataset.r = r; sq.dataset.c = c;
      const piece = state.board?.[r]?.[c];
      sq.textContent = piece? prettyPiece(piece): '';
      sq.onclick = ()=> {
        const from = selectedSquare;
        const to = {r,c};
        if(!from){
          // select if piece belongs to me
          if(!piece) return;
          sq.style.boxShadow='0 0 0 3px rgba(255,105,180,0.15)';
          selectedSquare = {r,c};
        } else {
          // attempt move
          socket.emit('chess_move',{room,from, to});
          clearSelection();
        }
      };
      board.appendChild(sq);
    }
  }
}

function clearSelection(){
  selectedSquare = null;
  const board = document.getElementById('chessBoard');
  if(!board) return;
  [...board.children].forEach(ch => ch.style.boxShadow='none');
}

function prettyPiece(p){
  // p like 'wP','bK'
  const map = {P:'♟',R:'♜',N:'♞',B:'♝',Q:'♛',K:'♚'};
  const symbol = map[p[1]] || '?';
  return p[0]==='w'? symbol: symbol;
}

// ---------------- generic state updates ----------------
socket.on('connect_error', (err) => {
  console.error('connect_error',err);
});

// auto-set secret when user types and blurs
secretInput.addEventListener('blur', setSecretIfAny);

// initial
showLobby();
