# Vancouver Living Atlas：火箭遊戲設計與資料來源

研究日期：2026-10-22。以下以 NASA、ESA 與遊戲開發者提供的資料為參考；參考現象與本遊戲規則分開，所有海陸、月面和星空素材均由程式產生，沒有下載或重製外部圖片。

本輪修訂 Titan：更明亮的銀色箭體、清楚的黑色隔熱面與銀框翼片，新增四枚外掛助推器，與中央核心同時點火。外掛先燃盡、向外分離，核心持續推進，再進行核心與上面級分離；地面五股噴流會撞擊當地表面並向外攤開。[城市驗收 18／18](rocket-launch-game/titan-four-runtime-report.json)、[模型展示 4／4](rocket-launch-game/titan-four-model-report.json)與[完整回歸 2,016／2,016](rocket-launch-game/titan-four-test-summary.json)通過；完整套件包含 121 項火箭測試及其中 19 項 UI 測試，TypeScript、lint／格式檢查與 `build:firebase` 通過，沒有部署。完整流程與本輪獨立報告見 [Titan 四助推器修訂](rocket-launch-game/TITAN_FOUR_BOOSTERS.md)，未沿用舊版通過數字。

先前三型首次加入時，完整回歸 **2,001／2,001 通過**，其中包含 **106 項火箭測試**及其中的 **17 項 UI 測試**，不另外加總；當時 TypeScript 與 `build:firebase` 通過，實際城市固定步進驗收 **12／12**、獨立模型展示 **4／4**。[Titan 舊版驗收與原始報告](rocket-launch-game/SUPER_HEAVY.md)保留方法與限制，先前環境、事故及 1,982 項回歸也按版本保留。

先前「漸進坍塌、箭體火災與事故觀察」修訂已通過新增的 13／13 項事故 runtime 驗收，另有 14 項 UI 元件測試。這兩組與下方先前版本的 1,920／1,944 項回歸、21 項環境整合驗收分開記錄；舊報告沒有覆寫，也沒有把新增事故結果算成舊環境測試的重跑。

事故修訂在恢復載入緩衝前的完整回歸為 **1,982／1,982 通過**，0 fail／skipped／cancelled，套件耗時 148.50 秒。新增事故狀態、低屋頂撞擊後持續坍塌、殘骸在坡地落定、城市鏡頭避障與修復城市不重播事故均包含在內。當次 TypeScript、修改檔案 lint／格式檢查，以及 Firebase 正式靜態建置（含既有資產隔離、adoption 與 CSP 驗證）全部通過；沒有部署。之後恢復建造 6／10 秒與倒數 5 秒的補正，另通過全部 **87 項火箭回歸測試**及 TypeScript；包含兩型火箭資源未載入時不得 Ready、完整倒數、飛行與事故流程，未將先前完整套件結果當成此次重新執行。

## 任務定義與遊戲循環

完整循環為「選 Scout／Atlas／Titan → 任意地點放置 → 建造與背景載入 → 發射前地基評估 → 點火 → 自動或手動升空 → 抵達太空 → 繼續觀看／返回溫哥華」。成功條件使用越過 100 km 並維持結構完整，文字稱為抵達太空，不稱為入軌。這個版本不包含返回地球。

