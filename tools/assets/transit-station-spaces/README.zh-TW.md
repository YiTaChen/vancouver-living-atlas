# D01 站點／月台離線研究包

Based on Vancouver Living Atlas by YiTaChen  
Source: https://github.com/YiTaChen/vancouver-living-atlas  
License: [Vancouver Living Atlas Noncommercial Research and Attribution 1.0](../../../LICENSE)

本包是 2026-10-03 backlog D01 的獨立離線交付。原創站牌、月台邊、導引牌、公車及列車跨隙板共五個模塊，各有兩個真正可編輯 Blender 來源與普通 GLB；不複製照片、商標、路線號碼或外部模型。候車亭直接引用 `street-furniture-expansion` 的 `transit-shelter`，沒有複製該來源或 GLB。新包沒有修改 `public/`、runtime consumer、舊素材包、真實路線或正式載入預設。

完成狀態以 `manifest.json`、`qa/handoff.json` 為準。即使標成 `offline_complete`，整合仍為 `runtime_pending_webgl`，D06 乘坐玩法沒有實作或驗收。

## 尺寸／來源

- `bus-stop-pole`：W .58 × H 2.665 × D .26 m；原點為地面接觸中心；+Z 為圖示正面。
- `platform-edge-2m`：W 4 × H .955 × L 2 m（LOD1 高 .952 m）。一般走面 Y=.95；黃色凸點最高 .955 m。原點在 rail-contact base；+X 為軌道側邊，+Z 沿軌道。以 37 個 unit-scale 模塊拼出 74 m；不拉伸人尺度構件。
- `station-guidance-sign`：W 1.88 × H 2.85 × D .24 m；牌面下緣 2.33 m，柱間淨寬 1.63 m。放在走道外側，不把 1.63 m 柱距冒稱為 1.8 m 主走道。
- `bus-threshold-deck` / `metro-threshold-deck`：X 跨隙長 .95 / .90 m、Z 淨寬 .95 / 1.10 m，Y 完整厚度 .035 m。原點為站邊 floor datum，+X 朝車廂。最高走面比 floor 高 .015 m，兩端各 .20 m 漸變，坡度 .075；兩端接地點與車內實際 floor 以 GLB 射線核對。
- GLB 的 Y-up / +Z 與 Blender 的 Z-up / −Y 只由 exporter 轉換一次。來源保留 component meshes、公尺 UV、材質節點與適用的可編輯 bevel / weighted-normal modifiers。
- 無圖片 maps；具名 semantic material roles 供未來共用材質重綁。零新增 GPU texel 估算不等於零幾何／draw 成本。實際 bytes、vertices、tris、primitives 均由重匯入前的 GLB accessor / node transforms 量測，見 `qa/measurements.json`。

## 靜態匯出合批（2026-10-04）

`.blend` 仍保留所有獨立零件、UV、材質與 modifier；`export.py` 先正常匯出，再由 `batch_static.py` 按 material role / attribute signature 合批。沒有簡化三角形或移除原始 component，所有 named nodes / anchors 與變換都保留為 zero-draw anchors；真正幾何位於 `module-batch-*`，每批的 `extras.componentRanges` 精確指向該批唯一 primitive 的 vertex/index ranges。`sourceLocalToModuleMatrix` 記錄原零件座標系。整件共同父節點為 `station-module-root`；便攜跨隙板仍是一個可移動 actor，沒有分拆或隱藏內部動態。

- 月台 LOD0：32 → 3 primitives；LOD1：4 → 2。37 件 LOD0 月台的逐件 primitive submissions 由 1,184 → 111，尚未加入 instancing，也不是實测 GPU 多 pass draw 數。
- 站牌 LOD0/1：11/9 → 3/3；導引牌：9/9 → 3/3；兩種跨隙板：4/1 → 2/1。
- 全部十份 GLB：84 → 23 primitives；triangles、vertex 數、材質定義及原始 named-node transforms 保持相同。
- 實際 binary comparison 的最大 float32 rebasing 誤差為 1.2e−7，沒有幾何簡化。每個 component 的 indices（扣除 vertex base）、POSITION/NORMAL/UV、material 及完整覆蓋都逐一核對，見 `qa/static-batching.json`。
- 因保留完整 anchor/range provenance 與重建 buffers，GLB 總 bytes 由 224,220 增至 267,052，所有單件仍在預算内；不以 primitive 減少推論 FPS 或 GPU memory 改善。

