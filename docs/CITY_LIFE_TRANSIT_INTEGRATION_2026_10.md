# City Life & Transit：審查、測試與整合結果（2026-10-07）

本輪審查使用者指定的 `21007a07dd0715562511f202427c4a1cc55893ed` 交付，在原有 PR #6 上接續修正。原交付確實是離線模組、行人來源與官方交通來源資料，沒有正式 scene 接線；原文件把 WebGL 標成 `not_run` 是正確的歷史記錄。

目前新增 **主城背景行人 consumer**，並以原始公車 GLB 完成 **三站研究場景的搭乘 WebGL 驗證**。真實 Bus 5/6、七站 SkyTrain、Canada 車型與 Waterfront 步行轉乘仍未完成。不能把研究公車旅程當成整份交通規格完成。

- 原需求：[CITY_LIFE_TRANSIT_SPEC.md](CITY_LIFE_TRANSIT_SPEC.md)
- 原交付：[CITY_LIFE_TRANSIT_HANDOFF_2026_10.md](CITY_LIFE_TRANSIT_HANDOFF_2026_10.md)
- 執行碼提交：`61b035e49d6c29dc4451b58b09d311d6783e2ecd`
- 原 base：`401569193ccda73e8f6a6fd96e4bdb144ef5a4c6`
- 更新的 PR：[PR #6](https://github.com/YiTaChen/vancouver-living-atlas/pull/6)

## 修正已重現的問題

| 問題 | 修正與回歸 |
| --- | --- |
| 玩家離開最初登記的步行地板後，無法提交合法的當前上車位置 | 新增 `updateWalkingFloor(passengerId, floor, step)`；要求 fresh surface-step proof，拒絕 riding、pending、非法地板與沒有顯式連接的跨層移動 |
| 非閉環行人在終點仍累加動畫 phase；最後一步累加超過實際剩餘距離 | 步態只根據真實移動距離前進；終點維持 wait |
| 相同 preload callback 重送會先 release 待提交的 handle，再提交已釋放物件 | 按 lease callback／handle／generation 去重；WeakMap 不保留無界歷史；不同 lease 仍各自釋放 |
| representation 交易接受比 reserve／preload 更早的時間 | 記錄單筆交易的 monotonic observation，拒絕倒退時間與過期候選 |
| passenger 交易在 preload／expire 後接受倒退時間的 commit | 同樣拒絕倒退觀測；有效 rollback／timeout 保留原身份與地板 |
| 行人整合容易在切換畫質時清掉畫面內角色、覆寫仍使用中的 route，或複製全城人行道索引 | 畫質重選保留既有身份；route/state/cache 有上限；地板索引只建立目前附近的可見、非 protected、ground footway |
| 長路段只索引起點與起始路線，路段中間可能一直沒有候選 | 以固定 80 m source windows 建立線段 bins；穩定 run ID 不隨相機位移；中段、斜線、候選排序與移動身份均有回歸 |
| 局部地板索引不足導致的失敗被跨區快取 | floorCell 改變時只清除 failed attempts，既有合法 route／actor 保留；跨 600 m 邊界有重現與重試回歸 |
| 公車 manifest 的 1 秒門動畫與 GLTF 由 frame 1 開始的 track 時間有偏移 | 按真實動畫 track 起止正規化，保留原 plug→slide 插值，沒有改寫 GLB 或 manifest |

前三個純模組的修正新增六項有意義的回歸，原 runtime tests 從 31 增至 37。其餘新增測試直接讀實際 GLB，或以錯層、缺口、坡度、樹幹、資源晚到與資料洩漏反例驗證 consumer 邊界。

## 主城已接入的行人

入口是 `CityEngine.pedestrians`，由 `city-pedestrians.ts` 共用一個人口 selector 與 renderer。背景角色使用原四種輪廓、兩級 LOD，八個 GLB 共 **355,520 bytes**；原 `.blend`、GLB、動畫來源與來源 manifest 沒有重製。

- compatible 全域上限 12 人；桌面 Balanced 24 人；High／Ultra 32 人，Ultra 不再加人口。
- 實際人行道地板、中心與身體兩側採樣、建築淨空、同 surface/layer、坡度與連續樹幹距離都要通過。沿來源線段建立穩定的 80 m station windows，只在實際來源兩端離交叉路口保留 10 m；候選依 window 線段距離排序，涵蓋長路段中間，不假造路口通行。
- 樹源使用既有城市實際 world XZ，包括既有森林來源，lazy 建立 16 m bins；路徑驗證以至少 0.6 m 樹幹半徑加 0.35 m 身體空間檢查。沒有逐幀掃描全城樹木。
- 同人行道內依序嘗試 1／0.55／1.45 m 偏移；地板或淨空不成立便留空。背景路徑是同一合法 footway 的往返，並非跨路口閉環。
- 角色必須在視口外安全生成；相機轉回才可看到既有身份。初次近景可能先沒有角色，轉頭、行走或等待角色進入畫面後才看見，沒有為了密度在面前硬生成。
- 玩家同層且距離小於 1.4 m 時簡單停步；尚無玩家被推動、車輛碰撞、喇叭、候車或近骨架事件 consumer。
- 20 Hz 固定步進、距離分級 movement ticks，渲染時插值。使用真實時間，與天空快轉時間分開。
- 相機距地面達 45 m 或飛行時關閉背景角色的選取、動作與顯示。首次全城開場不下載八個行人 GLB。已載入模板可在有界 renderer 中保留以便返回近景。
- 最多八組 InstancedMesh、共用 opaque 材質、無角色貼圖；beauty、SSAO normal target 及其 depth texture 使用相同剛性肢體形變；customDepthMaterial 亦接同一 position 函數，背景角色不投動態陰影。SSAO 中其他城市 geometry 使用 neutral attributes，維持原姿；五項 renderer 測試驗證 loader／shader 契約，並非獨立的 shadow-depth GPU 驗收。
- teardown 移除並釋放角色 owner、晚到模型與本畫布的 WebGL context；BFCache suspension 只暫停，沒有誤拆保留頁面。

這是背景人口的第一個可用 consumer。四名近距離互動角色、8–16 骨架、複雜穿越與候車反應仍是後續工作。

## 公車已驗證的內容

本機 opt-in QA 使用原 `boardable-bus` 的 12 m 外殼、內裝、四片門實際 GLTF animation、十個 seat 與兩個 standing anchors。總模型 6,070 triangles／28 primitives／515,700 bytes／無貼圖。

三站研究 layout 有連續彎道與等高候車島。上車／下車檢查當前門位、車速、停妥、候車島地板與實際 animated door aperture rays；交易仍走 reserve→preload→fresh validate→commit。座位按 pelvis datum、站立按 feet datum，眼位使用 manifest；Orbit 切換只換相機，不改乘客身份。

已實際完成 seat-09 與 main-aisle 兩種研究旅程：停妥開門、上車、乘坐、按鈴／停站、彎道、Orbit／返回、終點留車及後門下車。終點保留乘客與車，沒有 occupied reset；場景重設只在 walking 且無 pending 時可用。即時模式也觀察了站立乘客經彎道，手動暫停期間站距／時間／local anchor 保持不變。

候車島 Y=0.36 是研究模型門檻的等高地板，不是城市真實路緣。場景不是主城自由步行到站、搭乘、再下車自由步行的正式旅程，也沒有真實路口交通佔用。研究空車道可用 Infinity clearance；`verified-source-service` 則強制要求 fresh surface/collision 與 occupancy callbacks，不能直接改分類來解鎖。

API 與後續接線要求：[transit-demo-runtime.md](city-life-transit/transit-demo-runtime.md)。正式輸出不包含這個 QA 元件、模型或 `/__offline-assets/` loader；QA asset server 僅供本機。

## 測試與建置

| 檢查 | 本輪結果 |
| --- | --- |
| `npm run check` | 通過 |
| `npm test` | **816 passed，0 failed，0 skipped** |
| Runtime 純模組 | 37 passed |
| 實際行人 GLB loader／shader 契約／dispose | 5 passed |
| Sidewalk／consumer／樹幹／錯層／grade | 15 passed |
| 實際公車 GLB 門／fixed anchors／停站／pause | 4 passed |
| 新資產採用與輸出隔離反例 | 18 passed |
| 行人來源 CPU validator | 八個 GLB 通過；來源檔保持原 hash |
| GTFS importer self-test | 六項通過 |
| GTFS source-only snapshot validator | 通過 |
| `--require-ride-ready` | **預期拒絕，exit 1**；保留來源尚不能授權搭乘的閘門 |
| `npm run build:firebase` | 通過；英文靜態頁、十語 UI、地理資料、landmark worker、既有 Blender isolation 與新行人 adoption 全通過 |
| 新增與修改的 city-life 模組／驗證工具 focused lint | 通過 |
| 全庫 `npm run lint` | 仍有 **211 項既有診斷**；沒有放寬規則，不能宣稱全庫 lint 通過 |

本機 Node 26.0.0／npm 11.12.1。`61b035e` 執行碼另在 [GitHub Node 24／Ubuntu 的 Validate city 工作流](https://github.com/YiTaChen/vancouver-living-atlas/actions/runs/37677424665)通過，包含 typecheck、完整測試、architectural GLB 檢查、production build；該工作流不部署或執行 GPU 驗收。

正式採用清單不是整個目錄的豁免。`verifyCityLifeIsolation` 必須逐一核對八個名字、路徑、來源 manifest、hash 與 bytes；拒絕多餘檔案、行人來源包的未批准原 bytes 複本（含改名／移位）、symlink、Blender／backup，以及明列的 source-only／QA 引用；不宣稱能語義辨識任何轉換後的來源資料。它已成為 Firebase build 的必跑 gate。

PR 與本輪都沒有修改 `package.json` 或 lock。唯讀 audit 報告 24 個受影響 package nodes，其版本已存在於 base lock；沒有混入整庫升級，也沒有宣稱已證實正式部署可利用性。這是既有 dependency 維護項目。

## 瀏覽器證據及驗收邊界

截圖與 JSON 存於 [city-life-transit/qa/](city-life-transit/qa/)，記錄各 checkpoint 的執行碼 revision、source fingerprint、解析度、相機、population、WebGLRenderer.info 的幀內 render calls／triangles（包含既有多 pass）或公車交易狀態。PedestrianRenderer 的 populatedBatches 是非空批次數，triangles 是主 pass 幾何總和，geometryBytes 是去重 CPU buffers，皆不能當成 GPU VRAM。GPU 為本機 AMD Radeon Pro 560X／ANGLE Metal，Three r185，Codex in-app Chromium。這些是本輪觀測，沒有沿用 PR5 或台北 GTA 的 FPS 換算。

公車完整旅程證據來自 `efaf99a`，後續 `61b035e` 僅修改行人 source windows／地板快取及其測試，公車 consumer 未變。行人證據另在修正後版本取得。

資源上限、shared buffer 與 late-load 清理有回歸；有限瀏覽器 checkpoint 不代表跨裝置效能基準或十分鐘無洩漏認證。公車研究場景與主城 compatible／High 均未記錄 WebGL error／warning。下列是固定時刻觀測，主城 render counts 包含既有多 pass，不能用作人物單獨 GPU 成本或不同畫質的公平 FPS 比較。

| 主城 checkpoint | 實體 render size | 顯示角色／模板 | 人物非空批／主 pass triangles | 全幀 calls／triangles |
| --- | --- | --- | --- | --- |
| compatible 冷遠景 | 1280×720 | 0／0 | 0／0 | 779／3,915,219 |
| compatible 近景 | 1280×720 | 2／8 | 2／624 | 207／1,521,851 |
| High 冷遠景 | 1600×900 | 0／0 | 0／0 | 796／3,920,361 |
| High 近景 | 1600×900 | 19／8 | 6／3,888 | 1,001／5,474,489 |
| High→Balanced 近景 | 1280×720 | 13／8 | 7／3,328 | 473／2,574,140 |
| High 返回遠景 | 1600×900 | 0／8 | 0／0 | 796／3,920,361 |

High→Balanced 留下的十三個 ID 均屬切換前既有角色，沒有重置身份。測試期間 route≤64、actor state≤128；compatible 與 High 返回遠景後，背景 draw batches／triangles 均歸零，八個模型模板保留。人物進入不同 LOD／變體時，非空批次數可增加，即使人口減少。

**High 城市整體仍有成本**：上述近景的全幀幾何與後製提交量仍高，本輪沒有同相機的關閉人口基準、CPU/GPU frame-time 分解或十分鐘 profile，不能歸因或承諾 FPS 提升。下一輪應量測 building／tree／SSAO／shadow／fill 成本及初次近景索引停頓，再決定 batching、LOD 和 deferred index 工作；不以砍掉城市遠景來完成預算。

in-app browser 的另一個分頁建立後，原 document 仍回報 `visibilityState=visible`，因此不把它冒充 30 秒真實 hidden-tab 驗收。隱藏 300 秒、清除時間債與恢復 clamp 已通過純 controller／實際 GLB CPU 測試；真實 browser visibility/BFCache、觸控與長時服務仍需另驗。

| 原 spec 驗收 | 本輪狀態 |
| --- | --- |
| V01 城市遠景 | 全城開場保留；遠景行人不載入／不顯示。有 browser checkpoint；完整飛行俯瞰回歸不是本輪新增驗收 |
| V02 近景行人與低空 Orbit | 背景 consumer 接入，距離／LOD／安全出生／population cap 有實際畫面與 CPU 契約；不是完整近骨架人口 |
| V03 局部事件 | 玩家近身停等已接；喇叭／穿越／候車尚未接，事件 grid 仍屬純模組 |
| V04 真實車道／路口 | 研究彎道與 pure path/occupancy 有測試；production shared lane authority 尚未接 |
| V05 十次正式公車旅程 | 兩種 research anchors 完成瀏覽器旅程；真實主城旅程、下車自由步行及十次循環未完成 |
| V06／V07 真實 SkyTrain／轉乘 | 未完成 |
| V08 Orbit／hidden | 研究乘客 Orbit 身份保留已驗；真實 browser hidden 仍未取得有效觀測 |
| V09 區域終點與失敗 | 研究車 hold-open／下車已驗；資產失敗與 rollback 有 CPU 反例；正式地理服務仍未接 |
| V10 既有探索模式 | 完整既有自動回歸通過；不據此冒充所有模式的本輪 browser 旅程 |
| V11 十分鐘服務／表示交接 | pure 兩階段交接與 bounded cache 回歸通過；十分鐘完整瀏覽器循環未跑 |
| V12 二十次失敗／連點 | 原 CPU 反例與新增時序／重送反例通過；完整二十次瀏覽器 mode／collision 交接未跑 |

## 待開發入口

1. **B2 近距離互動角色**：保留既有背景池，新增近 skeleton 和局部事件 consumer；不得為每個行人建立 Navigator。
2. **B3 共享車道與路口**：把來源 road topology、停止線、跟車、排隊、cross-lane swept volume、停站公車接上 `TrafficOccupancy` 的同一權威。
3. **C2 真實 Bus 5/6**：每個所選方向修剪 scheduled-stop interval、建立連續 turns、合法 stop bay／curb／ramp／door floor，加入完整上下車自由步行及 5↔6 調度。
4. **D1 Expo 兩站與多車編組**：以既有四節 GLB 寫可搭乘編組 consumer，驗證逐節曲線／coupling／門／月台。既有裝飾 SkyTrain 四車移動不能算這個新可搭乘 consumer 完成。
5. **E1 七站、Canada 與 Waterfront 轉乘**：七個來源站名已有八組 station×line、十六個方向平台記錄；還缺 source-backed 站體、入口、分層動線、合法月台與軌道排除區。現有研究站體 `worldTransform=null`，不能換站名當真站。Canada 仍需獨立車型、門、內裝與對位；Expo profile 不得代用。
6. **F2 觸控與持續服務**：真實 hidden/BFCache、觸控上車／看向／下車／返回、完整十次旅程、十分鐘循環與 repeated representation 資源觀測。

**夜景仍為 deferred，暫不實作。** 本輪沒有改城市範圍、far plane、天空／曝光，也沒有加入店家／窗戶／路燈發光。
