#include <algorithm>
#include <iostream>
#include <vector>

struct Position {
  int x;
  int y;
};

enum TileType { Fog, Obstacle, Mountain, City, Plain, King };

struct TileProp {
  TileType type;
  int color;
  int armyCount;
};

enum QuePurpose { Defend, AttackGeneral, ExpandLand, Attack };

struct QueItem {
  Position from;
  Position to;
  QuePurpose purpose;
  int priority;
  Position target;
};

struct BFSQueItem {
  int step;
  Position pos;
};

struct ExPosition {
  int x;
  int y;
  int color;
};

struct LeaderBoardRow {
  int color;
  int armyCount;
};

typedef std::vector<std::vector<TileProp>> GameMap;
typedef std::vector<ExPosition> EnemyGeneral;
typedef std::vector<LeaderBoardRow> LeaderBoardTable;
typedef std::vector<QueItem> AttackQueue;

struct GBot {
  std::string roomId;
  Room* room;
  std::string username;
  std::string myPlayerId;
  int color;
  int attackColor;
  Position* attackPosition;
  Position* myGeneral;
  EnemyGeneral* enemyGeneral;
  initGameInfo* initGameInfo;
  GameMap* gameMap;
  std::vector<std::vector<bool>>* totalViewed;
  LeaderBoardTable* leaderBoardData;
  AttackQueue* queue;
};

void initMap(int mapWidth, int mapHeight) {
  GameMap gameMap(mapWidth, std::vector<TileProp>(mapHeight, {Fog, 0, 0}));
  std::vector<std::vector<bool>> totalViewed(
      mapWidth, std::vector<bool>(mapHeight, false));
  gbot.gameMap = &gameMap;
  gbot.totalViewed = &totalViewed;
}

bool unRevealed(TileProp tile) {
  return tile.type == Fog || tile.type == Obstacle;
}

bool unMoveable(TileProp tile, bool ignoreCity) {
  return tile.type == Mountain || tile.type == Obstacle ||
         (ignoreCity && tile.type == City);
}

bool posOutOfRange(Position pos) {
  if (!gbot.gameMap || !gbot.initGameInfo) return true;
  int mapWidth = gbot.initGameInfo->mapWidth;
  int mapHeight = gbot.initGameInfo->mapHeight;
  if (pos.x < 0 || pos.x >= mapWidth) return true;
  if (pos.y < 0 || pos.y >= mapHeight) return true;
  return false;
}

int calcDist(Position a, Position b) { return abs(a.x - b.x) + abs(a.y - b.y); }

void patchMap(std::vector<MapDiffData> mapDiff) {
  if (!gbot.gameMap || !gbot.totalViewed || !gbot.initGameInfo) return;
  int mapWidth = gbot.initGameInfo->mapWidth;
  int mapHeight = gbot.initGameInfo->mapHeight;
  std::vector<TileProp> flattened = gbot.gameMap->flat();
  std::vector<std::vector<TileProp>> newState = *gbot.gameMap;
  for (int i = 0, j = 0; i < mapDiff.size(); i++) {
    auto tmp = mapDiff[i];  // Ensure that the type inspection can be passed.
    if (tmp.type() == typeid(int)) {
      j += std::any_cast<int>(tmp);
    } else {
      flattened[j++] = std::any_cast<TileProp>(tmp);
    }
  }
  for (int i = 0; i < mapWidth; ++i) {
    for (int j = 0; j < mapHeight; ++j) {
      newState[i][j] = flattened[i * mapHeight + j];
      if (!(*gbot.totalViewed)[i][j] && !unRevealed(newState[i][j]))
        (*gbot.totalViewed)[i][j] = true;
      if (newState[i][j].type == King && newState[i][j].color) {
        if (newState[i][j].color == gbot.color) {
          gbot.myGeneral = new Position{i, j};
        } else if (std::find_if(gbot.enemyGeneral->begin(),
                                gbot.enemyGeneral->end(), [&](ExPosition a) {
                                  return a.color == newState[i][j].color;
                                }) == gbot.enemyGeneral->end()) {
          gbot.enemyGeneral->push_back({i, j, newState[i][j].color});
        }
      }
    }
  }
  gbot.enemyGeneral->erase(
      std::remove_if(gbot.enemyGeneral->begin(), gbot.enemyGeneral->end(),
                     [&](ExPosition a) {
                       return newState[a.x][a.y].color == a.color ||
                              newState[a.x][a.y].type == Fog;
                     }),
      gbot.enemyGeneral->end());
  *gbot.gameMap = newState;
}