重新驗證原始與合批內容：

```sh
blender -b -t 2 --python tools/assets/transit-station-spaces/export.py -- --output /tmp/station-unbatched --unbatched
python tools/assets/transit-station-spaces/audit_batch.py /tmp/station-unbatched
```

`--unbatched` 僅供來源比較；正式匯出預設會合批。若要查 named mesh 的三角形，應查 componentRanges；不要把保留的 empty anchor 誤認為幾何不存在。精確角色 primitive 數、hash 與 bounds 由 package validator 強制核對。

## station-layout.json

所有座標均為本地研究座標，沒有地理位置、真實站點 ID 或世界 XYZ 例外。

1. `research-bus-a/b`：一對相反行進方向的研究站島。車根與輪胎接地 datum 不變，朝 +Z、−X 右門。站島 Y=.36 對齊新低地板公車 floor/sill；此高度是明確的研究站島提案，不是實測路緣。前／後門中心分別 Z=4.275 / −.625 m，取自 bus manifest。候車亭旋轉 90°，保留原前柱 root，完整足跡位於站島內；亭前另留連續 1.8 m 走道。
2. `research-metro-platform`：74 × 4 m 研究月台，Y=.95 與 `expo-metro-17m` floor/sill 完全相同。四車偏移 +26.85 / +8.95 / −8.95 / −26.85 m，實際編組長 71.5 m，每端餘量 1.25 m，大於每端 1 m 停車容差。全部 12 個右側門口均逐車變換到 station frame。
3. 每站記錄 local frame、停止車輛 frame、進站方向、waiting polygons、walking corridor、floor polygon/height、入口本地端点、未解決的 walk-surface target、門口對位與排除區。
4. 公車門檻到站島邊緣水平間隙 .25 m；列車為 .22 m。已提供實體可編輯 threshold deck、三段 walkable top polygons、deployed / retracted transforms、端點支撐及排除區。部署後跨過間隙並伸入車內實際 floor；兩端 .20 m 漸變上升 .015 m。預設 `enabled: false`，D06 必須確認 stopped / open / aligned、部署動作、支撐與動態碰撞後才可啟用。收起姿態是站側指定區域的直立便攜板，其位置由實際匯出 bounds 旋轉後的最低點推算接地（不再使用固定 .55 m 高度），不假冒已設計好的車輛機械改裝；兩姿態之間不能直接插值冒稱動作路徑已驗收。公車門掃掠到島邊最小 .083 m、列車門掃掠到月台邊 .0415 m 的 CPU 分離量不是營運／安全認證。
5. 月台 GLB 是實體模塊。公車站島與 entry connector 保留為可產生 walk-surface 的 polygon descriptors；預覽中的站島支撐 slab、軌條、人物與尺是 QA-only，不進 runtime GLB。沒有自動建立真正路緣、坡道或升降機。

`qa/source-audit.json` 保存 repo source hashes 與候選盤點。現有 `railways.json` 的 Expo open-air OSM 路徑具來源 ID，但沒有 station footprint、入口或測量月台高度；roads/paths 未提供可驗證 bus-stop pair。故地理放置及真實 entry connection 留待整合 agent 查證。原有地理資料仍是 © OpenStreetMap contributors / ODbL-1.0。沒有發明 Waterfront 地下 SkyTrain 連接，也沒有把 SeaBus 通道當作地下入口。這些 coupon 不是真實營運路線、Mark V 模型、無障礙法規認證或行進中跨車廂通行驗收。

