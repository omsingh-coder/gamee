# server.py
# eventlet monkey patch must be first
import eventlet
eventlet.monkey_patch()

from flask import Flask, send_from_directory, request
from flask_socketio import SocketIO, join_room, leave_room, emit
import string, random

app = Flask(__name__, static_folder='.', static_url_path='')
socketio = SocketIO(app, cors_allowed_origins="*", async_mode='eventlet')

rooms = {}  # code -> {players:[{sid,name,secret,secretSet}], game, state, host}

def gen_code(n=6):
    chars = string.ascii_uppercase + string.digits
    return ''.join(random.choice(chars) for _ in range(n))

@app.route('/')
def index():
    return send_from_directory('.', 'index.html')

@app.route('/<path:filename>')
def static_files(filename):
    return send_from_directory('.', filename)

# ---------------- LUDO helpers ----------------
LUDO_MAIN = 52  # main track length
LUDO_HOME_STEPS = 5  # steps inside final stretch
LUDO_TOTAL_STEPS = LUDO_MAIN + LUDO_HOME_STEPS  # 57

# start indices on the board for 4 players (0, 13, 26, 39) approximate spacing
LUDO_START_INDEX = [0, 13, 26, 39]

def init_ludo_state(code):
    players = rooms[code]['players']
    order = [p['sid'] for p in players]
    state = {
        'tokens': {},          # sid -> [ {'steps':-1 (home), or 0..56 (on board/homestretch), or 100 (finished)} x4 ]
        'order': order,        # turn order (list of sids)
        'turnIndex': 0,        # index into order of whose turn it is
        'last_dice': None,
        'last_roller': None
    }
    for p in players:
        state['tokens'][p['sid']] = [{'steps': -1} for _ in range(4)]
    return state

def steps_to_board_index(start_idx, steps):
    # if steps < LUDO_MAIN -> map to main board index
    if steps < LUDO_MAIN:
        return (start_idx + steps) % LUDO_MAIN
    return None  # in home stretch -> not on main board

def move_ludo_token(state, sid, token_index, dice):
    tokens = state['tokens'].get(sid)
    if tokens is None:
        return False
    tok = tokens[token_index]
    # already finished
    if tok.get('steps', -1) == 100:
        return False
    # from home
    if tok['steps'] < 0:
        if dice == 6:
            tok['steps'] = 0
            return True
        else:
            return False
    else:
        tok['steps'] += dice
        if tok['steps'] >= LUDO_TOTAL_STEPS:
            tok['steps'] = 100  # finished
        else:
            # capture logic: if on main board (steps < LUDO_MAIN) compare board_index
            # compute this player's board indices
            # find its start index (det by player's position in order)
            try:
                player_idx = state['order'].index(sid)
            except ValueError:
                player_idx = 0
            start_idx = LUDO_START_INDEX[player_idx % 4]
            board_idx = steps_to_board_index(start_idx, tok['steps'])
            if board_idx is not None:
                # capture other players tokens on same board index
                for other_sid, oth_tokens in state['tokens'].items():
                    if other_sid == sid: continue
                    for ot in oth_tokens:
                        if ot.get('steps', -1) >= 0 and ot.get('steps', -1) < LUDO_MAIN:
                            other_player_idx = state['order'].index(other_sid) if other_sid in state['order'] else 0
                            other_start = LUDO_START_INDEX[other_player_idx % 4]
                            ot_board = steps_to_board_index(other_start, ot['steps'])
                            if ot_board == board_idx:
                                ot['steps'] = -1  # send home
        return True

def check_ludo_winner(state):
    for sid, toks in state['tokens'].items():
        if all(t.get('steps', -1) == 100 for t in toks):
            return sid
    return None

# ---------------- CHESS helpers ----------------
def init_chess_state(code):
    board = [['' for _ in range(8)] for __ in range(8)]
    for c in range(8):
        board[1][c] = 'bP'
        board[6][c] = 'wP'
    order = ['R','N','B','Q','K','B','N','R']
    for c,p in enumerate(order):
        board[0][c] = 'b'+p
        board[7][c] = 'w'+p
    players = rooms[code]['players']
    color_of = {}
    # assign colors: first player white, second black
    if len(players) >= 1:
        color_of[players[0]['sid']] = 'w'
    if len(players) >= 2:
        color_of[players[1]['sid']] = 'b'
    state = {'board': board, 'turn': 'w', 'color_of': color_of}
    return state

def clear_path(brd,r1,c1,r2,c2):
    dr = r2-r1; dc = c2-c1
    steps = max(abs(dr),abs(dc))
    if steps == 0: return True
    step_r = dr//steps; step_c = dc//steps
    for s in range(1,steps):
        if brd[r1+step_r*s][c1+step_c*s]:
            return False
    return True