void handleMove(int turnsCount) {
  if (!gbot.gameMap || !gbot.initGameInfo || !gbot.color) return;
  int mapWidth = gbot.initGameInfo->mapWidth;
  int mapHeight = gbot.initGameInfo->mapHeight;
  if (!gbot.queue->empty()) {
    while (!gbot.queue->empty()) {
      QueItem item = gbot.queue->front();
      if (gbot.gameMap->at(item.from.x).at(item.from.y).color != gbot.color)
        gbot.queue->pop_front();
      if ((item.purpose == Defend || item.purpose == AttackGeneral ||
           item.purpose == ExpandLand) &&
          gbot.gameMap->at(item.target.x).at(item.target.y).color == gbot.color)
        gbot.queue->pop_front();
      else
        break;
    }

    QueItem a = gbot.queue->pop_front();
    if (a) {
      socket.emit("attack", a.from, a.to, false);
      return;
    }
  }
  if (!gbot.enemyGeneral->empty() && gbot.queue) {
    for (ExPosition a : *gbot.enemyGeneral) {
      gbot.queue->clear();
      if (a.color == gbot.attackColor) {
        gatherArmies(AttackGeneral, 5, {a.x, a.y}, 2 * (mapWidth + mapHeight));
      }
      gatherArmies(AttackGeneral, 100, {a.x, a.y}, 2 * (mapWidth + mapHeight));
    }
    return;
  }

  if (kingInDanger()) return;

  if (gbot.attackColor != -1 && gbot.attackPosition && gbot.queue &&
      gbot.totalViewed) {
    if (gbot.gameMap->at(gbot.attackPosition->x)
            .at(gbot.attackPosition->y)
            .color == gbot.color) {
      for (auto d : directions) {
        Position newPos = {gbot.attackPosition->x + d[0],
                           gbot.attackPosition->y + d[1]};
        if (posOutOfRange(newPos) ||
            unMoveable(gbot.gameMap->at(newPos.x).at(newPos.y), true) ||
            gbot.totalViewed->at(newPos.x).at(newPos.y))
          continue;
        if (gbot.gameMap->at(newPos.x).at(newPos.y).color == gbot.attackColor) {
          gbot.queue->push_back(
              {Attack, 999, *gbot.attackPosition, newPos, newPos});
          *gbot.attackPosition = newPos;
          return;
        }
      }  // If not found, then consider conquer the city.
      for (auto d : directions) {
        Position newPos = {gbot.attackPosition->x + d[0],
                           gbot.attackPosition->y + d[1]};
        if (posOutOfRange(newPos) ||
            unMoveable(gbot.gameMap->at(newPos.x).at(newPos.y), false))
          continue;
        if (gbot.gameMap->at(newPos.x).at(newPos.y).color == gbot.attackColor) {
          gbot.queue->push_back(
              {Attack, 999, *gbot.attackPosition, newPos, newPos});
          *gbot.attackPosition = newPos;
          return;
        }
      }
      gbot.attackColor = -1;
      gbot.attackPosition = nullptr;
    } else {
      gbot.attackColor = -1;
      gbot.attackPosition = nullptr;
    }
  }

  if (detectThreat()) return;

  if ((turnsCount + 1) % 17 == 0) {
    quickExpand();
  } else if (turnsCount + 1 > 17) {
    expandLand();
  }
}

bool determineExpand() {
  if (!gbot.leaderBoardData) return false;
  int maxArmyCount = 0, myArmyCount = 0;
  for (LeaderBoardRow a : *gbot.leaderBoardData) {
    if (a.color == gbot.color) myArmyCount = a.armyCount;
    if (a.armyCount > maxArmyCount) maxArmyCount = a.armyCount;
  }
  if (maxArmyCount > myArmyCount * 1.5) {
    expandLand();
    return true;
  }
  return false;
}

bool kingInDanger() {
  if (!gbot.myGeneral || !gbot.gameMap || !gbot.initGameInfo || !gbot.queue)
    return false;
  std::vector<std::vector<int>> exDirections = directions;
  exDirections.push_back({-1, -1});
  exDirections.push_back({-1, 1});
  exDirections.push_back({1, -1});
  exDirections.push_back({1, 1});
  int mapWidth = gbot.initGameInfo->mapWidth;
  int mapHeight = gbot.initGameInfo->mapHeight;
  for (auto d : exDirections) {
    Position tile = {gbot.myGeneral->x + d[0], gbot.myGeneral->y + d[1]};
    if (!posOutOfRange(tile) && gbot.gameMap->at(tile.x).at(tile.y).color &&
        gbot.gameMap->at(tile.x).at(tile.y).color != gbot.color) {
      gatherArmies(Defend, 999, *gbot.myGeneral, 10);
      return true;
    }
  }
  return false;
}

