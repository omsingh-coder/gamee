/* app.js
   Functional frontend for single-folder Ludo+Chess multiplayer using Socket.IO
   - Bindings for Create/Join/Start/Leave
   - Handles simple Ludo & Chess render + moves
   - Obfuscated "Palak Pandey" (base64) included for hidden reference
*/

const socket = io(); // same-origin

// -- UI elements
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

let mySid = null;
let room = null;
let gameType = null;
let amHost = false;
let meSetSecret = false;
let opponentSetSecret = false;

// Palak Pandey hidden (base64) — decode only if you want to display subtly
const hiddenNameB64 = 'UGFsYWsgUGFuZGV5'; // "Palak Pandey"
function decodeHiddenName(){ try { return atob(hiddenNameB64); } catch(e){ return 'P.P.'; } }

// helpers
function showLobby(){ lobby.style.display='block'; gameArea.style.display='none'; }
function showGame(){ lobby.style.display='none'; gameArea.style.display='block'; }

function updateReadyHint(){
  if(!meSetSecret) readyHint.textContent = 'Set your secret message in the input above.';
  else if(!opponentSetSecret) readyHint.textContent = 'Waiting for your partner to set secret...';
  else readyHint.textContent = 'Both set! Host can start the game.';
}

// Bind actions
createBtn.addEventListener('click', () => {
  const name = nameInput.value.trim() || decodeHiddenName();
  gameType = gameSelect.value;
  socket.emit('create_room',{name,game:gameType});
});
joinBtn.addEventListener('click', () => {
  const name = nameInput.value.trim() || decodeHiddenName();
  const code = joinCode.value.trim().toUpperCase();
  if(!code){ alert('Enter room code'); return; }
  socket.emit('join_room',{name,code});
});
startBtn.addEventListener('click', ()=> {
  socket.emit('start_game',{room});
});
leaveBtn.addEventListener('click', ()=> {
  socket.emit('leave_room',{room});
  resetLobby();
});
backLobbyBtn.addEventListener('click', ()=> {
  socket.emit('leave_room',{room});
  resetLobby();
});
rollBtn.addEventListener('click', ()=> {
  socket.emit('roll_dice',{room});
  rollBtn.disabled = true;
});
resignBtn.addEventListener('click', ()=> {
  if(confirm('Resign?')) socket.emit('resign',{room});
});

// auto-set secret on blur or Enter
secretInput.addEventListener('blur', setSecretIfAny);
secretInput.addEventListener('keydown', (e)=> {
  if(e.key === 'Enter') { e.preventDefault(); setSecretIfAny(); }
});
function setSecretIfAny(){
  const s = (secretInput.value || '').trim();
  if(!s) return;
  socket.emit('set_secret',{room,secret:s});
  meSetSecret = true;
  updateReadyHint();
}

// socket events
socket.on('connect', ()=>{ mySid = socket.id; });
socket.on('room_created', data => {
  room = data.code; amHost = true; gameType = data.game;
  roomCodeSpan.textContent = room;
  roomCodeTop.textContent = `Room: ${room} • ${gameType.toUpperCase()}`;
  roomBox.style.display='block';
  setPlayersDisplay(data.players);
  showLobby();
  setSecretIfAny();
});
socket.on('room_joined', data => {
  room = data.code; amHost = false; gameType = data.game;
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
  startBtn.disabled = !(amHost && data.players.length===2 && data.players.every(p=>p.secretSet));
});
socket.on('start_ack', data => {
  gameType = data.players && data.players.length ? data.players[0].game : gameType;
  buildGameUI(data.game || gameType, data.state, data.players);
  showGame();
});
socket.on('dice_result', data => {
  diceVal.textContent = data.val;
  // server will emit state_update next
  setTimeout(()=> rollBtn.disabled = false, 600);
});
socket.on('state_update', data => {
  if(gameType === 'ludo') renderLudoState(data.state);
  else renderChessState(data.state);
});
socket.on('game_over', data => {
  const winner = data.winnerName || 'Winner';
  alert(`${winner} won!`);
});
socket.on('reveal_secret', data => {
  // private to winner
  alert(`Secret for winner 💌:\n\n${data.secret}`);
});
socket.on('left_room', ()=>{ resetLobby(); });
socket.on('connect_error', err => console.error('socket connect error', err));
socket.on('join_error', d => alert(d.msg || 'Join failed'));
socket.on('start_denied', d => alert(d.msg || 'Cannot start'));

// UI helpers
function setPlayersDisplay(players){
  playersList.textContent = players.map(p=>p.name + (p.secretSet? ' ✅':'')).join(' | ');
  playerA.textContent = players[0]? players[0].name:'—';
  playerB.textContent = players[1]? players[1].name:'—';
}

