import io from "socket.io-client";
import {
  GBot,
  QueItem,
  QuePurpose,
  initGameInfo,
  UserData,
  MapDiffData,
  LeaderBoardTable,
  TileType,
  TileProp,
  Room,
  Position,
  BFSQueItem,
  ExPosition,
} from "./lib/types";

if (!process.env.SERVER_URL || !process.env.ROOM_ID) {
  throw new Error("Important arguments missing.");
}

const gbot: GBot = {
  roomId: process.env.ROOM_ID,
  room: null,
  username: process.env.NAME || "GenniaBot",
  myPlayerId: null,
  color: null,
  myGeneral: null,
  enemyGeneral: new Array<ExPosition>(),
  initGameInfo: null,
  gameMap: null,
  queue: new Array<QueItem>(),
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
  async (
    mapDiff: MapDiffData,
    turnsCount: number,
    leaderBoardData: LeaderBoardTable
  ) => {
    console.log(`game_update: ${turnsCount}`);
    await patchMap(mapDiff);
    await handleMove();
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

function initMap(mapWidth: number, mapHeight: number) {
  gbot.gameMap = Array.from(Array(mapWidth), () =>
    Array(mapHeight).fill([TileType.Fog, null, null])
  );
}

const unRevealed = (tile: TileProp) =>
  tile[0] === TileType.Fog || tile[0] === TileType.Obstacle;

const unMoveable = (tile: TileProp, ignoreCity: boolean) =>
  tile[0] === TileType.Mountain ||
  tile[0] === TileType.Obstacle ||
  (ignoreCity && tile[0] === TileType.City);

const posOutOfRange = (pos: Position) => {
  if (!gbot.gameMap) return true;
  let mapWidth = gbot.gameMap.length;
  let mapHeight = gbot.gameMap[0].length;
  if (pos.x < 0 || pos.x >= mapWidth) return true;
  if (pos.y < 0 || pos.y >= mapHeight) return true;
  return false;
};

const calcDist = (a: Position, b: Position) =>
  Math.abs(a.x - b.x) + Math.abs(a.y - b.y);

async function patchMap(mapDiff: MapDiffData) {
  if (!gbot.gameMap) return;
  let mapWidth = gbot.gameMap.length;
  let mapHeight = gbot.gameMap[0].length;
  let flattened = gbot.gameMap.flat();
  let newState = [...gbot.gameMap];
  for (let i = 0, j = 0; i < mapDiff.length; i++) {
    let tmp = mapDiff[i]; // Ensure that the type inspection can be passed.
    if (typeof tmp === "number") {
      j += tmp;
    } else if (!(unRevealed(tmp) && !unRevealed(flattened[j]))) {
      // recognize previously discovered map state
      flattened[j++] = tmp;
    } else {
      j++;
    }
  }
  for (let i = 0; i < mapWidth; ++i) {
    for (let j = 0; j < mapHeight; ++j) {
      newState[i][j] = flattened[i * mapHeight + j];
      if (newState[i][j][0] === TileType.King && newState[i][j][1]) {
        if (newState[i][j][1] === gbot.color) gbot.myGeneral = { x: i, y: j };
        else if (
          gbot.enemyGeneral.filter((a) => a.color === newState[i][j][1])
            .length === 0
        ) {
          gbot.enemyGeneral.push({
            x: i,
            y: j,
            color: newState[i][j][1] as number,
          });
        }
      }
    }
  }
  gbot.gameMap = newState;
}

async function handleMove() {
  if (!gbot.gameMap || !gbot.initGameInfo || !gbot.color) return;
  let mapWidth = gbot.gameMap.length;
  let mapHeight = gbot.gameMap[0].length;
  let lands: Position[] = new Array<Position>();
  for (let i = 0; i < mapWidth; ++i) {
    for (let j = 0; j < mapHeight; ++j) {
      if (
        gbot.gameMap[i][j][1] === gbot.color &&
        (gbot.gameMap[i][j][2] as number) > 1
      ) {
        lands.push({ x: i, y: j });
      }
    }
  }
  let target = lands[Math.floor(Math.random() * lands.length)];
  if (!target) return;
  let direction = directions[Math.floor(Math.random() * directions.length)];
  socket.emit("attack", target, {
    x: target.x + direction[0],
    y: target.y + direction[1],
  });
}

interface ThreatTile {
  tile: TileProp;
  pos: Position;
  dist: number;
}

async function detectThreat() {
  if (!gbot.myGeneral || !gbot.gameMap) return;
  let queue = new Array<BFSQueItem>(),
    book = new Array<Position>();
  queue.push({ pos: gbot.myGeneral, step: -1 }), book.push(gbot.myGeneral);
  let front = 0,
    end = 0;
  let select = new Array<ThreatTile>();
  while (front <= end) {
    let a = queue[front++];
    for (let d of directions) {
      let b: Position = { x: a.pos.x + d[0], y: a.pos.y + d[1] };
      if (
        book.includes(b) ||
        posOutOfRange(b) ||
        unRevealed(gbot.gameMap[b.x][b.y]) ||
        unMoveable(gbot.gameMap[b.x][b.y], false)
      )
        continue;
      queue.push({ pos: b, step: a.step + 1 }), book.push(b), ++end;
      if (
        gbot.gameMap[b.x][b.y][1] &&
        gbot.gameMap[b.x][b.y][1] !== gbot.color
      ) {
        select.push({
          tile: gbot.gameMap[b.x][b.y],
          pos: b,
          dist: calcDist(gbot.myGeneral, b),
        });
      }
    }
  }
  if (select.length)
    console.log("[threat] pos " + select[0].pos + " " + select[0].dist);
  if (select.length) return select.sort((a, b) => b.dist - a.dist)[0];
  else return -1;
}

interface PossibleWay {
  val: number;
  way: Array<Position>;
  tag: boolean;
}

async function gatherArmies(
  purpose: QuePurpose,
  priority: number,
  toPos: Position,
  limit: number
): Promise<number> {
  if (!gbot.gameMap || !gbot.queue) return -1;
  let mapWidth = gbot.gameMap.length;
  let mapHeight = gbot.gameMap[0].length;
  let queue = new Array<BFSQueItem>();
  let possibleWay = new Array(mapWidth).fill(
    new Array<PossibleWay>(mapHeight).fill({
      val: -9999999,
      way: [],
      tag: false,
    })
  );
  if (gbot.gameMap[toPos.x][toPos.y][1] !== gbot.color) {
    possibleWay[toPos.x][toPos.y] = {
      val: -(gbot.gameMap[toPos.x][toPos.y][2] as number),
      way: [toPos],
      tag: false,
    };
  } else {
    possibleWay[toPos.x][toPos.y] = {
      val: gbot.gameMap[toPos.x][toPos.y][2] as number,
      way: [toPos],
      tag: false,
    };
  }
  let front = 0,
    end = 0;
  while (front <= end) {
    let a = queue[front++];
    possibleWay[a.pos.x][a.pos.y].tag = true;
    if (a.step >= limit) break;
    for (let d of directions) {
      let b: Position = { x: a.pos.x + d[0], y: a.pos.y + d[1] };
      if (posOutOfRange(b) || unMoveable(gbot.gameMap[b.x][b.y], false))
        continue;
      let newVal = possibleWay[a.pos.x][a.pos.y].val - 1;
      if (gbot.gameMap[b.x][b.y][1] !== gbot.color) {
        if (gbot.gameMap[b.x][b.y][0] === TileType.City) continue;
        newVal -= gbot.gameMap[b.x][b.y][2] as number;
      } else {
        newVal += gbot.gameMap[b.x][b.y][2] as number;
      }
      if (possibleWay[b.x][b.y].tag && possibleWay[b.x][b.y].val >= newVal)
        continue;
      let newWay = [b, ...possibleWay[a.pos.x][a.pos.y].way];
      queue.push({ step: a.step + 1, pos: b }), ++end;
      possibleWay[b.x][b.y] = {
        val: newVal,
        way: newWay,
        tag: false,
      };
    }
  }
  let maxWay: PossibleWay = { val: 0, way: [], tag: false };
  possibleWay.flat().forEach((x) => {
    if (x.val > maxWay.val) maxWay = x;
  });
  if (maxWay.val === 0) return 0;
  let prev: Position | null = null;
  for (let next of maxWay.way) {
    if (prev) {
      gbot.queue.push({
        from: prev,
        to: next,
        purpose,
        priority,
      });
    }
    prev = next;
  }
  return maxWay.way.length;
}

async function quickExpand(limit: number) {
  if (!gbot.myGeneral || !gbot.gameMap || !gbot.queue) return;
  let queue = new Array<BFSQueItem>(),
    book = new Array<Position>();
  queue.push({ pos: gbot.myGeneral, step: 0, way: [gbot.myGeneral] }),
    book.push(gbot.myGeneral);
  let front = 0,
    end = 0;
  let D = [...directions];
  while (front <= end) {
    let a = queue[front++];
    if (!a.way) continue; // for TypeScript check
    D.sort(() => Math.random() - 0.5);
    for (let d of D) {
      let b: Position = { x: a.pos.x + d[0], y: a.pos.y + d[1] };
      if (
        book.includes(b) ||
        posOutOfRange(b) ||
        unRevealed(gbot.gameMap[b.x][b.y]) ||
        unMoveable(gbot.gameMap[b.x][b.y], true)
      )
        continue;
      queue.push({ pos: b, step: a.step + 1, way: [b, ...a.way] }),
        book.push(b),
        ++end;
    }
  }
  let prev: Position | null = null;
  for (let next of queue[end].way || []) {
    if (prev) {
      gbot.queue.push({
        from: prev,
        to: next,
        purpose: QuePurpose.AttackGather,
        priority: 0,
      });
    }
  }
}
