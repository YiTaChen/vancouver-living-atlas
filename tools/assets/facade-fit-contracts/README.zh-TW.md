# C01–C03 立面適配契約：既有來源參照包

2026-10-03 · 版本 1.0.0

**離線適配契約已完成 (`offline_complete`)；街段整合仍是 `runtime_pending_webgl`。**

本包沒有新建模型、沒有複製 GLB／貼圖、沒有重建已可編輯的 `.blend`，也沒有啟用 runtime 或更動 `public/`。它把既有兩包共 **16 類、32 個 LOD** 的實際輸出、來源 hash、窗洞、玻璃止口、附著 datum、寬度範圍、轉角方向及失敗理由變成可驗證的交接介面。另參照 **2 個既有 Robson fitted sill LOD** 和 **4 個正式 bay LOD**，合計量測 38 個既有 GLB。

這是 `vancouver-facade-fit-reference/v1` 來源參照 schema，根欄位是 `moduleContracts`／`existingVariantReferences`／`bayReferences`，**不是**新版實體資產包的 `schemaVersion: 1 / assets[]`。不應把它交給共通「新 GLB 匯出包」validator；`validate.py` 只借用共通 GLB 解碼／量測函式，另驗本包的參照 schema。沒有 `source/`、`exports/` 或虛假的重新匯出命令。

## 已做與未做

| 任務 | 本次交付 | 狀態 |
| --- | --- | --- |
| C01 | 歷史／通用 8 類既有來源的 datum、空洞、寬度、方向與 fallback；既有 heritage bay 與 fitted sandstone variant 的精確參照 | 契約 `offline_complete` |
| C02 | 現代 5 類的 opening／glass-return、壓頂插入／排水、corner handedness；modern bay 完整深度與高度限制 | 契約 `offline_complete` |
| C03 | 雪松 3 類和既有住宅入口框的空洞、每 LOD 止口能力、門淨空、雨棚地面 datum 和坡度退回 | 契約 `offline_complete` |
| C01–C03 runtime | renderer 接口、cell-cap admission、實際 pavement、替換／去重、碰撞、日夜／天氣、LOD／生命週期及 GPU／frame-time | `not_run`，`runtime_pending_webgl` |

`offline-compatible-only` 是給定輸入的尺度／規則相容結果，不是 `sample_accepted`、可進入入口、實際人行道驗收或全城 coverage。`fit.mjs` 仍在 tools，沒有 runtime import。現有 10:00／300× 時鐘、移動實時更新、曝光、來源 footprint／高度／碰撞與材質預設均不在此修改範圍。

## 來源與尺度

參照原有 [architecture-details](../architecture-details/README.md)、[architecture-expansion](../architecture-expansion/README.md)、[Robson fitted sill](../architecture-details/runtime-candidate/manifest.json) 及 [正式 streetscape manifest](../../../public/models/streetscape/manifest.json)。每 LOD 在本包 [manifest.json](manifest.json) 保存 repository-relative `.blend`／GLB 路徑、SHA-256、bytes、實際 bounds／tris／vertices／primitives、圖像成本及語意材質名稱。引用未移到本包，因此不製造另一份庫存。

全部使用公尺，glTF +Y up／+Z 朝街，node transform 在實際量測中只套用一次。主要部件 root 是牆面附著平面 Z=0；corner 的 X=0 是外角而非外框中心。未知來源／角色／尺寸、負向鏡像和無法提供既有 slot 的輸入都不得藉契約新增人口。

| 既有 type | 主要接口 |
| --- | --- |
| sandstone-sill | 原始高 0.18 m；不能縮 Y 替換 0.16 m box。既有 Robson fitted variant 另有明確 hash，高 0.16 m |
| heritage-window-frame | 真空洞 1.20×1.40 m，X=-0.60…0.60、Y=0.10…1.50；外側倒角不等於玻璃止口 |
| heritage-cornice | 橫向長度適配，保留 0.24 m 截面；入口／上窗排除仍由來源提供 |
| sandstone-plinth | 近地 datum、source-local 門口排除及三點坡度檢查；不可跨門洞 |
| sandstone-corner | +X/+Z quadrant 的外 90°轉角；兩條具名相鄰邊、第二翼長度及不可鏡射契約 |
| residential-entry-surround | 真空洞 1.04×2.30 m；無門片、地板或 GIS 開洞能力 |
| sloped-metal-awning | 地面 datum；最低 2.37 m；保持 2.30 m 行人區 |
| flat-metal-awning | 地面 datum；最低 2.48 m；固定寬度、雨棚截面不縮放 |
| modern-recessed-window-surround | 真空洞 1.92×1.47 m；兩 LOD 都有 Z=0.07 的 return rear edge、前緣 Z=0.26，凹深 0.19 m |
| modern-sill-drip | 原寬 2.26 m，X-only 範圍 0.75–1.50 倍；保留 0.16×0.30 m 截面 |
| modern-parapet-cap | 真 cavity Z=0.056…0.444、Y=0…0.105；只限 exposed flat commercial roof，向 +Z 排水，使用現有 roofBoxFits 檢查 holes／更高 parts |
| concrete-shadow-plinth | 原寬 2.40 m、高 0.50 m；保留截面、門口排除與地面規則 |
| concrete-chamfer-corner | 外角 datum、+X-return；不可以負 scale 變左手件，不適配凹角或非 90°邊 |
| residential-cedar-window-surround | 真空洞 1.28×1.52 m；LOD0 止口 Z=0.10…0.13，LOD1 沒有細止口 |
| residential-cedar-sill | 原寬 1.62 m、截面 0.13×0.29 m；不跨 domestic row0 代表性門格 |
| residential-gabled-entry-canopy | 完整 Ymin=2.36／Ymax=3.10，實際高 0.74 m；禁止把底部歸零，保留 1.04×2.30 m 門區 |