def apply_chess_move(state, sid, frm, to, players):
    brd = state['board']
    try:
        r1,c1 = int(frm['r']), int(frm['c'])
        r2,c2 = int(to['r']), int(to['c'])
    except:
        return False, None, 'invalid_coords'
    if not (0<=r1<8 and 0<=c1<8 and 0<=r2<8 and 0<=c2<8):
        return False, None, 'out_of_bounds'
    piece = brd[r1][c1]
    if not piece:
        return False, None, 'no_piece'
    color = piece[0]
    mycolor = state['color_of'].get(sid)
    if mycolor != color:
        return False, None, 'not_your_piece'
    if state['turn'] != color:
        return False, None, 'not_your_turn'
    ptype = piece[1]
    target = brd[r2][c2]
    if target and target[0] == color:
        return False, None, 'cannot_capture_own'
    dr = r2-r1; dc = c2-c1
    legal = False
    if ptype == 'P':
        dir = -1 if color == 'w' else 1
        if dc == 0 and dr == dir and not target:
            legal = True
        if abs(dc) == 1 and dr == dir and target and target[0] != color:
            legal = True
        # initial two-step
        if dc == 0 and ((r1 == 6 and color == 'w') or (r1 == 1 and color == 'b')) and dr == 2*dir and not target:
            midr = r1 + dir
            if not brd[midr][c1]:
                legal = True
    elif ptype == 'N':
        if (abs(dr) == 2 and abs(dc) == 1) or (abs(dr) == 1 and abs(dc) == 2):
            legal = True
    elif ptype == 'B':
        if abs(dr) == abs(dc) and clear_path(brd, r1, c1, r2, c2):
            legal = True
    elif ptype == 'R':
        if (dr == 0 or dc == 0) and clear_path(brd, r1, c1, r2, c2):
            legal = True
    elif ptype == 'Q':
        if (abs(dr) == abs(dc) or dr == 0 or dc == 0) and clear_path(brd, r1, c1, r2, c2):
            legal = True
    elif ptype == 'K':
        if max(abs(dr), abs(dc)) == 1:
            legal = True
    if not legal:
        return False, None, 'illegal_move'
    captured = brd[r2][c2]
    brd[r2][c2] = piece
    brd[r1][c1] = ''
    state['turn'] = 'b' if state['turn'] == 'w' else 'w'
    if captured and captured[1] == 'K':
        winnerSid = None
        for p in players:
            if state['color_of'].get(p['sid']) == piece[0]:
                winnerSid = p['sid']
        return True, winnerSid, None
    return True, None, None

# ---------------- Socket handlers ----------------
@socketio.on('create_room')
def on_create(data):
    name = data.get('name','Player')
    game = data.get('game','ludo')
    code = gen_code()
    while code in rooms:
        code = gen_code()
    rooms[code] = {'players': [], 'game': game, 'state': None, 'host': request.sid}
    join_room(code)
    rooms[code]['players'].append({'sid': request.sid, 'name': name, 'secret': None, 'secretSet': False})
    emit('room_created', {'code': code, 'players': rooms[code]['players'], 'game': game}, room=request.sid)
    emit('players_update', {'players': rooms[code]['players']}, room=code)

@socketio.on('join_room')
def on_join(data):
    code = data.get('code')
    name = data.get('name','Player')
    if code not in rooms:
        emit('join_error', {'msg':'Room not found'}, room=request.sid)
        return
    if len(rooms[code]['players']) >= 2:
        emit('join_error', {'msg':'Room full'}, room=request.sid)
        return
    join_room(code)
    rooms[code]['players'].append({'sid': request.sid, 'name': name, 'secret': None, 'secretSet': False})
    emit('room_joined', {'code': code, 'players': rooms[code]['players'], 'game': rooms[code]['game']}, room=request.sid)
    emit('players_update', {'players': rooms[code]['players']}, room=code)

@socketio.on('set_secret')
def on_secret(data):
    code = data.get('room')
    secret = data.get('secret','')
    if code not in rooms: return
    for p in rooms[code]['players']:
        if p['sid'] == request.sid:
            p['secret'] = secret
            p['secretSet'] = True
    emit('players_update', {'players': rooms[code]['players']}, room=code)

@socketio.on('start_game')
def on_start(data):
    code = data.get('room')
    if code not in rooms:
        emit('start_denied', {'msg':'Room not found'}, room=request.sid); return
    if rooms[code]['host'] != request.sid:
        emit('start_denied', {'msg':'Only host can start'}, room=request.sid); return
    if len(rooms[code]['players']) < 2 or not all(p.get('secretSet') for p in rooms[code]['players']):
        emit('start_denied', {'msg':'Need 2 players and both secrets set'}, room=request.sid); return
    if rooms[code]['game'] == 'ludo':
        state = init_ludo_state(code)
    else:
        state = init_chess_state(code)
    rooms[code]['state'] = state
    emit('start_ack', {'code': code, 'state': state, 'players': rooms[code]['players'], 'game': rooms[code]['game']}, room=code)
    emit('state_update', {'state': state}, room=code)

