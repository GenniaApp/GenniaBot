import socketio
import os
from enum import Enum
from typing import List, Tuple

class TileType(Enum):
    Fog = 0
    Obstacle = 1
    Mountain = 2
    City = 3
    Plain = 4
    King = 5

class QuePurpose(Enum):
    Defend = 0
    AttackGeneral = 1
    ExpandLand = 2
    Attack = 3

class Position:
    def __init__(self, x: int, y: int):
        self.x = x
        self.y = y

class QueItem:
    def __init__(self, from_pos: Position, to_pos: Position, purpose: QuePurpose, priority: int, target: Position):
        self.from_pos = from_pos
        self.to_pos = to_pos
        self.purpose = purpose
        self.priority = priority
        self.target = target

class GBot:
    def __init__(self, room_id: str, username: str):
        self.room_id = room_id
        self.room = None
        self.username = username
        self.my_player_id = None
        self.color = None
        self.attack_color = -1
        self.attack_position = None
        self.my_general = None
        self.enemy_general = []
        self.init_game_info = None
        self.game_map = None
        self.total_viewed = None
        self.leader_board_data = None
        self.queue = AttackQueue()

class AttackQueue:
    def __init__(self):
        self.que = []

    def push_back(self, item: QueItem):
        self.que.append(item)

    def pop_front(self):
        if len(self.que) > 0:
            return self.que.pop(0)
        return None

    def is_empty(self):
        return len(self.que) == 0

class MapDiffData:
    def __init__(self, diff: List[Tuple[TileType, int, int]]):
        self.diff = diff

class LeaderBoardTable:
    def __init__(self, data: List[Tuple[int, int]]):
        self.data = data

class Room:
    def __init__(self, players: List[Player], game_started: bool):
        self.players = players
        self.game_started = game_started

class Player:
    def __init__(self, id: str, color: int, force_start: bool, is_room_host: bool):
        self.id = id
        self.color = color
        self.force_start = force_start
        self.is_room_host = is_room_host

class UserData:
    def __init__(self, id: str):
        self.id = id

class ExPosition:
    def __init__(self, x: int, y: int, color: int):
        self.x = x
        self.y = y
        self.color = color

class LeaderBoardRow:
    def __init__(self, color: int, army_count: int):
        self.color = color
        self.army_count = army_count

class initGameInfo:
    def __init__(self, map_width: int, map_height: int):
        self.map_width = map_width
        self.map_height = map_height

def init_map(map_width: int, map_height: int):
    game_map = [[(TileType.Fog, None, None)] * map_height for _ in range(map_width)]
    total_viewed = [[False] * map_height for _ in range(map_width)]
    return game_map, total_viewed

def un_revealed(tile: Tuple[TileType, int, int]):
    return tile[0] == TileType.Fog or tile[0] == TileType.Obstacle

def un_moveable(tile: Tuple[TileType, int, int], ignore_city: bool):
    return tile[0] == TileType.Mountain or tile[0] == TileType.Obstacle or (ignore_city and tile[0] == TileType.City)

def pos_out_of_range(pos: Position, game_map, init_game_info):
    if not game_map or not init_game_info:
        return True
    map_width = init_game_info.map_width
    map_height = init_game_info.map_height
    if pos.x < 0 or pos.x >= map_width:
        return True
    if pos.y < 0 or pos.y >= map_height:
        return True
    return False

def calc_dist(a: Position, b: Position):
    return abs(a.x - b.x) + abs(a.y - b.y)

def patch_map(map_diff: MapDiffData, game_map, total_viewed, init_game_info):
    if not game_map or not total_viewed or not init_game_info:
        return
    map_width = init_game_info.map_width
    map_height = init_game_info.map_height
    flattened = [tile for sublist in game_map for tile in sublist]
    new_state = list(game_map)
    j = 0
    for i in range(len(map_diff.diff)):
        tmp = map_diff.diff[i]
        if isinstance(tmp, int):
            j += tmp
        else:
            flattened[j] = tmp
            j += 1
    for i in range(map_width):
        for j in range(map_height):
            new_state[i][j] = flattened[i * map_height + j]
            if not total_viewed[i][j] and not un_revealed(new_state[i][j]):
                total_viewed[i][j] = True
            if new_state[i][j][0] == TileType.King and new_state[i][j][1]:
                if new_state[i][j][1] == gbot.color:
                    gbot.my_general = Position(i, j)
                elif len([a for a in gbot.enemy_general if a.color == new_state[i][j][1]]) == 0:
                    gbot.enemy_general.append(ExPosition(i, j, new_state[i][j][1]))
    gbot.enemy_general = [g for g in gbot.enemy_general if new_state[g.x][g.y][1] == g.color or new_state[g.x][g.y][0] == TileType.Fog]
    gbot.game_map = new_state

