# 公車內裝 v2：離線補件

**新重建的離線資產；尚未整合 runtime、尚未 WebGL 驗收。** 不把原先遺失補件的口頭描述當成已找回的檔案或量測。本包不修改 `boardable-bus`、`public`、應用程式、package scripts 或 workflows。

## 內容

- 可直接編輯的 Blender 4.3.2 `.blend` LOD0／LOD1：各座椅外殼、椅墊、扶手、柱、地板及車內部件保留獨立物件。
- 普通 GLB LOD0／LOD1：匯出後依材質批次合併；原始部件保留 zero-draw 節點，實際頂點／索引區間可追溯。
- 24 個實際乘客座位、pelvis／camera 錨點；司機座位另列。灰地板、藍色立體椅墊、黃色扶手、吊環、兩階後平台、輪拱、輪椅空間及簡化司機／付費區。
- 沿用 `vehicle` 公尺座標：glTF +Y 向上、+Z 車頭、−X 車輛右側。既有外裝、輪軸、門位置與門動畫由 hash-pinned 相鄰套件供應，**不能同时載入舊內裝**。
- 實際 GLB 幾何量測、逐部件保守碰撞盒、地板分段、站立限制、兩門通行取樣、負向測試、CPU 回匯入渲染。

先看 [日間車內前望後](qa/previews/front-looking-rear-lod0.png)、[後望前](qa/previews/rear-looking-front-lod0.png)、[布局剖視](qa/previews/cutaway-layout.png)、[參考來源與近似範圍](REFERENCES.md)。所有預覽從交付 GLB 重新匯入；剖視僅移除 QA 場景的上部幾何，未更動 GLB。

## 前半截修正與深色坐墊

重新查閱同代 West Vancouver 2012 New Flyer XD40 #1210 的前後視照片，以及 #1202 駕駛區近照。前半截改為左側司機／高隔櫃、右側裸露金屬輪拱蓋與護欄、獨立前門付費動線、側向優先座與收起座椅的輪椅預留區；前向成對座椅移到更後方。共 24 個可坐錨點，另 3 個收起的位置不算可坐座位。所有側向座椅的 pelvis、camera、旋轉與保守碰撞均跟實際 GLB 一致。

[前半截望向駕駛區](qa/previews/front-lowfloor-looking-front.png) · [前門望向優先座](qa/previews/front-priority-overview.png)。這兩張也是實際 GLB 回匯入渲染，不是概念生成圖。

原版本不是字面上的整段鏡像；問題在於前區沿用後區成對座椅與扶桿節奏，缺少前輪拱／駕駛／無障礙空間的差異。使用者提供的是先前預覽，僅供版本比對。後半截 17 座與兩 LOD 共 526 個原始部件的世界座標頂點逐一比對完全不變；坐墊材質依使用者要求全車改為較深、較低飽和的 navy。詳見 [修正前後證據](qa/front-correction-provenance.json) 與 [照片來源](REFERENCES.md)。

## 重要限制

這是照片參考下的代表性 12 m 公車，並非特定 TransLink 車號的精準復刻。24 座是本包的實際建模數，不是照片座位計數或官方載客數。

低地板高 0.36 m；後平台高 0.68 m；天花板底 2.60 m。低地板允許 1.95 m 站立參考，後平台只有 1.92 m 淨高，故標為 seated-only，不向既有乘客 adapter 提供後平台站立錨點。1.95 m 角色不可直接走入後平台站立區；未來整合需選擇低地板座位／站位或另行驗證進座動作。不得靠角色非等比縮放掩蓋此限制。

矩形地板 metadata 是支撐面，**不是已扣除椅子／輪拱的最終導航網格**；必須扣除 `obstacleCollisionRefs` 並按角色高度驗證。階梯跨越、連續 capsule sweep、坐下動作、載入生命週期、上下車交易、實際服務與 WebGL 效能均待整合驗收。

夜間照明仍 deferred：新內裝沒有 light node 或 emissive 材質，日間 QA 燈不進 GLB。

## 驗證與重新匯出

從 repo 根目錄執行：

```sh
# 保留美術修改：只開啟現存 .blend，不執行生成器。
blender -b -t 2 --python tools/assets/boardable-bus-v2/export.py -- --output /tmp/bus-v2-reexport

# 包裝、來源 hash、實際 GLB、地板／座位／門／站立取樣。
python tools/assets/boardable-bus-v2/validate.py
python tools/assets/boardable-bus-v2/test_bus-v2.py
node --test tests/bus-v2.test.mjs

# .blend 重開、重新匯出、編輯保存探針、GLB 回匯入與日間 CPU 預覽。
blender -b -t 2 --python tools/assets/boardable-bus-v2/qa_blender.py
```

