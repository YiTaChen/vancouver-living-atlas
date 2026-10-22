# Vancouver Living Atlas：火箭遊戲設計與資料來源

研究日期：2026-10-22。以下以 NASA、ESA 與遊戲開發者提供的資料為參考；參考現象與本遊戲規則分開，所有海陸、月面和星空素材均由程式產生，沒有下載或重製外部圖片。

## 任務定義與遊戲循環

完整循環為「選大／小火箭 → 任意地點放置 → 建造與背景載入 → 發射前地基評估 → 點火 → 自動或手動升空 → 抵達太空 → 繼續觀看／返回溫哥華」。成功條件使用越過 100 km 並維持結構完整，文字稱為抵達太空，不稱為入軌。這個版本不包含返回地球。

NASA 說明大氣會逐漸變薄，沒有硬性的物理邊界；100 km 是常用界線。因此畫面應隨高度逐漸變黑，不能跨過門檻便突然更換天空。來源：[The Atmosphere: Earth's Security Blanket](https://science.nasa.gov/earth/earth-atmosphere/the-atmosphere-earths-security-blanket/?category=applied_science)、[Where Does Space Begin?](https://www.nasa.gov/general/where-does-space-begin-we-asked-a-nasa-scientist-episode-43/)。

## 飛行與控制

使用固定步進更新位置、速度、姿態角（渲染時轉為四元數）、角速度、燃料與完整度。推力沿機身軸、重力向下、阻力使用扣除風速後的相對空氣速度。風場使用 seeded 平滑陣風，搭配有限的穩定恢復力矩與角速度阻尼。自動駕駛僅輸出操控命令，與手動模式共用模擬；不應忽略地基失效或沿固定動畫路徑移動。

小火箭設定較低慣量、較快操控反應和較大風擾動；大火箭設定較強主動穩定、較慢轉向，但更大的基座負擔與噴焰影響。大型較穩是遊戲機型的整體設定，尺寸本身不保證穩定。NASA 指出陣風可使火箭擺動，現代全尺寸火箭通常透過主動控制穩定姿態。來源：[Rocket Stability Condition](https://www1.grc.nasa.gov/beginners-guide-to-aeronautics/conditions-for-rocket-stability/)。

阻力依密度、速度平方、迎風面積與阻力係數改變；遊戲可以把複雜形狀影響合併為少數係數。來源：[Drag Equation](https://www1.grc.nasa.gov/beginners-guide-to-aeronautics/drag-equation/)。

升空先垂直離地，再漸進傾轉，讓軌跡可見且不是直線。ESA 對 Ariane 的說明也描述垂直離地後逐步傾向東方。來源：[Launchers FAQ](https://www.esa.int/Enabling_Support/Space_Transportation/Launchers_FAQ_Frequently_Asked_Questions)。

## 地基與城市反應

海洋與河流下沉、湖泊地基不穩、屋頂依承載力與噴焰傷害坍塌，都是本遊戲的明確規則；不能把水體分類宣稱為現實承載能力的通則。保留任意放置的自由，同時提示發射風險。

以向下噴焰錐、地面衝擊區與熱量累積區取代 CFD。建築用正常／受損／坍塌狀態和替代 mesh；樹木彎折、倒下或燃燒；草地焦黑；椅子、車輛和行人使用有上限的拋體效果。屋頂被破壞後，支撐傾斜要傳回火箭姿態，形成真正的連鎖失敗。

NASA 的發射台具有導焰設施與水系統，處理點火時的高熱、振動與聲學環境。這支持周邊環境需要強烈反應的視覺方向；具體城市損壞門檻仍是遊戲調校，沒有宣稱工程精度。來源：[Launch Complex 39B](https://www.nasa.gov/reference/launch-complex-39b/)、[Pad 39B Water Flow Test Comes Through Loud and Clear](https://www.nasa.gov/centers-and-facilities/kennedy/pad-39b-water-flow-test-comes-through-loud-and-clear/)。

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

兩種火箭均能抵達太空；手動過度轉向可失控墜毀；海河沉沒與湖泊沉陷；大型火箭破壞小屋支撐並影響姿態；周邊熱量與衝擊效果可見；第一／第三視角不改變飛行狀態；自動與手動可中途切換；成功只觸發一次；返回城市恢復操作；取消、載入失敗與重置可回收所有資源。

## CPU fixture 的跨平台數值穩定性

完整回歸揭露既有 material-consumer CPU fixture 在目前 Node 24／macOS 的一個數值差異：`interiors.0.polys.0.36.1` 實際值 `-12.13106480597334`，已記錄值 `-12.131064805973342`，差約 `1.8e-15` 公尺。修補前以 `git diff --exit-code bb26294 -- …` 核對 validator 的全部 16 個 `sourceHashes` 消費來源，連同 `geo.ts`、套件及鎖定檔、validator、harness 與 fixture，共 22 個路徑，結果為空差異。這個基線差異沒有來自火箭幾何或城市破壞改動。

因此只在這個 validator 的 JSON fixture 比較加入 `1e-12` 公尺的有限數值絕對容差，以涵蓋不同 V8／平台的三角函數末位差異；來源雜湊、三角形雜湊、字串、欄位及陣列結構仍嚴格比較，其他測試不受影響，既有 fixture 未重新錄製。`material-fixture-equality.test.mjs` 驗證微小數值噪聲可通過，來源／幾何雜湊改動、`1e-6` 公尺漂移、計數改動、缺漏／新增欄位、陣列改動及非有限值都會被拒絕。

## 模型參考與本次實作

白色圓筒箭體、深色級間段、整流罩與多噴嘴引擎叢集以現代運載火箭的外觀語彙為參考，製作為原創程序 mesh，沒有複製商標、圖像、CAD 或第三方模型。參考：[SpaceX Falcon 9](https://www.spacex.com/vehicles/falcon-9/)、[NASA SLS core stage](https://www.nasa.gov/reference/sls-space-launch-system-core-stage/)。Scout 與 Atlas 是本遊戲的虛構研究載具，並非這些真實火箭的複製品。

實作分工：

1. `rocket-state.ts`：純函式固定步進，seeded 風、推力、燃料、姿態、支撐損傷與任務狀態；Auto 只輸出控制量，不把火箭放到預錄路線。
2. `rocket-controller.ts`：地圖拾取、屋頂／水面／斜坡判讀、建造、非同步模組載入、輸入、鏡頭、城市 swept collision、任務生命週期。
3. `assets/rocket.ts`：兩種尺寸的原創箭體、建造架、噴焰、近地光源與第一人稱觀察艙。
4. `rocket-effects.ts`：附近最多 48 組建築頂點範圍、64 枚碎片、48 個拋飛物件、28 棵受熱樹木，160／420 粒子上限。修改 GPU buffer 僅上傳受損頂點範圍；可移動物件的 instance matrix 只在繪製期間替換並以 finally 還原。
5. `rocket-space.ts`：15 km 後以 floating origin 場景呈現地球、大氣與天體，保留同一枚箭體與實際姿態；CPU 城市細節準備在此場景停止。
6. `rocket-controls.tsx`：英文與繁中介面（其他語言英語 fallback）、桌面與觸控、任務完成與回城。火箭資源載入失敗有明確重試與退出，不會開放發射。

### 操作與遊戲尺度

W/S 俯仰、A/D 側向傾斜、R/F 推力、Space 倒數發射、C 第一／第三視角、M 自動／手動、X 引擎中止、Esc 返回城市。拖曳場景轉動視角，滾輪調第三視角距離。手機使用搖桿與獨立推力控制，介面保留自動、視角與中止按鈕。音效是點擊發射後啟動的合成低頻噪聲，可關閉。

火箭尺寸為 Scout 18 m、Atlas 48 m；安全地面自動升空約 128 秒到達 100 km（另加 6／10 秒建造、5 秒倒數與點火）。這是可玩的簡化上升模擬：不計算多級分離、完整六自由度剛體、真實結構工程、CFD、軌道速度或重返地球。周邊破壞是局部遊戲效果，不能預測真實建築損害。地形與既有城市資料本身也有近似；地球海陸為粗略程序輪廓，天體不是即時星曆。

## 最後發佈驗證

確認時間：2026-10-22 13:26 PDT（America/Vancouver）。以複合建築各 polygon part 破壞中心修復後的最終凍結版本，使用 Node.js 24.22.1 執行 `npm run check` 及 `npm run build:firebase`，兩者已於 13:24 PDT 確認以 exit 0 完成。Firebase 構建包含既有資產隔離、runtime adoption 與 CSP 驗證；此次僅構建，沒有部署。

完整自動回歸通過 1920／1920 項，0 失敗、0 跳過、0 取消，耗時 196.29 秒，包含最後複合建築破壞中心與屋頂立即撞毀後實際坍塌的新增回歸。全套測試產生的兩份無關 QA JSON 已還原，不納入火箭改動。

最後客戶端產物的模組分割如下；兩檔分別由控制器 chunk `CqYRUkQ7.js` 動態匯入，沒有直接放入 `index.html` 的初始載入引用。

| 模組         | 客戶端 chunk  | 原始 bytes | gzip bytes |
| ------------ | ------------- | ---------: | ---------: |
| 太空環境     | `DL6gbF3V.js` |     16,160 |      5,423 |
| 火箭局部效果 | `jxbGyIpd.js` |     14,441 |      5,161 |

兩個檔案均位於 `dist/client/_next/static/chunks/`；chunk 名稱取決於此次構建，後續修改會改變雜湊。

## 驗收紀錄（2026-10-22）

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
