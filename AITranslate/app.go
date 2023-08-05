import (
	"encoding/json"
	"errors"
	"fmt"
	"math"
	"math/rand"
	"net/http"
	"os"
	"strconv"
	"strings"
	"sync"
	"time"
)

type TileType int

const (
	Fog TileType = iota
	Plain
	Mountain
	Obstacle
	City
	King
)

type QuePurpose int

const (
	Defend QuePurpose = iota
	AttackGeneral
	ExpandLand
	Attack
)

type Position struct {
	X int `json:"x"`
	Y int `json:"y"`
}

type QueItem struct {
	From     Position   `json:"from"`
	To       Position   `json:"to"`
	Purpose  QuePurpose `json:"purpose"`
	Priority int        `json:"priority"`
	Target   Position   `json:"target"`
}

type AttackQueue struct {
	que []QueItem
	mux sync.Mutex
}

func (aq *AttackQueue) pushBack(item QueItem) {
	aq.mux.Lock()
	defer aq.mux.Unlock()
	aq.que = append(aq.que, item)
}

func (aq *AttackQueue) popFront() *QueItem {
	aq.mux.Lock()
	defer aq.mux.Unlock()
	if len(aq.que) == 0 {
		return nil
	}
	item := aq.que[0]
	aq.que = aq.que[1:]
	return &item
}

func (aq *AttackQueue) isEmpty() bool {
	aq.mux.Lock()
	defer aq.mux.Unlock()
	return len(aq.que) == 0
}

type ExPosition struct {
	X     int `json:"x"`
	Y     int `json:"y"`
	Color int `json:"color"`
}

type GBot struct {
	RoomID          string
	Room            *Room
	Username        string
	MyPlayerID      string
	Color           string
	AttackColor     int
	AttackPosition  *Position
	MyGeneral       *Position
	EnemyGeneral    []ExPosition
	InitGameInfo    *InitGameInfo
	GameMap         [][][3]interface{}
	TotalViewed     [][]bool
	LeaderBoardData LeaderBoardTable
	Queue           AttackQueue
}

type Room struct {
	ID          string   `json:"id"`
	Players     []Player `json:"players"`
	GameStarted bool     `json:"gameStarted"`
}

type Player struct {
	ID         string `json:"id"`
	Color      string `json:"color"`
	ForceStart bool   `json:"forceStart"`
	IsRoomHost bool   `json:"isRoomHost"`
}

type InitGameInfo struct {
	MapWidth  int `json:"mapWidth"`
	MapHeight int `json:"mapHeight"`
}

type MapDiffData []interface{}

type LeaderBoardTable [][]int

type TileProp [3]interface{}

type UserData struct {
	ID    string `json:"id"`
	Color string `json:"color"`
}

type BFSQueItem struct {
	Pos  Position `json:"pos"`
	Step int      `json:"step"`
}

type LeaderBoardRow []int

var (
	gbot GBot
)

func main() {
	err := dotenv.Load()
	if err != nil {
		panic(err)
	}

	if os.Getenv("SERVER_URL") == "" || os.Getenv("ROOM_ID") == "" {
		panic(errors.New("Important arguments missing."))
	}

	gbot = GBot{
		RoomID:          os.Getenv("ROOM_ID"),
		Username:        os.Getenv("BOT_NAME"),
		AttackColor:     -1,
		AttackPosition:  nil,
		MyGeneral:       nil,
		EnemyGeneral:    make([]ExPosition, 0),
		InitGameInfo:    nil,
		GameMap:         nil,
		TotalViewed:     nil,
		LeaderBoardData: nil,
		Queue:           AttackQueue{},
	}

	directions := [][]int{
		{-1, 0},
		{0, 1},
		{1, 0},
		{0, -1},
	}

	socket := io(os.Getenv("SERVER_URL"), nil)
	socket.On("connect", func() {
		socket.Emit("get_room_info")
	})

	socket.On("update_room", func(room Room) {
		gbot.Room = &room
		var botPlayer *Player
		for _, p := range room.Players {
			if p.ID == gbot.MyPlayerID {
				botPlayer = &p
				break
			}
		}
		gbot.Color = botPlayer.Color
		if !botPlayer.ForceStart {
			socket.Emit("force_start")
		}
		if botPlayer.IsRoomHost && !room.GameStarted {
			socket.Emit("tran")
			var humanPlayer *Player
			for _, p := range room.Players {
				if p.ID != gbot.MyPlayerID {
					humanPlayer = &p
					break
				}
			}
			if humanPlayer != nil {
				socket.Emit("change_host", humanPlayer.ID)
			}
		}
	})

	socket.On("set_player_id", func(playerID string) {
		gbot.MyPlayerID = playerID
	})

	socket.On("error", func(title string, message string) {
		fmt.Println(title, message)
	})

	socket.On("game_started", func(initGameInfo InitGameInfo) {
		gbot.InitGameInfo = &initGameInfo
		initMap(initGameInfo.MapWidth, initGameInfo.MapHeight)
	})

	socket.On("game_update", func(mapDiff MapDiffData, turnsCount int, leaderBoardData LeaderBoardTable) {
		gbot.LeaderBoardData = leaderBoardData
		patchMap(mapDiff)
		handleMove(turnsCount)
	})

	socket.On("game_over", func(capturedBy UserData) {
		// handle game over
	})

	socket.On("game_ended", func(winner UserData, replayLink string) {
		// handle game ended
	})

	socket.Connect()
}

