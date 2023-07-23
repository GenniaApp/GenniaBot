import Point from "./point";
import Player from "./player";
import GameMap from "./map";
import MapDiff from "./map-diff";

export { Point, Player, GameMap, MapDiff };

export interface ExPosition {
  x: number;
  y: number;
  color: number;
}

export interface GBot {
  roomId: string;
  room: Room | null;
  username: string;
  myPlayerId: string | null;
  color: number | null;
  myGeneral: Position | null;
  enemyGeneral: Array<ExPosition>;
  initGameInfo: initGameInfo | null;
  gameMap: TileProp[][] | null;
  totalViewed: boolean[][] | null;
  queue: AttackQueue | null;
}

export enum QuePurpose {
  Defend = 0,
  Attack = 1,
  AttackGather = 2,
  AttackGeneral = 3,
  ExpandCity = 4,
  ExpandLand = 5,
}

export interface QueItem {
  purpose: QuePurpose;
  priority: number;
  from: Position;
  to: Position;
  target: Position;
}

export class AttackQueue {
  constructor(public que: Array<QueItem> = []) {}

  pushBack(item: QueItem): void {
    // while (
    //   this.que.length > 0 &&
    //   this.que[this.que.length - 1].priority < item.priority
    // ) {
    //   this.que.pop();
    // }
    this.que.push(item);
  }

  popFront(): QueItem | undefined {
    return this.que.shift();
  }

  isEmpty(): boolean {
    return this.que.length === 0;
  }
}

export interface BFSQueItem {
  pos: Position;
  step: number;
}

export interface ExBFSQueueItem {
  pos: Position;
  step: number;
  way: Position[];
}

export interface initGameInfo {
  king: Position;
  mapWidth: number;
  mapHeight: number;
}

export interface SelectedMapTileInfo {
  x: number;
  y: number;
  half: boolean;
  unitsCount: number | null;
}

export interface Position {
  x: number;
  y: number;
}

export interface Route {
  from: Position;
  to: Position;
}

export type LeaderBoardRow = [
  number, // color
  number, // armyCount
  number // landCount
];

export type LeaderBoardTable = LeaderBoardRow[];

export interface UserData {
  id?: string;
  username: string;
  color: number;
}

export class Message {
  constructor(
    public player: UserData,
    public content: string,
    public target?: UserData | null,
    public turn?: number
  ) {}
}

export class Room {
  constructor(
    public id: string,
    public roomName: string = "Untitled",
    public gameStarted: boolean = false,
    public forceStartNum: number = 0,
    public mapGenerated: boolean = false,
    public maxPlayers: number = 8,
    public gameSpeed: number = 1, // valid value: [0.25, 0.5, 0.75, 1, 2, 3, 4];
    public mapWidth: number = 0.75,
    public mapHeight: number = 0.75,
    public mountain: number = 0.5,
    public city: number = 0.5,
    public swamp: number = 0,
    public fogOfWar: boolean = true,
    public deathSpectator: boolean = true, // allow dead player to watch game
    public globalMapDiff: MapDiff | null = null,
    public gameRecord: any,
    public map: GameMap | null = null,
    public gameLoop: any = null, // gameLoop function
    public players: Player[] = new Array<Player>(),
    public generals: Point[] = new Array<Point>()
  ) {}

  toJSON() {
    const { gameLoop, generals, ...json } = this;
    return json;
  }
}

export type RoomPool = { [key: string]: Room };

export enum TileType {
  King = 0, // base
  City = 1, // spawner
  Fog = 2, // it's color unit = null
  Obstacle = 3, // Either City or Mountain, which is unknown, it's color unit = null
  Plain = 4, // blank , plain, Neutral, 有数值时，即是army
  Mountain = 5,
  Swamp = 6,
}

export enum RoomUiStatus {
  loading,
  gameRealStarted, // loading over, gameStarted
  gameSetting,
  gameOverConfirm,
}

export type TileProp = [
  TileType,
  number | null, // color, when color == null it means no player own this tile
  number | null // unitsCount
];

export type TilesProp = TileProp[];

export type MapData = TilesProp[];

export type MapDiffData = (number | TileProp)[]; // number: same count, TileProp: diff
