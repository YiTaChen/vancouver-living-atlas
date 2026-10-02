# 2026-10 城市初始畫面與建築材質可讀性

本階段修正初次進入城市時「地面、水面明亮，但多數建築呈深灰」的問題。修正集中在建築 shader 如何使用既有素材，以及初始城市時刻；沿用目前 Blender PBR atlas，不重建城市幾何，也不提高全場曝光來掩蓋建築表面的問題。

TypeScript 檢查與 **660/660 項測試通過**。實際瀏覽器的 **5 個視點 × 4 種條件，前後版本各 20 份**對照已完成，全部有效且相機一致。陰天市中心、Gastown 屋頂、步行與駕車能辨識較明亮的外牆和玻璃，灰白屋頂與保留的深色屋頂形成差異；夜間窗燈正常，auto 極光也已實際渲染確認。短測沒有 FPS 提升證據。原始畫面、測量 JSON、版本與來源 fingerprint 保存於[城市可讀性視覺驗證](visual-quality/city-readability/README.md)，正式建置與發布另記錄於該索引。

## 根因：素材如何被建築 shader 使用

| 問題 | 既有行為 | 對初始畫面的影響 | 本階段修正 |
|---|---|---|---|
| 平屋頂共用深色道路瀝青 | 所有平屋頂選 atlas 的 asphalt slot；平均 sRGB 為 `(0.259805, 0.279812, 0.279812)`，轉成線性色彩後亮度 Y 約 **0.0618** | 高視角可見的大量屋頂集中在很低的反射率，缺少礦物屋面與淺色膜材的層次 | 建築專用的三種代表性屋頂配色，重用瀝青紋理的細微變化 |
| 牆面原有明度被替換 | 將建築 profile 色除以自身最大色彩分量，只保留少量色相差異，再以 atlas 底色決定主要明度 | profile 原本較明亮的牆面配色沒有完整呈現；單純提高 vertex color 仍難以改善 | profile 色負責牆面色相與反射率，atlas 色相對其平均值提供表面變化 |
| 天空色在玻璃上再次受漫反射照明 | 先把較暗的天空色混入玻璃 diffuse pigment，再交給 Standard 光照計算 | 本應看見天空反射的窗面又被照明衰減；玻璃比例高的現代建築尤其偏暗 | 將室內底色與近似天空反射分開；反射項於間接鏡面光階段加入 |
| 初始時刻過快進入夜間 | 原本從 16:00 開始，以 300 倍速度運行 | 場景開始後約 54 秒便到 20:30，首次探索容易把夜色誤認為白天材質過暗 | 改由 10:00 開始，保留原本 300 倍運行速度與完整日夜循環 |

初始 overview 的遠距路徑原本就不啟用近景 AO 與陰影，因此這次沒有透過削弱 AO、移除陰影或更換 shadow map 尺寸來修正遠景。上述材質問題也不是「尚未補上一份 Blender 模型」：來源 atlas 已存在，問題在應用端如何解讀與組合它。

使用者提供的 Waterfront／Gastown 實景參考只用來定性觀察淺色石材、玻璃與屋頂之間的對比，不作逐棟材質測量或色彩校正依據。本文件不收錄或公開該私人照片。

## 平屋頂配色與來源界線

[building-surface-palette.ts](../lib/city/building-surface-palette.ts) 提供三個固定配色；數值在 CPU 端由 sRGB 轉為線性 RGB 一次，再以三個 `vec4` uniform 傳入 shader。

| 索引 | 代表性表面 | sRGB 底色 | 粗糙度 |
|---|---|---|---:|
| 0 | 瀝青 | `(0.259805, 0.279812, 0.279812)`，保留原 manifest 平均色 | 0.93 |
| 1 | 礦物／砂礫 | `#93988e` | 0.88 |
| 2 | 淺色塗層膜材 | `#b9c0bb` | 0.82 |

現有地理來源沒有屋頂材質欄位；這些是**代表性外觀，不是實測屋頂分類**。沿用由來源結構產生的 `FacadeKind` 與 `profile.seed`，不增加任意座標區塊或逐棟人工例外。既有 FacadeKind 本身也包含代表性建築風格判斷，不能當成官方材質資料。

| 既有建築類型 | 瀝青 | 礦物／砂礫 | 淺色膜材 |
|---|---:|---:|---:|
| heritage-brick、lowrise-masonry | 40% | 60% | 0% |
| midrise-grid、balcony-slab、curtain-wall | 0% | 30% | 70% |
| domestic-cladding 的平屋頂 | 20% | 40% | 40% |

