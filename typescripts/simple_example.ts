import io from "socket.io-client";
import {
    initGameInfo,
    UserData,
    MapDiffData,
    LeaderBoardTable,
    TileType,
    TileProp,
    Room,
    Point
} from "./lib/types";

if (!process.env.SERVER_URL || !process.env.ROOM_ID) {
    throw new Error("Important arguments missing.");
}

interface GBot {
    roomId: string;
    room: Room | null;
    username: string;
    myPlayerId: string | null;
    color: number | null;
    initGameInfo: initGameInfo | null;
    gameMap: TileProp[][] | null;
}

const gbot: GBot = {
    roomId: process.env.ROOM_ID,
    room: null,
    username: process.env.NAME || "GenniaBot",
    myPlayerId: null,
    color: null,
    initGameInfo: null,
    gameMap: null,
};

const directions = [
    [-1, 0],
    [0, 1],
    [1, 0],
    [0, -1],
];

const socket = io(process.env.SERVER_URL, { query: { ...gbot } });

socket.emit("get_room_info");

// set up socket event listeners
socket.on("connect", () => {
    console.log(`socket client connect to server: ${socket.id}`);
});

socket.on("update_room", (room: Room) => {
    console.log("update_room");
    console.log(room);
    gbot.room = room;
    gbot.color = room.players.filter((p) => p.id === gbot.myPlayerId)[0].color;
});

socket.on("set_player_id", (playerId: string) => {
    console.log(`set_player_id: ${playerId}`);
    gbot.myPlayerId = playerId;
});

socket.on("error", (title: string, message: string) => {
    console.log("GET ERROR FROM SERVER:\n", title, message);
});

socket.emit("force_start");

socket.on("game_started", (initGameInfo: initGameInfo) => {
    console.log("Game started:", initGameInfo);
    gbot.initGameInfo = initGameInfo;
    initMap(initGameInfo.mapWidth, initGameInfo.mapHeight);
});

socket.on(
    "game_update",
    (
        mapDiff: MapDiffData,
        turnsCount: number,
        leaderBoardData: LeaderBoardTable
    ) => {
        console.log(`game_update: ${turnsCount}`);
        patchMap(mapDiff);
        handleMove();
    }
);

socket.on("game_over", (capturedBy: UserData) => {
    console.log(`game_over: ${capturedBy.username}`);
    process.exit(0);
});

socket.on("game_ended", (winner: UserData, replayLink: string) => {
    console.log(`game_ended: ${winner.username} ${replayLink}`);
    process.exit(0);
});

socket.on("attack_success", (from: Point, to: Point, turn: number) => {
    console.log(`attack_success: ${from} ${to} ${turn}`);
});

socket.on("attack_failure", (from: Point, to: Point, msg: string) => {
    console.log(`attack_failure: ${from} ${to} ${msg}`);
});

function initMap(mapWidth: number, mapHeight: number) {
    gbot.gameMap = Array.from(Array(mapWidth), () =>
        Array(mapHeight).fill([TileType.Fog, null, null])
    );
}

function patchMap(mapDiff: MapDiffData) {
    if (!gbot.gameMap) return;
    let mapWidth = gbot.gameMap.length;
    let mapHeight = gbot.gameMap[0].length;
    let flattened = gbot.gameMap.flat();
    let newState = [...gbot.gameMap];
    for (let i = 0, j = 0; i < mapDiff.length; i++) {
        let tmp = mapDiff[i]; // Ensure that the type inspection can be passed.
        if (typeof tmp === "number") {
            j += tmp;
        } else {
            flattened[j++] = tmp;
        }
    }
    for (let i = 0; i < mapWidth; ++i) {
        for (let j = 0; j < mapHeight; ++j) {
            newState[i][j] = flattened[i * mapHeight + j];
        }
    }
    gbot.gameMap = newState;
}

function handleMove() {
    if (!gbot.gameMap || !gbot.initGameInfo || !gbot.color) return;
    let mapWidth = gbot.gameMap.length;
    let mapHeight = gbot.gameMap[0].length;
    let lands: Point[] = new Array<Point>();
    for (let i = 0; i < mapWidth; ++i) {
        for (let j = 0; j < mapHeight; ++j) {
            if (
                gbot.gameMap[i][j][2] === gbot.color &&
                (gbot.gameMap[i][j][1] as number) > 1
            ) {
                lands.push(new Point(i, j));
            }
        }
    }
    let target = lands[Math.floor(Math.random() * lands.length)];
    if (!target) return;
    let direction = directions[Math.floor(Math.random() * directions.length)];

    socket.emit('attack', target, { x: target.x + direction[0], y: target.y + direction[1] }, false);
}