玻璃 attachment plane 是下游接合提案，**GLB 本身沒有玻璃片**。Heritage 兩 LOD 都沒有獨立 stop；要求實體 stop 時退回。Cedar 若要求 stop，只有 LOD0 可通過；不捏造 LOD1 的幾何能力。Modern 以頂點 witness 和穿過 return 的控制射線確認止口／凹入，不只抄文字。

固定窗框、門框、雨棚、corner 不能改寬／非等比拉伸。線性件保持 Y/Z=1；modern／cedar sill 沿用目前 QA selector 的 0.75–1.50 X 範圍，其餘線性件同範圍是**本包明記的保守離線提案**，不表示 renderer 已支援。Sandstone 原件和 fitted variant 使用現有 Robson 1.4–5.0 m span，但原件仍因截面不同而不能替代那個 box。尺寸比較容差為 0.0001 m，不能把一般 2 cm 匯出容差挪作「開口可壓縮 2 cm」。

## 可重跑命令

從 repository 根目錄執行；Python 標準庫與專案已安裝的 Node／TypeScript／Three 即可，不需 Blender、GPU、網路或額外套件。

```sh
# 一般驗證，不更動原 package 或任何來源；--report 只能寫本包。
python3 tools/assets/facade-fit-contracts/validate.py \
  --report tools/assets/facade-fit-contracts/qa/validation.json

# 實際 13 個 Python 正／反例與 35 個 Node 規則測試。
python3 -m unittest discover -s tools/assets/facade-fit-contracts -p 'test_*.py' -v
node --test tools/assets/facade-fit-contracts/fit.test.mjs

# 重新跑具名來源範例，不產生 world placement，也不寫來源。
node tools/assets/facade-fit-contracts/source_examples.mjs --summary
```

僅在來源／契約變更已經審閱後才重建參照 snapshot。它只更新本包 metadata，不重新建模或重匯出：

```sh
python3 tools/assets/facade-fit-contracts/snapshot.py --write
node tools/assets/facade-fit-contracts/source_examples.mjs --write --summary
python3 tools/assets/facade-fit-contracts/validate.py \
  --report tools/assets/facade-fit-contracts/qa/validation.json
# 再重跑兩套測試；若開口、datum 或 handedness 破壞相容性，先升版本。
```

## CPU 證據

- [validation.json](qa/validation.json)：38 個實際 GLB／既有可編輯來源 hash；32 個原型 LOD 的舊包 PBR／UV／索引／非退化檢查；16 個有 clearance 的 LOD，**1,200 條三軸內部射線**全部通過。
- [geometry-checks.json](qa/geometry-checks.json)：每 LOD 實際三角形對六平面開放盒裁切，能抓住探測格線之間的小遮擋片；另外以實體 frame／stop 控制射線避免「框也消失所以射線全通」的假陽性。邊界接觸只容許 1e-6 m 數值誤差。
- [measurements.json](qa/measurements.json)：完整 transformed bounds、幾何／嵌圖 bytes、圖像 hash 和保守 texel costs。不是 GPU allocation／FPS 數據。
- [source-examples.json](qa/source-examples.json)：直接執行目前 source selector、architectureWork、fitBays 和 windowBounds。**56 個 Robson fitted sandstone、24 個 modern、8 個 cedar upper sill** 的純尺度相容，共 88 個；不是重新量測可見／分配實例數。
- [node-tests.log](qa/node-tests.log)、[python-tests.log](qa/python-tests.log)：48 tests pass，0 skip。負向案例包含舊 hash／錯 bounds／偽止口／換 handedness／小遮洞三角形／損壞 GLB／datum 歸零／坡度超界／少於三點／同點冒充三點／門口交疊／不符屋頂與 cavity／上窗及屋頂高度衝突。

另外重跑 [既有 consumer regressions](qa/existing-consumer-tests.log)：25 tests pass，0 skip；只限列出的 architecture asset／candidate 和 streetscape-placement tests，不是全 repository suite。

