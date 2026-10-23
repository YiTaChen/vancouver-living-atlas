# Titan 四側助推器、核心持續推進與地面噴流

Titan 現在有四枚外掛助推器，與中央核心同時點火；外掛先燃盡、向外分離，核心保持推力，再由核心與上面級依序接手。箭體改為更明亮的銀色，黑色隔熱面與銀框控制翼在日間、黃昏和太空補光下更容易辨認。Scout／Atlas 的原有外形、建造和兩級流程保留。

本輪[城市固定步進驗收 18／18](titan-four-runtime-report.json)、[獨立模型展示 4／4](titan-four-model-report.json)與[完整回歸 2,016／2,016](titan-four-test-summary.json)通過。完整套件包含 **121 項火箭測試，其中含 19 項 UI 測試**，不另外加總；0 fail／cancelled／skipped，牆鐘約 116.88 秒。最終產品來源的 TypeScript、lint／格式檢查及 `build:firebase` 也通過，沒有部署。

先前的 [2,001 項測試摘要](titan-test-summary.json)、[12 項城市報告](titan-runtime-report.json)及[4 項模型報告](model-gallery-report.json)維持原始版本，沒有把舊版兩級 65.167 秒的結果當作新版四助推器時間。

## 點火、燃料與分離順序

| 階段               | HUD 與實際行為                                                                                                                   |
| ------------------ | -------------------------------------------------------------------------------------------------------------------------------- |
| `strap-on`         | 第一級「四側助推器＋核心」。四枚外掛和核心同時產生推力、同時消耗各自燃料；中央與四側共五股噴流可見。                             |
| `strap-separating` | 外掛燃盡並釋放，四枚保留分離時的姿態與動量，再向外散開。0.8 秒釋放動畫期間核心持續燃燒；HUD 顯示實際釋放進度與「核心持續推進」。 |
| `boost`            | 第二級「核心推進」。只剩核心與仍相連的上面級；核心顯示已消耗後的剩餘燃料，不重新填滿。                                           |
| `separating`       | 核心燃盡、釋放，留下上面級。保留原有 0.6 秒級間間隔，再開始上面級點火爬升。                                                      |
| `upper`            | 第三級「上面級」，使用自己的推力、燃料與乾重，繼續向 100 km 升空。                                                               |
| `coast`            | 越過任務高度後關閉引擎，保留速度並進入太空觀察；Earth／Sun／Moon／Rocket 焦點、第一／第三視角與回城仍可用。                      |

這裡的第一／二／三級是操作介面的流程名稱。四枚外掛和核心不是輪流點火；核心從最初就參與推進，側助推器釋放也不會令核心停機。自動和手動共用同一套燃料、質量與飛行狀態，分離時仍可操作推力、姿態、自動切換及引擎中止。事故仍保留最後一次爆炸後 5 秒觀察與 680 ms 淡入規則。

參數由 [rocket-state.ts](../../lib/city/rocket-state.ts)提供：

| 資源／尺寸               |                                    設定 |
| ------------------------ | --------------------------------------: |
| 高度／箭體參考半徑       |                            110 m／6.3 m |
| 完整載具／上面級包絡半徑 |                          14.1 m／10.1 m |
| 四枚外掛合計乾重／燃料   |                  140,000 kg／500,000 kg |
| 核心乾重／燃料           |                  205,000 kg／650,000 kg |
| 上面級乾重／燃料         |                  115,000 kg／276,000 kg |
| 初始合計推力             | 93 MN：核心 50 MN ＋ 四枚外掛合計 43 MN |
| 上面級推力               |                                 13.1 MN |
| 風壓／熱影響半徑         |                            220 m／105 m |
| 近地效果強度             |                                     2.2 |
| 建造／倒數／初始點火     |                          16 s／5 s／2 s |

新完整包絡 14.1 m 納入外掛助推器，比先前 11.5 m 更寬；需要足夠開闊、穩固的承載範圍。近地效果強度由先前 1.8 改為 2.2，風壓／熱半徑仍是 220／105 m，不再相乘放大。屋頂、湖床、弱地基及海河保留既有風險。

## 五股接地噴流與效果預算

[rocket-effects.ts](../../lib/city/rocket-effects.ts)把核心與四外掛的近地排氣投影到當地地形，傾斜時重新取樣落點高度；屋頂發射才另外取對應變形支撐屋頂的高度，地面發射仍沿用地形表面。每個接地點向八個方向攤開，最多 40 條火焰帶共用一個 instanced mesh、一個材質與一次 draw call。核心／外掛直接火焰的遊戲可達距離分別為 77／55 m，隨距離淡出；距離超出後不再把地面畫成持續燃燒的噴流，空中塵霧仍可逐漸飄散。

近地排氣約三分之二改為沿地面向外加速的塵霧，重用既有粒子池。Titan 仍限制為最多處理 96 個建築部件、56 棵樹、96 個拋飛物件和 96 塊建築碎片；compatible／balanced／high・ultra 的粒子池仍是 240／360／600 槽。這些是容量上限，不是每次受損數量，也不是保證幀率。地面火焰在熄火、超出距離、reset 或回城時清除；回城仍精確還原城市原始幾何。