`build.py` 會自動呼叫 `revise_front.apply_front`，同步建立修正後的前區、側座朝向與深色坐墊，不需要再手動執行修正腳本。獨立新目錄重建也通過座位／材質／朝向檢查，見 [builder-smoke.json](qa/builder-smoke.json)。它僅供在**新的輸出目錄**重建起始幾何，遇到既存 `.blend` 會拒絕覆寫。交付來源經過實際幾何修正；日後編輯以 `.blend` 為準。`revise_front.py` 保存本次前半截的局部幾何修正方法；它會替換前區，所以一般再匯出不可呼叫它。若替換正式 exports，重新執行 `metadata.py`、驗證、負向測試及全部預覽，重新人工檢查，不沿用旧 QA。

## 與既有 adapter 的離線組合

套件 manifest 只保存本包檔案，既有外裝透過 `dependencies` 的 SHA-256 釘選，避免複製外裝或讓包裝 validator 接受跨目錄來源。`compose.mjs` 讀取及核對相鄰原始套件後產生供現有 `passengerContractFromManifest` 使用的組合 view；檔案路徑基準是 repo root。此 helper 沒有被 runtime 匯入，並非已部署清單。

```sh
node tools/assets/boardable-bus-v2/compose.mjs > /tmp/bus-v2-composed.json
node --test tests/bus-v2.test.mjs
```

已驗證 LOD0／LOD1 各保留 24 個 pelvis 與 1 個低地板 feet 錨點；LOD2、誤放進 standingRegions 的後平台、缺失的外裝 asset ID 都被既有 adapter 拒絕。後平台放在 `nonStandingRegions`；輪椅空間放在 `reservedAccessibilityRegions`，不誤當一般站位。輪椅預留空間的保守全區 envelope 為 0.58 × 1.50 m、高 1.50 m，還需要真實輪椅與乘坐動作驗收。

## 成本與完成界線

精確 triangle／vertex／byte 計數以 [measurements.json](qa/measurements.json) 為準。兩 LOD 各 11 個實際材質 primitive；不含貼圖。與對應既有外装合成時，各為 32 個 primitive；這是幾何提交估算，不是 WebGL draw call 實測或 GPU 效能結論。

- 自動包裝及空間驗證：[validation.json](qa/validation.json)
- Blender 來源／回匯入：[blender-validation.json](qa/blender-validation.json)
- 23 項 Python 測試：[bus-v2-regression-tests.txt](qa/bus-v2-regression-tests.txt)
- 6 項既有 adapter 測試：[bus-v2-adapter-tests.txt](qa/bus-v2-adapter-tests.txt)
- 人工像素檢查：[visual-review.json](qa/visual-review.json)
- 預覽來源 hash：[previews/index.json](qa/previews/index.json)

Based on Vancouver Living Atlas by YiTaChen  
Source: https://github.com/YiTaChen/vancouver-living-atlas  
License: Vancouver Living Atlas Noncommercial Research and Attribution 1.0

### B-CAB 預算尚未達成

既有 backlog 的 B-CAB 目標是 LOD0 ≤12,000 triangles / 1.5 MiB、LOD1 ≤3,000 triangles / 384 KiB。本包詳細美術來源與兩個離線 GLB **均超過這些目標**；不能稱效能預算通過或 runtime-ready。精確差額見 [budget-review.json](qa/budget-review.json)。本輪優先修正真實前區關係並保留後區；後續仍需另做合規的 runtime 簡化版、實際效能及載入驗收。

### 詳細 master 繼承的門檻支撐缺口

加做實際三角面射線時確認：內裝地板只到 X=−1.15 m，原外裝門框位於 X=−1.25 m，兩門各有 0.10 m 寬度缺少開門狀態下的支撐面。原先兩門通道檢查是人體通行淨空，不代表完整門檻支撐已通過。這是既有詳細版／原外裝的缺口，不能直接當作已可連續步行登車。獨立 [runtime-candidate](runtime-candidate/README.zh-TW.md) 的支撐修正與驗證另列，不改写詳細 master 的來源／後區頂點證明。