比例描述二十個 seed 槽的美術配置，並非溫哥華實際材料比例。選擇器使用非負 safe integer seed 的 `% 20`；同一結構及其各個部分穩定選到同一配色，不受載入次序影響。未知類型、非有限值、負值、小數或超出安全整數範圍時，回退到礦物色索引 1。結果只會是 `0 | 1 | 2`。

平屋頂仍保留 `(-1, -1)` 表面標記；有來源支持的斜屋頂維持 `(-1, -2)` 與原本 shingle 材質。新增 `aRoofFinish` 只是每頂點一個 scalar 屬性，不改屋頂輪廓、牆高、屋簷、地基、道路或碰撞。

## 沿用 Blender atlas 的方式與限制

本次使用既有 [Blender 材質來源](../tools/assets/city-materials/source/city-material-library.blend)及[材質 manifest](../public/materials/city/manifest.json)。不新增 `.blend`、GLB 或貼圖，因為修正目標是建築 consumer 的色彩組合。現有 color／normal／ORM atlas、貼圖取樣尺度、遠景細節淡出與幾何合批繼續共用。

牆面使用「profile 線性色 × atlas 線性色 ÷ 該 slot 的線性平均色」。平屋頂採相同概念，將新的 finish 色乘上 asphalt 相對平均色的變化。這讓底色只套用一次；原本 asphalt finish 仍能還原其既有色彩。來源平均值為正，shader 另保留安全分母下限。

這裡的「平均色」有明確限制：manifest 儲存的是**編碼後 sRGB texel 的平均值**，runtime 再將此平均值轉為線性 RGB。它不等於「先將每個 texel 轉成線性 RGB，再取平均」。因此遠景回退到 manifest 色時，正規化比值精確為 1；近景 atlas 細節的平均則是近似，不能宣稱所有 LOD 都嚴格保持相同輻射平均值。這次維持低對比 grain，並以近、遠景實拍檢查是否產生明度跳動或過亮斑點。

幾何位置、拓撲、三角形數、既有 draw 分組及貼圖數量不變。新增 scalar 屬性仍有每頂點 4 bytes 的資料成本，三個配色 uniform 與額外 shader 運算也不是零成本；沒有量測前，不由 draw／texture 數不變推論 FPS 或 GPU 記憶體完全不變。

## 玻璃反射的角色

[architecture-material.ts](../lib/city/architecture-material.ts) 保留室內暗部、簾幕、窗框分隔與夜間窗光，將天空色放到獨立的近似反射項。該項跟隨既有線性天空色，加入 `reflectedLight.indirectSpecular` 後仍經過後續 AO、曝光色調映射與霧處理。

這是有意設計的外觀近似，不是完整光線追蹤或新的物理玻璃模型。它使用窗格位置及視角權重，未依真正的反射方向取樣，也不具有完整粗糙度濾波；既有 PMREM 反射仍存在，兩者相加可能讓部分玻璃過亮或呈乳白色。需檢查晴天、陰天、黃昏及夜間，尤其是街道斜視窗面與玻璃比例高的大樓。它跟隨夜間天空變暗，不能被當成永遠發亮的自發光窗面。

本階段不更動全域 sun／hemisphere／environment 強度、曝光、天空配色或水面材質。同一時刻與天氣下的對照才用來判斷建築修正；新的初始時刻另行驗證，不以更換太陽位置代替材質比較。

## 初始時鐘與第一晚天空

[DEFAULT_CLOCK](../lib/city/clock.ts) 改為 **10:00、running=true、rate=300**。300 倍表示每一真實秒推進五個城市分鐘，並以單調時間計算，不以 frame 數累加。時基從第一個可顯示的城市 frame 開始，模型下載與初始化時間不消耗白天。

在頁面持續可見、沒有手動調時或暫停的全新場景中：

| 城市場景開始後 | 城市時刻 | 意義 |
|---|---|---|
| 0 秒 | 10:00 | 明亮的初始探索時段 |
| 60 秒 | 15:00 | 首分鐘仍保留白天 |
| 126 秒 | 20:30 | 進入既有夜間週期 |
| 156 秒 | 23:00 | 可觀察夜間天空效果 |

使用者明確選擇的時刻、速度或暫停狀態仍優先；頁面隱藏時依原本可見性規則暫停累加。

既有 [NightSkyCycle](../lib/city/sky-state.ts) 的 auto 模式保證新場景第一個夜晚啟用極光週期，這次沒有修改該機制。預設極光功能開啟時，仍需要晴朗的可見天空與朝北、未被遮擋的視野才能看見；陰天會衰減天空效果，手動關閉亦受尊重。這是城市展示的夜間安排，**不是實際極光預報或真實天文事件保證**。

## 驗證與重現

目前已完成 `npm run check` 與 `npm test`，共 **660/660** 項測試通過，包含 palette 數值／分布／安全輸入、穩定來源 seed、材質整合與初始時鐘回歸。測試不能替代實際 WebGL shader 編譯、材質觀感或效能量測。

