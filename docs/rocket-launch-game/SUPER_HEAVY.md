# Titan／泰坦超大型火箭與三型造型

`RocketKind: 'super-heavy'` 顯示為 Titan／泰坦・超大型火箭。本輪更新明亮銀色箭體、黑色隔熱面與銀框翼片，加入四枚與核心同時點火、先於核心分離的外掛助推器；完整包絡半徑改為 14.1 m，近地效果強度改為 2.2。[新版城市驗收 18／18](titan-four-runtime-report.json)、[模型展示 4／4](titan-four-model-report.json)與[完整回歸 2,016／2,016](titan-four-test-summary.json)通過；完整套件包含 121 項火箭測試及其中 19 項 UI 測試，TypeScript 和 `build:firebase` 通過。Titan 在 69.517 模擬飛行秒達到 100,037.411 m，流程、圖片及原始數值見 [Titan 四助推器修訂](TITAN_FOUR_BOOSTERS.md)。

先前三型首次加入時的完整回歸 **2,001／2,001 通過**，包含 106 項火箭測試及其中 17 項 UI 測試；當時 TypeScript 與 `build:firebase` 通過。[舊版完整測試摘要](titan-test-summary.json)、[舊版城市 runtime](titan-runtime-report.json)與[舊版模型 gallery](model-gallery-report.json)獨立保留。下方 65.167 秒及 0／14／89 的結果屬於尚無四枚外掛的首版，沒有改寫為新版驗收。先前的 [21 項環境報告](runtime-report.json)、[13 項事故報告](accident-runtime-report.json)及 1,982 項完整回歸也保持原樣。

## 三款是不同外形

| 機型  | 程序幾何與材料                                                   | 主引擎              |  高度 |
| ----- | ---------------------------------------------------------------- | ------------------- | ----: |
| Scout | 細長機身、4 片後掠尾翼                                           | 1                   |  18 m |
| Atlas | 橙色核心、白色整流罩、2 枚白色側助推器                           | 7，側助推器另有噴嘴 |  48 m |
| Titan | 明亮銀色鼻錐、黑色隔熱面、4 枚外掛助推器、4 片控制翼、4 片格柵翼 | 19，外掛另有噴嘴    | 110 m |

模型由 [addRocketDesign](../../lib/city/assets/rocket-design.ts)加入不同造型，並由 [rocket.ts](../../lib/city/assets/rocket.ts)整合材質、噴嘴與搭建。附屬部件掛在各自的節段，會跟著建造、外掛釋放、核心分離與真正箭體殘骸移動；不以貼在世界座標上的裝飾代替。格柵翼的多條格線合併為 mesh，保留輪廓而不逐格增加 draw call。選擇卡的三種 SVG 剪影也使用不同輪廓，Titan 的四枚外掛在中英選項中明確標示。