struct ThreatTile {
  TileProp tile;
  Position pos;
  int val;
};

bool detectThreat() {
  if (!gbot.myGeneral || !gbot.gameMap) return false;
  std::vector<BFSQueItem> queue;
  queue.push_back({0, *gbot.myGeneral});
  std::vector<std::vector<bool>> book;
  book.push_back(*gbot.myGeneral);
  std::vector<ThreatTile> selected;
  int front = 0, end = 0;
  while (front <= end) {
    BFSQueItem a = queue[front++];
    for (auto d : directions) {
      Position b = {a.pos.x + d[0], a.pos.y + d[1]};
      if (std::find(book.begin(), book.end(), b) != book.end() ||
          posOutOfRange(b) || unRevealed(gbot.gameMap->at(b.x).at(b.y)) ||
          unMoveable(gbot.gameMap->at(b.x).at(b.y), false))
        continue;
      queue.push_back({a.step + 1, b});
      book.push_back(b);
      if (gbot.gameMap->at(b.x).at(b.y).color &&
          gbot.gameMap->at(b.x).at(b.y).color != gbot.color) {
        selected.push_back({gbot.gameMap->at(b.x).at(b.y), b,
                            (gbot.gameMap->at(b.x).at(b.y).armyCount) -
                                calcDist(*gbot.myGeneral, b)});
      }
    }
  }

  std::sort(selected.begin(), selected.end(),
            [](ThreatTile a, ThreatTile b) { return b.val < a.val; });

  ThreatTile threat = selected[0];
  if (threat) {
    gatherArmies(Defend, threat.val, threat.pos, 25);
    gbot.attackColor = threat.tile.color;
    gbot.attackPosition = new Position{threat.pos.x, threat.pos.y};
  }

  return selected.size() > 0;
}

struct PossibleWay {
  int val;
  std::vector<Position> way;
  bool tag;
};

void gatherArmies(QuePurpose purpose, int priority, Position toPos, int limit) {
  if (!gbot.gameMap || !gbot.queue || !gbot.initGameInfo) return;
  int mapWidth = gbot.initGameInfo->mapWidth;
  int mapHeight = gbot.initGameInfo->mapHeight;
  std::vector<BFSQueItem> queue;
  queue.push_back({0, toPos});
  std::vector<std::vector<PossibleWay>> possibleWay(
      mapWidth, std::vector<PossibleWay>(mapHeight, {-9999999, {}, false}));
  if (gbot.gameMap->at(toPos.x).at(toPos.y).color != gbot.color) {
    possibleWay[toPos.x][toPos.y] = {
        -(gbot.gameMap->at(toPos.x).at(toPos.y).armyCount), {toPos}, false};
  } else {
    possibleWay[toPos.x][toPos.y] = {
        gbot.gameMap->at(toPos.x).at(toPos.y).armyCount, {toPos}, false};
  }
  int front = 0, end = 0;
  while (front <= end) {
    BFSQueItem a = queue[front++];
    possibleWay[a.pos.x][a.pos.y].tag = true;
    if (a.step >= limit) break;
    for (auto d : directions) {
      Position b = {a.pos.x + d[0], a.pos.y + d[1]};
      if (posOutOfRange(b) ||
          unMoveable(gbot.gameMap->at(b.x).at(b.y), false) ||
          possibleWay[b.x][b.y].tag)
        continue;
      int newVal = possibleWay[a.pos.x][a.pos.y].val - 1;
      if (gbot.gameMap->at(b.x).at(b.y).color != gbot.color) {
        if (gbot.gameMap->at(b.x).at(b.y).type == City) continue;
        newVal -= gbot.gameMap->at(b.x).at(b.y).armyCount;
      } else {
        newVal += gbot.gameMap->at(b.x).at(b.y).armyCount;
      }
      if (possibleWay[b.x][b.y].val >= newVal) continue;
      std::vector<Position> newWay = possibleWay[a.pos.x][a.pos.y].way;
      newWay.push_back(b);
      queue.push_back({a.step + 1, b});
      ++end;
      possibleWay[b.x][b.y] = {newVal, newWay, false};
    }
  }
  PossibleWay maxWay = {0, {}, false};
  for (auto a : possibleWay) {
    for (auto b : a) {
      if (b.val > maxWay.val) maxWay = b;
    }
  }
  if (maxWay.val <= 0) return;
  Position* prev = nullptr;
  for (auto next : maxWay.way) {
    if (prev) {
      gbot.queue->push_back(
          {*prev, next, purpose, priority, maxWay.way[maxWay.way.size() - 1]});
    }
    prev = new Position{next.x, next.y};
  }
}