func initMap(mapWidth int, mapHeight int) {
	gbot.GameMap = make([][][3]interface{}, mapWidth)
	for i := 0; i < mapWidth; i++ {
		gbot.GameMap[i] = make([][3]interface{}, mapHeight)
		for j := 0; j < mapHeight; j++ {
			gbot.GameMap[i][j] = [3]interface{}{Fog, nil, nil}
		}
	}
	gbot.TotalViewed = make([][]bool, mapWidth)
	for i := 0; i < mapWidth; i++ {
		gbot.TotalViewed[i] = make([]bool, mapHeight)
	}
}

func unRevealed(tile TileProp) bool {
	return tile[0] == Fog || tile[0] == Obstacle
}

func unMoveable(tile TileProp, ignoreCity bool) bool {
	return tile[0] == Mountain || tile[0] == Obstacle || (ignoreCity && tile[0] == City)
}

func posOutOfRange(pos Position) bool {
	if gbot.GameMap == nil || gbot.InitGameInfo == nil {
		return true
	}
	mapWidth := gbot.InitGameInfo.MapWidth
	mapHeight := gbot.InitGameInfo.MapHeight
	if pos.X < 0 || pos.X >= mapWidth {
		return true
	}
	if pos.Y < 0 || pos.Y >= mapHeight {
		return true
	}
	return false
}

func calcDist(a Position, b Position) int {
	return int(math.Abs(float64(a.X-b.X)) + math.Abs(float64(a.Y-b.Y)))
}

func patchMap(mapDiff MapDiffData) {
	if gbot.GameMap == nil || gbot.TotalViewed == nil || gbot.InitGameInfo == nil {
		return
	}
	mapWidth := gbot.InitGameInfo.MapWidth
	mapHeight := gbot.InitGameInfo.MapHeight
	flattened := make([][3]interface{}, mapWidth*mapHeight)
	for i := 0; i < len(mapDiff); i++ {
		tmp := mapDiff[i]
		if val, ok := tmp.(float64); ok {
			j := int(val)
			i++
			flattened[j] = mapDiff[i].([3]interface{})
		}
	}
	newState := make([][][3]interface{}, mapWidth)
	for i := 0; i < mapWidth; i++ {
		newState[i] = make([][3]interface{}, mapHeight)
		for j := 0; j < mapHeight; j++ {
			newState[i][j] = flattened[i*mapHeight+j]
			if !gbot.TotalViewed[i][j] && !unRevealed(newState[i][j]) {
				gbot.TotalViewed[i][j] = true
			}
			if newState[i][j][0] == King && newState[i][j][1] != nil {
				if newState[i][j][1].(string) == gbot.Color {
					gbot.MyGeneral = &Position{X: i, Y: j}
				} else {
					found := false
					for _, exPos := range gbot.EnemyGeneral {
						if exPos.Color == newState[i][j][1].(int) {
							found = true
							break
						}
					}
					if !found {
						gbot.EnemyGeneral = append(gbot.EnemyGeneral, ExPosition{X: i, Y: j, Color: newState[i][j][1].(int)})
					}
				}
			}
		}
	}
	gbot.EnemyGeneral = gbot.EnemyGeneral[:0]
	for _, exPos := range gbot.EnemyGeneral {
		if newState[exPos.X][exPos.Y][1] == exPos.Color || newState[exPos.X][exPos.Y][0] == Fog {
			gbot.EnemyGeneral = append(gbot.EnemyGeneral, exPos)
		}
	}
	gbot.GameMap = newState
}