def handle_move(turns_count: int, game_map, init_game_info, gbot):
    if not game_map or not init_game_info or not gbot.color:
        return
    map_width = init_game_info.map_width
    map_height = init_game_info.map_height
    if not gbot.queue or gbot.queue.is_empty():
        while not gbot.queue.is_empty():
            item = gbot.queue.pop_front()
            if gbot.game_map[item.from_pos.x][item.from_pos.y][1] != gbot.color:
                gbot.queue.pop_front()
            if (item.purpose == QuePurpose.Defend or item.purpose == QuePurpose.AttackGeneral or item.purpose == QuePurpose.ExpandLand) and gbot.game_map[item.target.x][item.target.y][1] == gbot.color:
                gbot.queue.pop_front()
            else:
                break
        a = gbot.queue.pop_front()
        if a:
            socket.emit("attack", a.from_pos, a.to_pos, False)
            return
    if gbot.enemy_general and gbot.queue:
        for a in gbot.enemy_general:
            gbot.queue.que = []
            if a.color == gbot.attack_color:
                gather_armies(QuePurpose.AttackGeneral, 5, Position(a.x, a.y), 2 * (map_width + map_height))
            gather_armies(QuePurpose.AttackGeneral, 100, Position(a.x, a.y), 2 * (map_width + map_height))
        return
    if king_in_danger(game_map, init_game_info, gbot):
        return
    if gbot.attack_color != -1 and gbot.attack_position and gbot.queue and gbot.total_viewed:
        if gbot.game_map[gbot.attack_position.x][gbot.attack_position.y][1] == gbot.color:
            for d in sorted(directions, key=lambda x: random.random() - 0.5):
                new_pos = Position(gbot.attack_position.x + d[0], gbot.attack_position.y + d[1])
                if pos_out_of_range(new_pos, game_map, init_game_info) or un_moveable(gbot.game_map[new_pos.x][new_pos.y], True) or gbot.total_viewed[new_pos.x][new_pos.y]:
                    continue
                if gbot.game_map[new_pos.x][new_pos.y][1] == gbot.attack_color:
                    gbot.queue.push_back(QueItem(gbot.attack_position, new_pos, QuePurpose.Attack, 999, new_pos))
                    gbot.attack_position = new_pos
                    return
            for d in sorted(directions, key=lambda x: random.random() - 0.5):
                new_pos = Position(gbot.attack_position.x + d[0], gbot.attack_position.y + d[1])
                if pos_out_of_range(new_pos, game_map, init_game_info) or un_moveable(gbot.game_map[new_pos.x][new_pos.y], False):
                    continue
                if gbot.game_map[new_pos.x][new_pos.y][1] == gbot.attack_color:
                    gbot.queue.push_back(QueItem(gbot.attack_position, new_pos, QuePurpose.Attack, 999, new_pos))
                    gbot.attack_position = new_pos
                    return
            gbot.attack_color = -1
            gbot.attack_position = None
        else:
            gbot.attack_color = -1
            gbot.attack_position = None
    if detect_threat(game_map, init_game_info, gbot):
        return
    if (turns_count + 1) % 17 == 0:
        quick_expand(game_map, total_viewed, gbot)
    elif turns_count + 1 > 17:
        expand_land(game_map, init_game_info, gbot)

def king_in_danger(game_map, init_game_info, gbot):
    if not gbot.my_general or not game_map or not init_game_info or not gbot.queue:
        return False
    ex_directions = directions + [(-1, -1), (-1, 1), (1, -1), (1, 1)]
    map_width = init_game_info.map_width
    map_height = init_game_info.map_height
    for d in ex_directions:
        tile = Position(gbot.my_general.x + d[0], gbot.my_general.y + d[1])
        if not pos_out_of_range(tile, game_map, init_game_info) and game_map[tile.x][tile.y][1] and game_map[tile.x][tile.y][1] != gbot.color:
            gather_armies(QuePurpose.Defend, 999, gbot.my_general, 10)
            return True
    return False

