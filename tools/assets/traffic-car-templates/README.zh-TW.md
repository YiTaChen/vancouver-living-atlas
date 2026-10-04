# E01：共享轎車／SUV 離線候選

本包為 Vancouver Living Atlas 新建的代表性一般車流外觀。來源基準 `8b95f013297597845d542463d6ce635105a95c4f`。需求：`docs/AI_AGENT_DEVELOPMENT_BACKLOG.md` 的 E01／B-CAR。

完成狀態：`offline_complete`；整合狀態：`runtime_pending_webgl`。只有本目錄新增檔案；沒有改既有包、`public/`、正式 consumer、人口、路線、車速、日夜時鐘或部署。離線 CPU 圖不是瀏覽器驗收。

## 實際交付

- `traffic-sedan`：獨立成形的引擎蓋、行李廂、斜前後窗、車頂、側窗／柱與輪拱；四顆輪胎、輪圈、鏡子、門把及前後燈片
- `traffic-suv`：較高、較長後艙的車頂／側窗輪廓，較大輪胎；同樣保留四個穩定輪組節點
- 每型三個真實、壓縮保存的 `.blend`，共六個；保存原始多邊形 mesh、公尺 UV、材質節點與輪組階層，並非將 GLB 回匯冒充製作來源
- 六個普通 glTF 2.0 GLB，無 Draco／Meshopt／KTX、無外部圖像、無嵌圖、無新增 maps
- LOD0／1／2 每型分別 **1,252／564／116 tris**，上限 3,000／600／120；成本依 `qa/measurements.json` 實檔統計
- LOD2 沿用原有雙量體的簡化意圖，另保留粗輪與燈片；不是把 LOD0 自動減面或冒稱完全複製舊 mesh

## 尺寸和原點

以下是代表性設計目標，不是某款真實汽車的原廠尺寸：

| 變體 | 完整寬×高×長 m（實際 GLB） | 主輪軸距 | 輪胎半徑 | 輪距 |
| --- | --- | --- | --- | --- |
| sedan | 約 1.860 × 1.480 × 4.509 | 2.70 | 0.32 | 1.57 |
| SUV | 約 1.920 × 1.760 × 4.659 | 2.78 | 0.35 | 1.62 |

完整 bounds 包含鏡子、燈片、前格柵；nominal length 分別 4.50／4.65 m。所有 LOD 的完整 bounds 差異不超過 0.02 m；LOD2 不保留前格柵的小突出，但原點、車頂高度、輪中心及輪半徑不變。

Blender 作者座標 Z-up；出口一次轉為 glTF Y-up：`(x,y,z) → (x,z,-y)`。GLB +Z 為前方，−X 為右側。root 的 X=0 為中線、Z=0 為前後主軸中點、Y=0 是四輪接地面。匯入後以實際輪中心／半徑重新核對接地，不以圖片猜比例。

`manifest.json` 包含完整 wheel anchors、旋轉軸 +X、前軸轉向標記、保守 box collision，以及 32°轉向假設下的 bicycle-model 轉彎掃掠 annulus。這些都是靜態幾何提案，不是懸吊、輪胎接觸、真實方向盤限制或認證轉彎半徑。車艙不可進入，collision 刻意保守封住車內。

## 共用材質角色

- `paint`：單一 Principled 車漆／painted-metal 輪圈；沒有 vertex color。整合端替換 baseColorFactor／instance palette 即可換色，不要染到玻璃／輪胎
- `glass`：同一材質配線性 `COLOR_0`，分別表示深色車窗玻璃、白色前燈玻璃罩、紅色尾燈玻璃罩；目前都是 opaque 外觀表面。金屬輪圈不使用 glass role
- `rubber`：共用深色胎面、格柵及小件

名字、primitive 實際材質索引、node ID 和 maps=空陣列都可核對，不按顏色猜語義。本批不用每車私有貼圖。每型三個 LOD 的實際 primitives 為 **11／7／3**。匯出階段已完成靜態角色合批；不再把 31／19／10 個作者物件直接當 runtime draw 候選。

- LOD0：`body-shell`／`glass`／`trim` 各一 primitive，加四個可獨立轉動的輪組；每輪 rubber／painted-metal 分材質，因此 3＋4×2＝11
- LOD1：同樣三個靜態角色批次，加四顆獨立 rubber 輪，共 7
- LOD2：全車只三個語義 primitive；四個同名輪子節點改為無 draw 的 Empty anchors。實際輪胎幾何已合入 `trim`，不可用 Empty 假稱可獨立轉動

所有作者端物件仍保存在 `.blend`。`export.py` 只在記憶體加入 triangulation，按語義合併靜態幾何、按單輪合併其輪胎／輪圈／橡膠蓋。`batched_source_parts_json` 保存被合併的作者物件名，`material_roles_json` 和 manifest 的逐 LOD primitive bindings 記錄實際材質索引。Paint primitive 沒有 vertex color，不會把車漆換色與玻璃、輪胎混在一起；LOD0 輪圈是明確的 painted-metal，和車身共用漆色。輪組合併後橡膠 primitive 可能帶中性白 vertex color，驗證器逐值確認為 1，沒有意外染色。未知 static 多材質作者物件會拒絕匯出，要求先依角色拆分，而非錯誤合併。

三個角色仍不保證三個 GPU draws；輪組與 multi-pass 成本另計。正式整合尚須共享材料、instancing、cache／disposal 與效能量測，未宣稱 FPS 或 GPU 記憶體改善。

