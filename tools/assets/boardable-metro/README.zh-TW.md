# D04／D05：可登乘研究用 metro 離線資產

本包新增 `expo-metro-17m` 代表性四節 metro：lead、middle、tail 三種外觀，各有 LOD0／1／2；三型共用可延後載入的內裝 LOD0／1。來源保留於 11 個真正可編輯的壓縮 `.blend`，輸出為 11 個普通 GLB。不是 Mark V，也不聲稱精確複製 Mark II／III。

最終狀態以 `qa/handoff.json` 與 `qa/validation.json` 為準。離線完成不等於已接入正式城市；D06、WebGL、透明排序、移動碰撞、搭乘角色／相機附著及列車行進中的跨車廂穿行，均保持 `runtime_pending_webgl`／`not_run`。

## 尺度、角色與接口

- glTF 為公尺、Y-up、+Z 前進、−X 右側。Blender 原始檔為 Z-up，匯出只作一次 `(x,y,z) → (x,z,-y)`。
- vehicle root 在軌面接觸 Y=0、X=0 車身中心、Z=0 兩轉向架中點。兩 bogie 為 Z±5.65，輪半徑 0.36、每 bogie 四輪、輪軸沿 X；各輪保持獨立 mesh node。
- 車體名義長 17、主體寬 2.65、roof 寬 2.8 m。完整外觀實測長 17.8 m、最高 3.48 m；包含 coupler／roof equipment。不能按外框重新置中內裝。
- Floor／門檻 Y=0.95；ceiling underside Y=3.11；過頂扶手最低約 Y=3.062，因此可站立區保守淨高 2.11 m。中央通道保守淨寬 1.25 m。
- 左右側各三個 1.4 × 2.05 m 門口，中心 Z=-5.5／0／5.5；每門口兩片獨立門葉。`doors[]` 記錄 12 片門葉，以 `openingId` 對應六個完整門口。每片先向外 plug 0.11 m，再沿 Z 滑移 0.73 m。必須按此兩段路徑播放，不能把 closed/open 直接作對角線插值。
- 12 個座席均有 pelvis 與 camera-eye 兩種不同 anchor；兩個 priority seats 保留獨立 material role。不得把 pelvis position 當人物 feet/root。另有站立區、輪椅與自行車留白區、扶手、next-stop-screen 與端部觀景。
- 首車 +Z、尾車 −Z 是觀景玻璃，沒有假駕駛艙；中車兩端與首尾車內側是實際開洞的 gangway。靜態通道淨寬 1.16、最低淨高 2.05 m。伸縮／轉彎只交保守 envelope，車廂間橋面仍有 0.30 m 待 runtime 接縫，禁止據此開啟跨車廂移動。
- 四節 car-local offset 為 Z=26.85、8.95、−8.95、−26.85 m，全為 identity rotation；編組外框 Z±35.75，實長 71.5 m。含每端 1 m 停車容差的研究月台至少 73.5 m。這不是實際站體量測或法規認證。

`manifest.json` 的 `vehicles[]` 包含完整 frame tree、各門 rest/open transforms、sweeps、向外法線與 boarding points、floor triangulation（+Y winding）、seat/camera anchors、standing/free zones、wheel/bogie、coupler/gangway 及 collision primitives。數值與實際 GLB nodes／triangles 交叉核驗；使用者不需猜測顏色代表哪種物件。

## LOD 與資源

- Exterior LOD0／1 有真空腔、門／窗開口及可獨立運動門葉；有乘客／開門／上下車時，鎖定此兩級並先載入 interior。
- Exterior LOD2 是封閉展示 fallback，只能無乘客、門關閉、不可登乘。能力在每個 LOD 上顯式標記，不能由距離偷偷切換成可載客狀態。
- Interior LOD0／1 獨立檔，不應全城常駐。middle 兩節共用同一模板及同一內裝資源；lead／tail 同樣可共用內裝。
- 外觀主要 roles 為 paint／steel-metal／glass／lights，paint 使用頂點色；gangway bellows 另有小型次要 rubber role。輪、bogie 與 coupler 均為 steel-metal，不使用輪胎橡膠。總共五個角色是相對四角色提案的明記例外，實際 primitives 分列成本。內裝 floor／wall／seat／priority-seat／rail／screen 使用共享語意角色。無圖片、無私有 per-car maps、unique texture residency 估算 0。玻璃 alpha 應由 consumer 保留並實測排序，不按顏色重新猜測角色。
- `qa/measurements.json` 逐 GLB 列出 bytes、geometryBytes、embeddedImageBytes、triangles、vertices、primitives 及 bounds。primitive 數不等同 WebGL 多 pass draw calls。

## 靜態內裝 batching（發佈前最佳化）

內裝兩個 LOD 現在各 **6 primitives**：floor、wall（包含 ceiling）、seat、priority-seat、rail、screen。先由未修改的可編輯 `.blend` 匯出普通 GLB，再只對靜態內裝按 material／attribute signature 重組；不改來源物件，不動外觀 door／wheel／bogie／gangway 必要節點。原始 source、外觀 GLB、所有 geometry／frame 位置保持不變。

