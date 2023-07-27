#include <pybind11/pybind11.h>
#include <algorithm>

// TileType
#define TILE_KING 0
#define TILE_CITY 1
#define TILE_FOG 2
#define TILE_OBSTACLE 3
#define TILE_PLAIN 4
#define TILE_MOUNTAIN 5
#define TILE_SWAMP 6

typedef int TileType;
// End TileType

// QuePurpose
#define QUE_DEFEND 0
#define QUE_ATTACK 1
#define QUE_ATTACK_GATHER 2
#define QUE_ATTACK_GENERAL 3
#define QUE_EXPAND_CITY 4
#define QUE_EXPAND_LAND 5

typedef int QuePurpose;
// End QuePurpose

int add(int i, int j) {
    return i + j;
}

struct Position {
    int x;
    int y;

    friend Position operator+ (Position a, Position b) {
        return Position{ a.x + b.x, a.y + b.y };
    }
};

struct TileProp {
    TileType type;
    int color;
    int army;
};

struct BFSQueueItem {
    Position pos;
    int step;
    std::vector<Position> way;
};

const Position directions[] = { Position{-1, 0}, Position{0, 1}, Position{1, 0}, Position{0, -1} };


class GBot {
    public:
        GBot(
            const int color,
            TileProp** game_map,
            int map_width,
            int map_height
        ) : color(color), game_map(game_map), map_width(map_width), map_height(map_height) {}
        ~GBot() {}

        void updateMap(TileProp** new_map) {
            game_map = new_map;
        }

        void gatherArmies(QuePurpose purpose, int priority, Position toPos, int limit) {
            que_front = que_end = 0;
            bfs_queue[que_end] = BFSQueueItem{ toPos, 0, std::vector<Position>()};
            bfs_queue[que_end].way.push_back(toPos);
            while (que_front <= que_end) {
                BFSQueueItem fr = bfs_queue[que_front++];
                std::random_shuffle(directions, directions + 4);
                for (auto& dir : directions) {
                    auto to = fr.pos + dir;
                    if (posOutOfRange(pos)) continue;
                }
            }
        }

    private:
        const int color;
        Position my_general;
        Position* enemy_generals;
        int attack_color;
        Position attack_position;
        TileProp** game_map;
        int map_width;
        int map_height;
        bool** total_visited;
        BFSQueueItem bfs_queue[114514];
        int que_front;
        int que_end;

        bool posOutOfRange(Position pos) {
            return pos.x < 0 || pos.x >= map_width || pos.y < 0 || pos.y > map_height;
        }

        bool unRevealed(TileType type) {
            return type == TILE_FOG || type == TILE_OBSTACLE;
        }

        bool unMoveable(TileType type, bool ignore_city) {
            return type == TILE_MOUNTAIN || type == TILE_OBSTACLE || (ignore_city && type == TILE_CITY);
        }
};


namespace py = pybind11;

PYBIND11_MODULE(example, m) {
    // optional module docstring
    m.doc() = "pybind11 example plugin";

    // define add function
    m.def("add", &add, "A function which adds two numbers");

    // bindings to GBot class
    py::class_<GBot>(m, "GBot")
        .def(py::init<const std::string &, int>())
        .def("go_for_a_walk", &GBot::go_for_a_walk)
        .def("get_hunger", &GBot::get_hunger)
        .def("get_name", &GBot::get_name);
}