func handleMove(turnsCount int) {
	if gbot.GameMap == nil || gbot.InitGameInfo == nil || gbot.Color == "" {
		return
	}
	mapWidth := gbot.InitGameInfo.MapWidth
	mapHeight := gbot.InitGameInfo.MapHeight
	if !gbot.Queue.isEmpty() {
		for !gbot.Queue.isEmpty() {
			item := gbot.Queue.popFront()
			if gbot.GameMap[item.From.X][item.From.Y][1] != gbot.Color {
				continue
			}
			if (item.Purpose == Defend || item.Purpose == AttackGeneral || item.Purpose == ExpandLand) &&
				gbot.GameMap[item.Target.X][item.Target.Y][1] == gbot.Color {
				continue
			}
			break
		}
		item := gbot.Queue.popFront()
		if item != nil {
			socket.Emit("attack", item.From, item.To, false)
			return
		}
	}
	if len(gbot.EnemyGeneral) > 0 && gbot.Queue != nil {
		for _, a := range gbot.EnemyGeneral {
			gbot.Queue.que = nil
			if a.Color == gbot.AttackColor {
				gatherArmies(QuePurpose.AttackGeneral, 5, Position{X: a.X, Y: a.Y}, 2*(mapWidth+mapHeight))
			}
			gatherArmies(QuePurpose.AttackGeneral, 100, Position{X: a.X, Y: a.Y}, 2*(mapWidth+mapHeight))
		}
		return
	}
	if kingInDanger() {
		return
	}
	if gbot.AttackColor != -1 && gbot.AttackPosition != nil && gbot.Queue != nil && gbot.TotalViewed != nil {
		if gbot.GameMap[gbot.AttackPosition.X][gbot.AttackPosition.Y][1] == gbot.Color {
			for _, d := range directions {
				newPos := Position{X: gbot.AttackPosition.X + d[0], Y: gbot.AttackPosition.Y + d[1]}
				if posOutOfRange(newPos) || unMoveable(gbot.GameMap[newPos.X][newPos.Y], true) || gbot.TotalViewed[newPos.X][newPos.Y] {
					continue
				}
				if gbot.GameMap[newPos.X][newPos.Y][1] == gbot.AttackColor {
					gbot.Queue.pushBack(QueItem{
						Purpose:  QuePurpose.Attack,
						Priority: 999,
						From:     *gbot.AttackPosition,
						To:       newPos,
						Target:   newPos,
					})
					gbot.AttackPosition = &newPos
					return
				}
			}
			for _, d := range directions {
				newPos := Position{X: gbot.AttackPosition.X + d[0], Y: gbot.AttackPosition.Y + d[1]}
				if posOutOfRange(newPos) || unMoveable(gbot.GameMap[newPos.X][newPos.Y], false) {
					continue
				}
				if gbot.GameMap[newPos.X][newPos.Y][1] == gbot.AttackColor {
					gbot.Queue.pushBack(QueItem{
						Purpose:  QuePurpose.Attack,
						Priority: 999,
						From:     *gbot.AttackPosition,
						To:       newPos,
						Target:   newPos,
					})
					gbot.AttackPosition = &newPos
					return
				}
			}
			gbot.AttackColor = -1
			gbot.AttackPosition = nil
		} else {
			gbot.AttackColor = -1
			gbot.AttackPosition = nil
		}
	}
	if detectThreat() {
		return
	}
	if (turnsCount+1)%17 == 0 {
		quickExpand()
	} else if turnsCount+1 > 17 {
		expandLand()
	}
}

