# 公車內裝：B-CAB 預算候選

此目錄是修正後詳細美術來源的**獨立簡化衍生版**，不是原詳細檔的替換。普通 GLB 實際成本已符合 B-CAB；仍未接入遊戲、未做 WebGL／GPU／上下車驗收。上層 `source/`、`exports/`、manifest、scripts 及正式 consumer 都未由此工作修改。

## 實測成本

| 層級 | triangles | vertices | GLB bytes | B-CAB 限制 | primitives |
| --- | ---: | ---: | ---: | --- | ---: |
| LOD0 | 11,704 | 26,955 | 736,884 | 12,000 / 1,572,864 bytes | 11 |
| LOD1 | 2,824 | 6,910 | 202,492 | 3,000 / 393,216 bytes | 11 |

沒有貼圖、Draco、Meshopt 或其他必需 decoder。材質維持深 navy 線性色 `[.010,.033,.073,1]`、roughness `.78`，沒有用提高曝光補亮。GLB +Y up、+Z 車頭、−X 右側；原點不變；只在兩處門口加入 flush 支撐窄片，內裝 min-X 從 -1.1775 m 延伸到 -1.25 m，其他外框不變。

`*.components.json` 是離線幾何索引旁檔，不是 runtime 必需資源。每份旁檔綁定 GLB SHA-256，manifest 再綁定旁檔 SHA-256；保留每個部件真正 vertex/index ranges、世界 transform 與可重算 bounds。旁檔 bytes 在 [measurements.json](qa/measurements.json) 另列，不隱藏成本；若 consumer 選擇載入旁檔，必須額外計入下載與解析成本。

## 保留的布局與差異

- 前左司機座、儀表台及高設備櫃；前右無座位的輪拱蓋及黃色護欄
- 3 個朝向車內的 navy 優先座、對側 3 個收起座位和空出的輪椅區
- 4 個低地板前向座位、17 個後區座位，共 24 個可坐 pelvis/camera 錨點
- 原始門框／開門動畫依賴、車輛 datum、座位方位、低地板與兩階後平台高度
- LOD0 保留座墊與靠背的倒角及造型；移除紐扣／小踏板紋等細節，管件減面
- LOD1 移除小吊環、裝飾框、座椅底板與部分細支架；保留每個座椅靠背、座墊、腿、主要扶桿與前區差異

詳細美術來源仍在上層。此衍生版的後區也有減面，**不能套用詳細版「後區頂點完全不變」的證明**。保留的是後區座位關係、錨點與尺寸契約，不是頂點 byte identity。完整移除／減面清单見 `qa/derivation-lod*.json`。

## 門口支撐的明確修正

詳細 master 的低地板止於 X=-1.15 m，原外裝門框在 X=-1.25 m；兩門之間原有 0.10 m 寬的無支撐窄縫。此候選另加兩塊 12-triangle 窄片（每 LOD 共 24 triangles），位於 X=-1.25..-1.15 m、原門口 Z 範圍，頂面恰為 Y=0.36 m。這是刻意記錄的衍生修正；未修改詳細 master，也未改門、原四片地板或任何錨點。

兩塊窄片列入 floorSurfaces、walkableFloor.surfaceRefs 及 walkable-floor collision roles。驗證直接檢查頂面三角形共平面、矩形四角／面積完整覆蓋，並以垂直射線跨過原地板、接縫、窄片直到門框內側；不能只用 AABB 最大高度作支撐證明。負向測試會改寫真 GLB 的頂點，使頂面傾斜 48 mm 而 AABB 不變，確認仍被拒絕；也拒絕缺窄片、錯高度、接縫缺口及遺漏 metadata。

## 原始檔與重新匯出

兩份 `.blend` 是從詳細來源複製、保持獨立可編輯物件和減面 modifier 的真正衍生來源，並非從 GLB 回匯冒充原檔。LOD0 有 500 個 mesh / 359 個 modifiers；LOD1 有 273 個 mesh / 157 個 modifiers。`.blend` 分別 268,481 / 195,925 bytes。

從 repo root 執行：

