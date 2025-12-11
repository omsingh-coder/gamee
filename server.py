# server.py - Flask + Flask-SocketIO backend
# Run: gunicorn -k eventlet -w 1 server:app

from flask import Flask, send_from_directory, request
from flask_socketio import SocketIO, join_room, leave_room, emit
import string, random, eventlet
eventlet.monkey_patch()

app = Flask(__name__, static_url_path='', static_folder='.')
socketio = SocketIO(app, cors_allowed_origins="*")

# In-memory room store (for demo/personal use). For production, use persistent DB.
rooms = {}  # code -> {players:[{sid,name,secret,secretSet}], game, state, hostSid}

def gen_code(n=6):
    chars = string.ascii_uppercase+string.digits
    return ''.join(random.choice(chars) for _ in range(n))

# Serve index
@app.route('/')
def index():
    return send_from_directory('.', 'index.html')

# Serve other static (css/js)
@app.route('/<path:filename>')
def static_files(filename):
    return send_from_directory('.', filename)

# ---------- socket handlers ----------
@socketio.on('create_room')
def on_create(data):
    name = data.get('name','Player')
    game = data.get('game','ludo')
    code = gen_code()
    while code in rooms:
        code = gen_code()
    rooms[code] = {
        'players': [],
        'game': game,
        'state': None,
        'host': request.sid
    }
    join_room(code)
    rooms[code]['players'].append({'sid':request.sid,'name':name,'secret':None,'secretSet':False})
    emit('room_created', {'code':code,'players':rooms[code]['players'],'game':game}, room=request.sid)
    emit('players_update', {'players':rooms[code]['players']}, room=code)

@socketio.on('join_room')
def on_join(data):
    code = data.get('code')
    name = data.get('name','Player')
    if code not in rooms:
        emit('join_error', {'msg':'Room not found'})
        return
    if len(rooms[code]['players'])>=2:
        emit('join_error', {'msg':'Room full'})
        return
    join_room(code)
    rooms[code]['players'].append({'sid':request.sid,'name':name,'secret':None,'secretSet':False})
    emit('room_joined', {'code':code,'players':rooms[code]['players'],'game':rooms[code]['game']}, room=request.sid)
    emit('players_update', {'players':rooms[code]['players']}, room=code)

@socketio.on('set_secret')
def on_secret(data):
    code = data.get('room')
    secret = data.get('secret','')
    if code not in rooms: return
    for p in rooms[code]['players']:
        if p['sid']==request.sid:
            p['secret'] = secret
            p['secretSet'] = True
    emit('players_update', {'players':rooms[code]['players']}, room=code)

@socketio.on('start_game')
def on_start(data):
    code = data.get('room')
    if code not in rooms: return
    # only host can start
    if rooms[code]['host'] != request.sid:
        emit('start_denied', {'msg':'Only host can start'}, room=request.sid)
        return
    # ensure two players and both set secret
    if len(rooms[code]['players'])<2 or not all(p.get('secretSet') for p in rooms[code]['players']):
        emit('start_denied', {'msg':'Need 2 players and both secrets set'}, room=request.sid)
        return
    # init state according to game
    if rooms[code]['game']=='ludo':
        state = init_ludo_state(code)
    else:
        state = init_chess_state(code)
    rooms[code]['state'] = state
    emit('start_ack', {'code':code,'state':state,'players':rooms[code]['players']}, room=code)
    emit('state_update', {'state':state}, room=code)

@socketio.on('roll_dice')
def on_roll(data):
    code = data.get('room')
    if code not in rooms: return
    import random
    val = random.randint(1,6)
    # store last dice
    rooms[code].setdefault('last_dice', val)
    emit('dice_result', {'val':val}, room=code)
    # server waits for move_token event to move token(s)

