# Blender 資產交接清單（2026-10-02）

這份文件對應「先完成 Blender 資產、上傳 GitHub，再由使用者另外整合」的交付。資產存放在 `tools/assets/`，不覆寫 `public/`、城市 runtime、地理資料、導航或碰撞。它們是可編輯的來源與離線候選輸出，**尚未全部接入線上城市**。

## 先看哪些檔案

- 建築擴充：[`architecture-expansion/README.md`](../tools/assets/architecture-expansion/README.md)
- 葉片／樹皮／地表：[`vegetation_ground/README.md`](../tools/assets/vegetation_ground/README.md)
- 地標／車輛／室內材質：[`role-materials/README.md`](../tools/assets/role-materials/README.md)
- 人物來源與 LOD：[`citizen/optimization/README.zh-TW.md`](../tools/assets/citizen/optimization/README.zh-TW.md)
- 全批檔案雜湊與大小：[`offline-handoff/manifest.json`](../tools/assets/offline-handoff/manifest.json)
- 全批獨立完整性檢查：[`offline-handoff/validation.json`](../tools/assets/offline-handoff/validation.json)

以下逐項區分既有成果、新交付與需要另外整合的部分。各資料夾的 manifest 是實際尺寸、三角形、材質數與來源路徑的詳細依據；不要只複製預覽圖或只複製 GLB 而遺失 `.blend`。

## 1. 建築

### 既有、保留並重新稽核的 8 類

位於 [`architecture-details`](../tools/assets/architecture-details/README.md)，每類都有兩份獨立可編輯 `.blend` 與兩個 GLB。這些不是本批新增模型。

| 資產 ID | 用途 | LOD0／LOD1 三角形 |
|---|---|---:|
| sandstone-sill | 有滴水細節的砂岩窗台 | 32／16 |
| heritage-window-frame | 保留空窗洞的歷史窗框 | 40／32 |
| heritage-cornice | 連續線腳簷口 | 32／24 |
| sandstone-plinth | 石材基座 | 24／20 |
| sandstone-corner | 外轉角石材飾條 | 212／20 |
| residential-entry-surround | 住宅入口框，淨空 1.04 × 2.30 m | 128／40 |
| sloped-metal-awning | 斜雨棚與支架 | 48／40 |
| flat-metal-awning | 平雨棚與排水坡 | 36／28 |

共 552／220 三角形，所有 GLB 各 1 材質／1 primitive。既有 `runtime-candidate/` 另有適配 56 個 Robson 窗台的來源；那是特定配置候選，不可當成新增全城覆蓋。

### 本批新增的 8 類現代／住宅變體

- `modern-recessed-window-surround`：有深度的現代窗框，窗洞保持開放。
- `modern-sill-drip`：現代窗台與排水／滴水斷面。
- `modern-parapet-cap`：現代女兒牆壓頂。
- `concrete-shadow-plinth`：有陰影凹槽的混凝土基座。
- `concrete-chamfer-corner`：倒角混凝土外轉角。
- `residential-cedar-window-surround`：住宅雪松窗框。
- `residential-cedar-sill`：住宅木窗台。
- `residential-gabled-entry-canopy`：住宅斜屋簷式入口雨棚。

沿用既有 concrete、painted-metal、cedar 共用表面；不是下載材質，也不是把歷史零件只改名字。共 16 份獨立 LOD 來源與 16 個 GLB，合計 LOD0／LOD1 為 644／320 三角形，各 1 材質／1 primitive。每類的斷面、淨空、實際尺寸與輸出成本見建築擴充清單。

## 2. 植被與地表

既有 `residential-perennial` 的 7 三角形矮植栽保留；其修補的是相鄰放射面接縫，並未增加植物數量。本批補的是原計畫尚缺的葉片、樹皮、樹冠覆蓋來源與草／土接界：