func determineExpand() bool {
	if gbot.LeaderBoardData == nil {
		return false
	}
	maxArmyCount := 0
	myArmyCount := 0
	for _, a := range gbot.LeaderBoardData {
		if a[0] == gbot.Color {
			myArmyCount = a[1]
		}
		if a[1] > maxArmyCount {
			maxArmyCount = a[1]
		}
	}
	if maxArmyCount > myArmyCount*1.5 {
		expandLand()
		return true
	}
	return false
}

func kingInDanger() bool {
	if gbot.MyGeneral == nil || gbot.GameMap == nil || gbot.InitGameInfo == nil || gbot.Queue == nil {
		return false
	}
	exDirections := append(directions, []int{-1, -1}, []int{-1, 1}, []int{1, -1}, []int{1, 1})
	mapWidth := gbot.InitGameInfo.MapWidth
	mapHeight := gbot.InitGameInfo.MapHeight
	for _, d := range exDirections {
		tile := Position{X: gbot.MyGeneral.X + d[0], Y: gbot.MyGeneral.Y + d[1]}
		if !posOutOfRange(tile) && gbot.GameMap[tile.X][tile.Y][1] != nil && gbot.GameMap[tile.X][tile.Y][1] != gbot.Color {
			gatherArmies(QuePurpose.Defend, 999, *gbot.MyGeneral, 10)
			return true
		}
	}
	return false
}

type ThreatTile struct {
	Tile TileProp
	Pos  Position
	Val  int
}

func detectThreat() bool {
	if gbot.MyGeneral == nil || gbot.GameMap == nil {
		return false
	}
	queue := make([]BFSQueItem, 0)
	queue = append(queue, BFSQueItem{Pos: *gbot.MyGeneral, Step: 0})
	possibleWay := make([][]PossibleWay, gbot.InitGameInfo.MapWidth)
	for i := 0; i < gbot.InitGameInfo.MapWidth; i++ {
		possibleWay[i] = make([]PossibleWay, gbot.InitGameInfo.MapHeight)
		for j := 0; j < gbot.InitGameInfo.MapHeight; j++ {
			possibleWay[i][j] = PossibleWay{
				Val: -9999999,
				Way: make([]Position, 0),
				Tag: false,
			}
		}
	}
	if gbot.GameMap[*gbot.MyGeneral.X][*gbot.MyGeneral.Y][1] != gbot.Color {
		possibleWay[*gbot.MyGeneral.X][*gbot.MyGeneral.Y] = PossibleWay{
			Val: -(gbot.GameMap[*gbot.MyGeneral.X][*gbot.MyGeneral.Y][2].(int)),
			Way: []Position{*gbot.MyGeneral},
			Tag: false,
		}
	} else {
		possibleWay[*gbot.MyGeneral.X][*gbot.MyGeneral.Y] = PossibleWay{
			Val: gbot.GameMap[*gbot.MyGeneral.X][*gbot.MyGeneral.Y][2].(int),
			Way: []Position{*gbot.MyGeneral},
			Tag: false,
		}
	}
	front := 0
	end := 0
	for front <= end {
		a := queue[front]
		possibleWay[a.Pos.X][a.Pos.Y].Tag = true
		if a.Step >= 10 {
			break
		}
		for _, d := range directions {
			b := Position{X: a.Pos.X + d[0], Y: a.Pos.Y + d[1]}
			if contains(queue, b) || posOutOfRange(b) || unMoveable(gbot.GameMap[b.X][b.Y], false) || possibleWay[b.X][b.Y].Tag {
				continue
			}
			newVal := possibleWay[a.Pos.X][a.Pos.Y].Val - 1
			if gbot.GameMap[b.X][b.Y][1] != gbot.Color {
				if gbot.GameMap[b.X][b.Y][0] == City {
					continue
				}
				newVal -= gbot.GameMap[b.X][b.Y][2].(int)
			} else {
				newVal += gbot.GameMap[b.X][b.Y][2].(int)
			}
			if possibleWay[b.X][b.Y].Val >= newVal {
				continue
			}
			newWay := append([]Position{b}, possibleWay[a.Pos.X][a.Pos.Y].Way...)
			queue = append(queue, BFSQueItem{Pos: b, Step: a.Step + 1})
			end++
			possibleWay[b.X][b.Y] = PossibleWay{
				Val: newVal,
				Way: newWay,
				Tag: false,
			}
		}
	}
	selected := make([]ThreatTile, 0)
	for _, a := range possibleWay {
		for _, b := range a {
			if b.Val > 0 && (gbot.TotalViewed == nil || !gbot.TotalViewed[b.Way[len(b.Way)-1].X][b.Way[len(b.Way)-1].Y]) {
				if len(selected) == 0 {
					selected = append(selected, ThreatTile{
						Tile: gbot.GameMap[b.Way[len(b.Way)-1].X][b.Way[len(b.Way)-1].Y],
						Pos:  b.Way[len(b.Way)-1],
						Val:  b.Val - calcDist(*gbot.MyGeneral, b.Way[len(b.Way)-1]),
					})
				} else if rand.Float64() < 0.7 {
					selected = append(selected, ThreatTile{
						Tile: gbot.GameMap[b.Way[len(b.Way)-1].X][b.Way[len(b.Way)-1].Y],
						Pos:  b.Way[len(b.Way)-1],
						Val:  b.Val - calcDist(*gbot.MyGeneral, b.Way[len(b.Way)-1]),
					})
				}
			}
		}
	}
	if len(selected) > 0 {
		threat := selected[0]
		gatherArmies(QuePurpose.Defend, threat.Val, threat.Pos, 25)
		gbot.AttackColor = threat.Tile[1].(int)
		gbot.AttackPosition = &threat.Pos
	}
	return len(selected) > 0
}