@socketio.on('move_token')
def on_move_token(data):
    code = data.get('room')
    idx = int(data.get('tokenIndex',0))
    if code not in rooms: return
    state = rooms[code]['state']
    sid = request.sid
    # Ludo move logic (simplified)
    if rooms[code]['game']!='ludo': return
    ld = rooms[code].get('last_dice', None)
    if ld is None:
        return
    res = apply_ludo_move(state, sid, idx, ld)
    rooms[code]['state'] = state
    rooms[code].pop('last_dice',None)
    emit('state_update', {'state':state}, room=code)
    # check winner
    winner = check_ludo_winner(state)
    if winner:
        # find winner name
        pname = next((p['name'] for p in rooms[code]['players'] if p['sid']==winner),'Winner')
        emit('game_over', {'winnerSid':winner,'winnerName':pname}, room=code)
        # reveal secret privately
        secret = next((p['secret'] for p in rooms[code]['players'] if p['sid']==winner),'')
        emit('reveal_secret', {'secret':secret}, room=winner)

@socketio.on('chess_move')
def on_chess_move(data):
    code = data.get('room')
    if code not in rooms: return
    state = rooms[code].get('state')
    if not state: return
    frm = data.get('from'); to = data.get('to')
    # apply move (simplified rules: allow moves if basic piece rules satisfied; win if king captured)
    ok, winner = apply_chess_move(state, request.sid, frm, to, rooms[code]['players'])
    if ok:
        rooms[code]['state'] = state
        emit('state_update', {'state':state}, room=code)
        if winner:
            pname = next((p['name'] for p in rooms[code]['players'] if p['sid']==winner),'Winner')
            emit('game_over', {'winnerSid':winner,'winnerName':pname}, room=code)
            secret = next((p['secret'] for p in rooms[code]['players'] if p['sid']==winner),'')
            emit('reveal_secret', {'secret':secret}, room=winner)

@socketio.on('resign')
def on_resign(data):
    code = data.get('room')
    if code not in rooms: return
    # winner is other player
    players = rooms[code]['players']
    other = next((p for p in players if p['sid']!=request.sid),None)
    if other:
        emit('game_over', {'winnerSid':other['sid'],'winnerName':other['name']}, room=code)
        emit('reveal_secret', {'secret':other.get('secret','')}, room=other['sid'])

@socketio.on('leave_room')
def on_leave(data):
    code = data.get('room')
    if code and code in rooms:
        leave_room(code)
        rooms[code]['players'] = [p for p in rooms[code]['players'] if p['sid']!=request.sid]
        emit('players_update', {'players':rooms[code]['players']}, room=code)
        # if empty destroy
        if not rooms[code]['players']:
            del rooms[code]
        else:
            # if host left, promote first player
            if rooms[code].get('host')==request.sid:
                rooms[code]['host'] = rooms[code]['players'][0]['sid']
        emit('left_room', {}, room=request.sid)

@socketio.on('disconnect')
def on_disconnect():
    # remove from any rooms
    sid = request.sid
    for code,room in list(rooms.items()):
        if any(p['sid']==sid for p in room['players']):
            room['players'] = [p for p in room['players'] if p['sid']!=sid]
            emit('players_update', {'players':room['players']}, room=code)
            if not room['players']:
                del rooms[code]
            else:
                if room.get('host')==sid:
                    room['host'] = room['players'][0]['sid']


# ----------------- Game logic helpers -----------------

def init_ludo_state(code):
    # tokens: sid-> list of 4 tokens each as {'pos':-1||0..39||100+}
    state = {'tokens':{}, 'turnIndex':0, 'order':[]}
    for p in rooms[code]['players']:
        state['tokens'][p['sid']] = [{'pos':-1} for _ in range(4)]
        state['order'].append(p['sid'])
    state['turnIndex'] = 0
    return state

def apply_ludo_move(state, sid, tokenIndex, dice):
    # simplistic Ludo: if token at -1, need dice==6 to bring to start at pos 0
    # move forward by dice; if hits others, send them home
    tokens = state['tokens'].get(sid)
    if tokens is None: return False
    tok = tokens[tokenIndex]
    if tok['pos'] < 0:
        if dice==6:
            tok['pos'] = 0
            return True
        else:
            return False
    else:
        tok['pos'] = (tok['pos'] + dice) % 40
        # capture others
        for other_sid, oth_tokens in state['tokens'].items():
            if other_sid==sid: continue
            for ot in oth_tokens:
                if ot['pos']==tok['pos']:
                    ot['pos'] = -1  # sent home
        return True

