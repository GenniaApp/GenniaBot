import socketio
import random
import os
from dotenv import load_dotenv
from typing import List, Tuple, Union

load_dotenv()

sio = socketio.Client()


class TileType:
    Fog = 0
    Land = 1
    City = 2
    General = 3


TilePropTuple = Tuple[int, int, int]


class TileProp:
    def __init__(
        self, tile_type: int, color_index: Union[int, None], army_size: Union[int, None]
    ):
        self.tile_type = tile_type
        self.color_index = color_index  # owner_id
        self.army_size = army_size


class UserData:
    def __init__(self, id: int, username: str, color: int):
        self.id = id
        self.username = username
        self.color = color


class Room:
    def __init__(self, id: str, players: List[UserData]):
        self.id = id
        self.players = players


class Point:
    def __init__(self, x: int, y: int):
        self.x = x
        self.y = y


class GBot:
    def __init__(self, room_id: str, username: str = "GenniaBot"):
        self.room_id = room_id
        self.room = None
        self.username = username
        self.my_player_id = None
        self.color = None
        self.init_game_info = None
        self.game_map = None

    def init_map(self, map_width: int, map_height: int):
        self.game_map = [
            [TileProp(TileType.Fog, None, None) for _ in range(map_height)]
            for _ in range(map_width)
        ]

    def patch_map(self, map_diff: List[Union[int, TilePropTuple]]):
        if not self.game_map:
            return
        map_width = len(self.game_map)
        map_height = len(self.game_map[0])
        flattened = [tile for row in self.game_map for tile in row]
        new_state = [[None for _ in range(map_height)] for _ in range(map_width)]
        i = j = 0
        for diff in map_diff:
            if isinstance(diff, int):
                j += diff
            else:
                flattened[j] = TileProp(*diff)
                j += 1
        for i in range(map_width):
            for j in range(map_height):
                new_state[i][j] = flattened[i * map_height + j]
        self.game_map = new_state

    def handle_move(self):
        if not self.game_map or not self.init_game_info or not self.color:
            return
        map_width = len(self.game_map)
        map_height = len(self.game_map[0])
        lands = []
        for i in range(map_width):
            for j in range(map_height):
                if (
                    self.game_map[i][j].color_index == self.color
                    and self.game_map[i][j].army_size > 1
                ):
                    lands.append(Point(i, j))
        target = lands[random.randint(0, len(lands) - 1)] if lands else None
        if not target:
            return
        direction = random.choice([(0, 1), (0, -1), (1, 0), (-1, 0)])
        print(f"attack {target.x} {target.y} {direction}")
        sio.emit(
            "attack",
            (
                {"x": target.x, "y": target.y},
                {"x": target.x + direction[0], "y": target.y + direction[1]},
                False,
            ),
        )


gbot = GBot(room_id=os.getenv("ROOM_ID"), username=os.getenv("BOT_NAME"))


@sio.event
def connect():
    print(f"socket client connect to server: {sio.sid}")


@sio.event
def update_room(room: dict):
    print("update_room")
    gbot.room = room
    gbot.color = next(
        (p["color"] for p in room["players"] if p["id"] == gbot.my_player_id), None
    )


@sio.event
def set_player_id(player_id: str):
    print(f"set_player_id: {player_id}")
    gbot.my_player_id = player_id


@sio.event
def error(title: str, message: str):
    print("GET ERROR FROM SERVER:\n", title, message)


@sio.event
def room_message(player: dict, message: str):
    print(f"room_message: {player['username']} {message}")


@sio.event
def game_started(init_game_info: dict):
    print("Game started:", init_game_info)
    gbot.init_game_info = init_game_info
    gbot.init_map(init_game_info["mapWidth"], init_game_info["mapHeight"])


@sio.event
def attack_failure(from_p, to, message: str):
    print(f"attack_failure: {from_p} {to} {message}")


@sio.event
def game_update(
    map_diff: List[Union[int, TilePropTuple]],
    turns_count: int,
    leader_board_data: dict,
):
    print(f"game_update: {turns_count}")
    gbot.patch_map(map_diff)
    gbot.handle_move()


@sio.event
def game_over(captured_by: dict):
    print(f"game_over: {captured_by['username']}")
    sio.disconnect()


@sio.event
def game_ended(winner: dict, replay_link: str):
    print(f"game_ended: {winner['username']} {replay_link}")
    sio.disconnect()


sio.connect(
    os.getenv("SERVER_URL") + f"?username={gbot.username}&roomId={gbot.room_id}"
)

sio.emit("force_start")
