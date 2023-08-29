import io from "socket.io-client";
import dotenv from 'dotenv';
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
  AttackQueue,
  ExBFSQueueItem,
  LeaderBoardRow,
} from "./lib/types";

dotenv.config();

if (!process.env.SERVER_URL || !process.env.ROOM_ID) {
  throw new Error("Important arguments missing.");
}

const gbot: GBot = {
  roomId: process.env.ROOM_ID as string,
  room: null,
  username: process.env.BOT_NAME || "GenniaBot",
  myPlayerId: null,
  color: null,
  attackColor: -1,
  attackPosition: null,
  myGeneral: null,
  enemyGeneral: new Array<ExPosition>(),
  initGameInfo: null,
  gameMap: null,
  totalViewed: null,
  leaderBoardData: null,
  queue: new AttackQueue(),
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
  // console.log("update_room");
  try {
    gbot.room = room;
    let botPlayer = room.players.filter((p) => p.id === gbot.myPlayerId)[0];
    gbot.color = botPlayer.color;
    if (!botPlayer.forceStart) {
      socket.emit("force_start");
    }
    if (botPlayer.isRoomHost && !room.gameStarted) {
      socket.emit("tran");
      let human_player = room.players.filter((p) => p.id != gbot.myPlayerId)[0];
      if (human_player) socket.emit('change_host', human_player.id);
    }
  } catch (err: any) {
    console.log("Error in update_room");
    console.log(err.stack);
    process.exit(1)
  }
});

socket.on("set_player_id", (playerId: string) => {
  console.log(`set_player_id: ${playerId}`);
  gbot.myPlayerId = playerId;
});

socket.on("error", (title: string, message: string) => {
  // console.log("GET ERROR FROM SERVER:\n", title, message);
});


socket.on("game_started", (initGameInfo: initGameInfo) => {
  // console.log("Game started:", initGameInfo);
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
    gbot.leaderBoardData = leaderBoardData;
    try {
      await patchMap(mapDiff);
      await handleMove(turnsCount);
    } catch (err: any) {
      console.log("Error in game_update");
      console.log(err.stack);
      process.exit(1)
    }
  }
);

socket.on("game_over", (capturedBy: UserData) => {
  console.log(`game_over: ${capturedBy.username}`);
  // process.exit(0);
});

socket.on("game_ended", (winner: UserData, replayLink: string) => {
  console.log(`game_ended: ${winner.username} ${replayLink}`);
  // process.exit(0);
});

function initMap(mapWidth: number, mapHeight: number) {
  gbot.gameMap = Array.from(Array(mapWidth), () =>
    Array(mapHeight).fill([TileType.Fog, null, null])
  );
  gbot.totalViewed = Array.from(Array(mapWidth), () =>
    Array(mapHeight).fill(false)
  );
}

const unRevealed = (tile: TileProp) =>
  tile[0] === TileType.Fog || tile[0] === TileType.Obstacle;

const unMoveable = (tile: TileProp, ignoreCity: boolean) =>
  tile[0] === TileType.Mountain ||
  tile[0] === TileType.Obstacle ||
  (ignoreCity && tile[0] === TileType.City);

const posOutOfRange = (pos: Position) => {
  if (!gbot.gameMap || !gbot.initGameInfo) return true;
  let mapWidth = gbot.initGameInfo.mapWidth;
  let mapHeight = gbot.initGameInfo.mapHeight;
  if (pos.x < 0 || pos.x >= mapWidth) return true;
  if (pos.y < 0 || pos.y >= mapHeight) return true;
  return false;
};

const calcDist = (a: Position, b: Position) =>
  Math.abs(a.x - b.x) + Math.abs(a.y - b.y);

async function patchMap(mapDiff: MapDiffData) {
  if (!gbot.gameMap || !gbot.totalViewed || !gbot.initGameInfo) return;
  let mapWidth = gbot.initGameInfo.mapWidth;
  let mapHeight = gbot.initGameInfo.mapHeight;
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
      if (!gbot.totalViewed[i][j] && !unRevealed(newState[i][j]))
        gbot.totalViewed[i][j] = true;
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
  gbot.enemyGeneral = gbot.enemyGeneral.filter(g => newState[g.x][g.y][1] === g.color || newState[g.x][g.y][0] === TileType.Fog)

  gbot.gameMap = [...newState];
}

