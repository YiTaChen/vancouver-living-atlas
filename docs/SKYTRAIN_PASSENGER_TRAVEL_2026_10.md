# SkyTrain 七站搭乘整合與驗收（2026-10-22）

本次將既有離線車站與車廂資產接入城市，新增人物進站、站內行走、月台候車、開門上車、沿地理路線移動、停站下車、Waterfront 轉乘及返回街道的完整流程。原有「SkyTrain 車廂展示」仍為獨立展示，搭乘功能使用另一個入口與城市中的乘客控制器。

## 範圍與站點

| 路線 | 本區域的站序 |
| --- | --- |
| Expo Line | Waterfront → Burrard → Granville → Stadium–Chinatown → Main Street–Science World |
| Canada Line | Waterfront → Vancouver City Centre → Yaletown–Roundhouse |

七個選項均可作為起點或目的地，支援雙向行駛及途中停站。Vancouver City Centre 補足 Canada Line 的中間站；它與 Granville 是不同車站。跨線旅程一律在 Waterfront 轉乘，沒有新增 Granville 與 Vancouver City Centre 之間的站內付費區捷徑。Main Street–Science World 與 Yaletown–Roundhouse 是本地圖的涵蓋邊界，並非真實路線終點。

站序、車站辨識與官方來源整理於 [SkyTrain 車站參考資料](SKYTRAIN_STATION_REFERENCES_2026_10.md)。路線取自 repo 已封存的 TransLink GTFS 快照；車站位置同時保留既有 City of Vancouver 資料的來源身分。此功能使用離線遊戲班次，沒有連線查詢即時列車、票價或營運狀態。

## 使用方式

1. 點選「搭乘 SkyTrain」，展開起始車站入口與目的地選單。起始入口是明確的快速開始選項，可直接開始該站步行；它不表示車輛已經載人到站。
2. 按「從這個入口開始」。站體和搭乘列車載入後，人物位於車站大廳的可行走地面。
3. 靠近樓梯／電梯通行點，使用「前往月台」或互動鍵。目的地決定要使用的路線與方向；Waterfront 的 Expo 與 Canada 月台有各自的空間。
4. 在月台上走近正確側車門，等待列車完全停妥、車門開啟後上車。大廳、遠處、錯誤路線／方向或未開啟的車門都不能上車。
5. 沿途每站停靠時可選擇下車；留在車上則於停站等待結束後繼續。到達目的地或轉乘站時，列車等待人物明確下車。
6. 在 Waterfront 轉乘時，先下車，再走近通行點返回大廳，前往另一條線的月台，等待並重新上車。不能留在原車直接換線。
7. 下車後返回大廳，走近出口，按「回到街道」。控制器重新檢查當前城市的可通行地面，才恢復一般步行；不沿用地下月台的地板或高度。

目的地在站內可更改，上車後鎖定。列車行進時不提供下車、返回街道、切換交通模式或跨站重新進入的操作。

## 桌機與手機操作

| 操作 | 桌機 | 手機／觸控 |
| --- | --- | --- |
| 站內步行 | W／S 前後，A／D 轉向；方向鍵亦可 | 左下方搖桿，前後行走、左右轉向 |
| 環顧 | 拖曳場景 | 在搖桿之外拖曳場景 |
| 靠近通行點、上車、下車 | E，或點選對應按鈕 | 右下方互動按鈕 |
| 選擇行程 | 起點／目的地選單 | 展開搭乘面板後使用選單 |
| 返回街道 | 大廳出口附近的「回到街道」 | 展開面板，使用相同出口按鈕 |

桌機以精簡入口按鈕開始，搭乘期間顯示完整面板。手機搭乘期間預設只顯示目前站／下一站、路線與狀態，可展開行程；步行搖桿和互動按鈕獨立放置，按鈕至少 48px，主要觸控動作至少 56px。停站開門時標頭顯示所在站；車門關閉並行駛時才以「下一站」標示目的站。