// reset
function resetLobby(){
  room = null; amHost=false; meSetSecret=false; opponentSetSecret=false;
  roomBox.style.display='none'; startBtn.disabled=true;
  showLobby();
  gameContainer.innerHTML = '';
  diceArea.style.display='none';
  chessControls.style.display='none';
}

// ----------------- GAME UI BUILDERS -----------------
function buildGameUI(type, state, players){
  gameContainer.innerHTML = '';
  diceArea.style.display='none';
  chessControls.style.display='none';
  if(type === 'ludo'){
    diceArea.style.display='block';
    buildLudoBoard();
  } else {
    chessControls.style.display='block';
    buildChessBoard();
  }
}

// -------- Ludo (render-only, server authoritative) --------
let ludoState = null;
function buildLudoBoard(){
  const wrap = document.createElement('div');
  wrap.className = 'ludo-wrap';
  wrap.innerHTML = `
    <div style="text-align:center">
      <h3 style="font-family:'Great Vibes',cursive">Ludo — Roll & Move</h3>
      <div id="ludoBoard" style="width:520px;height:520px;margin:0 auto;position:relative;background:#fff0f5;border-radius:8px;"></div>
    </div>
  `;
  gameContainer.appendChild(wrap);
}
function renderLudoState(state){
  ludoState = state;
  const board = document.getElementById('ludoBoard');
  if(!board) return;
  board.innerHTML = '';
  const size = 520, center = size/2, r = 180;
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
  const tokenColors = ['#ff6b8a','#7ad0ff','#ffd57a','#b7ffb2'];
  if(state && state.tokens){
    let idx=0;
    for(const sid of Object.keys(state.tokens)){
      const tokens = state.tokens[sid];
      const color = tokenColors[idx%tokenColors.length];
      tokens.forEach((t,ti) => {
        const tokenEl = document.createElement('div');
        tokenEl.className='ludo-token';
        tokenEl.style.position='absolute';
        tokenEl.style.width='26px';tokenEl.style.height='26px';tokenEl.style.borderRadius='50%';
        tokenEl.style.background=color;tokenEl.style.display='flex';tokenEl.style.alignItems='center';tokenEl.style.justifyContent='center';
        tokenEl.style.color='#fff';tokenEl.style.fontSize='12px';tokenEl.style.cursor='pointer';
        tokenEl.textContent = ti+1;
        if(t.pos>=0 && t.pos<40){
          const angle = (t.pos/40)*Math.PI*2;
          const x = center + Math.cos(angle)*r - 13;
          const y = center + Math.sin(angle)*r - 13;
          tokenEl.style.left = `${x}px`; tokenEl.style.top = `${y}px`;
        } else {
          const hx = 20 + idx*60 + ti*14;
          tokenEl.style.left = `${hx}px`; tokenEl.style.top = `20px`;
        }
        tokenEl.addEventListener('click', ()=> {
          socket.emit('move_token',{room,tokenIndex:ti});
        });
        board.appendChild(tokenEl);
      });
      idx++;
    }
  }
}

// -------- Chess (simple capture-king rules) --------
let chessState = null;
function buildChessBoard(){
  const wrap = document.createElement('div');
  wrap.className='chess-wrap';
  wrap.innerHTML = `
    <div style="text-align:center">
      <h3 style="font-family:'Great Vibes',cursive">Chess — Capture the King</h3>
      <div id="chessBoard" style="width:520px;height:520px;margin:0 auto;display:grid;grid-template-columns:repeat(8,1fr);grid-template-rows:repeat(8,1fr);border-radius:8px;overflow:hidden"></div>
    </div>
  `;
  gameContainer.appendChild(wrap);
}
let selectedSquare = null;
function renderChessState(state){
  chessState = state;
  const board = document.getElementById('chessBoard');
  if(!board) return;
  board.innerHTML = '';
  for(let r=0;r<8;r++){
    for(let c=0;c<8;c++){
      const sq = document.createElement('div');
      const isLight = (r+c)%2===0;
      sq.style.background = isLight? '#f6eefa':'#bfa9c0';
      sq.style.width='100%';sq.style.height='100%';sq.style.display='flex';sq.style.alignItems='center';sq.style.justifyContent='center';
      sq.style.fontSize='22px';sq.style.cursor='pointer';sq.style.userSelect='none';
      sq.dataset.r = r; sq.dataset.c = c;
      const piece = state.board?.[r]?.[c];
      sq.textContent = piece? prettyPiece(piece): '';
      sq.addEventListener('click', ()=> {
        const from = selectedSquare;
        const to = {r,c};
        if(!from){
          if(!piece) return;
          sq.style.boxShadow='0 0 0 3px rgba(255,105,180,0.15)';
          selectedSquare = {r,c};
        } else {
          socket.emit('chess_move',{room,from, to});
          clearSelection();
        }
      });
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
  const map = {P:'♟',R:'♜',N:'♞',B:'♝',Q:'♛',K:'♚'};
  return map[p[1]] || '?';
}

// initial UI
showLobby();