已完成的前後畫面比較採以下五個視點，兩版均使用 **1920 × 1080 實際 canvas PNG**：

| 檢查點 view 名稱 | 放置方法 | 用途 |
|---|---|---|
| `overview` | 全新載入後原本的 startup pose，距離 8700 m、FOV 42；先於任何 QA 視點控制執行 | 驗證使用者真正看到的初始全景 |
| `downtown` | `Upgrade preview atlas-aerial` | 市中心中距離牆面與屋頂 |
| `gastown` | `Upgrade preview gastown-street` | 舊城街景、牆面與玻璃 |
| `gastown-roofs` | `Upgrade preview gastown-roofs` | 舊城近景屋頂 |
| `drive` | 既有 `burrard-drive` QA 視點 | 道路視角下的建築可讀性 |

每個視點執行四種固定條件：晴天 `clear` 14:00、陰天 `overcast` 14:00、晴天黃昏 19:48（19.8 h）、晴天夜間 23:00。使用 `Asset checkpoint name` 輸入 `baseline-<view>` 或 `candidate-<view>`，勾選 `Capture four lighting conditions`，再按 `Save asset checkpoint`。本階段重用既有 QA 控制，沒有另改診斷程式。

每組要記錄相機與 target、時刻、天氣、品質、畫布解析度、ready 狀態、頁面可見性及版本身分。兩版採同一裝置與重現條件；載入或快取尚未就緒、姿態飄移、頁面隱藏與錯誤畫面不可列為有效比較。來源 profiles、SSAO 與陰影設定一致：既有距離門檻使 8700 m overview 關閉兩者，而約 1260 m 的 High 市中心視點啟用兩者，不為這次比較另調門檻。

基準 build 在編輯前由 **`dfbd80d`** 編譯；但啟動基準本機 server 時，工作區的時鐘及 palette 編輯已開始。Server 寫入 JSON 的 `sourceFingerprint` 因此描述當時工作區，**不能當成舊版編譯來源的完整 fingerprint**。基準產物身分由獨立、編輯前保存的 `baseline-bundle.json` hash manifest 核對；候選則於修改後重新編譯、全新載入。結果索引須保留這項差異，不將 HEAD、工作區 fingerprint 和已編譯 bundle 三者混為一談。

完整矩陣、檔名、版本 hash 與結果以[視覺證據索引](visual-quality/city-readability/README.md)為準。沒有以全圖平均亮度宣稱畫面改善百分比，也沒有從短測推論統計顯著的效能收益。

在 repository 根目錄執行本機 QA 建置；基準與候選應各自使用對應 revision／工作樹及不同結果 label，避免覆蓋證據：

```sh
npm run check
npm test
VANCOUVER_VISUAL_QA=1 VANCOUVER_STATIC_EXPORT=1 npm run build
node tools/serve-visual-qa.mjs city-readability-candidate
```

伺服器只監聽 `http://localhost:3100/`，實際 PNG／JSON 寫入 `work/visual-qa/city-readability-candidate/`。基準產物另以 `node tools/serve-visual-qa.mjs city-readability-baseline` 啟動，寫入 `work/visual-qa/city-readability-baseline/`；同一 port 一次只執行一個 server。開啟可見瀏覽器，以前述固定視點與條件操作既有 QA 控制；畫面比較時固定時鐘，初始日夜測試則另外從全新場景運行。正式量測期間不並行執行建置、測試或 Blender 工作。

完成 QA 後，正式產物必須另外重建並驗證，排除本機 QA 控制與候選資產：

```sh
env -u VANCOUVER_VISUAL_QA npm run build:firebase
```

此命令建置並執行 `verify-firebase-build.mjs`，不會部署。QA build 不可拿來發布；Git 合併與 Hosting 發布成功與否需另以實際紀錄核對，不能由測試成功推定。

## 後續範圍

1. 若能取得有授權及時間標記的屋頂／外牆材料資料，先建立來源欄位、可信度及缺值回退規則，再取代代表性配色；保留可追溯的 structure ID 與來源版本。
2. 若實拍顯示近景材質仍不足，再針對具體材料製作或調整可編輯 Blender PBR 資產，並驗證公尺 UV、線性色彩平均、normal／ORM 語意、遠近尺度和共用貼圖成本。
3. 玻璃若需要更準確的天空反射，先建立方向與粗糙度一致的反射方案，再做同條件比較；維持室內、夜間窗光及材質分工。

上述為後續規劃，不代表已實作或驗收。不以畫面局部的任意 XYZ patch、更改來源輪廓或全域曝光補丁替代材質／來源契約。