E 採單次按下互動，長按不重複上車／切換樓層。編輯選單、文字輸入或對話框時不接管行走按鍵；點擊／拖曳場景會重新聚焦城市畫布。Escape 在搭乘期間關閉輔助面板、恢復控制顯示，不會把行進中的人物送回城市環繞視角。實際離站仍需在大廳出口使用返回街道操作。

搖桿與環顧各自管理指標，第二根手指點互動按鈕不會釋放第一根的步行操作。pointer cancel、失去 capture、失焦、分頁隱藏、停用輸入、隱藏／卸載步行介面，以及控制器銷毀都會清除相應的按住狀態。回到前景時使用有界時間步進，不補跑整段背景時間。

## 站體、列車與資料的精確程度

- 七站各自保留原創站體布局、入口、月台、扶梯／樓梯／電梯通行點、障礙物、軌道禁入區與可行走三角形。Waterfront 保留分開的 Expo／Canada 空間；Burrard、Granville 的地下站體、Main Street–Science World 的高架站體及其他站的辨識差異以官方站圖／照片研究為依據。
- 模型來自既有 `tools/assets/skytrain-stations-stage2/station-layout.json`，由建置工具產生可部署資料。尺寸、深度、內部配置和材料屬代表性原創重建，沒有逐站現場測量或攝影測量；不是每件設備、招牌和裝修的精確複製。商場、商店、整座歷史建築及所有出入口周邊空間也未完整重建。
- 執行時從城市地形決定街道基準高度，並依 GTFS 平面切線調整整站朝向；地理線形與站台端點之間採平滑接合。地下深度、隧道斷面、坡度及最後一段進站曲線是遊戲幾何，不是實測軌道工程資料。
- Main Street–Science World 的執行站體原點取保留的雙向 GTFS 月台端點中點，以避免原始選點偏移造成月台／車身進入鄰近裙樓。公開人物動線整合東入口、東側樓梯及月台通行點；原始西側支線仍保留於來源 metadata，但目前不接入步行圖，並以引導欄提示東入口。這是本遊戲的整合範圍，不代表現實車站西入口關閉。選定動線與整組列車的來源足跡檢查見[站體足跡稽核](qa/skytrain-travel-20261022/station-footprint-audit.json)。
- 樓梯具有步行支撐；靠近指定通行點也可透過互動切換大廳／月台。電梯屬受距離與樓層限制的通行操作，未模擬完整升降機機械、等待隊列或逐秒升降動畫。
- Expo 搭乘列車使用既有 Mark V 風格端車內裝與原創四節展示外觀；它不是對真實 Mark V 完整五節編組的逐節重建。Canada Line 使用既有內外裝，另一節共享原始幾何。只有搭乘車廂的站立視角作為移動乘客相機，未開放車內自由步行、逐座入座或跨車廂通行。
- 列車進出站、加減速、等待與停站秒數為遊戲節奏；每段約依執行曲線長度／11.5m/s 計算，限制在 30–180 秒，另有起步／停站等待。不能將這些秒數當成現實班次時刻表。
- 沒有將第三方照片、影片像素、官方站圖繪製內容或來源貼圖打包進新站體。來源與實景參考的範圍及限制見[參考資料文件](SKYTRAIN_STATION_REFERENCES_2026_10.md)與[來源摘要](qa/skytrain-travel-20261022/network-source-summary.json)。

## 效能與資源生命週期

第一次進站讀取路線及七站的輕量 metadata，以建立雙向站台與路線端點；七份部署站體 JSON 合計 540,255 bytes（未壓縮），不代表同時建立七站的 GPU 幾何。場景只保留一個目前站體 owner；到站切換時建立新站、回收前站，離站後隱藏該站與搭乘列車。下一次切站或整個城市銷毀時回收舊 owner。只建立當前路段需要的代表性隧道，切段／到站／離站會回收。

站體使用合併／實例化的重複幾何與按品質選擇的裝飾密度。列車沿用既有兩檔車廂 LOD：Balanced／相容模式使用輕量檔，High／Ultra 使用精細檔。LOD 在載入該列車／換線時決定，搭乘中不因 Auto 的小幅波動反覆換模型；當前站的建模密度也在載入時決定。High／Ultra 並沒有各自新增第三份內裝模型。