type PossibleWay struct {
	Val int
	Way []Position
	Tag bool
}

func gatherArmies(purpose QuePurpose, priority int, toPos Position, limit int) int {
	if gbot.GameMap == nil || gbot.Queue.isEmpty() || gbot.MyGeneral == nil || gbot.InitGameInfo == nil {
		return 0
	}
	mapWidth := gbot.InitGameInfo.MapWidth
	mapHeight := gbot.InitGameInfo.MapHeight
	queue := make([]BFSQueItem, 0)
	queue = append(queue, BFSQueItem{Pos: toPos, Step: 0})
	possibleWay := make([][]PossibleWay, mapWidth)
	for i := 0; i < mapWidth; i++ {
		possibleWay[i] = make([]PossibleWay, mapHeight)
		for j := 0; j < mapHeight; j++ {
			possibleWay[i][j] = PossibleWay{
				Val: 0,
				Way: make([]Position, 0),
				Tag: false,
			}
		}
	}
	if gbot.GameMap[toPos.X][toPos.Y][1] != gbot.Color {
		possibleWay[toPos.X][toPos.Y] = PossibleWay{
			Val: -(gbot.GameMap[toPos.X][toPos.Y][2].(int)),
			Way: []Position{toPos},
			Tag: false,
		}
	} else {
		possibleWay[toPos.X][toPos.Y] = PossibleWay{
			Val: gbot.GameMap[toPos.X][toPos.Y][2].(int),
			Way: []Position{toPos},
			Tag: false,
		}
	}
	front := 0
	end := 0
	for front <= end {
		a := queue[front]
		possibleWay[a.Pos.X][a.Pos.Y].Tag = true
		if a.Step >= limit {
			break
		}
		for _, d := range directions {
			b := Position{X: a.Pos.X + d[0], Y: a.Pos.Y + d[1]}
			if contains(queue, b) || posOutOfRange(b) || unMoveable(gbot.GameMap[b.X][b.Y], false) || possibleWay[b.X][b.Y].Tag {
				continue
			}
			newVal := possibleWay[a.Pos.X][a.Pos.Y].Val - 1
			if gbot.GameMap[b.X][b.Y][1] != gbot.Color {
				if gbot.GameMap[b.X][b.Y][0] == City {
					continue
				}
				newVal -= gbot.GameMap[b.X][b.Y][2].(int)
			} else {
				newVal += gbot.GameMap[b.X][b.Y][2].(int)
			}
			if possibleWay[b.X][b.Y].Val >= newVal {
				continue
			}
			newWay := append([]Position{b}, possibleWay[a.Pos.X][a.Pos.Y].Way...)
			queue = append(queue, BFSQueItem{Pos: b, Step: a.Step + 1})
			end++
			possibleWay[b.X][b.Y] = PossibleWay{
				Val: newVal,
				Way: newWay,
				Tag: false,
			}
		}
	}
	maxWay := PossibleWay{Val: 0, Way: make([]Position, 0), Tag: false}
	for _, a := range possibleWay {
		for _, b := range a {
			if b.Val > maxWay.Val {
				maxWay = b
			}
		}
	}
	if maxWay.Val <= 0 {
		return 0
	}
	prev := (*Position)(nil)
	for _, next := range maxWay.Way {
		if prev != nil {
			gbot.Queue.pushBack(QueItem{
				From:     *prev,
				To:       next,
				Purpose:  purpose,
				Priority: priority,
				Target:   maxWay.Way[len(maxWay.Way)-1],
			})
		}
		prev = &next
	}
	return len(maxWay.Way)
}