- maple、alder、fir、cedar 四種原創葉／針葉來源與各 3 級可重用枝葉樣本，共 12 GLB；每種 LOD0／1／2 為 188／136／80 三角形。
- 樹皮 PBR 來源，明確的縱向紋理與公尺重複尺度。
- soil、grass、soil–grass edge 地表來源與 3 個斜坡測試 GLB，512／128／32 三角形。
- 1024² 四格 RGBA atlas、5 級 mip 覆蓋參考；20 格實際 PNG 的最大覆蓋差 0.526 個百分點，低於該批 0.8 個百分點門檻。
- 唯一 maps 的 RGBA8＋mips 預估 21.33 MiB，加選用混合權重圖 1.33 MiB；12 個獨立 sprig GLB 會重複嵌入同組貼圖，整合時必須去重。

**重要整合差異：** 原 runtime 使用 RGB 中性底色與 `aSolid`／depth 特殊處理；新 straight-RGBA 葉片不能只改貼圖 URL 就視為接好。必須按該批 README 接入 alpha、陰影深度及 solid UV 契約，維持既有樹冠輪廓、來源種子與 population 上限。斜坡樣本只證明離線資產形體，不會替城市地形取樣或修改接地。

## 3. 地標、交通工具與室內材質

這一批是 **8 組可編輯 PBR 材質與 3 個材質展示模型**，不是 8 棟建築、完整車輛或完整室內重建。

| 材質 ID | 建議用途 |
|---|---|
| landmark-brushed-aluminum | 地標不透明金屬外飾 |
| landmark-pale-panel | 地標淡色不透明板材 |
| vehicle-red-paint | 車身紅色烤漆 |
| vehicle-tire-rubber | 輪胎橡膠 |
| vehicle-seat-leather | 座椅皮革 |
| interior-terrazzo | 室內水磨石 |
| interior-oak-veneer | 室內木飾面 |
| interior-matte-plaster | 室內消光灰泥 |

本批 24 張 256² maps 的 RGBA8＋mips 保守預估為 8 MiB；3 個材質研究 GLB 分別為地標 1,080、車輛 1,860、室內 1,620 三角形。

保留原本城市 8 種共用建材。水、玻璃、Canada Place 膜面、Science World 特殊紅板、夜間窗光、展示螢幕等專用效果不強制塞入不透明 atlas。

**實際程式限制：** `roadster.ts` 及 `interiors.ts` 的目前幾何處理會移除 UV；新材質 maps 不是可直接替換的 runtime 材質。整合時需先補符合公尺尺度的 UV、材質角色分組，再保留既有玻璃／發光／室內補光邏輯。原有夜間發光不得誤烘焙進 base color。

## 4. 人物

既有 citizen 已有原創骨架、idle／walk／run、22 骨骼、1 skinned mesh、1 材質，現行 GLB 約 37,799 三角形與 3 張 2048 px PBR 圖。本批已提供從現行 GLB 重建的可編輯基準來源，以及 3 份獨立候選 `.blend`／GLB；這不是找回原始雕塑歷史或未保存的作者工作檔。

| 人物輸出 | 三角形 | 3 張 PBR 圖 | GLB bytes | 建議 |
|---|---:|---:|---:|---|
| LOD0 | 37,799 | 1024 px | 3,498,312 | 近景保留完整拓撲 |
| LOD1 | 30,825 | 1024 px | 3,222,256 | 中距候選，減少 18.5% 三角形 |
| LOD2 | 27,531 | 512 px | 2,001,060 | 遠距候選，減少 27.2% 三角形 |

RGBA8 加完整 mip 的貼圖預估由原本 64 MiB，降為 LOD0／1 的 16 MiB、LOD2 的 4 MiB；這是資產成本計算，不是 FPS 或 GPU 實測。臉、頭髮、手、鞋、領口、背包與配件不參與簡化。22 骨骼順序、3 個 clips 時長保留；每 clip 40 個取樣姿勢，最大骨骼矩陣差約 7.0812e-7。