def detect_threat(game_map, init_game_info, gbot):
    if not gbot.my_general or not game_map:
        return False
    queue = []
    book = []
    queue.append((gbot.my_general, 0))
    book.append(str(gbot.my_general))
    front = 0
    end = 0
    selected = []
    while front <= end:
        a = queue[front]
        for d in sorted(directions, key=lambda x: random.random() - 0.5):
            b = Position(a[0].x + d[0], a[0].y + d[1])
            if str(b) in book or pos_out_of_range(b, game_map, init_game_info) or un_revealed(game_map[b.x][b.y]) or un_moveable(game_map[b.x][b.y], False):
                continue
            queue.append((b, a[1] + 1))
            book.append(str(b))
            end += 1
            if game_map[b.x][b.y][1] and game_map[b.x][b.y][1] != gbot.color:
                selected.append((game_map[b.x][b.y], b, (game_map[b.x][b.y][2] as int) - calc_dist(gbot.my_general, b)))
    selected = sorted(selected, key=lambda x: x[2], reverse=True)
    threat = selected[0] if selected else None
    if threat:
        gather_armies(QuePurpose.Defend, threat[2], threat[1], 25)
        gbot.attack_color = threat[0][1] as int
        gbot.attack_position = threat[1]
    return len(selected) > 0

def gather_armies(purpose: QuePurpose, priority: int, to_pos: Position, limit: int, game_map, init_game_info, gbot):
    if not game_map or not gbot.queue or not init_game_info:
        return 0
    map_width = init_game_info.map_width
    map_height = init_game_info.map_height
    queue = []
    possible_way = [[PossibleWay() for _ in range(map_height)] for _ in range(map_width)]
    queue.append((to_pos, 0))
    possible_way[to_pos.x][to_pos.y] = PossibleWay(gbot.game_map[to_pos.x][to_pos.y][2] as int, [to_pos], False)
    front = 0
    end = 0
    while front <= end:
        a = queue[front]
        possible_way[a[0].x][a[0].y].tag = True
        if a[1] >= limit:
            break
        for d in sorted(directions, key=lambda x: random.random() - 0.5):
            b = Position(a[0].x + d[0], a[0].y + d[1])
            if pos_out_of_range(b, game_map, init_game_info) or un_moveable(game_map[b.x][b.y], False) or possible_way[b.x][b.y].tag:
                continue
            new_val = possible_way[a[0].x][a[0].y].val - 1
            if game_map[b.x][b.y][1] != gbot.color:
                if game_map[b.x][b.y][0] == TileType.City:
                    continue
                new_val -= game_map[b.x][b.y][2] as int
            else:
                new_val += game_map[b.x][b.y][2] as int
            if possible_way[b.x][b.y].val >= new_val:
                continue
            new_way = possible_way[a[0].x][a[0].y].way + [b]
            queue.append((b, a[1] + 1))
            end += 1
            possible_way[b.x][b.y] = PossibleWay(new_val, new_way, False)
    max_way = PossibleWay(0, [], False)
    for a in possible_way:
        for b in a:
            if b.val > max_way.val:
                max_way = b
    if max_way.val <= 0:
        return 0
    prev = None
    for next_pos in max_way.way:
        if prev:
            gbot.queue.push_back(QueItem(prev, next_pos, purpose, priority, max_way.way[-1]))
        prev = next_pos
    return len(max_way.way)