```sh
# 日常匯出：只重開現有可編輯來源，不重新生成幾何。
blender -b -t 2 --python tools/assets/boardable-bus-v2/runtime-candidate/export.py -- --output /tmp/bus-runtime-reexport

# 實際 GLB 預算、具名部件、錨點、保守碰撞／導航取樣與負向測試。
python tools/assets/boardable-bus-v2/runtime-candidate/validate.py
python tools/assets/boardable-bus-v2/runtime-candidate/test_candidate.py
node --test tools/assets/boardable-bus-v2/runtime-candidate/adapter.test.mjs

# 源檔重開、完全一致再匯出、可編輯保存探針及實際 GLB CPU 預覽。
blender -b -t 2 --python tools/assets/boardable-bus-v2/runtime-candidate/qa_blender.py
```

`derive.py` 是一次性的衍生工具，來源 SHA 有釘選；不是重新匯出流程。預設拒絕覆寫已有 candidate source。需要重新派生時，在新目錄執行 `--output`，不要用它覆蓋美術修改。`threshold_support.py` 記錄新增窄片的方法；已有窄片時拒絕重複加入。新的 `derive.py` 派生會包括此修正。`export.py` 評估 modifier、清掉面積低於 1e-10 m² 的退化面，再依材質 batching；對 source 不寫入任何變更。

目前 39 項 Python 測試及 6 項實際 passenger adapter 測試通過；全部仍是離線證據。

## 驗證及可見證據

- [實際 GLB 幾何與導航取樣](qa/validation.json)
- [實測成本及 sidecar 分帳](qa/measurements.json)
- [來源重開／完全相同再匯出／可編輯副本探針](qa/blender-validation.json)
- [負向回歸測試](qa/regression-tests.txt)
- [既有真實 passenger adapter 的獨立候選測試](qa/adapter-tests.txt)
- [LOD0 前半截朝司機區](qa/previews/front-lowfloor-looking-front-lod0.png)
- [LOD1 前門望優先座](qa/previews/front-priority-overview-lod1.png)
- [LOD0 全車剖視](qa/previews/cutaway-layout-lod0.png) / [LOD1 全車剖視](qa/previews/cutaway-layout-lod1.png)
- [實際預覽 GLB hashes、相機、CPU設定](qa/previews/index.json)
- [目視檢查](qa/visual-review.json)、[來源與修改範圍](qa/provenance.json)、[逐檔 SHA-256 inventory](qa/hash-inventory.json)

旁檔讀取器檢查完整無重疊範圍、完整 batch 集合、實際 indices 不越界、實際 vertices 的 bounds、唯一場景 node 名稱及 identity baked batch world transform。座椅與 pelvis／camera／driver／doorway 等保留錨點的完整世界矩陣和位置逐一與詳細 GLB 相比；另外檢查座位本地寬度、navy 材質、側向朝內及相機偏移。

## 交接限制

這是代表性 12 m 公車，照片只作外觀／布局參考，不是特定車號的量測復刻。詳細引用與近似範圍見 [上層 REFERENCES.md](../REFERENCES.md)。原外裝檔透過 `../../boardable-bus` 的 hash-pinned dependency 使用；不要同時載入原始內裝、詳細 v2 與本候選。

1. 低地板 0.36 m，後平台 0.68 m，天花板底 2.60 m。後區僅 1.92 m 淨高，仍是 seated-only，不能讓 1.95 m 角色任意站立進入。
2. metadata 的地板是支撐面，不是已扣障礙物的導航網格。碰撞 proxy 是 LOD0 實測保守 AABB（`lodBasis: 0`）；LOD1 已做獨立幾何通行取樣，但換 LOD 的連續碰撞／動畫／pathfinding 仍待整合。
3. 兩門通道、站立中心線、全輪椅 bay envelope 和座位頭部的離線取樣通過，不等於連續 capsule sweep、法規無障礙認證或 gameplay 通過。
4. 靜態收起座位沒有展開動畫，也沒有 passenger anchors。門動畫仍由原外裝提供。
5. runtime、WebGL、GPU draw／FPS、載入／卸載生命週期與實際服務整合皆 `not_run`。CPU 白天預覽不是瀏覽器驗收；QA 燈和相機不在 GLB。
6. 候選 LOD0 應用於近景，LOD1 先作中距資產比較；實際距離／乘坐時選用策略由整合者測試決定。

Based on Vancouver Living Atlas by YiTaChen  
Source: https://github.com/YiTaChen/vancouver-living-atlas  
License: Vancouver Living Atlas Noncommercial Research and Attribution 1.0
