/* app.js - upgraded for turn-based real-feel Ludo + Chess
   - Enforces per-player dice-roll rights in Ludo
   - Highlights chess possible moves
   - Only current player can act (UI + server validation)
*/

const socket = io();

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
let myColor = null; // for chess: 'w' or 'b'

const hiddenNameB64 = 'UGFsYWsgUGFuZGV5';
function decodeHiddenName(){ try{ return atob(hiddenNameB64);}catch(e){return 'P.P.';} }

function showLobby(){ lobby.style.display='block'; gameArea.style.display='none'; }
function showGame(){ lobby.style.display='none'; gameArea.style.display='block'; }

// ---------- UI bindings ----------
createBtn.onclick = () => {
  const name = nameInput.value.trim() || decodeHiddenName();
  gameType = gameSelect.value;
  socket.emit('create_room',{name,game:gameType});
};
joinBtn.onclick = () => {
  const name = nameInput.value.trim() || decodeHiddenName();
  const code = joinCode.value.trim().toUpperCase();
  if(!code){ alert('Enter room code'); return; }
  socket.emit('join_room',{name,code});
};
startBtn.onclick = () => {
  // auto-send secret if present and not already set
  const s = (secretInput.value||'').trim();
  if(s && !meSetSecret) socket.emit('set_secret',{room,secret:s});
  socket.emit('start_game',{room});
};
leaveBtn.onclick = ()=> { socket.emit('leave_room',{room}); resetLobby(); };
backLobbyBtn.onclick = ()=> { socket.emit('leave_room',{room}); resetLobby(); };
rollBtn.onclick = ()=> {
  // roll button may be disabled by UI unless it's our turn
  socket.emit('roll_dice',{room});
  rollBtn.disabled = true;
};
resignBtn.onclick = ()=> { if(confirm('Resign?')) socket.emit('resign',{room}); };

// secret quick set
secretInput.addEventListener('keydown', e=> {
  if(e.key === 'Enter'){ e.preventDefault(); const s = (secretInput.value||'').trim(); if(s){ socket.emit('set_secret',{room,secret:s}); meSetSecret=true; } }
});
secretInput.addEventListener('blur', ()=>{ const s = (secretInput.value||'').trim(); if(s && !meSetSecret){ socket.emit('set_secret',{room,secret:s}); meSetSecret=true; } });

// ---------- socket handlers ----------
socket.on('connect', ()=>{ mySid = socket.id; console.log('connected', mySid); });

socket.on('room_created', data => {
  room = data.code; amHost=true; gameType = data.game;
  roomCodeSpan.textContent = room;
  roomCodeTop.textContent = `Room: ${room} • ${gameType.toUpperCase()}`;
  roomBox.style.display='block';
  setPlayersDisplay(data.players);
  showLobby();
});
socket.on('room_joined', data => {
  room = data.code; amHost=false; gameType = data.game;
  roomCodeSpan.textContent = room;
  roomCodeTop.textContent = `Room: ${room} • ${gameType.toUpperCase()}`;
  roomBox.style.display='block';
  setPlayersDisplay(data.players);
  showLobby();
});
socket.on('players_update', data => {
  setPlayersDisplay(data.players);
  opponentSetSecret = data.players.some(p => p.sid !== mySid && p.secretSet);
  meSetSecret = data.players.some(p => p.sid === mySid && p.secretSet);
  readyHint.textContent = !meSetSecret ? 'Set your secret message' : (!opponentSetSecret ? 'Waiting for other player' : 'Both set - host can start');
  startBtn.disabled = !(amHost && data.players.length===2 && data.players.every(p=>p.secretSet));
});

socket.on('start_ack', data => {
  // data.state must be used; also data.game tells which game
  gameType = data.game || gameType;
  // map my color for chess
  if(gameType === 'chess' && data.players){
    const me = data.players.find(p => p.sid === mySid);
    if(me){
      // server stored color mapping in state.color_of; but easier: deduce from state's color_of
      const color_of = data.state?.color_of || {};
      myColor = color_of[mySid] || null;
    }
  }
  buildGameUI(gameType, data.state, data.players);
  showGame();
});

socket.on('state_update', data => {
  // update UI and ensure turn-based controls enabled/disabled accordingly
  const state = data.state;
  if(!state) return;
  if(gameType === 'ludo'){
    // show whose turn it is
    const curSid = state.order[state.turnIndex];
    updateTurnUILudo(curSid);
    renderLudoState(state);
  } else {
    // chess
    renderChessState(state);
  }
});

