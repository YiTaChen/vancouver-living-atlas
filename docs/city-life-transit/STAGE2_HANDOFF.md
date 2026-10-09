# City Life & Transit 補充包：Stage 2 重建交接

日期：2026-10-09。來源基準：PR #6 的 `9efce79601deac6a0648cf8e158f3935cbb46f51`。

這是先前未成功公開之補充包的**新重建版本**，依已保留的原始規格和現有來源介面製作，並非聲稱找回原二進位檔。不得沿用舊版的 890 測試或舊圖作本次證據。原始規格保持 [CITY_LIFE_TRANSIT_SPEC.md](../CITY_LIFE_TRANSIT_SPEC.md) 不變。

本分支以 PR #6 為依賴，不覆蓋其中已完成的街道人口整合。`main`、正式 app、production 資產清單、工作流程、城市範圍與夜間照明均未修改。PR 為 draft；不包含合併或部署。

## 接手入口

| 包／模組 | 路徑 | 內容與邊界 |
|---|---|---|
| 近距離互動人物 | `tools/assets/city-life-interactive/` | 4 個原創輪廓，各 14 骨、6 clips；可編輯 `.blend`、GLB、CPU 重匯入預覽及驗證。依既有背景輪廓重建，非高精度玩家角色替換。 |
| 近景人物 consumer 候選 | `lib/city/city-life/interactive-renderer-candidate.ts` | 未掛入 scene。使用 caller 選好的穩定 actor ID、phase、全域 0–4 名額；獨立骨架／mixer，共享 geometry/material/clips。 |
| 公車內裝 v2 | `tools/assets/boardable-bus-v2/` | 深海軍藍坐墊、修正側向優先座與前段輪拱／駕駛配置；詳細 master 與獨立 budget derivative 並存。外殼與車門仍引用既有公車。 |
| Mark V 端車 | `tools/assets/skytrain-mark-v-interior/` | 依 2025 年投入服務的 Alstom Mark V 照片與座位圖建模；22 座 A 車、短貫通段、兩個預算內 LOD，非完整五節編組。 |
| Canada Line | `tools/assets/canada-line-stage2/` | 獨立兩節 profile、外殼 3 LOD、內裝 2 LOD，非 Expo 四節模板。請先讀 `qa/handoff.json`。 |
| 7 站代表性站體 | `tools/assets/skytrain-stations-stage2/` | 各站獨立 layout／來源／入口與平台，Waterfront 分 Expo 與 Canada；幾何及高度近似需依 metadata 使用。 |
| 新包 production 隔離檢查 | `tools/stage2/verify_isolation.py` | 完成既有 Firebase build 後，核對新來源／GLB／預覽雜湊與未掛載程式未漏進 production。是靜態輸出檢查，非 browser network 驗收。 |

## 原有介面與資源所有權

- 原有 `tools/assets/boardable-bus`、`boardable-metro`、`transit-station-spaces` 與所有已公布資產不覆寫。
- 公車 v2 是新內裝來源，不能直接改既有 `assetRefs` 就宣稱已整合；使用包內的 hash-checked composition helper 準備 consumer view，再由原 adapter 驗證。
- Canada Line 每節均沿自身 car-local frame；第二節 yaw π 後，car-local 左右對應 consist 的相反側，不能硬套 Expo 的門間距／月台／編組長度。
- 近人物 renderer 不建立第二份人口 selector。名額由既有全域 selector 分配；背景表示切換交易仍需 `reserve → preload → validate → commit`，失敗保留原有效表示。
- 模板 lease 由 caller 保留；候選 renderer 只釋放 clone 自己的骨架與 mixer，不 dispose 共用 geometry/material/texture。四個近皮膚的 frustum culling 暫停，避免以靜止姿勢球界裁掉動作；這不是效能驗收。
- 動畫 phase 由模擬時間供給；renderer 沒有壁鐘追趕或第二份 AI tick。坐姿必須對齊實際 pelvis bone，不把 foot-root 放在座位錨點。

## 必須保留的限制

