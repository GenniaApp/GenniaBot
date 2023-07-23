"use strict";
var __rest = (this && this.__rest) || function (s, e) {
    var t = {};
    for (var p in s) if (Object.prototype.hasOwnProperty.call(s, p) && e.indexOf(p) < 0)
        t[p] = s[p];
    if (s != null && typeof Object.getOwnPropertySymbols === "function")
        for (var i = 0, p = Object.getOwnPropertySymbols(s); i < p.length; i++) {
            if (e.indexOf(p[i]) < 0 && Object.prototype.propertyIsEnumerable.call(s, p[i]))
                t[p[i]] = s[p[i]];
        }
    return t;
};
exports.__esModule = true;
exports.RoomUiStatus = exports.TileType = exports.Room = exports.Message = exports.AttackQueue = exports.QuePurpose = exports.MapDiff = exports.GameMap = exports.Player = exports.Point = void 0;
var point_1 = require("./point");
exports.Point = point_1["default"];
var player_1 = require("./player");
exports.Player = player_1["default"];
var map_1 = require("./map");
exports.GameMap = map_1["default"];
var map_diff_1 = require("./map-diff");
exports.MapDiff = map_diff_1["default"];
var QuePurpose;
(function (QuePurpose) {
    QuePurpose[QuePurpose["Defend"] = 0] = "Defend";
    QuePurpose[QuePurpose["Attack"] = 1] = "Attack";
    QuePurpose[QuePurpose["AttackGather"] = 2] = "AttackGather";
    QuePurpose[QuePurpose["AttackGeneral"] = 3] = "AttackGeneral";
    QuePurpose[QuePurpose["ExpandCity"] = 4] = "ExpandCity";
    QuePurpose[QuePurpose["ExpandLand"] = 5] = "ExpandLand";
})(QuePurpose = exports.QuePurpose || (exports.QuePurpose = {}));
var AttackQueue = /** @class */ (function () {
    function AttackQueue(que) {
        if (que === void 0) { que = []; }
        this.que = que;
    }
    AttackQueue.prototype.pushBack = function (item) {
        // while (
        //   this.que.length > 0 &&
        //   this.que[this.que.length - 1].priority < item.priority
        // ) {
        //   this.que.pop();
        // }
        this.que.push(item);
    };
    AttackQueue.prototype.popFront = function () {
        return this.que.shift();
    };
    AttackQueue.prototype.isEmpty = function () {
        return this.que.length === 0;
    };
    return AttackQueue;
}());
exports.AttackQueue = AttackQueue;
var Message = /** @class */ (function () {
    function Message(player, content, target, turn) {
        this.player = player;
        this.content = content;
        this.target = target;
        this.turn = turn;
    }
    return Message;
}());
exports.Message = Message;
var Room = /** @class */ (function () {
    function Room(id, roomName, gameStarted, forceStartNum, mapGenerated, maxPlayers, gameSpeed, // valid value: [0.25, 0.5, 0.75, 1, 2, 3, 4];
    mapWidth, mapHeight, mountain, city, swamp, fogOfWar, deathSpectator, // allow dead player to watch game
    globalMapDiff, gameRecord, map, gameLoop, // gameLoop function
    players, generals) {
        if (roomName === void 0) { roomName = "Untitled"; }
        if (gameStarted === void 0) { gameStarted = false; }
        if (forceStartNum === void 0) { forceStartNum = 0; }
        if (mapGenerated === void 0) { mapGenerated = false; }
        if (maxPlayers === void 0) { maxPlayers = 8; }
        if (gameSpeed === void 0) { gameSpeed = 1; }
        if (mapWidth === void 0) { mapWidth = 0.75; }
        if (mapHeight === void 0) { mapHeight = 0.75; }
        if (mountain === void 0) { mountain = 0.5; }
        if (city === void 0) { city = 0.5; }
        if (swamp === void 0) { swamp = 0; }
        if (fogOfWar === void 0) { fogOfWar = true; }
        if (deathSpectator === void 0) { deathSpectator = true; }
        if (globalMapDiff === void 0) { globalMapDiff = null; }
        if (map === void 0) { map = null; }
        if (gameLoop === void 0) { gameLoop = null; }
        if (players === void 0) { players = new Array(); }
        if (generals === void 0) { generals = new Array(); }
        this.id = id;
        this.roomName = roomName;
        this.gameStarted = gameStarted;
        this.forceStartNum = forceStartNum;
        this.mapGenerated = mapGenerated;
        this.maxPlayers = maxPlayers;
        this.gameSpeed = gameSpeed;
        this.mapWidth = mapWidth;
        this.mapHeight = mapHeight;
        this.mountain = mountain;
        this.city = city;
        this.swamp = swamp;
        this.fogOfWar = fogOfWar;
        this.deathSpectator = deathSpectator;
        this.globalMapDiff = globalMapDiff;
        this.gameRecord = gameRecord;
        this.map = map;
        this.gameLoop = gameLoop;
        this.players = players;
        this.generals = generals;
    }
    Room.prototype.toJSON = function () {
        var _a = this, gameLoop = _a.gameLoop, generals = _a.generals, json = __rest(_a, ["gameLoop", "generals"]);
        return json;
    };
    return Room;
}());
exports.Room = Room;
var TileType;
(function (TileType) {
    TileType[TileType["King"] = 0] = "King";
    TileType[TileType["City"] = 1] = "City";
    TileType[TileType["Fog"] = 2] = "Fog";
    TileType[TileType["Obstacle"] = 3] = "Obstacle";
    TileType[TileType["Plain"] = 4] = "Plain";
    TileType[TileType["Mountain"] = 5] = "Mountain";
    TileType[TileType["Swamp"] = 6] = "Swamp";
})(TileType = exports.TileType || (exports.TileType = {}));
var RoomUiStatus;
(function (RoomUiStatus) {
    RoomUiStatus[RoomUiStatus["loading"] = 0] = "loading";
    RoomUiStatus[RoomUiStatus["gameRealStarted"] = 1] = "gameRealStarted";
    RoomUiStatus[RoomUiStatus["gameSetting"] = 2] = "gameSetting";
    RoomUiStatus[RoomUiStatus["gameOverConfirm"] = 3] = "gameOverConfirm";
})(RoomUiStatus = exports.RoomUiStatus || (exports.RoomUiStatus = {}));