**畫面限制：** LOD1／2 後腰與布料邊緣有局部 shading／UV 差異，只供中遠距離候選；近景用 LOD0。檔案已重開、匯出、重新匯入渲染並跑實際候選的角色回歸測試，但不能宣稱所有動畫／距離下零差異。精確來源及測試見人物交接清單；現行 `public/models/citizen` 不被取代。

警員的程序帽子／徽章／配色契約與可操控 citizen 不相同，不能拿 citizen atlas 全面重新著色充當警員。這批不新增群眾人口、AI、對話或交通功能。

## 5. 哪些保留既有做法

- GIS 建築主體、道路、地形、來源輪廓與高度：保留資料衍生幾何，不用整棟 GLB 取代。
- 既有 heritage-shop／modern-lobby bay 及四份 LOD 來源：保留既有可編輯成果。
- 橋梁、飛機、船舶、公共運輸與其他程序地標：本規格未要求全部重建；可按表面角色採用新材質，幾何與功能維持原作。
- 水、天空、招牌文字、展品發光等：保留專用 shader／canvas 管線。

「保留」表示已盤點而未改作新模型，不能計入本批新增資產數量。

## 6. 整合順序與授權

1. 先保存整份來源、manifest、輸出及驗證報告，再選擇要接入的單一來源樣區。
2. glTF 為公尺、Y up；建築的 +Z 面向街道，Blender 作者座標 Z up／-Y 朝街。人物與植被按各 manifest 的原點及朝向，不要重複軸轉換。
3. 依來源建築邊、入口淨空、表面高程放置；不要用拉伸 doorway、改 GIS footprint、貼平面遮洞或全城加密掩蓋配置問題。
4. 使用共享材質／幾何及有上限的 cell／LOD；GLB 已嵌入貼圖時不要再重複載入一套獨立 maps。
5. 開發環境完成晴／陰／黃昏／夜晚、LOD 切換、實際坡面與入口、重複載入／釋放，再量測 GPU、記憶體及目標裝置。
6. 本批 GitHub 資產分支不自動合併 main。main 的既有 Firebase workflow 會部署，使用者接好與驗收後再決定發布。

所有新增幾何／紋理為原創或沿用 repository 自有來源，適用 repository 的 [LICENSE](../LICENSE)（非商業研究及署名授權），不宣稱 CC0、商用授權或真實建築掃描。沒有加入第三方下載模型、照片或 mocap。

## 7. 這批驗證到哪裡

- 建築：12 項正負向測試、16 份實際 Blender 來源／PBR／淨空稽核、保留來源重匯出一致；修改不支援的共享材質會明確拒絕。
- 材質：24 maps 來源重烘焙 hash 一致，實際 tint 編輯進入輸出且其他 23 maps 不變，unsupported coat 拒絕；同相機四種光照預覽已檢視。
- 植被：15 個 GLB 的 geometry、maps、material、sampler 重匯出一致；物件／mesh 編輯保留，6 類不支援 shader 編輯拒絕；覆蓋統計來自最終 uint8 PNG。
- 人物：3 個候選各 4 項角色回歸通過；最終來源重新匯出與交付 GLB byte-identical；固定姿勢預覽已檢視並保留中遠距離限制。
- 整體：另有逐檔 SHA、有限值、索引與封裝檢查，並由獨立審查交叉確認。Blender／CPU 驗證不代表已在城市中驗收。

整批最後檢查：**627／627 repository tests、TypeScript、正式 Firebase build 與 emitted worker verifier 通過**；新增 handoff 檢查另有 7 個 Python 正負向案例。全批 inventory 稽核 273 個新作／重用檔案。既有 runtime、`public/`、部署 workflow、套件鎖檔與地理／碰撞程式均保持基準版本。完整 lint 仍有先前既存的問題；這批新增的測試檔定向 lint 通過，沒有將既存 lint 宣稱清空。