socket.on('dice_result', data => {
  diceVal.textContent = data.val;
  // still wait for state_update that will follow after move
});

socket.on('not_your_turn', d => { alert(d.msg || 'Not your turn'); });
socket.on('no_dice', d => { alert(d.msg || 'You need to roll first'); });
socket.on('invalid_move', d => { alert(d.msg || 'Invalid move') });
socket.on('illegal_move', d => { alert(d.msg || 'Illegal move'); });
socket.on('game_over', data => { alert((data.winnerName || 'Someone') + ' won!'); });
socket.on('reveal_secret', data => { alert('Secret for winner: ' + (data.secret||'')); });

// ---------- UI helpers ----------
function setPlayersDisplay(players){
  playersList.textContent = players.map(p=>p.name + (p.secretSet? ' ✅':'')).join(' | ');
  playerA.textContent = players[0]? players[0].name:'—';
  playerB.textContent = players[1]? players[1].name:'—';
}

function resetLobby(){
  room = null; amHost=false; meSetSecret=false; opponentSetSecret=false; myColor=null;
  roomBox.style.display='none'; startBtn.disabled=true;
  showLobby();
  gameContainer.innerHTML = '';
  diceArea.style.display='none';
  chessControls.style.display='none';
}

// ---------------- LUDO UI ----------------
function updateTurnUILudo(curSid){
  // enable roll button only if it's our sid
  if(curSid === mySid){
    rollBtn.disabled = false;
  } else {
    rollBtn.disabled = true;
  }
  // visually indicate current player
  const players = [playerA, playerB];
  players.forEach(el => el.style.boxShadow = 'none');
  if(playerA.textContent && playerA.textContent.trim() !== '—' && curSid === window.currentPlayerSid?.a) {
    playerA.style.boxShadow = '0 6px 18px rgba(255,105,180,0.12)';
  }
}

// Build board container
function buildGameUI(type, state, players){
  gameContainer.innerHTML = '';
  diceArea.style.display='none';
  chessControls.style.display='none';
  if(type === 'ludo'){
    diceArea.style.display='block';
    buildLudoBoard();
    // store current players mapping to start indices for rendering
    window.ludoState = state;
  } else {
    chessControls.style.display='block';
    buildChessBoard();
    window.chessState = state;
    // capture my color if provided in state
    myColor = state?.color_of?.[mySid] || myColor;
  }
}