Atlas 的橙色核心與雙側助推器借用 [NASA SLS core stage](https://www.nasa.gov/reference/sls-space-launch-system-core-stage/)及 [SLS solid rocket booster](https://www.nasa.gov/reference/sls-space-launch-system-solid-rocket-booster/)的造型語彙。Titan 的鋼色箭體、深色隔熱面與翼片參考 [SpaceX Starship 官方設計頁](https://www.spacex.com/vehicles/starship/design)。這些是視覺參考：本專案的 4 片格柵翼、19 個主引擎、尺寸與分級方式都是原創遊戲配置，並不對應任何現行實物藍圖，沒有複製商標、CAD、照片或第三方模型。

## 尺度、地基與時間

參數來源為 [ROCKET_CONFIGS](../../lib/city/rocket-state.ts)。

| 參數               | Titan 設定 | 用途                               |
| ------------------ | ---------: | ---------------------------------- |
| 高度               |      110 m | 載具尺寸與鏡頭構圖                 |
| 箭體參考半徑       |      6.3 m | 機身／氣動參考，與附屬部件包絡分開 |
| 完整碰撞包絡半徑   |     14.1 m | 包含四枚外掛、控制翼與格柵翼       |
| 上面級碰撞包絡半徑 |     10.1 m | 分離後只掃掠仍相連的上面級部件     |
| 風壓影響半徑       |      220 m | 局部壓力與周邊物件候選範圍         |
| 熱影響半徑         |      105 m | 局部受熱與森林互動範圍             |
| 近地效果強度       |        2.2 | 加強反應強度，不再將上述半徑乘大   |
| 建造               |       16 s | 放置後的搭建與背景載入窗口         |
| 倒數               |        5 s | 與 Scout／Atlas 相同               |
| 點火爬升           |        2 s | 第一次升空前的點火過程             |

碰撞外廓與機身參考半徑各自使用，不能把裸箭體尺寸當成包含翼片、側助推器或上面級接環的外廓：

| 機型  | 完整載具包絡半徑 | 分級後上面級包絡半徑 |
| ----- | ---------------: | -------------------: |
| Scout |           2.22 m |               1.15 m |
| Atlas |            9.8 m |                4.9 m |
| Titan |           14.1 m |               10.1 m |

Scout／Atlas 保留建造 6／10 秒與倒數 5 秒。建造時間結束仍須等飛行、太空和效果資源 ready，不能因為計時已滿便跳過載入。Scout／Atlas 保留原兩級燃料與分離；Titan 分開記錄外掛、核心與上面級燃料，先釋放四枚外掛，再進行核心分離與上面級點火。三型共享手動／自動、第一／第三視角和 100 km 太空任務。

Titan 先前尚無四枚外掛的版本，在城市 Auto 情境以 **65.167 模擬飛行秒**達到 **100,030.692 m**，仍有約 3.73% 總燃料。這份舊版兩級時間保留於 [titan-runtime-report.json](titan-runtime-report.json)，新版四助推器另記錄燃料、事件順序與飛行時間。離地後固定步進時間不包含 16 秒建造、5 秒倒數與點火，也不是實機 FPS、自然牆鐘時間或入軌證據。

較大的載荷與噴流需要更寬廣、堅固的地面或平台。一般屋頂、湖床和弱地基可能垮塌；海洋和河流仍會下沉。220 m 並非必然全毀的圓圈，周邊反應依噴流方向、距離、離地高度、可見城市物件與預算上限計算。事故仍遵守支撐下沉、自由下墜、撞擊、箭體破裂與可能延遲爆炸的流程；操作選項由最後一次實際爆炸後重新計滿 5 秒才淡入，不另縮短 Titan 的觀察窗口。

## 局部效果預算

預算由 [rocket-effects.ts](../../lib/city/rocket-effects.ts)按機型選擇。下表是處理／池容量上限，並不代表每次都會損毀這些數量，也不是保證的幀率。

| 局部資源                 | Scout／Atlas，各自 | Titan |
| ------------------------ | -----------------: | ----: |
| 建築部件                 |                 48 |    96 |
| 受熱樹木                 |                 28 |    56 |
| 拋飛物件                 |                 48 |    96 |
| 建築碎片                 |                 64 |    96 |
| compatible renderer 粒子 |                160 |   240 |
| balanced 粒子            |                160 |   360 |
| high／ultra 粒子         |                420 |   600 |

compatible renderer 的粒子限制優先於品質選單。Titan 擴大局部容量，Scout／Atlas 原有 48／28／48／64 與 160／420 設定保持不變。建築只更新受影響的頂點範圍，碎片與粒子使用可回收池；一般城市 instance 的暫時變換在繪製後還原。抬升後的噴流影響隨高度減少，不把地面 220 m 作用圈一路帶到太空。

四外掛與核心近地同時噴射時，最多用 40 條平面火焰帶呈現五個接地點、每點八個方向，維持一個 instanced mesh 與一次 draw call；約三分之二的近地排氣粒子改為向外塵霧，沿用上述粒子池。火焰落點重採樣當地地形，屋頂發射才另外取對應變形支撐屋頂的高度。核心／外掛直接火焰分別在約 77／55 m 的遊戲可達距離內淡出，熄火或回城會清除。此局部視覺模型不等同噴流 CFD。

## 先前 Titan 首版的驗收結果與方法

[先前城市驗收 12／12 項檢查](titan-runtime-report.json)使用 Chrome／Metal、實際城市、production 控制器／模型／效果。該版本尚未加入 Titan 四枚外掛與本輪地面火焰帶。測試暫停自動更新後呼叫原本的 `update(1/60)`，在步進之間繪製畫面；沒有指定 phase、高度、heat、損壞計數或成功結果。三款依序使用同一個量測過的開闊地面位置 `(x=300, z=-25)` 與真實 ground support，沒有用測試平台抬高承載力。

以下是該舊版各自離地後約 5 秒（實際取樣 5.017 秒）的觀察：

| 機型  | 受損建築部件 | 最遠受損部件中心距離 | 起火樹木 |
| ----- | -----------: | -------------------: | -------: |
| Scout |            0 |                  0 m |        5 |
| Atlas |           14 |               73.5 m |       15 |
| Titan |           89 |              179.5 m |       56 |

這組數值展示同地點、同一飛行階段的差異，不保證每次都有相同數量。Titan 的受熱樹木最遠約 93.3 m，與較遠的建築風壓反應分開記錄；配置半徑不是固定全毀範圍。

Titan 當次處理 96 個建築部件、56 棵樹，粒子池為 240 槽；實際拋飛物件 36 個、建築碎片 96 塊，均在各自上限內。HUD 的 `debris=132` 合計拋飛物件與建築碎片，並不表示 96 個建築碎片槽超限。每型返回城市後，建築 position／color buffer 的原始位元 hash 都是 **3116572666**，與發射前基線一致；火箭 inactive、模式回到 orbit。報告的未捕捉頁面錯誤為 0，原始資源 console 記錄另行保留。

[模型 gallery 的 4 項檢查](model-gallery-report.json)以 production `createRocketModel(kind)`、`build(1)`、`stage(createRocket(kind))` 產生完整模型。展示時把高度正規化為 100 顯示單位來比較架構，仍明確標示真實設定 18／48／110 m；它證明不同外形、完整模型入鏡及 1／7／19 個主引擎，並不是自然飛行或真實尺寸並排照片。Titan 的四片格柵翼合併在同一格柵 mesh。

另外以 production React SSR 與實際 CSS 檢查英文／繁中 × 1440 × 900、615 × 669、390 × 844、844 × 390、320 × 568，共 [**10 組隔離 DOM 版面觀察**](three-choice-layout-report.json)。沒有水平溢出；320 × 568 的內容確實捲動，取消按鈕留在固定 header，Titan 卡仍可點。這 10 組 browser 觀察獨立於 npm 測試數量，不加進 2,001；17 項 UI 單元測試已包含在該總數。

重跑城市案例使用 [rocket-super-heavy-acceptance.mjs](../../tools/rocket-super-heavy-acceptance.mjs)，模型比較使用 [rocket-model-gallery.mjs](../../tools/rocket-model-gallery.mjs)。兩者方法與 raw report 分開，前者是固定步進的實際遊戲模擬，後者是模型 fixture；都不推算即時手機 FPS、建築工程損壞或真實軌道力學。

[三款不同外形](evidence/rocket-three-designs.png) · [三卡選單](evidence/rocket-three-chooser.png) · [Titan 近地點火](evidence/titan-super-heavy-ignition.png) · [Titan 級間分離](evidence/titan-stage-separation.png) · [Titan 任務完成](evidence/titan-mission-complete.png)

資源記錄補充：原始城市報告有兩筆未附 URL 的 HTTP 404 console 訊息。[獨立資源追查](titan-resource-investigation.json)只重現 `favicon.ico` 404，dummy 與實際地點載入時沒有其他失敗資源或頁面錯誤；原始兩筆沒有足夠資料可逐筆歸因。

返回 [畫面與驗收總覽](README.md)或[完整遊戲規格](../ROCKET_LAUNCH_GAME.md)。