原 floor、seat、wall 等節點保留為具名 **zero-draw anchors**。真正三角形位於 `interior-batch-*` mesh nodes；每個 batch 的 `extras.componentRanges` 提供原始 component/node/primitive、sourceLocalToVehicleMatrix，以及精確 vertexStart／vertexCount／indexStart／indexCount。consumer 或 validator 若要按「seat-right-01」取三角形，必須使用這些 ranges，不能假設同名 node 自身仍有 mesh。

`qa/static-batching.json` 對比由真實來源新匯出的 unbatched GLB 與實際交付 GLB：逐 component 索引順序、material ID、POSITION／NORMAL／UV 等 attributes 核對，誤差小於 1e-5 m／float units。triangles／vertices 不變；只重組索引和繪圖單元。保留詳細 ranges 和 32-bit indices 有少量 bytes 成本，記錄於 measurements，不能把 draw 減少當作 FPS 實測。

- LOD0 四車編組：closed/open exterior 154；加內裝由 282 降為 **178 primitives**
- LOD1 四車編組：closed/open exterior 154；加內裝由 234 降為 **178 primitives**
- LOD2：closed exterior 52；不可登乘、不可開門、無內裝

另有實際 copied-interior source 編輯證明：floor 上表面頂點提高 0.011 m、metro-floor roughness 改成 .123，六 primitive 匯出仍保留兩種變更，正式來源檔不變。新版 regression 包含 range gap、vertex escape、錯誤 component identity、錯誤 source node index 及錯誤 bounds 的拒絕測試。

## 可重現命令（repository root）

建立最初程序來源（會重建 defaults，僅適用初始製作，不可代替保留手動編輯的重匯出）：

```sh
blender -b -t 2 --python tools/assets/boardable-metro/build.py
```

保留來源重匯出到新的目錄，既不執行 generator，也不覆寫 `.blend`：

```sh
blender -b -t 2 --python tools/assets/boardable-metro/export.py -- --output /tmp/metro-reexport
```

讀取／驗證來源與實際交付 GLB、來源修改保留證明：

```sh
python tools/assets/boardable-metro/validate.py
python tools/assets/boardable-metro/test_validate.py
blender -b -t 2 --python tools/assets/boardable-metro/audit_blender.py
blender -b -t 2 --python tools/assets/boardable-metro/render_previews.py
python tools/assets/boardable-metro/finalize.py
```

如需獨立重跑 raw／batch 對照：

```sh
blender -b -t 2 --python tools/assets/boardable-metro/export.py -- --output /tmp/metro-unbatched --unbatched
python tools/assets/boardable-metro/audit_batch.py /tmp/metro-unbatched
```

`--unbatched` 是 QA 證據輸出，不是建議的 runtime interior。`audit_blender.py` 已自動包含此對照。

Python validator 需 NumPy；contact sheets 需 Pillow。Blender 4.3.2。每次只跑一個本包 Blender process、2 threads。Cycles CPU 640×400、8 samples；此 Blender build 沒有 OpenImageDenoise，因此保留可見取樣雜訊，不將降噪後的圖冒充更多取樣。

## 驗收與限制

- common package-contract 驗證普通 GLB、來源／輸出 SHA-256、數值、indices、normalized normals、bounds、costs。
- 本包驗證 frame 無環／完整、actual node anchors、floor triangles +Y winding、實際 floor／threshold 表面 ray、門口接近邊界的 open/closed section ray、1.75／1.81 m 人體、0.48 m 身體直徑與 0.24 m 頭部直徑的 capsule-spine sphere／實際 triangle 最近點檢查，以及所需通道、座面與 pelvis、wheel contact、留白區、static gangway、碰撞 proxy 與 visible floor／seat bounds。
- 門兩階段軌跡有 21 點／葉 envelope 檢查，另用實際門葉頂點沿兩段移動對 static GLB triangles 作 ray sweeps；floor/header 接觸採 0.2 mm 內縮排除零厚度邊界接觸。這不是連續精確物理 solver，也不是運輸安全認證。
- 所有 `.blend` 逐一重開、重匯出、交付 GLB 逐一重匯入。source-copy 修改 +0.011 m 頂點與 .123 roughness，證實 exporter 保留真實編輯；原始 source hash 不變。
- 圖片來自實際輸出 GLB：三型、三 exterior LOD、四視角；每型四照明、門開／關、走道、剖面、每個入口與每個座位 camera、1 m／1.75 m／1.81 m 參考，另有 interior LOD 對照。這些照明是離線研究，不宣稱與城市 renderer 天氣一致。
- Exact duplicate triangle 檢查不能證明所有 partial coplanar overlap 都不存在；輪廓為低多邊形研究風格；不包含車站、路線、時刻、乘客動畫、行駛服務狀態及 moving inter-car collision。

## 交接順序

先跑 validator／核對 SHA-256，再讀 `vehicles[]` datum 及能力；製作 `lib/city/railway.ts` 新 profile adapter，按 car-local pose 與 route 來源放置。先固定座位單節研究，對準 Y=.95 門檻與月台；確認 material roles、lazy interior／cache 與 LOD lock，再做 D06 狀態機及 WebGL 四照明／重複搭乘釋放測試。保持現有正式模型預設不變，本包不寫 `public/`、runtime 或舊 schema。

Based on Vancouver Living Atlas by YiTaChen  
Source: https://github.com/YiTaChen/vancouver-living-atlas  
License: Vancouver Living Atlas Noncommercial Research and Attribution 1.0
