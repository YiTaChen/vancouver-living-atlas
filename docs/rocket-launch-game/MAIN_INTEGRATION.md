# 火箭遊戲整合 main

2026-10-23（Vancouver）。依使用者要求，將已驗收的火箭分支 `6c158e57e895527274df58e5b8074dfc89333b44` 合併到最新 main `f0a578c9694ee218d740ee0f892d20d3d9502d6d`，保留兩個 parent 與原開發分支。

## 共用程式的整合

main 在火箭開發期間另加入公車座位與路線服務、世界 SkyTrain／站外通道、城市音效、啟動與效能診斷。`app/page.tsx`、`lib/city/engine.ts` 的衝突逐段處理，保留兩邊的功能。

- 火箭照常建立、更新、分級、切換太空場景及釋放資源；城市破壞繪製前後還原與 main 的 GPU／frame 診斷清理同時保留。
- main 的公車世界服務、站立互動、SkyTrain 載入／站內總覽、單一持續觸控搖桿、音效控制與交通來源說明保留。
- 切換至街道、飛機或 Tesla 時先同步結束火箭控制；火箭選型、放置、飛行期間不會同時把輸入送給公車或 SkyTrain。行駛中的交通工具仍遵守原本的退出限制。
- 火箭分支原本的 14 個產品來源 SHA 全部保留；引擎與頁面的整合另以擴大的 53 個來源 SHA 防護實景驗收。

新增 8 項行為測試執行合併後的 production 方法與操作處理器，覆蓋同一 RAF 更新、交通／音效共存、正常與失敗渲染還原、太空場景略過城市 LOD、輸入清除、重複釋放及模式交接。使用記錄用瀏覽器／GPU 邊界，沒有另寫一份模擬流程來取代 production 方法。

## 合併後重新驗證

[完整回歸報告](main-integration-tests.json)：262 個測試檔，合計 **2,260 項：2,259 通過、0 失敗、1 項跳過**，約 126.37 秒；其中 193 項火箭測試包含新增的 8 項整合測試，不另外加總。

跳過項目是 main 既有的官方 SkyTrain 壓縮檔重建測試：只有存在 `work/open-world-transit/google_transit.zip` 時執行。本地沒有該可選檔案，依原設定跳過；未把它算成通過。兩份會由測試產生的 QA JSON 均精確還原原始位元組與 SHA256。

TypeScript、Firebase 正式建置與資產／CSP 驗證通過，新增測試的 lint／格式通過。[建置與檢查紀錄](main-integration-checks.json)保留命令、來源 parent 及原始 log 雜湊。合併頁面的既有 lint 診斷種類與數量與 main 相同，沒有宣稱全 repository lint 通過。

[合併後城市驗收](main-integration-runtime.json)使用獨立無頭 Chrome／Metal、原控制器、原始道路拾取與 `update(1/60)`，只重測 Balanced 四個代表路口；**37／37 條件通過，4／4 自然抵達 100 km**。未指定飛行高度、事故、損壞或成功結果。

| 路口                  | 模擬飛行時間 |
| --------------------- | -----------: |
| Thurlow／Melville     |    69.600 秒 |
| Nicola／W Pender      |    69.483 秒 |
| Robson／Gilford       |    69.500 秒 |
| Canada Place／Burrard |    69.950 秒 |

四次回城的城市幾何、原碰撞資料、暫時幾何／材質及快取均精確還原。53 個來源檔前後 SHA 一致、HMR 為零、未捕捉 JavaScript／WebGL shader 錯誤為零。報告仍保留兩條無 URL 的 generic resource 404 console 訊息；HTTP failure 清單為空，火箭與 worker 資產檢查通過。

這次沒有把先前 20 個路口／三種畫質、屋頂事故與森林實景全部重新執行；它們仍明確屬於[火箭分支原驗收](FOUNDATION_CONTACT_FEEDBACK.md)。新的實景報告保留 39,498,195 bytes 原始 trace 的 SHA256；大檔留在忽略的 `work/`，版本庫只保存精簡報告。固定步進不是手機即時 FPS 保證，樹冠與前方建築的視覺遮擋限制沿用原紀錄。

## main 的既有發布流程

推送 main 會觸發 repository 既有的 GitHub Actions 驗證及 Firebase Hosting 部署 workflow。本地整合驗證沒有額外執行 Firebase deploy；正式部署是否完成，以該合併提交的 Actions 結果為準。