/* Ludo rendering & interaction (real-feel) */
let ludoState = null;
function buildLudoBoard(){
  const wrap = document.createElement('div');
  wrap.className = 'ludo-wrap';
  wrap.innerHTML = `
    <div style="text-align:center">
      <h3 style="font-family:'Great Vibes',cursive">Ludo — Real Feel</h3>
      <div id="ludoBoard" style="width:560px;height:560px;margin:0 auto;position:relative;background:#fff0f5;border-radius:8px;padding:12px;"></div>
    </div>`;
  gameContainer.appendChild(wrap);
}
function renderLudoState(state){
  ludoState = state;
  const board = document.getElementById('ludoBoard');
  if(!board) return;
  board.innerHTML = '';
  // draw main 52 positions roughly as circle for visuals
  const size = 520, center=size/2, r=190;
  for(let i=0;i<52;i++){
    const angle = (i/52)*Math.PI*2;
    const x = center + Math.cos(angle)*r - 14;
    const y = center + Math.sin(angle)*r - 14;
    const el = document.createElement('div');
    el.style.position='absolute';
    el.style.left = `${x}px`; el.style.top = `${y}px`;
    el.style.width='28px'; el.style.height='28px'; el.style.borderRadius='6px';
    el.style.display='flex'; el.style.alignItems='center'; el.style.justifyContent='center';
    el.style.fontSize='11px';
    el.style.background='rgba(255,255,255,0.9)';
    el.style.border='1px dashed rgba(0,0,0,0.03)';
    el.dataset.index = i;
    board.appendChild(el);
  }
  // draw home areas (top)
  // render tokens:
  const tokenColors = ['#ff6b8a','#7ad0ff','#ffd57a','#b7ffb2'];
  let idx=0;
  const order = state.order || [];
  order.forEach((sid, playerIdx) => {
    const tokens = state.tokens[sid] || [];
    const color = tokenColors[playerIdx%tokenColors.length];
    tokens.forEach((t,ti) => {
      const tokenEl = document.createElement('div');
      tokenEl.className = 'ludo-token';
      tokenEl.style.position='absolute';
      tokenEl.style.width='28px'; tokenEl.style.height='28px'; tokenEl.style.borderRadius='50%';
      tokenEl.style.background = color; tokenEl.style.display='flex'; tokenEl.style.alignItems='center';
      tokenEl.style.justifyContent='center'; tokenEl.style.color='#fff'; tokenEl.style.fontWeight='600';
      tokenEl.style.cursor = 'default';
      tokenEl.textContent = (ti+1);
      // compute on-screen position based on token steps
      const steps = t.steps;
      if(steps === -1){
        // home area positions (arranged on corners)
        const hx = 10 + playerIdx*120 + ti*24;
        tokenEl.style.left = `${hx}px`; tokenEl.style.top = `10px`;
      } else if(steps === 100){
        // finished zone bottom
        const fx = 10 + playerIdx*120 + ti*24;
        tokenEl.style.left = `${fx}px`; tokenEl.style.top = `480px`;
        tokenEl.style.opacity = '0.85';
      } else {
        // compute board index
        const start_idx = [0,13,26,39][playerIdx%4];
        let board_index = null;
        if(steps < 52){
          board_index = (start_idx + steps) % 52;
        }
        if(board_index !== null){
          // find the board slot element
          const slot = board.querySelector(`[data-index="${board_index}"]`);
          if(slot){
            tokenEl.style.left = slot.style.left;
            tokenEl.style.top = slot.style.top;
            tokenEl.style.transform = 'translate(6px,6px)'; // small offset
          } else {
            // fallback
            tokenEl.style.left = `${center}px`; tokenEl.style.top = `${center}px`;
          }
        } else {
          // home stretch, position near center with offset
          const hx = center + (playerIdx-1.5)*40 + ti*10;
          const hy = center;
          tokenEl.style.left = `${hx}px`; tokenEl.style.top = `${hy}px`;
        }
      }
      // only allow clicks if this token belongs to current player & it's that player's turn
      const currentSid = state.order[state.turnIndex];
      if(sid === currentSid && sid === mySid){
        tokenEl.style.cursor = 'pointer';
        tokenEl.addEventListener('click', ()=> {
          // request move; server will validate that we rolled and it's our turn
          socket.emit('move_token',{room,tokenIndex:ti});
        });
      }
      board.appendChild(tokenEl);
    });
    idx++;
  });

  // show whose turn (visual)
  const turnSid = state.order[state.turnIndex];
  const playerNames = Array.from(document.querySelectorAll('.player-pill')).map(el => el.textContent);
  // dice button control
  rollBtn.disabled = (turnSid !== mySid);
  // display small label
  const info = document.createElement('div');
  info.style.position='absolute';
  info.style.right='10px'; info.style.bottom='10px';
  info.style.background = '#fff'; info.style.padding='8px 10px'; info.style.borderRadius='8px';
  info.style.boxShadow='0 6px 18px rgba(0,0,0,0.06)';
  const turnPlayer = state.order.indexOf(turnSid);
  info.innerText = `Turn: Player ${turnPlayer+1}${turnSid===mySid ? ' (You)' : ''}`;
  board.appendChild(info);
}