城市的 Auto 畫質仍可動態控制渲染解析度與景物準備預算。搭乘列車時，Auto 使用列車的實際遊戲速度與行駛情境，而非人物的靜止速度；站內則以步行情境處理。手動指定品質選項維持可用。這些是資源上限與動態策略，實際 FPS、耗電及不同手機的 GPU 表現仍需以瀏覽器驗收紀錄為準。

載入列車或換線時，先以城市相機及實際光照預編譯已載入的列車子樹，完成前保持忙碌、禁止上車。這減少首次進入車廂才遇到 shader 編譯的機會，但未據此宣稱固定 FPS 或零停頓。站台側車門有實際開關與淨空判定；靜態展示內裝的門口牆／玻璃只在搭乘實例中裁出開口，原始 GLB 檔保持不變。

地下視角依目前相機高度與當地城市地形判定，繪製期間暫時隱藏城市共用海面，避免低於海平面的合法車站被水平海面穿過；正常或失敗渲染後皆恢復海面原先的可見狀態。Main Street 活躍站體則以建物 seed 與 170m 世界座標半徑共同限制，僅替換重疊的 `osm-structure-303` 通用車站外殼。鄰近高樓、原始建物足跡、碰撞體、原始站體資料不因此刪除或修改；換站、離站、錯誤與銷毀時清除替換狀態。這些範圍亦有實際引擎／材質 hook 的 CPU 回歸測試。

取消／銷毀中的非同步載入以生命週期與 generation 驗證結果，晚到資料不重新掛上場景；卸載會移除鍵盤、視窗與畫布事件監聽並回收站體、列車及隧道資源。路線資料必須包含兩線共 12 個不重複、方向正確的相鄰有向區段，資料缺失時拒絕開始旅程。

## 實作位置

| 檔案 | 職責 |
| --- | --- |
| `lib/city/skytrain-network.ts` | 七站／兩線、Waterfront 轉乘規劃、等待／上車／行駛／停站生命週期 |
| `lib/city/skytrain-travel.ts` | 城市中的乘客、站內樓層／行走、上落車證明、輸入、相機與返回街道 |
| `lib/city/skytrain-stations.ts` | 原創站體、樓梯支撐、軌道與障礙碰撞、單站資源 owner |
| `lib/city/skytrain-ride-path.ts` | GTFS 資料驗證、整站朝向修正、地理路徑與連續停靠姿態 |
| `lib/city/skytrain-ride-train.ts`、`skytrain-door-aperture.ts` | 移動列車、車廂 LOD、正確月台側的開門與門口淨空 |
| `components/skytrain-travel-panel.tsx`／`.css` | 行程選單、站況、互動按鈕、手機控制與響應式面板 |
| `lib/i18n/skytrain-travel.json` | 既有十種介面的完整搭乘文字 |
| `tools/build-skytrain-runtime-stations.mjs`、`build-skytrain-routes.mjs` | 由既有來源生成部署資料 |
| `public/models/skytrain-stations/`、`skytrain-routes.json` | 七站 runtime metadata、manifest 與區域路線 |
| `app/page.tsx`、`lib/city/engine.ts` | 與既有城市模式、面板、生命週期及 Auto 畫質整合 |

## 已執行的針對性驗證

新增搭乘功能的針對性測試共 **98／98** 通過；加上既有車廂測試為 **108／108**，最後換線與通道修正後已完整重跑。各組如下：

| 測試組 | 通過數 |
| --- | ---: |
| 站序、行程與旅程生命週期 | 20 |
| 雙向地理路徑與連續姿態 | 12 |
| 七站幾何、地面支撐、動線與碰撞 | 21 |
| 搭乘列車、門口與開關門 | 10 |
| 桌機／手機介面 handler 與語系 | 8 |
| 實際城市搭乘控制器 | 18 |
| 實際引擎地下渲染與導航保護 | 7 |
| 實際建物 shader hook 與來源範圍 | 2 |
| 既有車廂載入／資源回歸 | 10 |