def check_ludo_winner(state):
    for sid, toks in state['tokens'].items():
        if all(t['pos']>=100 for t in toks): # in this simplified version we may not reach 100
            return sid
    # alternatively consider winner if all tokens > 0 and gone many rounds - skipping for brevity
    return None

# Chess: simple board representation: 8x8 with 'wP','bK' etc.
def init_chess_state(code):
    # standard starting placement
    board = [['' for _ in range(8)] for __ in range(8)]
    # pawns
    for c in range(8):
        board[1][c] = 'bP'
        board[6][c] = 'wP'
    order = ['R','N','B','Q','K','B','N','R']
    for c,p in enumerate(order):
        board[0][c] = 'b'+p
        board[7][c] = 'w'+p
    # map players to colors: first player = white, second = black
    players = rooms[code]['players']
    color_of = {}
    if len(players)>=1:
        color_of[players[0]['sid']] = 'w'
    if len(players)>=2:
        color_of[players[1]['sid']] = 'b'
    state = {'board':board, 'turn':'w', 'color_of':color_of}
    return state

def apply_chess_move(state, sid, frm, to, players):
    # simplified: allow moves if piece belongs to player color and move is in basic pattern (no checks)
    brd = state['board']
    r1,c1 = int(frm['r']), int(frm['c'])
    r2,c2 = int(to['r']), int(to['c'])
    if r1<0 or r1>7 or r2<0 or r2>7: return False, None
    piece = brd[r1][c1]
    if not piece: return False, None
    color = piece[0]
    mycolor = state['color_of'].get(sid)
    if mycolor != color:
        return False, None
    # ensure turn
    if state['turn'] != color: return False, None

    ptype = piece[1]
    target = brd[r2][c2]
    # don't capture own
    if target and target[0]==color: return False, None

    dr = r2-r1; dc = c2-c1

    legal = False
    # pawn (very simple: forward by 1, capture diagonally)
    if ptype=='P':
        dir = -1 if color=='w' else 1
        if dc==0 and dr==dir and not target:
            legal=True
        if abs(dc)==1 and dr==dir and target and target[0]!=color:
            legal=True
    elif ptype=='N':
        if (abs(dr)==2 and abs(dc)==1) or (abs(dr)==1 and abs(dc)==2):
            legal=True
    elif ptype=='B':
        if abs(dr)==abs(dc) and clear_path(brd,r1,c1,r2,c2):
            legal=True
    elif ptype=='R':
        if (dr==0 or dc==0) and clear_path(brd,r1,c1,r2,c2):
            legal=True
    elif ptype=='Q':
        if (abs(dr)==abs(dc) or dr==0 or dc==0) and clear_path(brd,r1,c1,r2,c2):
            legal=True
    elif ptype=='K':
        if max(abs(dr),abs(dc))==1:
            legal=True

    if not legal:
        return False, None

    # perform move
    captured = brd[r2][c2]
    brd[r2][c2] = piece
    brd[r1][c1] = ''
    # toggle turn
    state['turn'] = 'b' if state['turn']=='w' else 'w'

    # if captured king -> winner
    if captured and captured[1]=='K':
        winnerSid = None
        for p in players:
            if state['color_of'].get(p['sid'])==piece[0]:
                winnerSid = p['sid']
        return True, winnerSid
    return True, None

def clear_path(brd,r1,c1,r2,c2):
    dr = r2-r1; dc = c2-c1
    steps = max(abs(dr),abs(dc))
    step_r = (dr//steps) if steps!=0 else 0
    step_c = (dc//steps) if steps!=0 else 0
    for s in range(1,steps):
        rr = r1 + step_r*s
        cc = c1 + step_c*s
        if brd[rr][cc]:
            return False
    return True

# ----------------- Run -----------------
if __name__ == '__main__':
    print("Starting server on 0.0.0.0:5000")
    socketio.run(app, host='0.0.0.0', port=5000)