// ---------------- CHESS UI & possible-moves highlighting ----------------
let chessState = null;
function buildChessBoard(){
  const wrap = document.createElement('div');
  wrap.className = 'chess-wrap';
  wrap.innerHTML = `
    <div style="text-align:center">
      <h3 style="font-family:'Great Vibes',cursive">Chess — Turn Based</h3>
      <div id="chessBoard" style="width:520px;height:520px;margin:0 auto;display:grid;grid-template-columns:repeat(8,1fr);grid-template-rows:repeat(8,1fr);border-radius:8px;overflow:hidden"></div>
    </div>`;
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
      sq.style.width='100%'; sq.style.height='100%'; sq.style.display='flex';
      sq.style.alignItems='center'; sq.style.justifyContent='center';
      sq.style.fontSize='22px'; sq.style.cursor='pointer'; sq.style.userSelect='none';
      sq.dataset.r = r; sq.dataset.c = c;
      const piece = (state.board && state.board[r]) ? state.board[r][c] : '';
      sq.textContent = piece ? prettyPiece(piece) : '';
      // click
      sq.addEventListener('click', ()=> {
        const myColorLocal = state.color_of ? state.color_of[mySid] : myColor;
        if(!myColorLocal) { alert('You have no color assigned'); return; }
        // If no selection yet:
        if(!selectedSquare){
          if(!piece) return;
          if(piece[0] !== myColorLocal) return; // only select own piece
          // compute possible moves and highlight
          const moves = computePossibleMoves(state, r, c);
          highlightSquares(moves);
          sq.style.boxShadow = '0 0 0 3px rgba(255,105,180,0.15)';
          selectedSquare = {r,c};
        } else {
          // emit move
          const from = selectedSquare;
          const to = {r,c};
          // ensure it's our turn
          if(state.turn !== (state.color_of ? state.color_of[mySid] : myColor)) {
            alert('Not your turn');
            clearSelection();
            return;
          }
          socket.emit('chess_move',{room,from,to});
          clearSelection();
        }
      });
      board.appendChild(sq);
    }
  }
}
// clearing highlights
function clearSelection(){
  selectedSquare = null;
  const board = document.getElementById('chessBoard');
  if(!board) return;
  [...board.children].forEach(ch => { ch.style.boxShadow = 'none'; ch.style.outline = 'none'; });
}
function highlightSquares(moves){
  const board = document.getElementById('chessBoard');
  if(!board) return;
  moves.forEach(m => {
    const idx = m.r*8 + m.c;
    const cell = board.children[idx];
    if(cell){
      cell.style.outline = '3px solid rgba(255,105,180,0.25)';
    }
  });
}

// compute possible moves on client using same simplified rules as server
function computePossibleMoves(state, r1, c1){
  const brd = state.board;
  const piece = brd[r1][c1];
  if(!piece) return [];
  const color = piece[0], ptype = piece[1];
  const moves = [];
  for(let r=0;r<8;r++){
    for(let c=0;c<8;c++){
      const dr = r - r1, dc = c - c1;
      const target = brd[r][c];
      if(target && target[0] === color) continue;
      let legal = false;
      if(ptype === 'P'){
        const dir = color === 'w' ? -1 : 1;
        if(dc === 0 && dr === dir && !target) legal = true;
        if(Math.abs(dc) === 1 && dr === dir && target && target[0] !== color) legal = true;
        if(dc === 0 && ((r1 === 6 && color === 'w') || (r1 === 1 && color === 'b')) && dr === 2*dir && !target){
          const midr = r1 + dir;
          if(!brd[midr][c1]) legal = true;
        }
      } else if(ptype === 'N'){
        if((Math.abs(dr)===2 && Math.abs(dc)===1) || (Math.abs(dr)===1 && Math.abs(dc)===2)) legal = true;
      } else if(ptype === 'B'){
        if(Math.abs(dr)===Math.abs(dc) && client_clear_path(brd,r1,c1,r,c)) legal = true;
      } else if(ptype === 'R'){
        if((dr===0 || dc===0) && client_clear_path(brd,r1,c1,r,c)) legal = true;
      } else if(ptype === 'Q'){
        if((Math.abs(dr)===Math.abs(dc) || dr===0 || dc===0) && client_clear_path(brd,r1,c1,r,c)) legal = true;
      } else if(ptype === 'K'){
        if(Math.max(Math.abs(dr),Math.abs(dc)) === 1) legal = true;
      }
      if(legal) moves.push({r,c});
    }
  }
  return moves;
}
function client_clear_path(brd,r1,c1,r2,c2){
  const dr = r2-r1; const dc = c2-c1;
  const steps = Math.max(Math.abs(dr), Math.abs(dc));
  if(steps === 0) return true;
  const step_r = dr/steps; const step_c = dc/steps;
  for(let s=1;s<steps;s++){
    const rr = Math.round(r1 + step_r*s), cc = Math.round(c1 + step_c*s);
    if(brd[rr][cc]) return false;
  }
  return true;
}

function prettyPiece(p){
  const map = {P:'♟',R:'♜',N:'♞',B:'♝',Q:'♛',K:'♚'};
  return map[p[1]] || '?';
}

// start UI
showLobby();