func quickExpand() {
	if gbot.GameMap == nil || gbot.TotalViewed == nil || gbot.Queue.isEmpty() || gbot.MyGeneral == nil || gbot.InitGameInfo == nil {
		return
	}
	mapWidth := gbot.InitGameInfo.MapWidth
	mapHeight := gbot.InitGameInfo.MapHeight
	queue := make([]BFSQueItem, 0)
	queue = append(queue, BFSQueItem{Pos: *gbot.MyGeneral, Step: 0})
	possibleWay := make([][]PossibleWay, mapWidth)
	for i := 0; i < mapWidth; i++ {
		possibleWay[i] = make([]PossibleWay, mapHeight)
		for j := 0; j < mapHeight; j++ {
			possibleWay[i][j] = PossibleWay{
				Val: 0,
				Way: make([]Position, 0),
				Tag: false,
			}
		}
	}
	possibleWay[*gbot.MyGeneral.X][*gbot.MyGeneral.Y] = PossibleWay{
		Val: gbot.GameMap[*gbot.MyGeneral.X][*gbot.MyGeneral.Y][2].(int),
		Way: []Position{*gbot.MyGeneral},
		Tag: false,
	}
	front := 0
	end := 0
	for front <= end {
		a := queue[front]
		possibleWay[a.Pos.X][a.Pos.Y].Tag = true
		for _, d := range directions {
			b := Position{X: a.Pos.X + d[0], Y: a.Pos.Y + d[1]}
			if contains(queue, b) || posOutOfRange(b) || unMoveable(gbot.GameMap[b.X][b.Y], false) || possibleWay[b.X][b.Y].Tag {
				continue
			}
			newVal := possibleWay[a.Pos.X][a.Pos.Y].Val - 1
			if gbot.GameMap[b.X][b.Y][1] != gbot.Color {
				if gbot.GameMap[b.X][b.Y][0] == City {
					continue
				}
				newVal -= gbot.GameMap[b.X][b.Y][2].(int)
			} else {
				newVal += gbot.GameMap[b.X][b.Y][2].(int)
			}
			if possibleWay[b.X][b.Y].Val >= newVal {
				continue
			}
			newWay := append([]Position{b}, possibleWay[a.Pos.X][a.Pos.Y].Way...)
			queue = append(queue, BFSQueItem{Pos: b, Step: a.Step + 1})
			end++
			possibleWay[b.X][b.Y] = PossibleWay{
				Val: newVal,
				Way: newWay,
				Tag: false,
			}
		}
	}
	maxWay := PossibleWay{Val: 0, Way: make([]Position, 0), Tag: false}
	for _, a := range possibleWay {
		for _, b := range a {
			if b.Val > 0 && (gbot.TotalViewed == nil || !gbot.TotalViewed[b.Way[len(b.Way)-1].X][b.Way[len(b.Way)-1].Y]) {
				if maxWay.Val == 0 {
					maxWay = b
				} else if rand.Float64() < 0.7 {
					maxWay = b
				}
			}
		}
	}
	if maxWay.Val == 0 {
		return
	}
	prev := (*Position)(nil)
}

// for _, next := range maxWay.Way {
// 	if prev != nil {
// 		gbot.Queue.pushBack(QueItem{
// 			From:     *prev,
// chatgpt generated stop due to max tokens reached