def quick_expand(game_map, total_viewed, gbot):
    if not game_map or not total_viewed or not gbot.queue or not gbot.my_general or not gbot.init_game_info:
        return 0
    map_width = gbot.init_game_info.map_width
    map_height = gbot.init_game_info.map_height
    queue = []
    possible_way = [[PossibleWay() for _ in range(map_height)] for _ in range(map_width)]
    queue.append((gbot.my_general, 0))
    possible_way[gbot.my_general.x][gbot.my_general.y] = PossibleWay(gbot.game_map[gbot.my_general.x][gbot.my_general.y][2] as int, [gbot.my_general], False)
    front = 0
    end = 0
    while front <= end:
        a = queue[front]
        possible_way[a[0].x][a[0].y].tag = True
        for d in sorted(directions, key=lambda x: random.random() - 0.5):
            b = Position(a[0].x + d[0], a[0].y + d[1])
            if pos_out_of_range(b, game_map, init_game_info) or un_moveable(game_map[b.x][b.y], False) or possible_way[b.x][b.y].tag:
                continue
            new_val = possible_way[a[0].x][a[0].y].val - 1
            if game_map[b.x][b.y][1] != gbot.color:
                if game_map[b.x][b.y][0] == TileType.City:
                    continue
                new_val -= game_map[b.x][b.y][2] as int
            else:
                new_val += game_map[b.x][b.y][2] as int
            if possible_way[b.x][b.y].val >= new_val:
                continue
            new_way = possible_way[a[0].x][a[0].y].way + [b]
            queue.append((b, a[1] + 1))
            end += 1
            possible_way[b.x][b.y] = PossibleWay(new_val, new_way, False)
    max_way = PossibleWay(0, [], False)
    for a in possible_way:
        for b in a:
            if b.val > 0 and not total_viewed[b.way[-1].x][b.way[-1].y]:
                if max_way.val == 0:
                    max_way = b
                elif random.random() < 0.7:
                    max_way = b
    if max_way.val == 0:
        return 0
    prev = None
    for next_pos in max_way.way:
        if prev:
            gbot.queue.push_back(QueItem(prev, next_pos, QuePurpose.ExpandLand, 50, max_way.way[-1]))
        prev = next_pos

def expand_land(game_map, init_game_info, gbot):
    if not game_map or not init_game_info:
        return
    tiles = []
    map_width = init_game_info.map_width
    map_height = init_game_info.map_height
    for i in range(map_width):
        for j in range(map_height):
            if game_map[i][j][0] == TileType.Plain and game_map[i][j][1] != gbot.color:
                tiles.append(Position(i, j))
    random.shuffle(tiles)
    ok = False
    for tile in tiles:
        if gather_armies(QuePurpose.ExpandLand, 10, tile, 1, game_map, init_game_info, gbot):
            ok = True
    if not ok:
        gather_armies(QuePurpose.ExpandLand, 10, tiles[0], 10, game_map, init_game_info, gbot)

def main():
    dotenv.load_dotenv()
    server_url = os.getenv("SERVER_URL")
    room_id = os.getenv("ROOM_ID")
    bot_name = os.getenv("BOT_NAME") or "GenniaBot"

    if not server_url or not room_id:
        raise Exception("Important arguments missing.")

    gbot = GBot(room_id, bot_name)

    directions = [
        (-1, 0),
        (0, 1),
        (1, 0),
        (0, -1)
    ]

    socket = socketio.Client()
    socket.connect(server_url)

    @socket.on("connect")
    def on_connect():
        pass

    @socket.on("update_room")
    def on_update_room(room: Room):
        gbot.room = room
        bot_player = next((p for p in room.players if p.id == gbot.my_player_id), None)
        gbot.color = bot_player.color
        if not bot_player.force_start:
            socket.emit("force_start")
        if bot_player.is_room_host and not room.game_started:
            socket.emit("tran")
            human_player = next((p for p in room.players if p.id != gbot.my_player_id), None)
            if human_player:
                socket.emit("change_host", human_player.id)

    @socket.on("set_player_id")
    def on_set_player_id(player_id: str):
        gbot.my_player_id = player_id

    @socket.on("error")
    def on_error(title: str, message: str):
        pass

    @socket.on("game_started")
    def on_game_started(init_game_info: initGameInfo):
        gbot.init_game_info = init_game_info
        gbot.game_map, gbot.total_viewed = init_map(init_game_info.map_width, init_game_info.map_height)

    @socket.on("game_update")
    def on_game_update(map_diff: MapDiffData, turns_count: int, leader_board_data: LeaderBoardTable):
        gbot.leader_board_data = leader_board_data
        patch_map(map_diff, gbot.game_map, gbot.total_viewed, gbot.init_game_info)
        handle_move(turns_count, gbot.game_map, gbot.init_game_info, gbot)

    @socket.on("game_over")
    def on_game_over(captured_by: UserData):
        pass

    @socket.on("game_ended")
    def on_game_ended(winner: UserData, replay_link: str):
        pass

    socket.emit("get_room_info")

if __name__ == "__main__":
    main()