控制器測試使用真實七站資料、站體地板／障礙解析器、地理路徑、旅程狀態機與門動畫，只替代無 GPU 環境中的城市畫布／街道查詢與 GLB 視覺載入。渲染測試執行抽取的實際引擎方法，材質測試執行實際 `onBeforeCompile` hook；它們不是 WebGL 截圖或真手機效能實測。

- 七站均能進入、站內步行、從安全大廳出口返回新驗證的街道地面。
- 真實月台步行能走到車門；大廳、遠處、門未開啟、錯線、非有限速度或移動中都拒絕不合法上落車。
- Expo 正向／反向中間站與 Canada Line 中間站均保留；Burrard→Waterfront→Yaletown 的跨線旅程必須下車、回大廳、換月台再上車。
- 連續走上 Burrard 樓梯能更新大廳樓層，避免人在大廳卻仍被判為月台而無法離站。
- 手機搖桿指標取消、第二手指互動、失焦、隱藏、停用與卸載清理；桌機表單焦點不誤觸行走，點擊場景後可恢復鍵盤控制，停用輸入時不搶焦點。
- 閉門前不發車；移動中不退出／改目的地；背景分頁、異常大時間步、載入晚到、銷毀與缺失／重複路線資料受限制。
- 七站選項順序、Waterfront 轉乘行程、十種語系、精簡入口與手機到站顯示使用實際 UI handler 驗證。
- 編譯尚未完成時不能走動／上車；銷毀後編譯晚到不恢復乘客或站體；小地圖及直接城市飛往視角不能中斷站內或乘車狀態。
- 地下海面暫時隱藏會在正常／失敗繪製後恢復；指定站殼替換受 seed 與世界半徑限制，原始幾何、資料及鄰近高樓保留。
- Waterfront 實際連續步行可穿過兩處轉乘入口、走下 Canada 樓梯；走路改變人物所在路線後，返回大廳再前往月台，仍須依實際已載入列車的 `serviceLine`／`ready` 換車與預編譯，才能上車。兩個通道支柱僅在執行實例中修正為 0.22m 方柱，視覺與碰撞一致；原始 metadata、支柱位置／高度及其他支柱不變。

可重現的針對性指令（使用 repo 支援的 Node 24.22.1）：

```sh
node --test tests/skytrain-network.test.mjs tests/skytrain-stations.test.mjs tests/skytrain-ride-path.test.mjs tests/skytrain-ride-train.test.mjs tests/skytrain-travel.test.mjs tests/skytrain-travel-ui.test.mjs tests/skytrain-render-policy.test.mjs tests/skytrain-building-replacement.test.mjs tests/skytrain-cabin.test.mjs
```

## 瀏覽器、整體檢查與發布驗收

原生操作使用城市 QA 快照。最後發布程式相較該快照，另有部署來源改為穩定邏輯 ID、以實際載入列車判斷換線，以及上述兩個 Waterfront 通道方柱修正；這些差異已分開記錄並以最終 108 項回歸及正式建置驗證。原生操作與效能樣本不標成最終發布程式逐位元相同的測量。