這是可玩的局部視覺與受力近似，不是 CFD、真實建築工程評估或實際火箭藍圖。外形仍只借用 [NASA SLS](https://www.nasa.gov/reference/sls-space-launch-system-core-stage/)與 [SpaceX Starship](https://www.spacex.com/vehicles/starship/design)的可辨認語彙，四外掛、19 個中央主引擎、翼片與燃料配置是本專案的原創遊戲設計。

## 本輪城市實測

最終城市報告完成於 2026-10-22 17:04:07 PDT（溫哥華），18 項檢查全部通過。Titan 在 **69.517 模擬飛行秒**達到 **100,037.411 m**，剩餘總燃料約 **2.04%**。事件順序為初始點火與 `core-ignition` 同時發生，再依序記錄 `strap-on-burnout`、`strap-on-separation`、`core-only`、`booster-burnout`、`stage-separation`、`upper-ignition` 與 `mission-complete`。此飛行時間從離地計算，不含建造、倒數及初始點火，也不是程式的牆鐘時間。

離地 1.017 秒時，實際核心噴流可見、四股外掛噴流同時存在，共 40 條地面火焰帶；核心燃料已降至約 597,350 kg，外掛剩約 415,625 kg，確認兩者同時消耗。外掛釋放後 0.45 秒，核心噴流仍可見、仍有推力，核心燃料約 326,083 kg，沒有重置為滿量。釋放 0.45 秒圖保留轉換進度，另取 1.55 秒畫面讓四枚外掛向外散開更清楚。

三型依序從同一實測地面 `(x=300, z=-25)` 發射；以下取樣皆為離地 **5.017 秒**：

| 機型  | 受損建築部件 | 最遠受損部件中心距離 | 起火樹木 |
| ----- | -----------: | -------------------: | -------: |
| Scout |            0 |                  0 m |        5 |
| Atlas |           14 |               73.5 m |       15 |
| Titan |           91 |              179.5 m |       56 |

這是該位置與這次模擬的觀察，不保證每次損壞數量相同。Titan 此時高度約 **564.9 m**，直接地面火焰帶已為 **0**；壓力、既有塵霧與地面損傷不會因此倒轉消失。當次處理 96 個建築部件、56 棵樹，粒子池為 240 槽；實際拋飛物件 36 個、建築碎片 96 塊，均在各自上限內。HUD `debris=132` 是兩者合計，不是碎片池超額。

三型回城後建築 position／color buffer 的原始位元 hash 都為 **3116572666**，與基線一致；火箭 inactive、模式回到 orbit。頁面未捕捉錯誤為 0；原始報告另保留兩筆未附 URL 的 HTTP 404 console 訊息，`httpFailures` 為空，未將兩筆訊息直接歸因到特定資源。

## 驗收方法、UI 與本輪圖像

城市案例使用 [rocket-super-heavy-acceptance.mjs](../../tools/rocket-super-heavy-acceptance.mjs)在 Chrome／Metal 執行實際 production 控制器、模型與效果，暫停自動更新後呼叫原本的 `update(1/60)`，在步進之間繪製。它不指定 phase、高度、熱量、損壞計數或成功結果；三型使用同一量測過的開闊地面位置與自然 ground support。這是固定步進的生產 runtime，不是自然牆鐘時間、實機 FPS 或真實軌道力學驗證。

模型展示使用 [rocket-model-gallery.mjs](../../tools/rocket-model-gallery.mjs)呼叫 production 模型，把顯示高度正規化以比較外形，並另外標示 18／48／110 m 的實際設定。四項檢查通過，Titan 的模型含四枚外掛、四片控制翼、一個合併格柵 mesh 與 19 個核心主引擎。這是獨立模型 fixture，不取代城市飛行或手機效能驗收。

另外有 [12 組 HUD DOM 觀察](titan-four-hud-layout-report.json)：英文／繁中、390 × 844／615 × 669／844 × 390，以及自動／手動組合，stage 卡與 telemetry 沒有重疊。[10 組 chooser DOM 觀察](titan-four-chooser-layout-report.json)使用英文／繁中與 1440 × 900、615 × 669、390 × 844、844 × 390、320 × 568，三型卡片無水平溢出，取消與 Titan 按鈕可點，最小尺寸以內部捲動容納內容。這些是 production React render 與實際 CSS 的隔離 DOM 驗證，不含城市 WebGL，也不加進 npm 單元測試總數。

UI 元件測試另確認雙語 stage、真實分離進度、核心燃料不重置與原有操控 callbacks；effects 測試覆蓋五個接地點、有限粒子池、傾斜斜坡投影、實際支撐表面、熄火／高空淡出與重置。新增的城市高角度畫面只調整 orbit 相機以看清五股向外噴流，沒有更改飛行或效果狀態。

[新版三型模型](evidence/titan-four-models.png) · [四助推器選單](evidence/titan-four-chooser.png) · [日間點火](evidence/titan-four-super-heavy-ignition.png) · [高角度城市噴流](evidence/titan-four-ground-outwash.png) · [黃昏材質](evidence/titan-four-dusk-materials.png) · [外掛釋放過程](evidence/titan-four-booster-transition.png) · [外掛向外散開](evidence/titan-four-booster-release.png) · [後續核心分離](evidence/titan-four-core-release.png) · [上面級抵達太空](evidence/titan-four-mission-complete.png)

返回 [畫面總覽](README.md)、[Titan 規格與舊版紀錄](SUPER_HEAVY.md)或[完整遊戲規格](../ROCKET_LAUNCH_GAME.md)。
