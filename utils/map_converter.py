import argparse
import json
from bs4 import BeautifulSoup
from typing import List, Tuple
from enum import Enum


class TileType(Enum):
    King = 0
    City = 1
    Fog = 2
    Obstacle = 3
    Plain = 4
    Mountain = 5
    Swamp = 6


CustomMapTileData = Tuple[TileType, int, int, bool, int]

# [TileType,
#   number,
#   number, // unitsCount which is not allow set to null
#   boolean, // isAlwaysRevealed
#   number, // King Priority
# ];


class CustomMapData:
    def __init__(
        self,
        id: str,
        name: str,
        width: int,
        height: int,
        creator: str,
        description: str,
        mapTilesData: List[List[CustomMapTileData]],
    ):
        self.id = id
        self.name = name
        self.width = width
        self.height = height
        self.creator = creator
        self.description = description
        self.mapTilesData = mapTilesData


def convert_html_to_2d_array(html: str) -> List[List[CustomMapTileData]]:
    soup = BeautifulSoup(html, "html.parser")
    rows = soup.find_all("tr")
    result = []
    for row in rows:
        cells = row.find_all("td")
        row_data = []
        for cell in cells:
            color_index = None
            tile_type = TileType.Plain
            units_count = 0
            king_priority = 0
            classes = cell["class"]

            is_always_revealed = True if cell.find("img", {"alt": "light"}) else False

            if cell.text.isdigit():
                units_count = int(cell.text.strip())

            if "swamp" in classes:
                tile_type = TileType.Swamp
            elif "city" in classes:
                tile_type = TileType.City
            elif "mountain" in classes:
                tile_type = TileType.Mountain
            elif "king" in classes:
                tile_type = TileType.King
                color_index = 0
            row_data.append(
                [
                    tile_type.value,
                    color_index,
                    units_count,
                    is_always_revealed,
                    king_priority,
                ]
            )
        result.append(row_data)
    return result


def convert_to_custom_map_data(html_path: str, json_path: str):
    with open(html_path, "r") as f:
        html = f.read()
    map_tiles_data = convert_html_to_2d_array(html)
    custom_map_data = CustomMapData(
        "id",
        "name",
        len(map_tiles_data[0]),
        len(map_tiles_data),
        "creator",
        "description",
        map_tiles_data,
    )

    with open(json_path, "w") as f:
        json.dump(custom_map_data.__dict__, f, indent=4)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(
        description="Convert HTML data to CustomMapData object and store it in a JSON file"
    )
    parser.add_argument("html_path", type=str, help="Path to the HTML file")
    parser.add_argument("json_path", type=str, help="Path to the JSON file")
    args = parser.parse_args()
    convert_to_custom_map_data(args.html_path, args.json_path)