async function handleMove(turnsCount: number) {
  if (!gbot.gameMap || !gbot.initGameInfo || !gbot.color) return;
  let mapWidth = gbot.initGameInfo.mapWidth;
  let mapHeight = gbot.initGameInfo.mapHeight;
  if (gbot.queue && !gbot.queue.isEmpty()) {
    while (!gbot.queue.isEmpty()) {
      let item = gbot.queue.que[0];
      if (gbot.gameMap[item.from.x][item.from.y][1] !== gbot.color)
        gbot.queue.popFront();
      if (
        (item.purpose === QuePurpose.AttackGeneral || item.purpose === QuePurpose.ExpandLand) &&
        gbot.gameMap[item.target.x][item.target.y][1] === gbot.color
      )
        gbot.queue.popFront();
      else break;
    }

    let a = gbot.queue.popFront();
    if (a) {
      // console.log('attack:', a)
      socket.emit("attack", a.from, a.to, false);
      return;
    }
  }
  if (gbot.enemyGeneral.length > 0 && gbot.queue) {
    for (let a of gbot.enemyGeneral) {
      gbot.queue.que = [];
      if (a.color === gbot.attackColor) {
        await gatherArmies(QuePurpose.AttackGeneral, 5, { x: a.x, y: a.y }, 2 * (mapWidth + mapHeight));
      }
      await gatherArmies(QuePurpose.AttackGeneral, 100, { x: a.x, y: a.y }, 2 * (mapWidth + mapHeight));
    }
    return;
  }

  if (await kingInDanger()) return;

  if (gbot.attackColor !== -1 && gbot.attackPosition && gbot.queue && gbot.totalViewed) {
    if (gbot.gameMap[gbot.attackPosition.x][gbot.attackPosition.y][1] === gbot.color) {
      console.log("attack mode.");
      for (let d of directions.sort(() => Math.random() - .5)) {
        let newPos: Position = {
          x: gbot.attackPosition.x + d[0],
          y: gbot.attackPosition.y + d[1]
        };
        if (posOutOfRange(newPos) || unMoveable(gbot.gameMap[newPos.x][newPos.y], true)
          || gbot.totalViewed[newPos.x][newPos.y])
          continue;
        if (gbot.gameMap[newPos.x][newPos.y][1] === gbot.attackColor) {
          gbot.queue.pushBack({
            purpose: QuePurpose.Attack,
            priority: 999,
            from: gbot.attackPosition,
            to: newPos,
            target: newPos
          });
          gbot.attackPosition = newPos;
          return;
        }
      } // If not found, then consider conquer the city.
      for (let d of directions.sort(() => Math.random() - .5)) {
        let newPos: Position = {
          x: gbot.attackPosition.x + d[0],
          y: gbot.attackPosition.y + d[1]
        };
        if (posOutOfRange(newPos) || unMoveable(gbot.gameMap[newPos.x][newPos.y], false))
          continue;
        if (gbot.gameMap[newPos.x][newPos.y][1] === gbot.attackColor) {
          gbot.queue.pushBack({
            purpose: QuePurpose.Attack,
            priority: 999,
            from: gbot.attackPosition,
            to: newPos,
            target: newPos
          });
          gbot.attackPosition = newPos;
          return;
        }
      }
      gbot.attackColor = -1;
      gbot.attackPosition = null;
    } else {
      gbot.attackColor = -1;
      gbot.attackPosition = null;
    }
  }

  if (await determineExpand()) return;

  if (await detectThreat()) return;

  if ((turnsCount + 1) % 17 === 0) {
    await quickExpand();
  } else if (turnsCount + 1 > 17) {
    await expandLand();
  }
}

async function determineExpand(): Promise<boolean> {
  if (!gbot.leaderBoardData) return false;
  let maxArmyCount = 0, myArmyCount = 0;
  for (let a of gbot.leaderBoardData) {
    if (a[0] === gbot.color) myArmyCount = a[1];
    if (a[1] > maxArmyCount) maxArmyCount = a[1];
  }
  if (maxArmyCount > myArmyCount * 1.5) {
    await expandLand();
    return true;
  }
  return false;
}