NASA 說明大氣會逐漸變薄，沒有硬性的物理邊界；100 km 是常用界線。因此畫面應隨高度逐漸變黑，不能跨過門檻便突然更換天空。來源：[The Atmosphere: Earth's Security Blanket](https://science.nasa.gov/earth/earth-atmosphere/the-atmosphere-earths-security-blanket/?category=applied_science)、[Where Does Space Begin?](https://www.nasa.gov/general/where-does-space-begin-we-asked-a-nasa-scientist-episode-43/)。

## 三種火箭的外形與影響範圍

三款使用不同程序幾何、材料與附屬部件，並非同一模型縮放。選擇卡也以三種原創 SVG 剪影和中英文字標示差異。

| 機型               | 可辨認外形                                                                    | 高度／箭體參考半徑 | 建造／倒數  | 風壓／熱影響半徑 |
| ------------------ | ----------------------------------------------------------------------------- | ------------------ | ----------- | ---------------- |
| Scout 小型         | 細長箭體、4 片後掠尾翼、1 個主引擎                                            | 18 m／1.1 m        | 6 秒／5 秒  | 35 m／17 m       |
| Atlas 大型         | 橙色核心、白色整流罩、2 枚白色側助推器、7 個主引擎                            | 48 m／3.5 m        | 10 秒／5 秒 | 100 m／45 m      |
| Titan 泰坦・超大型 | 明亮銀色鼻錐、黑色隔熱面、4 枚外掛助推器、4 片控制翼、4 片格柵翼、19 個主引擎 | 110 m／6.3 m       | 16 秒／5 秒 | 220 m／105 m     |

Titan 的近地效果強度為 2.2，需比 Atlas 更寬廣、堅固的地面或平台；一般屋頂、湖床與弱地基仍可能失效。220 m／105 m 是遊戲配置的局部風壓／受熱範圍，2.2 加強效果，不再把半徑乘大，也不是範圍內每棟建築都必然毀壞。作用仍會受噴流方向、距離、離地高度、碰撞物件與有上限的效果池影響。海河下沉、手動／自動、事故觀察與太空目標沿用原有規則；Scout／Atlas 保留原兩級分離，Titan 另有先釋放外掛助推器的步驟。

翼片、助推器、隔熱面與引擎掛在各自箭體節段上，隨搭建、級間分離與殘骸破裂移動；Titan 的格柵翼以合併 mesh 保留格線輪廓，避免每一格增加獨立 draw call。碰撞外廓也納入附屬部件：Titan 完整載具包絡半徑更新為 14.1 m，上面級為 10.1 m，與 6.3 m 的箭體參考半徑分開。詳細參數與效果預算見 [Titan 規格](rocket-launch-game/SUPER_HEAVY.md)。

先前未加入四枚外掛的 Titan 版本，在同一實測地面位置、各自離地約 5 秒時，Scout／Atlas／Titan 受損建築部件為 **0／14／89**，最遠中心距離約 **0／73.5／179.5 m**；當時 Titan 以 **65.167 模擬飛行秒**達到 **100,030.692 m**，回城建築 position／color 原始位元 hash 與基線 **3116572666** 一致。這些是[保留的舊版城市報告](rocket-launch-game/titan-runtime-report.json)，不是新版四助推器的時間或損壞基準，也不是每次發射的保證數字。

新版 Titan 的四枚外掛與核心共用初始點火時刻，外掛與核心燃料同時消耗；外掛分離的 0.8 秒仍有核心推力，不是關機滑行。HUD 依序顯示「四側助推器＋核心 → 側助推器分離中／核心持續推進 → 核心推進 → 核心級分離 → 第三級上面級」，分離進度取自物理 snapshot。核心剩餘燃料不因外掛分離而重置；手動推力、姿態、自動切換與中止操作保留。

本輪四助推器 Titan 以 **69.517 模擬飛行秒**達到 **100,037.411 m**；同一開闊地面、離地 5.017 秒時，三型受損建築部件為 **0／14／91**，最遠中心距離約 **0／73.5／179.5 m**。三型回城後的建築 buffer 原始位元 hash 均還原為基線 **3116572666**。這是本次地點與模擬的觀察，不保證其他地點有相同數量；完整燃料、事件與預算數值見[新版城市原始報告](rocket-launch-game/titan-four-runtime-report.json)。

## 飛行與控制

使用固定步進更新位置、速度、姿態角（渲染時轉為四元數）、角速度、燃料與完整度。推力沿機身軸、重力向下、阻力使用扣除風速後的相對空氣速度。風場使用 seeded 平滑陣風，搭配有限的穩定恢復力矩與角速度阻尼。自動駕駛僅輸出操控命令，與手動模式共用模擬；不應忽略地基失效或沿固定動畫路徑移動。

小火箭設定較低慣量、較快操控反應和較大風擾動；大火箭設定較強主動穩定、較慢轉向，但更大的基座負擔與噴焰影響。大型較穩是遊戲機型的整體設定，尺寸本身不保證穩定。NASA 指出陣風可使火箭擺動，現代全尺寸火箭通常透過主動控制穩定姿態。來源：[Rocket Stability Condition](https://www1.grc.nasa.gov/beginners-guide-to-aeronautics/conditions-for-rocket-stability/)。

阻力依密度、速度平方、迎風面積與阻力係數改變；遊戲可以把複雜形狀影響合併為少數係數。來源：[Drag Equation](https://www1.grc.nasa.gov/beginners-guide-to-aeronautics/drag-equation/)。

升空先垂直離地，再漸進傾轉，讓軌跡可見且不是直線。ESA 對 Ariane 的說明也描述垂直離地後逐步傾向東方。來源：[Launchers FAQ](https://www.esa.int/Enabling_Support/Space_Transportation/Launchers_FAQ_Frequently_Asked_Questions)。

## 地基與城市反應

海洋與河流下沉、湖泊地基不穩、屋頂依承載力與噴焰傷害坍塌，都是本遊戲的明確規則；不能把水體分類宣稱為現實承載能力的通則。保留任意放置的自由，同時提示發射風險。

以向下噴焰錐、地面衝擊區與熱量累積區取代 CFD。建築用正常／受損／坍塌狀態和替代 mesh；樹木彎折、倒下或燃燒；草地焦黑；椅子、車輛和行人使用有上限的拋體效果。屋頂被破壞後，支撐傾斜要傳回火箭姿態，形成真正的連鎖失敗。

Titan 五股近地噴流以最多 40 條地面火焰帶呈現，每股向八方攤開，共用一個 instanced mesh／單次繪製。落點沿箭體方向投影並重採樣當地地形高度；屋頂發射時另外取對應變形支撐屋頂的高度，地面發射仍沿用地形表面。近地塵霧重用既有粒子池。直接火焰依噴嘴到表面的可達距離淡出，核心／側助推器的遊戲視覺距離上限為 77／55 m；較高處可保留漂移塵霧與壓力反應，不再把地面火焰留在數百公尺高空下方。

NASA 的發射台具有導焰設施與水系統，處理點火時的高熱、振動與聲學環境。這支持周邊環境需要強烈反應的視覺方向；具體城市損壞門檻仍是遊戲調校，沒有宣稱工程精度。來源：[Launch Complex 39B](https://www.nasa.gov/reference/launch-complex-39b/)、[Pad 39B Water Flow Test Comes Through Loud and Clear](https://www.nasa.gov/centers-and-facilities/kennedy/pad-39b-water-flow-test-comes-through-loud-and-clear/)。

## 先前事故流程修訂（13 項新增 runtime 驗收通過）

屋頂失效採漸進形變：屋頂與樓層約在 2.6 秒內逐步下沉、垮塌。火箭先隨失效支撐下沉約 1.5 秒，這段期間關閉引擎；支撐釋放後進入 `falling`，保留姿態、轉動與實際重力下墜，再由城市碰撞判定撞擊。屋頂形變與支撐釋放由同一事故時鐘推進，可互相重疊；並非先等待 2.6 秒、再另外等待 1.5 秒，也沒有把整個模擬時鐘慢放。

撞擊後讓真正箭體破裂，重用原有六節機身、整流罩與引擎 mesh，各節保留動量、翻滾、落地及停止的過程。已經完成分級時，只處理仍在載具上的上面級，不重新生成已離開的助推器。是否爆炸取決於燃料、撞擊與可重現的 seed；可能先破裂、冒煙，再延遲爆炸，也可能只有損毀而沒有爆炸。爆炸會再推動已有殘骸，箭體火光與煙霧跟隨機身或殘骸位置。

森林發射會先讓附近樹木受熱起火，局部火焰的距離與高度才決定箭體受熱量，不能用整片森林的起火數量直接加熱高空火箭。箭體需要累積熱量，起火門檻與脆弱程度由 seed 決定，因此同一地點可能安全飛離，也可能在升空途中起火。離開熱源、氣流冷卻與關閉引擎能讓火勢減弱或熄滅；嚴重內部燃燒仍可能在離開森林後持續升溫、損傷並造成空中爆炸。這些是遊戲機率與熱量狀態，不代表每次森林發射必定爆炸。

若事故發生時正在第一視角，鏡頭自動改為第三視角追看箭體與殘骸，並檢查事故與鏡頭之間的城市碰撞幾何，平順選擇避開鄰樓的觀察方向。地基垮塌、自由下墜及撞擊／爆炸後前 5 秒只顯示小型原因與時間軸，重建、新火箭、修復城市、回城按鈕及大面板暫不顯示；仍可拖曳觀察，Esc 可提前回城。提示位於底部至少 96 px 的安全區，加上小型淡背景，避免與城市底欄重疊。5 秒從實際撞擊開始；若之後又爆炸，則改由最後一次爆炸重新起算。滿 5 秒後，操作面板以 680 ms 淡入；減少動態效果設定下直接顯示。計時取自物理 snapshot，沒有用 `setTimeout` 凍住事故；手機收起 HUD、精簡模式與已展開 options 使用相同規則。

飛行中只有箭體起火、尚未損毀時，仍保留自動／手動、推力與中止操控，另外顯示箭體起火與溫度提示。單純引擎中止與水面下沉沿用原有操作流程，不會被當成已發生爆炸。英文與繁中皆使用明確事故原因，不直接顯示內部英文 `failureReason`。

[新增 13 項事故驗收與原始報告](rocket-launch-game/runtime-acceptance.md)記錄了實際屋頂在模擬 elapsed **t≈8.0667 秒開始垮塌 → 10.6333 秒撞擊並拆成六節 → 11.3167 秒延遲爆炸**。最後爆炸後 4.8 秒沒有操作面板，5.15 秒面板已出現並完成淡入檢查。森林案例在 t≈9.950 秒箭體起火，t≈13.7167 秒於發射點上方 20.395 m 發生空中爆炸；同一森林另一次 seed 0、一般 Auto 發射安全抵達 100,009.159 m。這裡 elapsed 包含搭建與倒數，不是舊兩級驗收從離地開始計算的飛行時間。

驗收由 [rocket-accident-acceptance.mjs](../tools/rocket-accident-acceptance.mjs)在 Chrome／Metal 執行實際控制器 `update(1/60)`，不指定熱量、起火、碰撞或成功結果。森林案例先使用正常手動推力指令近地停留受熱，再切 Auto 升空；這是操控輸入，不是注入熱量。此次新增 13／13 項通過，0 未捕捉 JavaScript 錯誤，2 筆 HTTP 404 另外保留；[事故 JSON](rocket-launch-game/accident-runtime-report.json)與六張[實際事故畫面](rocket-launch-game/README.md)獨立保存。

最後一次事故 runtime 於 21:34:02 UTC 完成，追蹤的 `httpFailures` 為空。新增的兩項檢查確認事故鏡頭視線未受城市建築遮擋，以及修復城市不重播事故：修復後 `damaged=0`、`restoredRoof=null`、`supportColliders=0`、`shockAge≈99.25`，事故時間仍持續前進。淡入的實測 opacity 為 0.119376 → 1。

[UI 元件 14 項測試](../tests/rocket-controls.test.mjs)涵蓋 4.999 秒無按鈕、5 秒出現、後續爆炸重新計時、手機隱藏 HUD／minimal／options，以及英文／繁中事故原因。空中火災時間軸顯示「箭體起火 → 箭體起火／爆炸」，不假設上升中的火箭先下墜。這些是元件 render／callback 驗證，與 13 項實際城市 runtime 分開；森林熄火由[熱狀態測試](../tests/rocket-state.test.mjs)涵蓋，本次 runtime 保留的是起火爆炸與安全升空案例。另有[鄰樓遮擋追蹤測試](../tests/rocket-controller.test.mjs)，驗證事故鏡頭找到清楚視線並保留同一任務。

## 太空美術與尺度

`RocketSpace` 的地球半徑使用 6,371 km；顯示單位縮為每單位 100 km。相機維持發射點附近，地球隨高度向下移動，避免地圖投影或高空大座標污染局部火箭精度。地球、雲層與月亮共用同一個陽光方向，日夜球面和終止線保持一致；大氣層是薄球殼，天空在 15–90 km 之間平滑轉暗，星點則逐漸浮現。

太陽和月亮保持約半度視直徑。其他行星使用遠處小亮點，而非靠近鏡頭的巨大裝飾球。此場景展示合理的尺度關係，沒有即時星曆，不聲稱天體方位與遊戲日期精確對應。來源：[NASA Basics of Space Flight, Chapter 1](https://science.nasa.gov/learn/basics-of-space-flight/chapter1-1/)、[Moon Facts](https://science.nasa.gov/moon/facts/)、[Earth Facts](https://science.nasa.gov/earth/facts/)。

海陸使用本專案手寫的粗略海岸輪廓和程序噪聲，供高空背景辨識地球；不是精密地理資料，不可用作導航。雲與月面紋理同樣由程序產生。

## 效能與整合

- 放置後播放基座、箭體、整流罩依序搭建的低面數動畫，同時載入飛行、粒子、音效和太空模組；資源 ready 與建造完成都滿足才能點火。
- 單枚活躍火箭；只查詢發射點附近物件，限制碎片和粒子數量，使用物件池與 instancing。
- 升到高空後停止城市破壞查詢，淡出地圖細節，再由獨立太空場景接手。
- `RocketSpace` 不持有 renderer，不建造火箭，不註冊事件，不執行網路請求；只提供 `scene`、`camera`、`update` 和冪等 `dispose`。
- `update` 的高度參數是公尺；lookYaw、lookPitch 是以弧度表示的視角偏移。第三人稱預設位於局部火箭後方 90 m、上方 20 m，第一人稱相機位於局部原點。
- 在此 scene 加入火箭時，使用 `ROCKET_SPACE_METERS_TO_UNITS` 縮放模型；不要再套 map 的 Mercator scale。太空視角控制由呼叫端提供 lookYaw／lookPitch。
- `dispose` 僅釋放太空環境自有的 geometry/material/texture，不處理整合端另外加入 scene 的火箭等資源。呼叫端保留這些外部物件的所有權。
- 每幀呼叫 `update` 後，整合端可以覆寫 `camera.position`、`camera.quaternion` 並呼叫 `camera.updateMatrixWorld()`，以第一人稱視角對齊實際飛行姿態。

## 類似遊戲的參考方向

KSP 的官方資料把組裝、氣動與軌道物理直接連結到飛行結果；本次借用可讀的姿態與物理回饋，不必加入完整零件編輯器。Spaceflight Simulator 的開發者資料強調容易開始、透過嘗試掌握不同火箭行為，適合本遊戲以少量清楚控制建立重玩性。來源：[Kerbal Space Program 官方商店頁](https://store.steampowered.com/app/220200/Kerbal_Space_Program/)、[Spaceflight Simulator 官方商店頁](https://store.steampowered.com/app/1718870/Spaceflight_Simulator/)。

## 驗收情境

新版四助推器驗收把城市固定步進、獨立模型展示與元件測試分開記錄，最後結果彙整在 [Titan 四助推器修訂](rocket-launch-game/TITAN_FOUR_BOOSTERS.md)。城市案例使用原控制器的 `update(1/60)`，沒有指定 phase、高度、熱量或成功結果；模型展示正規化顯示高度，只驗證外形與入鏡。兩者都不是自然牆鐘時間或即時手機 FPS 基準。

先前三型首次驗收另有 17 項 UI render／callback 測試與[英文／繁中共 10 組隔離 DOM 版面觀察](rocket-launch-game/three-choice-layout-report.json)，覆蓋 1440 × 900、615 × 669、390 × 844、844 × 390、320 × 568，最小尺寸捲動後取消與 Titan 按鈕仍可點。這 10 組不包含在當時 2,001 項 npm 測試內；17 項 UI 單元測試已包含其中，不重複加總。舊報告保留原樣，不當作新版控制流程的重跑。

## CPU fixture 的跨平台數值穩定性

完整回歸揭露既有 material-consumer CPU fixture 在目前 Node 24／macOS 的一個數值差異：`interiors.0.polys.0.36.1` 實際值 `-12.13106480597334`，已記錄值 `-12.131064805973342`，差約 `1.8e-15` 公尺。修補前以 `git diff --exit-code bb26294 -- …` 核對 validator 的全部 16 個 `sourceHashes` 消費來源，連同 `geo.ts`、套件及鎖定檔、validator、harness 與 fixture，共 22 個路徑，結果為空差異。這個基線差異沒有來自火箭幾何或城市破壞改動。

因此只在這個 validator 的 JSON fixture 比較加入 `1e-12` 公尺的有限數值絕對容差，以涵蓋不同 V8／平台的三角函數末位差異；來源雜湊、三角形雜湊、字串、欄位及陣列結構仍嚴格比較，其他測試不受影響，既有 fixture 未重新錄製。`material-fixture-equality.test.mjs` 驗證微小數值噪聲可通過，來源／幾何雜湊改動、`1e-6` 公尺漂移、計數改動、缺漏／新增欄位、陣列改動及非有限值都會被拒絕。

## 模型參考與本次實作

三款均為原創程序 mesh，沒有複製商標、圖像、CAD 或第三方模型。Atlas 的橙色核心與雙側助推器借用 [NASA SLS core stage](https://www.nasa.gov/reference/sls-space-launch-system-core-stage/)及[雙固體助推器](https://www.nasa.gov/reference/sls-space-launch-system-solid-rocket-booster/)的可辨認造型語彙；Titan 的鋼色箭體、深色隔熱面與大翼片參考 [SpaceX Starship 官方設計頁](https://www.spacex.com/vehicles/starship/design)。Scout、Atlas、Titan 是虛構遊戲載具；尺寸、翼片、引擎數與分級配置都是本專案設計，不是真實火箭藍圖，也不宣稱與現行實物一一對應。

實作分工：

1. `rocket-state.ts`：純函式固定步進，seeded 風、推力、燃料、姿態、支撐損傷與任務狀態；Auto 只輸出控制量，不把火箭放到預錄路線。
2. `rocket-controller.ts`：地圖拾取、屋頂／水面／斜坡判讀、建造、非同步模組載入、輸入、鏡頭、城市 swept collision、任務生命週期。
3. `assets/rocket.ts`／`rocket-design.ts`：三型原創箭體、翼片／側助推器／隔熱面、建造架、噴焰、近地光源與第一人稱觀察艙；附屬部件跟隨節段分級及破裂。
4. `rocket-effects.ts`：Scout／Atlas 保留 48 組建築部件、28 棵受熱樹木、48 個拋飛物件、64 枚碎片與 160／420 粒子上限。Titan 單獨使用 96／56／96／96 物件預算；粒子依 compatible／balanced／high・ultra 為 240／360／600。修改 GPU buffer 僅上傳受損頂點範圍；可移動物件的 instance matrix 只在繪製期間替換並以 finally 還原。
5. `rocket-space.ts`：15 km 後以 floating origin 場景呈現地球、大氣與天體，保留同一枚箭體與實際姿態；CPU 城市細節準備在此場景停止。
6. `rocket-controls.tsx`：英文與繁中介面（其他語言英語 fallback）、桌面與觸控、任務完成與回城。火箭資源載入失敗有明確重試與退出，不會開放發射。

### 操作與遊戲尺度

W/S 俯仰、A/D 側向傾斜、R/F 推力、Space 倒數發射、C 第一／第三視角、M 自動／手動、X 引擎中止、Esc 返回城市。拖曳場景轉動視角，滾輪調第三視角距離。手機使用搖桿與獨立推力控制，介面保留自動、視角與中止按鈕。音效是點擊發射後啟動的合成低頻噪聲，可關閉。

火箭高度為 Scout 18 m、Atlas 48 m、Titan 110 m。Scout／Atlas 在先前安全地面驗收約 66 秒到達 100 km；Titan 新版四助推器為 69.517 模擬飛行秒，舊版兩級約 65.2 秒的紀錄留在舊報告。建造保留載入緩衝：Scout 6 秒、Atlas 10 秒、Titan 16 秒，倒數均為 5 秒；點火分別為 0.8／1.2／2 秒。太空與其他飛行資源從放置後背景載入，建造計時結束仍須等待資源 ready 才能發射，不因時間已滿而略過載入。Scout／Atlas 保留兩級燃料與分離；Titan 分開記錄外掛、核心、上面級的燃料與乾重，先釋放四枚外掛，再分離核心。這是可玩的簡化上升模擬：不計算完整六自由度剛體、真實結構工程、CFD、軌道速度或重返地球。周邊破壞是局部遊戲效果，不能預測真實建築損害。地形與既有城市資料本身也有近似；地球海陸為粗略程序輪廓，天體不是即時星曆。

## 首輪版本驗證（13:26 PDT）

確認時間：2026-10-22 13:26 PDT（America/Vancouver）。以複合建築各 polygon part 破壞中心修復後的最終凍結版本，使用 Node.js 24.22.1 執行 `npm run check` 及 `npm run build:firebase`，兩者已於 13:24 PDT 確認以 exit 0 完成。Firebase 構建包含既有資產隔離、runtime adoption 與 CSP 驗證；此次僅構建，沒有部署。

完整自動回歸通過 1920／1920 項，0 失敗、0 跳過、0 取消，耗時 196.29 秒，包含最後複合建築破壞中心與屋頂立即撞毀後實際坍塌的新增回歸。全套測試產生的兩份無關 QA JSON 已還原，不納入火箭改動。

最後客戶端產物的模組分割如下；兩檔分別由控制器 chunk `CqYRUkQ7.js` 動態匯入，沒有直接放入 `index.html` 的初始載入引用。

| 模組         | 客戶端 chunk  | 原始 bytes | gzip bytes |
| ------------ | ------------- | ---------: | ---------: |
| 太空環境     | `DL6gbF3V.js` |     16,160 |      5,423 |
| 火箭局部效果 | `jxbGyIpd.js` |     14,441 |      5,161 |

兩個檔案均位於 `dist/client/_next/static/chunks/`；chunk 名稱取決於此次構建，後續修改會改變雜湊。

## 首輪驗收紀錄（2026-10-22）

開發分支：`codex/rocket-launch-game`。沒有合併 main，也沒有執行 Firebase deploy。

- **完整回歸：1920 / 1920 通過**，0 fail / skipped / cancelled；196.29 秒。涵蓋既有步行、駕車、飛行、Tesla、SkyTrain、離線資產保護與新功能測試。
- **火箭專屬 25 項行為測試**：兩種尺寸逐步到 100 km、多 seed 與風、屋頂承載、海河沉沒、湖床失效、手動失控／自動恢復、引擎中止與碰撞、載入失敗／過期 promise、回城資源回收、完整機身掃掠、雙指放置／縮放、HUD 後鍵盤控制、局部 buffer 上傳、原生 instance 所有權還原、64 碎片上限與近樹優先。
- **真實時間 WebGL 任務**：在本機 Chrome / IAB 的 compatible renderer，從史丹利公園點選大型火箭放置、建造、倒數，以自動模式自然飛到 100 km，實際出現 Mission complete；可留在太空、切第一／第三視角，再返回原本溫哥華鏡頭。這趟未透過設定高度或成功狀態跳過飛行。
- **桌面／響應式互動**：1440 px、390 px portrait、844 px landscape；選大小、取消、Esc、manual/auto、第一視角、靜音、回城、原生多指不誤放置、倒數精簡控制、HUD 隱藏後仍可中止、任務完成與太空觀察。原生同時觸控已驗證左搖桿保持輸入時可獨立拖動右推力，放開回到中立。
- **顯示與可讀性**：手機建造／準備只顯示短卡，保留箭體視野；手動模式顯示有正負方向的 pitch / roll 與爬升速度。第一視角可轉頭看向地球，第三視角保持穩定地平線。
- **載入邊界**：太空與噴流模組是獨立動態 import chunk，初始 HTML 不直接載入／preload；只在火箭放置後準備。正式靜態建置含資產隔離、adoption、locale 與 CSP 驗證。

這些是桌面 WebGL、手機尺寸與合成觸控驗收，不等同於實體 iPhone／Android 的 FPS、電池或熱限制基準。城市物件損傷是本次任務內可復原的視覺模擬；回城會重置破壞，避免地圖其他載具使用尚未重新求解的建築碰撞資料。大型建築、街景 LOD 和行人／車輛並未改造成完整物理剛體城市。

複合建築的破壞範圍採各 polygon part 自己的中心，而不沿用同 buildingId 的第一個 part。專屬回歸測試以相隔 1 km 的兩個 part 驗證：支撐已崩塌且當幀立即撞毀時，實際發射屋頂仍會壓垮並拋出碎片，遠處 part 保持原狀，重置後精確還原。

[執行畫面與手機驗收](rocket-launch-game/README.md)。

## 先前已驗收修訂：鏡頭、節奏、分級與太空觀察

第三視角原本對移動中的世界座標做指數平滑，高速飛行時會產生約「速度／平滑係數」的落後距離；不同 render delta 又改變追趕量，造成視距與物體大小跳動。現改成以火箭為參考座標，平移同步，只平滑玩家 orbit offset、縮放與分離後的構圖。第三視角移除人工震動，第一視角僅保留低幅度的近地點火震動。

第一級在燃料完全耗盡後關機並分離，分離 snapshot 保存同一 tick 的真實位置、姿態與速度，扣除一級乾重後，上面級經過 0.6 秒間隔與 0.4 秒點火爬升繼續飛行。下級 mesh 保留分離瞬間的動量，另有小幅推出速度、重力與繞自身中心的翻轉；顯示 22 秒後回收視覺預算。火箭的虛擬 base 不瞬移，上面級噴嘴則移到正確的幾何位置。這是傳統關機後分級的簡化，而非 Starship hot-staging。現象參考：[NASA Space Launch System](https://www.nasa.gov/space-launch-system-sls/)、[NASA Rocket Staging](https://www.nasa.gov/wp-content/uploads/2010/11/492443main_LN_Rocket_Staging_Ed.pdf?emrc=63b2db)。

越過 100 km 後引擎關閉，保留速度並平順進入觀察滑行，不再瞬間凍結箭體位置。完成介面收成不遮擋視野的小卡，提供地球／太陽／月亮／火箭四個觀察焦點；天體保持約半度的盤面，觀察時移動相機方向並縮小 FOV，讓使用者能找到並看清，而不是放大天體本身。日月觀察會暫隱近處箭體，避免望遠鏡視角被鼻尖或箭身擋住；切回火箭便恢復同一枚載具。自由拖曳解除焦點，第一／第三視角和回城持續可用。

地球、雲層和薄大氣改由解析 ray–sphere 背景 pass 呈現，輪廓用 shader derivatives 抗鋸齒；避免近地平線放大球殼多邊形邊緣。背景在實際繪製前取得最後相機 pose 與 inverse projection，因此相機焦點切換不會讓球面位置落後。鏡頭與深度精度參考：[Three.js cameras](https://threejs.org/manual/pages/cameras.html)。

太陽在預設桌面第三視角會出現在工具列下方，不再藏在模式列後；月球保留可讀的日照相位，以觀察按鈕導覽。箭體以柔和地球反射光、環境補光與相機側形狀光保持銀白材質可讀性；新增的 Three lights 不改變地球／月球 shader 的天體日照。解析背景預設約 724 triangles／4 draw calls；加入真實上面級後的美術驗收為 3,596 triangles／15 calls，屬獨立場景測量，並非完整城市 FPS 基準。

該次完整回歸 **1,944／1,944 通過**（0 fail／skipped／cancelled，140.75 秒），TypeScript 與 Firebase 正式靜態建置均 exit 0，沒有部署。新增行為驗證涵蓋不規則幀率下的固定第三視角視距、分離後構圖平滑、分離瞬間無位移跳躍、乾重／燃料守恆、上面級碰撞排除已脫離助推器、引擎中止、任務完成後持續滑行，以及新太空觀察 UI callbacks。

該次最終 Chrome／Metal [21 項整合驗收](rocket-launch-game/runtime-acceptance.md)全數通過，無未捕捉 JavaScript 錯誤：大型與小型火箭均約 65.63 秒飛行至 100 km，分離與上級點火有實際事件、燃料與質量狀態，日月焦點經真實按鈕置中。另於 IAB 的一般圖形模式從史丹利公園實際點選地面、建造、倒數，自然飛至任務完成，並確認第一／第三視角切換；未透過設定高度或成功狀態跳過飛行。手機響應式測試確認本級燃料、級間分離提示、日月觀察與任務結果展開正常。原生手機效能仍需實機量測。

最後追加小視窗完成卡安全區：700 px 以下直向視窗把觀察卡移到下方，避免蓋住中央箭體；展開詳細資料保留內部捲動。615 × 669 的自然時間任務畫面已確認鼻尖與箭身完整可見，修改後正式靜態建置再度 exit 0。