| 項目 | 驗收紀錄 |
| --- | --- |
| 桌機完整搭乘與返回街道 | 原生瀏覽器走完 Waterfront→Burrard，含入口、站內步行、候車、上車、移動、下車、回大廳及返回街道。 |
| Expo 長程連續搭乘 | 完成 Main Street 修正的 QA 版本由 Main Street–Science World 出發，經 Stadium–Chinatown、Granville、Burrard，自動續行後於 Waterfront 停妥開門；2026-10-22 14:01 UTC 確認到站。 |
| Waterfront 跨線轉乘 | 原生瀏覽器在 Waterfront 下 Expo 車後步行約 63m、返回大廳、選擇 City Centre、前往 Canada 月台、步行約 32m 上車；到 City Centre 停站後下車。QA 快照以通行按鈕切換樓層；最後連續樓梯／通道修正另以實際控制器回歸驗證，沒有聲稱在該快照完成全程連續樓梯轉乘。 |
| 手機版面與完整 Canada Line 旅程 | 桌面原生瀏覽器以 390×844、844×390 響應式視窗驗證；以原生 pointer 搖桿行走，走完 Vancouver City Centre→Yaletown、下車、返回大廳及街道，另驗證 City Centre 下車後搖桿與拖曳環顧。[直向車廂](qa/skytrain-travel-20261022/mobile-canada-portrait.jpg)、[橫向車廂](qa/skytrain-travel-20261022/mobile-canada-landscape.jpg)、[City Centre 月台](qa/skytrain-travel-20261022/mobile-city-centre-platform.jpg)保留畫面證據。不是實體手機測試。 |
| 站內視覺與可見性 | 已記錄[Main Street 月台](qa/skytrain-travel-20261022/science-world-platform.jpg)、[Granville 扶梯](qa/skytrain-travel-20261022/granville-escalators.jpg)、[Stadium–Chinatown 月台](qa/skytrain-travel-20261022/stadium-chinatown-platform.jpg)及[Expo 移動車廂](qa/skytrain-travel-20261022/desktop-expo-moving.jpg)。這些是特定視角的觀察紀錄，沒有宣稱七站所有出入口均完整實測。 |
| 畫質與效能範圍 | 保留手動品質及 Auto；Auto 接收實際列車速度，列車 LOD 在載入／換線時固定。[效能紀錄](qa/skytrain-travel-20261022/performance.json)為一台 Radeon Pro 560X Mac、1280×720、Auto／Balanced 的 2,400 frame 前景樣本，共 43.06 秒：frame interval 中位數 16.8ms、P95 20.9ms、P99 24ms，仍包含一次 1,373ms 停頓，原因尚未由該紀錄建立。它不是最終發布版本、全程旅程、High／Ultra 或實體手機效能保證。 |
| 本地測試 | 較早全套 1,754／1,754 與受影響範圍 160／160 均通過；它們早於最後換線／通道修正。最後兩處修正後，搭乘與既有車廂 **108／108** 完整重跑通過。 |
| TypeScript 與 lint | 最終 `npm run check` 通過，新增程式／測試的嚴格 lint 通過。[相同四個既有修改檔案的比較](qa/skytrain-travel-20261022/lint-comparison.json)仍有 47 個既有錯誤，新增診斷 0；沒有把此結果說成全 repo 零 lint 錯誤。 |
| 最終正式包原生煙霧測試 | 無 QA 面板的正式輸出另於 localhost:3101 啟動，透過公開入口選擇 Waterfront→Vancouver City Centre，成功載入站廳、Canada 月台與實際列車；新來源 ID 驗證通過。[正式包月台畫面](qa/skytrain-travel-20261022/production-waterfront-canada.jpg)。此煙霧測試不取代上列長程操作。 |
| 正式建置 | 最後換線／通道修正後，`npm run build:firebase` 再次通過，包含靜態輸出、Firebase 輸出檢查及 CSP 產生。路線改用穩定來源 ID 與 SHA-256 溯源，保留原有來源／交接檔排除檢查。此紀錄證明建置成功，不等同已部署或已合併。 |

基準版本共有 1,673 項測試，加上本次 98 項，完整 commit 的 CI 預期為 **1,771** 項。本文記錄的是上述本地已執行結果；1,771 是該 commit 的 CI 執行核對數，沒有預先標成通過。實際 commit、main 合併及部署狀態以 GitHub／部署系統的紀錄為準。

機器可讀的[驗收收據](qa/skytrain-travel-20261022/acceptance.json)區分本地測試、原生瀏覽器觀察及 CI 預期值。[雙向路徑連續性報告](qa/skytrain-travel-20261022/path-continuity.json)與[站體足跡報告](qa/skytrain-travel-20261022/station-footprint-audit.json)各自記錄方法、雜湊及限制；其他原生畫面與量測紀錄收於[同一 QA 目錄](qa/skytrain-travel-20261022/)。