@socketio.on('roll_dice')
def on_roll(data):
    code = data.get('room')
    if code not in rooms: return
    state = rooms[code].get('state')
    if not state: return
    sid = request.sid
    # only allow the current turn to roll
    cur_sid = state['order'][state['turnIndex']]
    if sid != cur_sid:
        emit('not_your_turn', {'msg':'Not your turn to roll'}, room=sid)
        return
    import random
    val = random.randint(1,6)
    state['last_dice'] = val
    state['last_roller'] = sid
    emit('dice_result', {'val': val}, room=code)

@socketio.on('move_token')
def on_move_token(data):
    code = data.get('room')
    idx = int(data.get('tokenIndex', 0))
    if code not in rooms: return
    state = rooms[code].get('state')
    if not state: return
    sid = request.sid
    cur_sid = state['order'][state['turnIndex']]
    # only current player can move tokens
    if sid != cur_sid:
        emit('not_your_turn', {'msg':'Not your turn to move'}, room=sid)
        return
    ld = state.get('last_dice', None)
    if ld is None or state.get('last_roller') != sid:
        emit('no_dice', {'msg':'Roll the dice first'}, room=sid)
        return
    moved = move_ludo_token(state, sid, idx, ld)
    # clear last dice only after a non-6 move or if moved but dice not 6
    if not moved:
        emit('invalid_move', {'msg':'Invalid token move'}, room=sid)
        return
    # if dice != 6 then advance turn
    if ld != 6:
        # advance to next active player
        state['turnIndex'] = (state['turnIndex'] + 1) % len(state['order'])
    # clear dice if consumed
    state['last_dice'] = None
    state['last_roller'] = None
    rooms[code]['state'] = state
    emit('state_update', {'state': state}, room=code)
    winner = check_ludo_winner(state)
    if winner:
        pname = next((p['name'] for p in rooms[code]['players'] if p['sid']==winner), 'Winner')
        emit('game_over', {'winnerSid': winner, 'winnerName': pname}, room=code)
        secret = next((p['secret'] for p in rooms[code]['players'] if p['sid']==winner), '')
        emit('reveal_secret', {'secret': secret}, room=winner)

@socketio.on('chess_move')
def on_chess_move(data):
    code = data.get('room')
    if code not in rooms: return
    state = rooms[code].get('state')
    if not state: return
    frm = data.get('from'); to = data.get('to')
    ok, winner, err = apply_chess_move(state, request.sid, frm, to, rooms[code]['players'])
    if ok:
        rooms[code]['state'] = state
        emit('state_update', {'state': state}, room=code)
        if winner:
            pname = next((p['name'] for p in rooms[code]['players'] if p['sid']==winner), 'Winner')
            emit('game_over', {'winnerSid': winner, 'winnerName': pname}, room=code)
            secret = next((p['secret'] for p in rooms[code]['players'] if p['sid']==winner), '')
            emit('reveal_secret', {'secret': secret}, room=winner)
    else:
        emit('illegal_move', {'msg': err or 'Illegal move'}, room=request.sid)

@socketio.on('resign')
def on_resign(data):
    code = data.get('room')
    if code not in rooms: return
    players = rooms[code]['players']
    other = next((p for p in players if p['sid'] != request.sid), None)
    if other:
        emit('game_over', {'winnerSid': other['sid'], 'winnerName': other['name']}, room=code)
        emit('reveal_secret', {'secret': other.get('secret','')}, room=other['sid'])

@socketio.on('leave_room')
def on_leave(data):
    code = data.get('room')
    if code and code in rooms:
        leave_room(code)
        rooms[code]['players'] = [p for p in rooms[code]['players'] if p['sid'] != request.sid]
        emit('players_update', {'players': rooms[code]['players']}, room=code)
        if not rooms[code]['players']:
            del rooms[code]
        else:
            if rooms[code].get('host') == request.sid:
                rooms[code]['host'] = rooms[code]['players'][0]['sid']
        emit('left_room', {}, room=request.sid)

@socketio.on('disconnect')
def on_disconnect():
    sid = request.sid
    for code,room in list(rooms.items()):
        if any(p['sid']==sid for p in room['players']):
            room['players'] = [p for p in room['players'] if p['sid'] != sid]
            emit('players_update', {'players': room['players']}, room=code)
            if not room['players']:
                del rooms[code]
            else:
                if room.get('host') == sid:
                    room['host'] = room['players'][0]['sid']

if __name__ == '__main__':
    print("Starting server on 0.0.0.0:5000")
    socketio.run(app, host='0.0.0.0', port=5000)