## 重現／保存人工編輯

由 repository root 執行：

```sh
# 重建預設原創來源，會覆寫本包來源；只在明確要重建時使用。
blender -b -t 2 --python tools/assets/transit-station-spaces/build.py
python tools/assets/transit-station-spaces/contract.py

# 通常應使用此來源保留入口；開啟現存 .blend，完全不呼叫生成器。
blender -b -t 2 --python tools/assets/transit-station-spaces/export.py -- --output /tmp/station-reexport
# 若要正式刷新本包 exports，可明確把 --output 設成本包 exports，然後重跑 contract.py。

python tools/assets/transit-station-spaces/validate.py
blender -b -t 2 --python tools/assets/transit-station-spaces/audit_blender.py
blender -b -t 2 --python tools/assets/transit-station-spaces/export.py -- --output /tmp/station-unbatched --unbatched
python tools/assets/transit-station-spaces/audit_batch.py /tmp/station-unbatched
blender -b -t 2 --python tools/assets/transit-station-spaces/audit_thresholds.py
blender -b -t 2 --python tools/assets/transit-station-spaces/render_previews.py
python tools/assets/transit-station-spaces/finalize.py
```

`export.py --source-root <來源目錄>` 可對藝術家編輯後的來源副本匯出。`audit_blender.py` 對十份來源重開、UV／modifier 檢查、來源 hash 不變的重匯出、GLB 重匯入與平台實際射線高度檢查；另在 temporary source copy 修改單一 vertex 及材質，證明同一匯出入口保留兩種編輯。見 `qa/source-edit-proof.json`。正常匯出不重新生成 mesh，也不保存回 `.blend`。

## QA 與下一步

- CPU 共通包裝／hash／transformed bounds、規格尺寸、LOD envelope、成本及 layout tests：`qa/validation.json`。
- 9 個故障反例會被拒絕：短月台、錯誤地板、移動門錨點、虛構世界放置、過窄走道、非 unit frame，以及舊公車／列車收起姿態懸空及下沉姿態。
- 十個 GLB 來源及實際曲面：`qa/blender-validation.json`。
- `qa/previews/index.json`：兩 LOD × 晴天／陰天／黃昏／夜間，共 8 張模塊圖；另有公車＋引用候車亭、整列車＋74m月台、人物近景及公車／列車已部署跨隙板特寫與收起接地檢視，共 14 張。全部 actual exported GLB reimport，Cycles CPU 32 samples（此 Blender build 沒有 OpenImageDenoise，直接提高 samples，不把後製濾鏡當原始證據）；1 m 尺、1.75 / 1.81 m 示意人形只留 QA。
- `qa/stored-contact-validation.json`：16 個收起姿態 × 2 LOD 共 32 個 actual GLB 頂點接地檢查；最低點等於研究地板高度，舊懸空及下沉位置反例均會被拒絕。没有新增或假設隱藏支架。
- `qa/threshold-validation.json`：兩公車門與 12 列車門的 actual GLB 已部署跨隙板／已全開車門無重疊、車內承載端實際 floor 命中（同時檢查 imported batch mesh 及 `componentRanges` 指定的真正 floor triangles，沒有把 zero-draw anchor 當幾何）、已部署板上方的門口淨高最少 2.084 / 2.034 m（門口目標 ≥2.0 m），另從真正車內地板對 cabin overhead 射線量得 2.24 / 2.16 m，分別核對 ≥2.05 m；關門重疊反例會被偵測，要求先收板再關門。這是靜態離線姿態，不是營運或無障礙認證。
- 先解決真實 stop/platform IDs 與來源 walk/rail frame，再核對門檻／站台、移動／停止、LOD/cache/shared material 和 collision。載客時使用可登乘車輛 LOD + interior。此包不授權新增加全城市站點數量。
- WebGL loading、LOD switching、city placement、draw/frame-time、GPU memory、moving collision、boarding／alighting、runtime teardown 與部署均 `not_run`。