async function kingInDanger(): Promise<boolean> {
  if (!gbot.myGeneral || !gbot.gameMap || !gbot.initGameInfo || !gbot.queue) return false;
  const exDirections = [...directions, [-1, -1], [-1, 1], [1, -1], [1, 1]];
  const mapWidth = gbot.initGameInfo.mapWidth;
  const mapHeight = gbot.initGameInfo.mapHeight;
  for (let d of exDirections) {
    let tile: Position = { x: gbot.myGeneral.x + d[0], y: gbot.myGeneral.y + d[1] };
    if (!posOutOfRange(tile)
      && gbot.gameMap[tile.x][tile.y][1]
      && gbot.gameMap[tile.x][tile.y][1] !== gbot.color) {
      console.log("king is in danger", gbot.gameMap[tile.x][tile.y][1]);
      await gatherArmies(QuePurpose.Defend, 999, tile, 10);
      await gatherArmies(QuePurpose.Defend, 999, gbot.myGeneral, 10);
      return true;
    }
  }
  return false;
}

interface ThreatTile {
  tile: TileProp;
  pos: Position;
  val: number;
}

async function detectThreat(): Promise<boolean> {
  if (!gbot.myGeneral || !gbot.gameMap) return false;
  let queue = new Array<BFSQueItem>(),
    book = new Array<string>();
  queue.push({ pos: gbot.myGeneral, step: 0 }), book.push(JSON.stringify(gbot.myGeneral));
  let front = 0, end = 0;
  let selected = new Array<ThreatTile>();
  while (front <= end) {
    let a = queue[front++];
    for (let d of directions.sort(() => Math.random() - .5)) {
      let b: Position = { x: a.pos.x + d[0], y: a.pos.y + d[1] };
      if (
        book.includes(JSON.stringify(b)) ||
        posOutOfRange(b) ||
        unRevealed(gbot.gameMap[b.x][b.y]) ||
        unMoveable(gbot.gameMap[b.x][b.y], false)
      )
        continue;
      queue.push({ pos: b, step: a.step + 1 });
      book.push(JSON.stringify(b)); ++end;
      if (
        gbot.gameMap[b.x][b.y][1] &&
        gbot.gameMap[b.x][b.y][1] !== gbot.color
      ) {
        selected.push({
          tile: gbot.gameMap[b.x][b.y],
          pos: b,
          val:
            (gbot.gameMap[b.x][b.y][2] as number) - calcDist(gbot.myGeneral, b),
        });
      }
    }
  }

  selected = selected.sort((a: ThreatTile, b: ThreatTile) => b.val - a.val);

  let threat = selected[0];
  if (threat) {
    await gatherArmies(QuePurpose.Defend, threat.val, threat.pos, 25);
    gbot.attackColor = threat.tile[1] as number;
    gbot.attackPosition = threat.pos;
  }

  return selected.length > 0;

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
  // console.log("gatherArmies started");
  if (!gbot.gameMap || !gbot.queue || !gbot.initGameInfo) return 0;
  let mapWidth = gbot.initGameInfo.mapWidth;
  let mapHeight = gbot.initGameInfo.mapHeight;
  let queue = new Array<BFSQueItem>();
  queue.push({ step: 0, pos: toPos });
  let possibleWay: PossibleWay[][] = new Array(mapWidth);
  for (let i = 0; i < mapWidth; i++) {
    possibleWay[i] = new Array<PossibleWay>(mapHeight);
    for (let j = 0; j < mapHeight; j++) {
      possibleWay[i][j] = {
        val: -9999999,
        way: [],
        tag: false,
      };
    }
  }
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
  let front = 0, end = 0;
  while (front <= end) {
    let a = queue[front++];
    possibleWay[a.pos.x][a.pos.y].tag = true;
    if (a.step >= limit) break;
    for (let d of directions.sort(() => Math.random() - .5)) {
      let b: Position = { x: a.pos.x + d[0], y: a.pos.y + d[1] };
      if (posOutOfRange(b) || unMoveable(gbot.gameMap[b.x][b.y], false) || possibleWay[b.x][b.y].tag)
        continue;
      let newVal = possibleWay[a.pos.x][a.pos.y].val - 1;
      if (gbot.gameMap[b.x][b.y][1] !== gbot.color) {
        if (gbot.gameMap[b.x][b.y][0] === TileType.City) continue;
        newVal -= gbot.gameMap[b.x][b.y][2] as number;
      } else {
        newVal += gbot.gameMap[b.x][b.y][2] as number;
      }
      if (possibleWay[b.x][b.y].val >= newVal)
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
  // console.log("gatherArmies ended");
  if (maxWay.val <= 0) return 0;
  console.log(maxWay.way);
  let prev: Position | null = null;
  for (let next of maxWay.way) {
    if (prev) {
      gbot.queue.pushBack({
        from: prev,
        to: next,
        purpose,
        priority,
        target: maxWay.way[maxWay.way.length - 1],
      });
    }
    prev = next;
  }
  // console.log("gatherArmies ended");
  return maxWay.way.length;
}

async function quickExpand() {
  // console.log("quickExpand started");
  if (!gbot.gameMap || !gbot.totalViewed || !gbot.queue || !gbot.myGeneral || !gbot.initGameInfo) return 0;
  let mapWidth = gbot.initGameInfo.mapWidth;
  let mapHeight = gbot.initGameInfo.mapHeight;
  let queue = new Array<BFSQueItem>();
  queue.push({ step: 0, pos: gbot.myGeneral });
  let possibleWay = new Array(mapWidth).fill(
    new Array<PossibleWay>(mapHeight).fill({
      val: 0,
      way: [],
      tag: false,
    })
  );
  possibleWay[gbot.myGeneral.x][gbot.myGeneral.y] = {
    val: gbot.gameMap[gbot.myGeneral.x][gbot.myGeneral.y][2] as number,
    way: [gbot.myGeneral],
    tag: false,
  };
  let front = 0, end = 0;
  while (front <= end) {
    let a = queue[front++];
    possibleWay[a.pos.x][a.pos.y].tag = true;
    for (let d of directions.sort(() => Math.random() - .5)) {
      let b: Position = { x: a.pos.x + d[0], y: a.pos.y + d[1] };
      if (posOutOfRange(b) || unMoveable(gbot.gameMap[b.x][b.y], false) || possibleWay[b.x][b.y].tag)
        continue;
      let newVal = possibleWay[a.pos.x][a.pos.y].val - 1;
      if (gbot.gameMap[b.x][b.y][1] !== gbot.color) {
        if (gbot.gameMap[b.x][b.y][0] === TileType.City) continue;
        newVal -= gbot.gameMap[b.x][b.y][2] as number;
      } else {
        newVal += gbot.gameMap[b.x][b.y][2] as number;
      }
      if (possibleWay[b.x][b.y].val >= newVal)
        continue;
      let newWay = [...possibleWay[a.pos.x][a.pos.y].way, b];
      queue.push({ step: a.step + 1, pos: b }), ++end;
      possibleWay[b.x][b.y] = {
        val: newVal,
        way: newWay,
        tag: false,
      };
    }
  }
  let maxWay: PossibleWay = { val: 0, way: [], tag: false };
  possibleWay.flat().forEach((a) => {
    if (a.val > 0 && !(gbot.totalViewed as boolean[][])[a.way[a.way.length - 1].x][a.way[a.way.length - 1].y]) {
      if (maxWay.val === 0) {
        maxWay = a;
      } else if (Math.random() < .7) {
        maxWay = a;
      }
    }
  });
  if (maxWay.val === 0) return 0;
  console.log('QuickExpand:', maxWay.way);
  let prev: Position | null = null;
  for (let next of maxWay.way) {
    if (prev) {
      gbot.queue.pushBack({
        from: prev,
        to: next,
        purpose: QuePurpose.ExpandLand,
        priority: 50,
        target: maxWay.way[maxWay.way.length - 1],
      });
    }
    prev = next;
  }
  // console.log("quickExpand ended");
}

async function expandLand() {
  // console.log("expandLand started");
  if (!gbot.gameMap || !gbot.initGameInfo) return;
  let tiles = new Array<Position>();
  let mapWidth = gbot.initGameInfo.mapWidth;
  let mapHeight = gbot.initGameInfo.mapHeight;
  for (let i = 0; i < mapWidth; ++i)
    for (let j = 0; j < mapHeight; ++j)
      if (gbot.gameMap[i][j][0] === TileType.Plain && gbot.gameMap[i][j][1] !== gbot.color)
        tiles.push({ x: i, y: j });
  tiles = tiles.sort(() => Math.random() - 0.5);
  let ok = false;
  for (let tile of tiles)
    if (await gatherArmies(QuePurpose.ExpandLand, 10, tile, 1)) ok = true;
  if (!ok) await gatherArmies(QuePurpose.ExpandLand, 10, tiles[0], 10);
  // console.log("expandLand ended");
}
