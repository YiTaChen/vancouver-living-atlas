# City Life & Transit：暫時交接／復原紀錄（2026-10-07）

> **PROVISIONAL / PUBLICATION BLOCKED — 不是最終交付。**
>
> 目前這個 GitHub 分支只新增本交接文件。下列程式、GTFS 資料、Blender 來源及 GLB 已在製作環境完成或部分完成，但**尚未上傳到此分支**。不要以本文件的路徑存在於文字中，推定相應檔案已可從 GitHub 取得。雲端執行環境在最後驗證／上傳前發生連線故障；恢復後將更新同一份交接文件並發布實際檔案。

## 目前可確認的版本及範圍

- Repository：`YiTaChen/vancouver-living-atlas`
- 專用分支：`codex/city-life-transit-offline-20261007`
- 製作基準：`401569193ccda73e8f6a6fd96e4bdb144ef5a4c6`
- 這是 [PR #5](https://github.com/YiTaChen/vancouver-living-atlas/pull/5) 已於 2026-10-04 合併的 main；PR5 最終 head 為 `ebbb9eed94ab6abccb20826f8da9fe6978a512a8`。原規格的 `5574d557` 盤點不是當前基準。
- 使用者提供的 City Life & Transit spec 1.0 已完整讀取；原件為 **45,686 bytes**，SHA-256 `f897546640c93c443ced9ea8b205e4bdf89e7018068e4e79ca90a72cd5a220bc`。工作環境已保留逐 byte 相同副本，預定路徑 `docs/CITY_LIFE_TRANSIT_SPEC.md`，但尚未發布到分支。
- 本輪不改正式 scene、Engine、Navigation、city-buses、railway、城市 far plane 或日夜曝光；不 merge main、不部署。夜景一律 deferred。
- 本交接不聲稱已完成可搭乘旅程、七站站體、Canada Line 車型或 WebGL 驗收。

## 已寫入製作環境、但尚未發布的程式

以下皆為獨立離線模組，尚無 production import：

| 預定路徑 | 實作內容與限制 |
| --- | --- |
| `lib/city/city-life/simulation-clock.ts` | 真實秒、預設 20 Hz、最多補 4 步；隱藏清掉時間債。整合者仍須接 visibility lifecycle。 |
| `lib/city/city-life/population.ts` | compatible/Balanced/High 的 12/24/32 聯集 cap、近骨架及互動子上限、三秒離開遲滯、同 surface/layer 事件格。遮蔽、淡入與 renderer 尚未接線。 |
| `lib/city/city-life/actor-state.ts` | 穩定 actorId、station、phase，walk/wait/look/yield/resume；需要已驗證的人行道 route 與安全下一段。 |
| `lib/city/city-life/continuous-path.ts` | 3D cubic chain、顯式 surface 連接、接縫位置/切線驗證、內部 cusp/垂直切線解析拒絕、各車独立取樣及 car-local rider transform。測試路徑為 synthetic，不是假裝已落地的市區車道。 |
| `lib/city/city-life/traffic-occupancy.ts` | 公車／汽車共用站距佔用、同層跟車距離、原子路口衝突區保留；實際 source topology、障礙及 swept volume 仍需接線。 |
| `lib/city/city-life/transit-service.ts` | moving/approaching/stopped/opening/dwell/closing/departing/terminal、全站停靠、0.5 秒停妥、10 秒 dwell、交接門互鎖、終點 hold。無虛構 U-turn/crossover 或載客重生；合法回程未接入。 |
| `lib/city/city-life/passenger-transfers.ts` | reserve/preload/validate/commit、generation token、timeout/cancel、唯一座位、先保留出口再釋放座位、固定 local anchor、停妥服務更名。實際門／地板 proof 必須每次現場重驗。 |
| `lib/city/city-life/representation.ts` | 詳模載入前保留舊 handle、stale callback 釋放、載客／開門／交接 LOD 能力閘門、安裝失敗 rollback；adapter 仍需原子安裝唯一 collider/controller。 |
| `lib/city/city-life/resource-cache.ts` | entries/pending cap、共享 promise/refcount lease、延後回收，不能逐人 dispose 共用資源。 |
| `lib/city/city-life/vehicle-profile-adapter.ts` | 從現有 D02–D05 manifest 綁定 live vehicle/car ID，保留 pelvis/feet datum；拒絕非 passenger LOD、Expo/Canada 混用、未解析 nested frame。 |
| `tests/city-life-runtime.test.mjs` | 31 項 focused tests，包括 20 次取消／過期、10 次上下車、cache 重用、兩次轉向、終點持續、原 manifest 適配與 cusp 反例。 |
| `tools/verify-city-life-isolation.mjs` | 新資產 hash／路徑不得漏入 production dist 的獨立驗證器；最終執行尚未完成。 |

### 既有來源必須沿用

原有 `tools/assets/boardable-bus/manifest.json`、`boardable-metro/manifest.json`、`transit-station-spaces/station-layout.json` 及 `transit-independent-review/report.json` 保持不變。12 m bus 與 17 m Expo 車型已有離線來源，不重建複製。研究月台不是七個真實車站，SeaBus 通道也不是 SkyTrain 地下入口。

仍沿用 `surface-reachability.ts` 的 `{surfaceId, layer}`；XZ 或 Y 接近不代表可以換樓層。seat pelvis 不等於角色腳底，stand anchor 才以 feet 表示。Orbit 不修改 passenger identity。drive/boat/fly 或重新放置需要先安全下車，不能留下幽靈佔用。

## 官方交通資料：已製作、尚未發布

預定目錄：`tools/transit/city-life-sources/`，含 importer、兩份精簡 JSON、README、validation report；測試為 `tests/city-life-transit-sources.test.mjs`。

已核對：
- 官方 [GTFS ZIP](https://gtfs-static.translink.ca/gtfs/google_transit.zip)，下載時間 2026-10-07 17:48:16 UTC，16,145,585 bytes。
- Feed `26SEP_20261002`，有效日期 2026-09-07 至 2027-01-03；不把下載／更新日期當生效日。
- ZIP SHA-256：`67fe970456c4640e030f7c991012e720f0b0e7d7af58a7ca3457b4ecd0650682`。
- 8 個方向服務、55 個公車 stop occurrences、7 個 station entities、8 個 station×line entities、16 個 rail directional platform records、416 個保留 shape points。
- `sourceStopId` 與 `stopCode` 分欄；Burrard Bay 1 為 8535 / 50043。Waterfront Canada P5/P4 使用 11303/11302，不混成 Expo P1/P2。
- 四個真實 block-backed transitions 組成兩個 5/6 來源循環。**完整 shape 尾巴的 endpoints 有 151–180 m gap**；按 shared scheduled-stop projection interval 裁切後，平面接點為 0 m / 0°。不可直接串完整 endpoints，也不可把平面連續性當成車道／高程／停靠驗收。
- 模擬 boarding 與 continuation 都 disabled。source-only schema **永遠不能宣告 rideReady**，即使有人把所有 status flags 改為 passed；將來需另外驗證真正 runtime geometry/profile/frame/connector package。
- 六項 Python 測試、十一項 Node source 測試通過；兩份 fixture 曾用相同 ZIP byte-for-byte 重製一致。完整 ZIP 不納入 Git。

資料使用受 [TransLink GTFS 條款](https://www.translink.ca/about-us/doing-business-with-translink/app-developer-resources/gtfs/gtfs-data) 約束。未來消費器須依官方要求呈現 prominent legend；資料使用不授予官方商標權，repository license 不重新授權來源 feed。

City GIS API 的可選讀取遇到未完成的 network approval，未重試；GIS 核驗保持 `not_run`。官方站圖 URL 有保留，但 PDF layout 尚未查閱。GTFS 不提供門口高程、地下深度、軌道折返、合法月台或站體施工圖。

## 原創背景行人資產：部分驗證，尚未發布

預定目錄：`tools/assets/city-life-pedestrians/`。

製作環境已有：
- commuter、raincoat、runner、tote 四種原創輪廓，各兩個背景 LOD。
- 八份可編輯壓縮 `.blend`、八份普通 GLB、生成／保留來源匯出工具。
- 每 GLB 一個 opaque primitive、vertex color、零 image textures。
- 當時實測：medium 420–452 triangles、far 148–184 triangles，身高 1.60/1.67/1.78/1.86 m，腳底 Y=0、+Z 前進。
- `_LIMB`、三個 scalar pivot attributes、`_PALETTE` 與 COLOR_0 保留，另有 CPU rigid-limb motion 與 GLSL 參考。
- 初次實際來源編輯 +0.01 m／再匯出 proof 通過，重匯入 Cycles 預覽已生成並查看。
- 後來改善 far-LOD neck/coat，再跑 build/source audit/render；最後 finalize 曾成功，但**最後這輪的 audit/render 結果尚無法重新讀取核對**。

**必須補完：**
1. 檢查最後 audit/render session 結果與實際檔案 hash。
2. 寫入並執行 `validate.py`、`tests/city-life-pedestrian-assets.test.mjs`；故障前這兩檔尚未成功寫入。
3. 完成 README、最終 visual-review evidence 和 package tests。
4. 確保 manifest/handoff 的 offline 狀態由最後證據決定。生成器曾提早寫 `offline_complete`，不能把該字串當完成證據；若驗證無法完成，必須降為 `offline_validation_pending`。
5. 近景 8–16 骨架角色尚未製作；背景 shader 與 normal/depth/AO pass 接線、GPU draw cost、animated culling、觸控／WebGL 全部未驗收。

## 已確認的檢查，及不可混用的版本邊界

| 檢查 | 已知結果 | 邊界 |
| --- | --- | --- |
| 完整 `npm test` checkpoint | 745/745，0 skip | 當時為原 718 加新 27；晚於此檢查又新增及修改 focused tests，**不是最終整包全測通過**。 |
| 最後獨立 CPU focused 複查 | 42/42（31 runtime＋11 source） | 另六個 adversarial ownership/timeout/downgrade/pause/path checks 通過。 |
| `npm run check` checkpoint | pass | 最終資產／全部檔案合併後仍需重跑。 |
| 新 TypeScript／測試範圍 oxlint | pass at checked checkpoint | 最終 asset tests 尚未寫入。 |
| 全庫 `npm run lint` | fail，211 diagnostics，檢查時皆在新碼以外 | 不把既有 lint debt 說成 pass。 |
| `npm run build:firebase` checkpoint | pass | static build、landmark worker、既有 Blender isolation 通過；19 adopted、176 protected hashes。不是本輪最終新資產 isolation。 |
| 既有 architecture GLB validator | pass，`--skip-blender` | 只涵蓋該既有包。 |
| Blender 新行人最終 package validator | pending | 檔案／測試尚未寫完。 |
| Browser/WebGL、V01–V12、touch、frame-time | `not_run` | 不沿用 PR5 的畫面／GPU 數字。 |

獨立檢查曾找到兩個安全問題，已修正並再驗證：cubic 內部 cusp 導致朝向翻轉；source readiness 只靠 flags 可被錯誤升級。修正後的 focused 結果是 42/42。最後另有對 cloned service plans、path metadata、actor routes 的凍結，仍應納入最終 typecheck/full-suite。

驗證環境：Linux x86_64、Node 24.19.0、npm 11.9.0、Python 3.12.14、Blender 4.3.2。沒有本輪 WebGL 裝置量測。

## 恢復後的執行順序

1. 只讀核對製作 checkout 是否仍在、branch/base、未提交 diff、最後 Blender session 及所有檔案 hash；不可盲目重建覆蓋可編輯來源。
2. 完成行人 validator/tests/README，修正任何提早的 completion status。
3. 再跑 focused tests、完整 npm test、typecheck、新碼 lint、source validator、預期失敗的 source ride-ready gate、Blender/package CPU checks、Firebase build、`verify-city-life-isolation.mjs`。
4. 寫入 `docs/city-life-transit/validation.json`，清楚列 final pass/fail/not_run；目前該證據檔尚未建立。
5. 將實際 modules/tests/source fixtures/.blend/GLB/previews、原規格與完整 handoff 上傳同一專用 branch。每個 binary blob 要核對 Git blob SHA；只更新自己的 branch，保留 main/PR5。
6. 更新**本同一份** handoff，去除已解決 blocker，補 exact commit／draft PR／CI links；不把未驗收項變成 accepted。
7. 可以開明確標示 offline-only 的 draft PR；不得 merge/deploy。驗證 exact commit 的 remote CI。
8. 整合者再接真實街區路徑、七站及 Canada 車型、門／地板／碰撞／UI／觸控、合法 return/service continuity、Waterfront 實際步行轉乘，完成 V01–V12 與資源/畫面量測。

## 目前阻擋原因

2026-10-07 約 18:04 UTC 起，雲端 exec transport 無法建立程序；恢復嘗試先逾時，之後持續回報 Noise handshake failure。GitHub connector 仍可讀寫，因此先保存這份**文件限定的暫時交接**。尚不能讀取製作環境中的 binary bytes，沒有宣稱它們已上傳或最後驗證完成。