void quickExpand() {
  if (!gbot.gameMap || !gbot.totalViewed || !gbot.queue || !gbot.myGeneral ||
      !gbot.initGameInfo)
    return;
  int mapWidth = gbot.initGameInfo->mapWidth;
  int mapHeight = gbot.initGameInfo->mapHeight;
  std::vector<BFSQueItem> queue;
  queue.push_back({0, *gbot.myGeneral});
  std::vector<std::vector<PossibleWay>> possibleWay(
      mapWidth, std::vector<PossibleWay>(mapHeight, {0, {}, false}));
  possibleWay[gbot.myGeneral->x][gbot.myGeneral->y] = {
      gbot.gameMap->at(gbot.myGeneral->x).at(gbot.myGeneral->y).armyCount,
      {*gbot.myGeneral},
      false};
  int front = 0, end = 0;
  while (front <= end) {
    BFSQueItem a = queue[front++];
    possibleWay[a.pos.x][a.pos.y].tag = true;
    for (auto d : directions) {
      Position b = {a.pos.x + d[0], a.pos.y + d[1]};
      if (posOutOfRange(b) ||
          unMoveable(gbot.gameMap->at(b.x).at(b.y), false) ||
          possibleWay[b.x][b.y].tag)
        continue;
      int newVal = possibleWay[a.pos.x][a.pos.y].val - 1;
      if (gbot.gameMap->at(b.x).at(b.y).color != gbot.color) {
        if (gbot.gameMap->at(b.x).at(b.y).type == City) continue;
        newVal -= gbot.gameMap->at(b.x).at(b.y).armyCount;
      } else {
        newVal += gbot.gameMap->at(b.x).at(b.y).armyCount;
      }
      if (possibleWay[b.x][b.y].val >= newVal) continue;
      std::vector<Position> newWay = possibleWay[a.pos.x][a.pos.y].way;
      newWay.push_back(b);
      queue.push_back({a.step + 1, b});
      ++end;
      possibleWay[b.x][b.y] = {newVal, newWay, false};
    }
  }
  PossibleWay maxWay = {0, {}, false};
  for (auto a : possibleWay) {
    for (auto b : a) {
      if (b.val > 0 && !(*gbot.totalViewed)[b.way[b.way.size() - 1].x]
                                           [b.way[b.way.size() - 1].y]) {
        if (maxWay.val == 0) {
          maxWay = b;
        } else if (rand() < .7) {
          maxWay = b;
        }
      }
    }
  }
  if (maxWay.val == 0) return;
  Position* prev = nullptr;
  for (auto next : maxWay.way) {
    if (prev) {
      gbot.queue->push_back(
          {*prev, next, ExpandLand, 50, maxWay.way[maxWay.way.size() - 1]});
    }
    prev = new Position{next.x, next.y};
  }
}

void expandLand() {
  if (!gbot.gameMap || !gbot.initGameInfo) return;
  std::vector<Position> tiles;
  int mapWidth = gbot.initGameInfo->mapWidth;
  int mapHeight = gbot.initGameInfo->mapHeight;
  for (int i = 0; i < mapWidth; ++i)
    for (int j = 0; j < mapHeight; ++j)
      if (gbot.gameMap->at(i).at(j).type == Plain &&
          gbot.gameMap->at(i).at(j).color != gbot.color)
        tiles.push_back({i, j});
  std::random_shuffle(tiles.begin(), tiles.end());
  bool ok = false;
  for (auto tile : tiles)
    if (gatherArmies(ExpandLand, 10, tile, 1)) ok = true;
  if (!ok) gatherArmies(ExpandLand, 10, tiles[0], 10);
}

int main() {
  GBot gbot;
  gbot.roomId = "room123";
  gbot.room = nullptr;
  gbot.username = "GenniaBot";
  gbot.myPlayerId = "";
  gbot.color = 0;
  gbot.attackColor = -1;
  gbot.attackPosition = nullptr;
  gbot.myGeneral = nullptr;
  gbot.enemyGeneral = new EnemyGeneral();
  gbot.initGameInfo = nullptr;
  gbot.gameMap = nullptr;
  gbot.totalViewed = nullptr;
  gbot.leaderBoardData = nullptr;
  gbot.queue = new AttackQueue();

  std::vector<std::vector<int>> directions = {{-1, 0}, {0, 1}, {1, 0}, {0, -1}};

  std::string SERVER_URL = "http://localhost:3000";
  std::string ROOM_ID = "room123";

  // Connect to server and emit events
  // ...

  return 0;
}