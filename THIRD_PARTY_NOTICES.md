# Third-party notices

Radar includes or uses the following third-party material. Each keeps its own
license; Radar's own license does not apply to it.

## Text recognition models

`src-tauri/data/ocr/name_rec.onnx`, `cyrillic_rec.onnx` and their character
lists (`name_dict.txt`, `cyrillic_dict.txt`)

- PP-OCRv5 text line recognition from [PaddleOCR](https://github.com/PaddlePaddle/PaddleOCR),
  Copyright (c) PaddlePaddle Authors, licensed under the
  [Apache License 2.0](https://www.apache.org/licenses/LICENSE-2.0).
- Converted to ONNX by the [RapidOCR](https://github.com/RapidAI/RapidOCR) project,
  licensed under the Apache License 2.0.

## Season of weapons

`src-tauri/data/watermark-to-season.json`

- From [Destiny Item Manager (DIM)](https://github.com/DestinyItemManager/DIM),
  Copyright (c) Destiny Item Manager contributors, licensed under the
  [MIT License](https://github.com/DestinyItemManager/DIM/blob/master/LICENSE).

## Set bonuses and mod numbers

`src-tauri/data/compendium-snapshot.json`

- A snapshot of the community spreadsheet "Destiny Data Compendium"; Radar
  loads its current version at run time. All credit to its authors.

## Perk descriptions

- Loaded at run time from [Clarity](https://d2clarity.com) (database-clarity.github.io).
  All credit to the Clarity team.

## Destiny

Destiny and Destiny 2, their names, artwork, icons and game data are
trademarks and property of Bungie, Inc. Radar is an independent fan project
and is not affiliated with or endorsed by Bungie. Game data comes from the
Bungie.net API.

## Libraries

Radar is built on open-source libraries (among them Tauri, React, Tailwind CSS
and many Rust crates), each under its own license (mostly MIT and/or
Apache-2.0). Their license texts are included with each package; see
`package.json`, `website/package.json` and `src-tauri/Cargo.toml` for the list.