玻璃是無內裝外觀用的不透明深色玻璃；不做透射。前後燈是 lens 幾何和顏色，不自帶 emission／point light。作者端 `headlight-lens-*`、`taillight-lens-*` 名稱保存在 GLB `glass` node 的 `batched_source_parts_json`；runtime 已合批，若需要單獨驅動燈片材質，必須從來源明確分離，不能假設還有獨立的 lens mesh node。這些限制在 handoff 中列出。

## 保留手動編輯的重新匯出

在 repo root 執行。Blender 僅一個程序、兩個 CPU threads：

```sh
blender -b -t 2 --python-exit-code 1 \
  --python tools/assets/traffic-car-templates/export.py -- \
  --source tools/assets/traffic-car-templates/source \
  --output /tmp/traffic-car-reexport-NEW
```

輸出資料夾必須不存在且不得與 source 重疊。`export.py` 逐一開啟六個已儲存 `.blend`，驗證材質圖，僅在記憶體加入匯出用 triangulation 與語義合批，匯出後比對原來源 hash。它不呼叫生成器、不存回來源、不把藝術家編輯重設成預設值。未知材質角色、未支援 node／socket 會清楚拒絕，不能靜默假裝匯出成功。

`build.py` 是初次生成／明確重建 default 的入口；不是手動編輯後的 reexport。它會覆蓋作者來源，只有指定 `--replace-sources` 才可重建現存來源。重新驗證後使用 `finalize.py` 更新 hashes 與量測；不可只修改 manifest 的數字。

```sh
blender -b -t 2 --python-exit-code 1 \
  --python tools/assets/traffic-car-templates/audit_blender.py
blender -b -t 2 --python-exit-code 1 \
  --python tools/assets/traffic-car-templates/render_previews.py
python3 tools/assets/traffic-car-templates/finalize.py
python3 tools/assets/traffic-car-templates/validate.py
python3 -m unittest discover -s tools/assets/traffic-car-templates -p test_validate.py
python3 tools/assets/package-contract/validate.py tools/assets/traffic-car-templates
```

重新 render 後的 preview index 先標 `rendered_pending_visual_review`；必須檢視全部輸出、記錄 `visualReview.status=pass` 並更新 index 的狀態，才能由 `finalize.py` 回填 `offline_complete`。未檢視時維持 `offline_partial`，不能只靠渲染指令返回成功冒稱目視通過。

產生／render 使用 Blender 4.3.2。此 build 無 OpenImageDenoise，24 samples 的小圖保留噪訊；不是假稱已去噪的高畫質成品。

## 驗證證據

- `qa/validation.json`：共通 schema／hash／變換後 bounds，加上 E01 尺寸、輪半徑、輪軸、輪拱、LOD、normal／UV／tangent、無重複三角形、材質角色、成本、碰撞與轉彎 envelope
- `qa/blender-audit.json`：逐一重開全部六個來源、保留拓撲／節點，重新匯出後比對幾何；另在空白場景重匯入實際 GLB，量 bounds 與輪組
- `qa/source-edit-preservation.json`：複製來源後實際修改 mesh 頂點、UV、paint 顏色與 roughness，存檔、經同一 exporter 開檔、回匯，證明修改仍在；原始來源與編輯後來源檔都沒有被 exporter 覆寫；未支援 graph 拒絕測試
- `qa/batching-report.json`：舊候選 31／19／10 到 11／7／3 的實際 GLB 成本對照、前後 hash、幾何／bounds 一致性與輪圈材質修正；非 GPU FPS 結果
- `qa/measurements.json`：逐 GLB bytes／triangles／vertices／primitives、來源 bytes／SHA、零 image bytes／零 GPU texel 規劃量；未量 GPU allocation
- `qa/preview-index.json` 與 `qa/previews/`：每型正、側、後、俯視，LOD0↔1／LOD1↔2 同視點，以及晴／陰／黃昏／夜四離線光照，共 20 張真正 GLB 的 Cycles CPU PNG，640×420、24 samples
- QA 有 1 m、0.1 m刻度尺，赭色 1.75 m 人形及灰色 1.81 m 人形。參照物只有 QA 場景，無任何人形／尺／地板／camera／light 進入 runtime GLB
- `qa/handoff.json`：待測事項、限制、整合順序及實檔入口

這是可編輯的低模代表性資產。幾何凸出和玻璃只服務外觀；沒有加入座位／駕駛、門片動畫、碰撞互動或路線機制。

## 整合順序

1. 由 `lib/city/environment.ts` 的既有 traffic 路線／population 中選可見小樣區，不新增人口或 route
2. 保留單一軸向轉換、以實際 road surface 高度放 vehicle root；**不得繼續加舊 body 的 ground+1.8 m**，也不得另疊 cabin+0.65 m
3. 明確綁定三個共用角色及 paint 換色，輪子獨立節點轉動；靜態小件合批需維持 role 與 anchors
4. 決定實際 LOD selector、cache、實例 cap，沿用已交付的 11／7／3 batching；LOD2 保留簡化量體及靜態輪胎，過渡與陰影需 WebGL 實測
5. 測坡地、碰撞／轉彎、日夜 lens、route speed（elapsed time，不能乘300）、draw/GPU memory/frame time 和資源釋放
6. 全部 sample 通過才由整合 agent 決定 `public/`、consumer 啟用及發布；本包不作這些變更

## 授權與出處

Based on Vancouver Living Atlas by YiTaChen  
Source: https://github.com/YiTaChen/vancouver-living-atlas  
License: Vancouver Living Atlas Noncommercial Research and Attribution 1.0

本包為本專案原創代表性設計，沒有複製商標、真實車輛照片、貼圖或第三方模型。沿用 repo LICENSE 與 AI_AGENT_POLICY；不是獨立可商用素材授權。