來源範例只記 source structure/feature/edge、along-edge scalar、相對 foundation 的 datum。`edgeKey` 的 X/Z 是**原 consumer 已存在的來源邊指紋**，不是新 placement exception。Sill 的局部 attachment offset 以目前 consumer 的「既有 box center 減 authored bounds center」計算，保留實際 anchor；這個做法不能套到 ground-datum 雨棚。

兩個真實來源 window comparison 刻意保留 rejection：

- structure 145639／feature 133049 的現代窗約 2.668402×2.2445 m，不能硬塞 1.92×1.47 m 窗框。
- structure 145755／feature 105546 的住宅窗約 1.358517×1.5105 m，亦不等於 1.28×1.52 m。

兩者為 `opening-mismatch`，應保留現有 shader／程序框。這次沒有為製造成功範例而改 profile、地理來源或 `.blend`。將來需要這些特定開口的新尺寸才另做新 ID／可編輯變體，並重新驗 source hashes。

## Ground／bay 的數值規則

`groundThreshold` 要求 caller 提供實際 rendered-surface-triangle basis，至少左／中／右三個**不同 source-local along 位置和 sample ID**，範圍覆蓋完整寬度；不能只給 raw elevation、重複點或名字不同但同座標的點。threshold=最高樣本+0.02 m，最高−最低不得超過 0.14 m，也不能低於既有 foundation。測試中的高度明寫 synthetic fixture，**不把其 basis 字串當真實現場取樣證明**。

Ground entry／canopy 還須低於保留的 upper window，並低於 source wall top−0.30 m。Domestic door 的 row0 只有 caller 能證明它是現有門 shader 抑制格時才可跳過，第一個保留 row1 用目前 windowBounds 算出；否則退回。不能任意指定高一層當高度上限。

`fitBay` 直接呼叫現行 `streetBayThreshold`，維持以 3.20 m 作高度 gate、heritage upper-sill margin 0.19 m／其他 0.15 m，以及 source 高度限制。Heritage 完整深度為 1.2207 m，modern 為 1.703 m；包括雨棚，不能稱為可走入室內深度。已有 GIS 牆並未開洞，入口框／bay 都不能自行變成可通行入口。

`fitBay` 的 pass 僅涵蓋固定寬度及現行 threshold gate；完整 heritage／modern 來源篩選、water／sidewalk coverage、modern 雨棚前端 1.75 m pavement 檢查及去重／population gate 尚待 consumer 接合，並列在 bayReferences.pendingConsumerGates。

Ground tests 和 source upper-sill selections 是分開的證據。此包**未對實際場景的地面三角形取樣**，沒有宣稱任何新門、雨棚、bay 已貼地通過。那些需要正式整合端在同一個 source-local contract 下提供並驗證資料。

## 整合交接順序

1. 保留舊 manifests 和既有 IDs；檢查本包 hash pin 是否仍為目前來源。拿最新 consumer／source 邊重新算，不搬範例 world XYZ。
2. 接合完整 existing slot／entry exclusions／兩邊 corner／roof footprint，並把真實 pavement 三點資料傳入。沒有證據時保留 fallback。
3. 只替換既有 population，遵守目前 production cell caps。窗框若要取代多個 procedural boxes，先實作去重和合併 ownership；本包沒有宣稱此 adapter 已存在。
4. 讀 actual source references、抽 geometry，綁既有 atlas。保留 profile／GLB material semantic role，不把每個 GLB 的 inspection maps 複製到 GPU。
5. 驗證 source terrain、入口／上窗、High／Ultra／compatible fallback、晴／陰／黃昏／夜晚、LOD、load fail／late result／dispose，量 frame-time、draw／tris、texture／cache 後才標 `sample_accepted`。

原預覽可參考 [歷史部件](../architecture-details/preview.png) 和 [擴充 LOD0](../architecture-expansion/preview-lod0.png)／[LOD1](../architecture-expansion/preview-lod1.png)，它們是舊 GLB 匯回 Blender 的單體圖，不是本次新 render／街景截圖。這次未重新打開 Blender；來源 hash 完整核對與重新開檔／re-export 為不同證據。

開始前依 [待開發需求](../../../docs/AI_AGENT_DEVELOPMENT_BACKLOG.md)、[專案規格](../../../docs/PROJECT_SPECIFICATION.md)、[材質流程](../../../docs/MATERIAL_PIPELINE.md)、[素材整合紀錄](../../../docs/OFFLINE_ASSET_INTEGRATION_2026_10.md) 及 [城市明亮度](../../../docs/CITY_READABILITY_2026_10.md) 核對現況。歷史 GPU／測試數字沒有挪成本次驗收。

Based on Vancouver Living Atlas by YiTaChen  
Source: https://github.com/YiTaChen/vancouver-living-atlas  
License: [Vancouver Living Atlas Noncommercial Research and Attribution 1.0](../../../LICENSE)