// regenerate
// func quickExpand() {
//   if gbot.gameMap == nil || gbot.totalViewed == nil || gbot.queue == nil || gbot.myGeneral == nil || gbot.initGameInfo == nil {
//     return 0
//   }
//   mapWidth := gbot.initGameInfo.mapWidth
//   mapHeight := gbot.initGameInfo.mapHeight
//   queue := make([]BFSQueItem, 0)
//   queue = append(queue, BFSQueItem{step: 0, pos: gbot.myGeneral})
//   possibleWay := make([][]PossibleWay, mapWidth)
//   for i := 0; i < mapWidth; i++ {
//     possibleWay[i] = make([]PossibleWay, mapHeight)
//     for j := 0; j < mapHeight; j++ {
//       possibleWay[i][j] = PossibleWay{val: 0, way: make([]Position, 0), tag: false}
//     }
//   }
//   possibleWay[gbot.myGeneral.x][gbot.myGeneral.y] = PossibleWay{
//     val: gbot.gameMap[gbot.myGeneral.x][gbot.myGeneral.y][2].(int),
//     way: []Position{gbot.myGeneral},
//     tag: false,
//   }
//   front := 0
//   end := 0
//   for front <= end {
//     a := queue[front]
//     front++
//     possibleWay[a.pos.x][a.pos.y].tag = true
//     for _, d := range directions {
//       b := Position{x: a.pos.x + d[0], y: a.pos.y + d[1]}
//       if posOutOfRange(b) || unMoveable(gbot.gameMap[b.x][b.y], false) || possibleWay[b.x][b.y].tag {
//         continue
//       }
//       newVal := possibleWay[a.pos.x][a.pos.y].val - 1
//       if gbot.gameMap[b.x][b.y][1] != gbot.color {
//         if gbot.gameMap[b.x][b.y][0] == TileType.City {
//           continue
//         }
//         newVal -= gbot.gameMap[b.x][b.y][2].(int)
//       } else {
//         newVal += gbot.gameMap[b.x][b.y][2].(int)
//       }
//       if possibleWay[b.x][b.y].val >= newVal {
//         continue
//       }
//       newWay := append(possibleWay[a.pos.x][a.pos.y].way, b)
//       queue = append(queue, BFSQueItem{step: a.step + 1, pos: b})
//       end++
//       possibleWay[b.x][b.y] = PossibleWay{
//         val: newVal,
//         way: newWay,
//         tag: false,
//       }
//     }
//   }
//   maxWay := PossibleWay{val: 0, way: make([]Position, 0), tag: false}
//   for _, a := range possibleWay {
//     for _, b := range a {
//       if b.val > 0 && !(gbot.totalViewed.([][]bool))[b.way[len(b.way)-1].x][b.way[len(b.way)-1].y] {
//         if maxWay.val == 0 {
//           maxWay = b
//         } else if rand.Float64() < 0.7 {
//           maxWay = b
//         }
//       }
//     }
//   }
//   if maxWay.val == 0 {
//     return 0
//   }
//   fmt.Println("QuickExpand:", maxWay.way)
//   var prev *Position
//   for _, next := range maxWay.way {
//     if prev != nil {
//       gbot.queue.pushBack(QueItem{
//         from:     *prev,
//         to:       next,
//         purpose:  QuePurpose.ExpandLand,
//         priority: 50,
//         target:   maxWay.way[len(maxWay.way)-1],
//       })
//     }
//     prev = &next
//   }
// }

// func expandLand() {
//   if gbot.gameMap == nil || gbot.initGameInfo == nil {
//     return
//   }
//   tiles := make([]Position, 0)
//   mapWidth := gbot.initGameInfo.mapWidth
//   mapHeight := gbot.initGameInfo.mapHeight
//   for i := 0; i < mapWidth; i++ {
//     for j := 0; j < mapHeight; j++ {
//       if gbot.gameMap[i][j][0] == TileType.Plain && gbot.gameMap[i][j][1] != gbot.color {
//         tiles = append(tiles, Position{x: i, y: j})
//       }
//     }
//   }
//   rand.Shuffle(len(tiles), func(i, j int) {
//     tiles[i], tiles[j] = tiles[j], tiles[i]
//   })
//   ok := false
//   for _, tile := range tiles {
//     if gatherArmies(QuePurpose.ExpandLand, 10, tile, 1) {
//       ok = true
//     }
//   }
//   if !ok {
//     gatherArmies(QuePurpose.ExpandLand, 10, tiles[0], 10)
//   }
// }