1. 本交付是離線資產、metadata 與未掛載程式候選；沒有把真實 5／6 公車、七站 SkyTrain、Waterfront 轉乘或完整旅程接入正式城市。
2. 公車抬高後甲板在既有屋頂下的代表性淨高不足 1.95 m，因此只供座位用途；consumer standingRegions 僅保留合格低地板站位。輪椅區的簡化空間不能當作無障礙認證。
3. 站點 GIS／官方入口圖能支持站名、相對位置與線別，不能證明地下深度／室內施工尺寸；layout 中 `representative` 標記不可移除。
4. 156 個站台門檻橋板屬 Atlas 代表性遊戲幾何，非真實站設施調查。部署／回收及關門互鎖仍需 runtime 接線與驗收。
5. 人物無 IK 與完整腳掌接觸求解；雨衣下襬、提袋、坐姿、真車門／座椅 fit 仍需近景檢查。
6. 不建立 GTFS 即時班次、不宣稱可搭乘、不改夜景、不移除遠景或縮 far plane。舊整合結果屬 PR #6，不能擴張到本包。

最新前段／顏色修正、Mark V 來源及量測見 [TRANSIT_INTERIOR_REFINEMENT.md](TRANSIT_INTERIOR_REFINEMENT.md)。公車詳細 master 超出 B-CAB 預算，且保留原始門口 10 cm 支撐缺口；整合應評估獨立 runtime-candidate，其中新增兩塊與車門齊平的支撐板。

## 驗證狀態

本次封存後重新執行：

- `npm test`：836／836 通過，0 skipped。
- `npm run check`：通過。
- `npm run build:firebase`：通過；未部署。
- 新增 TypeScript／JavaScript 檔案 scoped lint：通過。
- `npm run lint`：未通過，211 項既有錯誤分布於 83 個檔案；這些檔案逐一與 PR #6 基準比對，內容完全相同。未擴大範圍修正原有 lint。
- 人物：7 個 Node 測試、11 個 Python 負例通過；獨立複查確認無 skin binding、多一個動畫、Infinity／重複 clip 三類輸入均拒絕。
- 公車詳細 master：23 個 Python 測試、6 個實際 adapter Node 測試通過；獨立 budget derivative：39 個 Python 測試、6 個實際 adapter Node 測試通過；新增兩個門檻支撐板後再次封存。
- Mark V：23 個回歸／負例測試通過；LOD0 10,992 triangles／1,177,176 bytes，LOD1 2,964 triangles／305,404 bytes。實際支撐三角形、完整 sidecar 覆蓋、transform 與精確 anchor 集均已驗證。
- Canada Line：19 個 Python 測試通過。
- 車站：7 站、16 stops、167 surfaces、156 門介面、184 anchors 通過，10 個負例拒絕；門檻橋板 9,828 個支撐樣本、5,616 個動作姿勢樣本及 3 個碰撞判定 fixtures 通過。這不是連續時間碰撞證明。
- 25 個可編輯 Blender 來源均有逐包重開與 byte-identical reexport 證據。
- `python3 tools/stage2/verify_isolation.py`：102 個新離線 payload 與 101 個 production 輸出隔離檢查通過。

本輪原始命令輸出與機器可讀摘要位於 `tools/stage2/qa/`；各包 `qa/` 另有實際尺寸、三角面數、GLB 雜湊、來源重開及預覽證據。

實際 WebGL、桌面與 compatible／touch 旅程、動態碰撞、進出車站地形開口、長時間服務、記憶體／cache 回收及 GPU frame-time：**not_run**。

現有 GitHub Validate city 僅針對 base `main` 的 PR 自動觸發；本 draft PR 依賴 PR #6 分支，因此 hosted CI：**not_run**。工作流程未更動；本地檢查與 hosted CI 分列，不以沒有檢查當成成功。

## 建議整合順序

先檢查各包 CPU 圖與來源／尺寸，再接獨立 opt-in QA 場景；保留正式 fallback。先驗收單一公車門／座位及兩站旅程，接著驗收 Canada 編組、月台門側與七站之必要地形入口。所有 `V01–V12` 場景仍依原規格逐項驗收。只有真實畫面／流程與資源生命週期證據完成，才能把 `runtime_pending_webgl` 改為 `sample_accepted`。
