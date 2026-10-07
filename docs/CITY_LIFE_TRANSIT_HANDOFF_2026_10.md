# City Life & Transit：離線實作交接（2026-10-07）

> 後續審查與整合已在同一 PR 接續：請讀 [CITY_LIFE_TRANSIT_INTEGRATION_2026_10.md](CITY_LIFE_TRANSIT_INTEGRATION_2026_10.md)。以下保留原 `21007a0` 離線交付的歷史狀態；不能把下列 `not_run` 當成目前分支所有功能的最新總結。

## 狀態與接手入口

本交付是可重用的 **離線 TypeScript 狀態／安全模組、原創低成本行人來源包、官方靜態交通資料與測試**。沒有接入正式 scene、Engine、Navigation、city-buses 或 railway；沒有合併 main 或部署。`runtime_pending_webgl`，V01–V12 的實際瀏覽器驗收全部 `not_run`。CPU 正反例不是可搭乘或畫面驗收。

- 原始需求：[CITY_LIFE_TRANSIT_SPEC.md](CITY_LIFE_TRANSIT_SPEC.md)，完整保留使用者提供的 45,686 bytes，沒有改寫 planned/deferred 狀態。
- 本輪 baseRevision：`401569193ccda73e8f6a6fd96e4bdb144ef5a4c6`。它是 [PR #5](https://github.com/YiTaChen/vancouver-living-atlas/pull/5) 已於 2026-10-04 合併的結果；不是規格盤點時的 `5574d557`。PR5 的最終 head 為 `ebbb9eed94ab6abccb20826f8da9fe6978a512a8`。
- PR5 已把屋頂設備、普通車與有限 Ultra 闊葉樹 consumer 整合；公車／metro 內裝與研究站體保留為來源。本輪不重做或覆蓋這些來源，也不沿用 PR5 的 WebGL 數字冒充本輪結果。
- 所有既有檔案保持不變。原本嘗試在主 backlog 加入本規格連結，但該文件是既有 ground/city-scale 資產的鎖定來源；回歸正確拒絕 hash 漂移後已撤回連結，沒有修改舊 manifest 或放寬 validator。請由本交接／draft PR 進入新規格。新增模組未被正式 app 匯入；不改城市範圍、far plane、天空、日夜、曝光或既有模式。

## 檔案與責任

| 路徑 | 實際交付／API | 明確邊界 |
| --- | --- | --- |
| `lib/city/city-life/simulation-clock.ts` | `SimulationClock`，預設 20 Hz，最多補 4 步，隱藏清掉未完成步長與時間債 | 由整合者接 `visibilitychange`；不使用 300× sky clock |
| `lib/city/city-life/population.ts` | `populationProfile`、單一 `PopulationSelector`、同 surface/layer `ActorEventGrid` | 無實際 renderer、遮蔽測試或街區生成；`spawnSafe` 必須來自真實可見性檢查 |
| `lib/city/city-life/actor-state.ts` | `PathActor` 的 walk/wait/look/yield/resume、穩定站距與 phase | route 必須已經驗證人行道／淨空／閉環；不能以汽車中線當路徑 |
| `lib/city/city-life/continuous-path.ts` | `ContinuousPath`，有來源 ID 的 3D cubic chain、G1 接縫檢查、各車獨立取樣；`riderWorldTransform` | 目前測試曲線是 synthetic fixture，不是真實車道／鐵路；不自動把 GTFS 平面線升成可走 path |
| `lib/city/city-life/traffic-occupancy.ts` | `TrafficOccupancy`，車／停站公車共享站距佔用、同層跟車距離、原子路口衝突區保留 | 拓撲、煞停線、跨 lane 的 swept volume 與實際障礙由 adapter 提供 |
| `lib/city/city-life/transit-service.ts` | `TransitService`，全站停靠、停妥 0.5 秒、正側開門、10 秒 dwell、交接互鎖、終點停妥不重生 | 純控制器；門動畫／碰撞／正確平台是外部觀測，無 UI、觸控、音效或接入正式模型 |
| `lib/city/city-life/passenger-transfers.ts` | `PassengerTransfers`，reserve/preload/validate/commit、唯一座位、出口保留、token/timeout/rollback、固定 car-local anchor、停妥服務更名 | 對實際門／合法地板的 proof 必須每次現場重驗，不可把 JSON 的 `true` 當成驗收 |
| `lib/city/city-life/vehicle-profile-adapter.ts` | 窄版 `passengerContractFromManifest`，直接讀 D02–D05 原 manifest 的 fixed anchors、frame、LOD 與 assetRefs | 僅 root-local 及 identity root；nested frame/Canada profile mismatch/展示 LOD 明確拒絕；不取代原 package GLB validator |
| `lib/city/city-life/representation.ts` | `RepresentationTransaction`，保留舊 handle、stale callback 釋放、能力閘門、安裝失敗 rollback | adapter 需原子安裝唯一 collider/controller binding；完成後才 `releaseOld()` |
| `lib/city/city-life/resource-cache.ts` | 有上限 pending/entries、共享 promise、refcount lease、延後回收 `SharedResourceCache` | 正在搭乘的 interior 與必要 floor 必須持有 lease，拉遠相機不 release |
| `tests/city-life-runtime.test.mjs` | CPU 正／反例，包含 20 次失敗／取消、10 次上下車、10 次 cache 重用、兩次轉向、600 秒終點持續 | 不等同 10 次實際旅程或 10 分鐘瀏覽器循環 |
| `tools/assets/city-life-pedestrians/` | 四種輪廓 × 兩背景 LOD、可編輯來源、GLB、gait metadata、重匯入 CPU 預覽、成本與尺寸驗證 | 不是近景 8–16 骨架互動角色；InstancedMesh/shader/pass 整合與 GPU 成本未驗證 |
| `tools/transit/city-life-sources/` | 官方 GTFS 精簡 source-only 資料、重製 importer、source validator 與 ride-ready 拒絕閘門 | 無地下深度、站體施工圖、合法月台或 Canada Line 可乘坐 profile |

## 既有資產不可重建或誤用

先讀以下現有來源，使用其正式 manifest 的 frame、datum、capability、door、floor、seat 欄位；不要從顏色猜角色，也不要把 research world XYZ 搬進城市：

1. `tools/assets/boardable-bus/manifest.json`：12 m 代表性低地板車，外內裝同一 root，−X 右門、+Z 前進。
2. `tools/assets/boardable-metro/manifest.json`：`expo-metro-17m`，四節整體含連接件約 71.5 m；不是 Canada Line 或 Mark V 模型。
3. `tools/assets/transit-station-spaces/station-layout.json`：74×4 m 研究月台、跨隙板及候車件。現有 layout 明確不是 source-backed 真站。不可把它換站名就算完成七站。
4. `tools/assets/transit-independent-review/report.json`：原有靜態門洞／地板／人尺度審核；仍不代表 moving collision 或站台整合。
5. `lib/city/surface-reachability.ts`、`travel-surfaces.ts`：沿用 `{surfaceId, layer}` 身份與明確連接，不能用 Y 或 XZ 最近點偷偷換樓層。

## 接口契約及安全接線順序

### 1. 一份時間、一份身份、一份 authority

在獨立驗證 route 或 feature flag 下建立單一人口 selector、服務 registry、passenger registry 與 cache。不要直接替換正式展示交通。城市遠景保留原 consumer。`vehicleId` 不取自 instance slot；service controller 與 renderer 分開。`PassengerTransfers` 本身不受相機變更影響，Orbit 只是看向另一位置。

每個可見幀只作插值與必要矩陣更新。用 real elapsed 秒喂 `SimulationClock`；隱藏時先 `setHidden(true)`，返回 `setHidden(false)`，不补算 30 秒。服務 tick 的額外 dt 上限為 0.2 秒。遠行人 1–2 Hz 與近 20/5 Hz 由 selector 的頻率輸出分層排程；不要對所有 actor 每幀建 Navigator/mixer。

### 2. 先把來源線做成合法空間

資料包的 `sourceStopId` 是 GTFS stop_id，`stopCode` 是站牌碼，`stopId` 為 Atlas 服務身份。固定資料版本與 hash，保留 TransLink legend。官方 GTFS 包含 routes/trips/stop_times/shapes，不含地下高程、門側、路緣高程或合法軌道折返。

Route 5/6 的 block 配對是服務連續性證據，不是幾何接縫驗收。完整 shape 尾巴超出首末 scheduled stop；不能把完整 endpoints 直接相接。按照資料包的站點投影 interval 作 trimming，再驗證車道側別、地面、轉彎切線、路口衝突與實際車身 swept bounds。本 source-only schema 的 readiness gate 一律拒絕「可搭乘」，即使手動填入 status/空字串也不能升級；將來需要獨立 runtime package validator 核對真實 geometry/profile/frame/connector 才能授權。

`ContinuousPath` 接受四個 XYZ 控制點的 cubic segments，檢查位置接縫 ≤0.00001 m、切線約 1° 以內及顯式 surface connection。它不建立街圖、不猜地下高程，也不把相交 XZ 自動連起來。每節車沿自己的 offset 取樣；超出有效 path 的編組會被拒絕，不把尾車 clamp 到同一位置。

### 3. 先停妥與開門，再開始交易

`TransitService.update(dt, input)` 的 `doorsClosed`／`platformDoorsOpen` 必須反映真實動態門與碰撞狀態。`alignmentValid` 同時包含本車本節、本服務站點、停車位置與正確側月台；未知時 false。`clearDistanceM` 是同一路徑前方合法最大位移，來自 `TrafficOccupancy` 加停線／障礙檢查，不能永遠 Infinity。`pendingTransfers` 必須使用 `PassengerTransfers.pendingFor(vehicleId)`。

公車及列車現在都服務所選每站。終點只有 `hold-for-alighting`，停妥供下車，不創造 U-turn、crossover 或載客 modulo 重生。回程在真實合法調度/連接建立後另接；可留車等待，但這不是已完成連續雙向服務。空車、不可見、無交接才可回收。轉換 5/6 service ID 的 `rebindService` 只更新乘客服務資訊，仍需外部提供停妥且合法連續的新服務控制器。

### 4. 固定座／站錨點和安全上下車

`RideAnchor`：`vehicleId/carId/anchorId/kind/frameId/translationM/rotationQuaternionXYZW`，`translationM` 按 metadata 對 seat 表示 pelvis，standing 表示 feet。不要把 seat pelvis 直接當 citizen 腳底；adapter 必須用角色身體契約換算。可先用 `passengerContractFromManifest` 從原 bus/metro manifest 綁定獨立 live vehicle/car ID，不複製資產。它保留 pelvis/feet 與相機 datum；每個 standing region 首版只有一個固定 slot。座位及站位都屬一個 car-local frame，`riderWorldTransform` 用 car root 的 yaw/pitch/translation 合成世界姿態。

`BoardingProof` 包含 exact vehicle/service/car/stop/platform/door/side、`surfaceId/layer/floorPointM`、實際速度與持續停妥時間、2 m 互動距離、正側、門開、對位、淨空、視線、模型能力與地板查詢。`floorPointM` 登乘時是原 walking floor；下車時是已保留出口地板。preload 後 commit 前重新作同一目標的全部檢查。證明目標改變、失敗、逾時或取消均不改原有效位置。下車前 seat 保持佔用，相近出口保留不能重疊。

外部載入完成只呼叫對應 token 的 `markPreloaded`，過期 callback 不能覆盖新交易。20 次連點/取消與超時案例已有單測。載入失敗呼叫 `cancel(token)`；呼叫端仍須顯示可理解錯誤。registry 的乘客 state 保留原 source 到 commit，`pendingFor` 負責門互鎖。實際走入/走出動畫、座位到門的可達動線及交易中的暫態 render pose 仍由 adapter 實作；不能為通過 2 m 門口條件而捏造距離。drive/boat/fly/重新放置不可直接刪 rider：`unregister` 會拒絕 riding 或 pending，先在合法站點下車。步行活動／手帳 gate 必須確定真正 walking，不能因 Navigation 舊 mode 字串仍是 walk 而發奖励。

### 5. 表示、內裝與 cache

先 `RepresentationTransaction.reserve`，preload 新 representation；失敗保留舊 handle。`commit` 接收同一 authoritative snapshot，回傳新舊 handle 及 snapshot，座標、速度、path station、door/occupancy 不另產生第二份 authority。adapter 安裝成功後 `releaseOld()`；安裝失敗 `rollback()`。未 settle 時禁止下一個 swap。載客、門開或交接期間，不接受缺 passenger/door/opening capability 的降級。該協議不代替實際 renderer/collider 原子接線，V11/V12 仍要觀測。

使用 `SharedResourceCache(maxEntries,maxPending,idleSeconds,dispose)` 的明確上限。`acquire` 回 lease，同 key 只 load 一次；資源引用都 `release` 才能在延時後 `collect`。持有中的車廂、current station floor 不因相機拉遠 release；next station 預取也使用上限。載入器自己清理失敗前建立的部分資源。不要逐人 dispose 共享 geometry/material；骨架更新若日後加入，每人自己的 pose/mixer。

## 需求覆盖／尚未完成

| Spec phase | 本輪完成的離線部分 | 接手仍需完成 |
| --- | --- | --- |
| A 來源與契約 | HEAD/PR5 核對、完整原規格、穩定身份型別、GTFS 來源包與 readiness 拒絕 | 官方站圖/GIS 地理核驗、車道／地下 profile、Canada Line 車型、車站實際 layout |
| B 活街／普通交通 | 四背景輪廓、兩 LOD、人口額度／遲滯、局部事件、簡單反應、連續曲線及佔用控制器 | Robson/Waterfront 2–3 街區安全路徑、同 pass shader/normal/depth 綁定、淡入、遮蔽、少量互動骨架、活動與視覺驗收 |
| C 公車旅程 | 可重用停靠/乘客交易/按鈴狀態、固定 local transform、既有車型與 source route 綁定說明 | 真實 3 站以上空間、門/座位/UI/觸控、合法回程、完整遊戲旅程 |
| D Expo 兩站 | 獨立 car 取樣、既有 Expo 資產兼容契約、方向 stop source | Stadium/Main Street 站體、地面入口、月台/車門對位、連續高架/地下 path |
| E 區域擴展 | Expo 5 站、Canada 3 站各方向來源，Waterfront 分線身份 | 七站真實 layout/GLB、Canada 車型、所有合法路徑與 Waterfront 真步行轉乘 |
| F 整合 | 單測、type/lint/build 及資產 CPU 證據（具體結果見下） | 所有 V01–V12 WebGL/桌面/compatible觸控、資源與 frame-time、原模式回歸 |

沒有完整站體可交付，沒有把 GTFS 平面 geometry 或 74 m 研究月台稱為七站完成。近景骨架角色與自由車內走動也不在已完成欄。夜景全部 deferred，未製作照明池、未調曝光，沒有用縮短視距掩蓋成本。

## 驗證結果

見 `docs/city-life-transit/validation.json`，保留確切命令、環境、pass/fail/not_run、限制與測試數。數字為本輪實際最後執行結果，不沿用 PR5。離線模型圖是 Blender CPU 重匯入預覽，不是瀏覽器截圖。


### 獨立安全審查與復原

離線獨立審查發現並修正兩個問題：

- 單一 cubic 內部 cusp 可以避過固定間隔採樣而產生 180° 朝向翻轉。現在用導數二次式解析找候選零點，拒絕 cusp／垂直 tangent，並保留 8/64/128 subdivisions 的回歸。
- 原 source gate 只檢查部分 flag/non-null，偽造 passed status 可錯誤宣告 rideReady。現在 source-only schema 永遠不授予 ride readiness；另有全旗標偽造、空 ID、錯誤門側、非數字高程的反例測試。

修正後 42/42 runtime＋source focused tests 通過；另以六個獨立案例核對下車逾時保留座位、open-door/pending 降級拒絕、stale callback 不取消新版、失敗舊 cache lease 不釋放新版、隱藏清掉殘餘 tick、cusp/垂直 tangent。這份審查不是正式場景／WebGL 驗收。

製作環境曾在最後打包前中斷，先以 commit `e7237bdec288159f96cbc67d0962454b4a96d2e1` 保存文件限定的 provisional recovery handoff。環境恢復後已確認原始 checkout、程式、來源資料與 binary assets 仍在，採用原始持久檔案而非從對話重建來源；重新執行 final checks 後，以本文件取代暫時交接。原 provisional commit 仍可供追溯，不能以其當時 unpublished 狀態代表本次最終分支。

### 最終離線結果

- TypeScript、49 個新 focused tests、完整 **768/768 npm tests**（0 skip）、新碼 oxlint、Firebase static build、原有與新增資產 isolation 通過。
- 全库 lint 保留 211 個既有診斷，未改規則；這一項是 fail，不是全綠。
- 4 種行人 × 2 LOD：medium 420–452、far 168–204 triangles；8 GLB 合計 355,520 bytes，8 個壓縮可編輯來源 740,195 bytes，零 image textures。每 GLB 一個 opaque primitive；8 批是預期最大背景主 pass 提交，不是實測 GPU draw 或性能保證。
- `qa/source-audit.json` 的來源保留、相同 GLB 重匯出，以及暫時 +0.01 m 真正手動來源編輯 proof 通過。三張最終 GLB 重匯入 CPU 預覽已目視檢查；動畫視覺、動態自碰撞及車門實際 fit 仍 not_run。
- 新 19 個 .blend／GLB／preview payload 的 hash 均未出現在 92 個 production dist files；不是瀏覽器 network 觀察。
- 全部既有 tracked files 未改動；只有新增交付檔案與替換本 branch 上的 provisional handoff。完整 GTFS ZIP、Python caches、Blender backup、工作暫存不提交。

#### 快速接手命令

```sh
npm ci
npm run check
node --test tests/city-life-runtime.test.mjs tests/city-life-transit-sources.test.mjs tests/city-life-pedestrian-assets.test.mjs
npm test
python3 tools/assets/city-life-pedestrians/validate.py
python3 tools/transit/city-life-sources/import_gtfs.py --self-test
python3 tools/transit/city-life-sources/import_gtfs.py --validate tools/transit/city-life-sources/transit-source-snapshot.json
# 預期 exit 1，source-only 不可變成可搭乘：
python3 tools/transit/city-life-sources/import_gtfs.py --validate tools/transit/city-life-sources/transit-source-snapshot.json --require-ride-ready
npm run build:firebase
node tools/verify-city-life-isolation.mjs
```

Blender 重製及保留來源匯出請依 [人物包 README](../tools/assets/city-life-pedestrians/README.zh-TW.md)，GTFS 重製依 [來源包 README](../tools/transit/city-life-sources/README.md)。優先閱讀 [實際匯出預覽](../tools/assets/city-life-pedestrians/qa/previews/background-lod0-front.png) 與 [量測](../tools/assets/city-life-pedestrians/qa/measurements.json)，再做場景 consumer。遠近人物 shader 必須同時接 position 與 normal；AO/normal/depth pass parity 在 WebGL 驗收前不可標為通過。
