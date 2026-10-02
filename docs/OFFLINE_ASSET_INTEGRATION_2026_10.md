# 2026-10 素材清點、城市整合與驗收紀錄

本輪採用 **1024 px 市民 LOD0 作為正式載入預設**，保留完整近景幾何，降低下載與貼圖成本。現代／雪松窗台保留 QA 比較；葉片、其餘建築、地表及角色材質保留來源，延後正式套用。已完成 651/651 測試、TypeScript、正式 Firebase build 與受控 GPU 場景比較；Git／Hosting 交付另以 main 歷史與 Actions 結果核對。這些單一來源樣區的結果不代表全城與各裝置均已驗收。

## 版本與證據範圍

| 項目 | 版本／位置 | 意義 |
|---|---|---|
| 城市整合基準 | `4967c72dfda532eb8151bf477b29eafe54a93d5d` | 本次比較的既有 main；包含來源區域規則與既有 QA 候選 |
| 新素材分支 | `assets/blender-offline-handoff`，`127be5c` | 可編輯 Blender 來源、GLB、貼圖與離線報告；原交付未自動替換城市 runtime |
| 本次工作分支 | `codex/offline-assets-validation` | 素材合併及受控場景比較；交付 revision 可從本文件的 main 歷史定位 |
| 更新的入口清單 | [BLENDER_ASSET_HANDOFF_2026_10.md](BLENDER_ASSET_HANDOFF_2026_10.md) | 區分本批新增、既有重用與待整合內容 |
| 逐檔 inventory | [offline-handoff/manifest.json](../tools/assets/offline-handoff/manifest.json) | 包含來源／匯出／貼圖／報告的大小與 SHA-256；不是 273 個獨立模型 |
| 本次完整性報告 | [source-integrity.json](visual-quality/offline-assets/source-integrity.json) | **273 個列管檔案、98,157,861 bytes，檔案完整性檢查通過** |

完整性檢查覆蓋檔案 hash、大小、GLB 封裝、有限值與內嵌資源。Blender 手動編輯、材質語意、相機距離、GPU 畫面及效能仍需各自驗證。原分支所附離線測試結果屬該交付版本，不能當成本次修改後的應用測試結果。

## 素材總表與目前決策

狀態說明：**採用**表示已根據本輪證據選為正式程式預設，發布另行記錄；**QA 保留**表示具名場景比較已有效完成，但沒有擴展為全城配置；**延後**表示來源保留，但視覺收益或消費契約不足；**既有**不能計入本批新增成果。

| 批次 | 實際內容 | 已知成本 | 本次測試／整合範圍 | 目前決策 |
|---|---|---|---|---|
| 既有建築部件 | 8 類、16 個獨立 LOD `.blend` 與 GLB | 各類各一件合計 LOD0／1：552／220 tris；各 GLB 1 材質／1 primitive | 保留庫存與既有 Robson 窗台候選 | 既有；不算新增 |
| 新建築部件 | 8 類、16 個 `.blend`、16 GLB | 644／320 tris；GLB 共 3,335,724 bytes；來源共 4,302,359 bytes | 現代折板窗台 24 個、住宅雪松窗台 8 個實際替換比較有效 | 2 類 QA 保留；其餘 6 類延後 |
| 葉片貼圖 | 1024² 四格 straight-RGBA atlas；1024／512／256／128／64 五級覆蓋校正 mip | 候選五級共 5,586,944 bytes RGBA8 texel 資料，約 5.328 MiB | 成熟樹幾何不變；公園 broadleaf 10 m 四光照有效，但候選視覺較簡化 | 延後正式採用；QA 保留 |
| 枝葉研究件 | maple／alder／Douglas-fir／cedar，各 3 LOD，共 12 GLB | 每物種 188／136／80 tris；12 GLB 共 13,375,288 bytes，內嵌貼圖重複 | 不替換成年城市樹；保留為可編輯來源 | 延後 |
| 樹皮／地表 | bark、soil、grass、soil–grass edge 的 PBR maps；選用權重圖；3 個斜坡 GLB | 地面 512／128／32 tris，3 GLB 共 2,859,848 bytes；整組唯一 maps 約 21.33 MiB，另選用權重約 1.33 MiB | 尚需樹皮公尺 UV、地面取樣與表面消費器 | 延後 |
| 地標／車輛／室內 | 8 種不透明 PBR、24 張 256² maps、3 個材質研究 GLB | 16 meshes、4,560 tris、8 材質；maps 約 8 MiB | 實際城市渲染器的四光照試片均有效 | 材質研究已完成；正式消費器延後 |
| 市民 LOD0 | 1 skinned mesh、1 材質、22 骨骼、idle／walk／run；完整拓撲＋1024 貼圖 | 37,799 tris；3,498,312 bytes；maps 約 16 MiB | 原 2048／新 1024 的四光照與 8 秒導航比較均有效 | 採用；不宣稱 FPS 提升 |
| 市民 LOD1／2 | 可編輯來源及獨立 GLB；保護臉、髮、手、鞋、領口與配件 | 30,825／27,531 tris；3,222,256／2,001,060 bytes；maps 約 16／4 MiB | 未接入距離切換；保留中遠距候選 | 延後 |

貼圖 MiB 是 RGBA8 加 mip 的資源規劃估算，不是實測 VRAM。PNG 壓縮大小、GLB 下載大小、GPU allocation 與 frame time 是不同指標；不能互相替代，也不能由三角形降低直接推論 FPS 提升。

## 建築：保留 GIS 主體，按來源邊與部件用途適配

新部件的尺寸為 GLB 實際 bounds，單位公尺、寬 × 高 × 深。每個 GLB 都是單一不透明材質／mesh／primitive。詳細來源見 [INTEGRATION_INVENTORY.csv](../tools/assets/architecture-expansion/INTEGRATION_INVENTORY.csv)、[manifest.json](../tools/assets/architecture-expansion/manifest.json) 與 [cost-report.json](../tools/assets/architecture-expansion/cost-report.json)。

| 部件 ID | 尺寸 m | LOD0／1 tris | 共用表面 | 本次判定與原因 |
|---|---:|---:|---|---|
| `modern-recessed-window-surround` | 2.20 × 1.75 × 0.24 | 56／40 | painted-metal | 延後：窗洞尺寸、玻璃止口與既有 opening datum 需匹配 |
| `modern-sill-drip` | 2.26 × 0.16 × 0.30 | 52／36 | painted-metal | QA 保留：具名來源的有效替換；尚無全城通用尺寸適配契約 |
| `modern-parapet-cap` | 2.40 × 0.19 × 0.46 | 60／28 | painted-metal | 延後：需女兒牆厚度、屋頂邊與排水方向契約 |
| `concrete-shadow-plinth` | 2.40 × 0.50 × 0.16 | 44／40 | concrete | 延後：基座高度、門檻／坡地接地與來源輪廓需適配 |
| `concrete-chamfer-corner` | 0.36 × 2.70 × 0.36 | 136／24 | concrete | 延後：需外角方向與垂直分段 datum |
| `residential-cedar-window-surround` | 1.62 × 1.84 × 0.16 | 112／64 | cedar | 延後：住宅 opening 與框材淨空需適配 |
| `residential-cedar-sill` | 1.62 × 0.13 × 0.29 | 40／20 | cedar | QA 保留：具名來源的有效替換；尚無全城通用尺寸適配契約 |
| `residential-gabled-entry-canopy` | 2.00 × 0.74 × 1.06 | 144／68 | cedar | 延後：模型最低／最高基準為 2.36／3.10 m，需入口高度與支架接牆規則 |

本次候選使用 `architecture-module-candidate.ts` 的來源結構／polygon edge／profile 匹配，重新執行既有 planner，並受原 cell instance 上限約束。匹配到的是既有輸出的窗台，並非額外加一排零件。只允許新窗台的水平跨度縮放 0.75–1.5 倍；不任意拉伸高度、深度或入口淨空。

| 比較候選 | 來源結構／feature | 邊識別 | 靜態計畫預期 | 成本上限 |
|---|---|---|---|---|
| 現代折板窗台 | `145639`／`133049` | `-326.275,445.400\|-336.041,435.450` | 24 個既有窗台；profile=`midrise-grid` | 最多 32 個；額外 ≤1,280 tris |
| 雪松窗台 | `145755`／`105546`、`145677`／`104898` | `-229.513,444.825\|-239.811,434.495`；`-242.321,434.725\|-247.862,429.170` | 合計 8 個既有窗台；profile=`domestic-cladding` | 最多 32 個；額外 ≤896 tris |
| 既有 Robson 砂岩窗台 | `153090`／`132886`、`153102`／`132843` | 見既有 candidate manifest／程式 | 既有 56 個候選；非本批新增 | 最多 64 個；額外 ≤1,280 tris |

前兩者的實際可見替換數為現代 24、雪松 8；各一個 visible batch、兩個 LOD 模板、shared atlas ready，且沒有保留私有預覽 texture。額外三角形分別為：現代 LOD0／1＝960／576；雪松 LOD0／1＝224／64，計算為實例數 ×（候選每件 tris − 原 box 12 tris）。近／遠門檻為 60／150 m，hysteresis 10 m；這是候選比較配置，尚非全城部件 rollout。

兩家庭 LOD0 的四光照、LOD1 晴天及原 box 晴天比較均有有效 checkpoint。現代晴天為 baseline 30.78 FPS、LOD0 30.67、LOD1 30.34；雪松為 32.24／32.29／32.87 FPS。source-selected 色彩／斷面差異屬局部風格細節，收益不足以證明全城應採同款部件；具名來源樣例也不等於通用 parametric fit。因而保留 QA，先建立 opening／sill／entry 的一般尺寸契約再擴展。整體多 pass calls 仍會受場景可見物件影響，不能用上述小幅 FPS 波動宣稱效能改善。

候選抽取 GLB 幾何後釋放其內嵌預覽貼圖，接入既有城市共用材質。若將 16 個獨立建築 GLB 連同重複 maps 常駐，未去重的貼圖估算為 56.25 MiB；不能因「每件只有一材質」就忽略整批資源重複。

## 植被：材質契約與成年樹輪廓分開驗收

新 sprig 約 1.25 m，是幼樹／枝條研究件；放大成成年行道樹會改變主幹、分枝與樹冠比例。這批先只比較葉片材質，維持目前成熟樹模型、來源種子、位置、人口和 LOD pool。既有 7-triangle perennial 屬另一項接縫修補候選，不列作本批新植被。

原 `detailed-trees.ts` 的葉片是 RGB 中性底色，由 min(RGB) 推估 coverage；`aSolid` 保護不透明內冠，陰影 depth 使用相同規則。新 atlas 是 straight RGBA，alpha 已經代表 coverage；直接改 URL 會再次解碼色彩與透明度。

受控 RGBA 適配器須遵守：base color 為 sRGB、alpha 為線性 coverage、cutoff=0.4、雙面 cutout；color／depth 共用同一張 texture 與同一 `aSolid` 邏輯；各物種內冠重新選取不透明 UV；透明像素保留 RGB 延拓，不以 min(RGB) 再推 alpha。五層 mip 上傳為**一張 texture 的五級**，不配置五張 GPU texture；最低為驗證過的 64 px mip。離線 uint8 PNG 的最大覆蓋差為 0.526 個百分點，低於 0.8 門檻；覆蓋率一致仍不能證明樹冠形狀、針葉輪廓或陰影視覺一致。

樹皮與地面延後的原因是消費契約尚未對上：

- 新 bark 重複尺度為 0.8 × 1.6 m；現有枝幹 U 是一圈、V 是正規化前弧長 ×3，成年樹再按尺寸縮放。直接替換會令每棵樹紋理尺寸不同；需先把環周長與樹幹實體長度映射為公尺 UV。normal／ORM 也不能當成舊 albedo bump 直接掛入。
- slope 研究件只有 2 × 2 m、高差 0.1 m；它沒有城市地形 drape、道路／入口排除或導航碰撞契約。地面應替換選定表面或同 shader 混合；全城疊加 patch 會增加 z-fighting 與 draw calls。
- soil／grass 可雙軸 repeat；soil–grass edge 的 U 必須 clamp、V repeat。選用 weight 是逐像素邊界圖；GLB 的低頻 `_GRASS_WEIGHT` 不等同該遮罩。

公園來源 broadleaf（seed=`3064`、height=22.9 m）的 10 m 四光照比較全部有效，baseline 約 34.99–35.72 FPS，candidate 約 35.64–36.10 FPS；兩者 color／depth 均共用各自同一張 map。候選呈現較簡單、較角狀的葉形，近景細節較少，因此維持原正式材質。兩版皆可見成熟樹 leaf card 尺度偏大的問題；下一輪要重整葉簇尺度、層次與 card geometry，單換材質不能解決此原因。30 m 晴天補充比較也已完成：broadleaf baseline／candidate 為 37.73／37.82 FPS，p95 為 34.1／33.8 ms；conifer 為 36.75／36.86 FPS，p95 為 34.4／34.6 ms。候選針葉仍較薄、形態較簡化，沒有改變保留 baseline 的決策。65 m 未執行，conifer 也未完成四光照矩陣，不宣稱所有 LOD 距離已驗收。

這次 QA 保留 baseline 供切換，候選另外配置 **1 張 texture，五 mip RGBA8 約 5.328 MiB**。這是雙版本比較的額外 residency，不能宣稱單一候選正式管線必定增加同等記憶體。若日後採用 RGBA，正式初始化應選擇單一葉片管線；只有同時保留新舊兩 atlas 才會有此雙份成本。候選 manifest 位於 [vegetation-runtime-candidate/manifest.json](../tools/assets/vegetation-runtime-candidate/manifest.json)，maps 經本機 `/__offline-assets/vegetation_ground/maps/` route 讀取，不放入正式 `public/`。

## 地標、車輛、室內：先看材質，再建立正確的消費器

本批是八種材質與試片，不是完整地標／汽車／室內重建。三個研究 GLB 共 1,176,944 bytes；每角色三張 256² maps，合計 24 張。base color 無烘焙日照；normal 為 OpenGL +Y；ORM 的 R=1、G=roughness、B=metallic。精確來源見 [role-materials/README.md](../tools/assets/role-materials/README.md)。

| 角色 | 每 UV 週期 | 研究 GLB／tris／bytes | 正式消費器需要完成的工作 |
|---|---:|---|---|
| brushed aluminum、pale panel | 1 m | landmark：4 meshes／1,080 tris／233,008 bytes | 逐部件檢查地標 UV、金屬／板材角色；保留玻璃與夜間窗光 |
| red paint、tire rubber、seat leather | 0.5 m | vehicle：6 meshes／1,860 tris／453,812 bytes | 補公尺 UV、拆分真實車身／輪胎／座椅角色，保留玻璃、車燈與駕駛 |
| terrazzo、oak veneer、matte plaster | 1 m | interior：6 meshes／1,620 tris／490,124 bytes | 補公尺 UV，按地板／木物件／牆面分組；保留 vertexColors、室內補光、展示互動 |

`roadster.ts` 的合批及 `interiors.ts` 的 `Parts.add` 目前刪除 UV，因此 maps 不能直接貼到既有 geometry。**roadster 的 `leather` key 現在實際用於駕駛頭部；座椅屬混合的 `dark` batch。** 按名稱替換會把皮革貼到頭部，按 `dark` 全替換則會連同儀表台、服裝及其他零件一起改動。此項須先做語意分組，不能靠顏色猜材質。

本次 `offline-material-study-qa.ts` 將原試片布局載入實際城市渲染器，檢查 16 meshes／8 materials／4,560 tris／24 textures；同相機 clear／overcast／dusk／night 四份 checkpoint 均有效。試片使用本機 QA route `/__offline-assets/`，不作為正式世界配置。材質研究已完成，正式套用仍延後，因為試片閱讀性不能替代上述 consumer UV／角色驗收。

## 市民：優先降低貼圖成本，保留完整近景幾何

| 版本 | Tris／vertices | 骨骼／動作 | 三張貼圖 | GLB bytes | RGBA8＋完整 mip 估算 |
|---|---:|---|---:|---:|---:|
| 原基準 | 37,799／29,048 | 22；idle／walk／run | 2048 px | 6,668,168 | 64 MiB |
| LOD0 候選 | 37,799／29,063 | 同上 | 1024 px | 3,498,312 | 16 MiB |
| LOD1 候選 | 30,825／24,559 | 同上 | 1024 px | 3,222,256 | 16 MiB |
| LOD2 候選 | 27,531／22,649 | 同上 | 512 px | 2,001,060 | 4 MiB |

表中 vertices 是 GLB 實際匯出數，包含 UV／法線 seam 拆分；與 authoring mesh 的頂點數不同。LOD0 比原版多 15 個匯出 seam vertices，原三角形、UV 拓撲、位置和動畫均由回歸核對。

LOD0 已選為正式載入預設：GLB 由 6,668,168 降為 3,498,312 bytes（約 −47.5%），貼圖估算由 64 降至 16 MiB（−75%）；三角形與骨架工作量沒有下降。實際 High／1080p 四光照 baseline 和 candidate 均有效，兩組 FPS 約 24.9–25.2，**沒有建立 FPS 提升證據**。本輪的採用收益是下載及貼圖成本，並保留完整近景拓撲。

既有 W 導航 8 秒的 baseline 距離為 32.976 m、candidate 32.888 m；兩者各自的 2／4／8 秒三份截圖均有效。這是實際輸入與 RAF 採樣結果，並非強制相同世界位移或合成角色 pose；未更改步行速度。

正式資產仍使用 `public/models/citizen/vancouver-citizen.glb`，URL 加 `?v=14d66fabe097` 避免命中舊 2048 貼圖的快取。原版保存於 [citizen/runtime-reference](../tools/assets/citizen/runtime-reference/README.md)，位於 `public/` 與不可變 handoff inventory 之外，僅本機 QA route 載入。原 optimization manifest 的舊 production-source 路徑是歷史記錄；應以目前 comparison test 和保留原版核對，不重跑生成／報告腳本覆寫該 inventory。`.blend` source 是從原正式 GLB 重建的可編輯來源，不是找回原作者雕塑／細分歷史。

`citizen.ts` 保持同一 public root、導航位置、接地與 contact shadow；載入替代件期間保留現有角色，驗證 idle／walk／run 後再交換。距離驅動步態相位、idle phase 與 blend weights 保留；過期 load 不附加，私有 mesh／material／texture／skeleton／ImageBitmap 依生命週期釋放；失敗保持上次可用角色。idle=2 s、walk=1 s／1 m stride、run=0.8 s／1.9 m stride；位移繼續由導航負責。

LOD1／2 已知後腰布料邊緣與局部 shading／UV 有差異，且目前沒有距離切換、fade 或避免重複 residency 的選擇器；故本次保留離線。1024 的採用限於本輪相機與光照結果，不代表任意臉部特寫無損；512 不能直接替代近拍角色。警員的帽子／徽章／制服配色是另一契約，本次不套用 citizen atlas。

## 實際場景比較與驗收門檻

比較採同一工作版本中的 baseline／candidate，固定城市來源物件和相機，避免不同地理配置混入判斷。本機 QA build 才顯示候選切換與捕捉工具；正式 build 需再次確認沒有診斷 UI、未採用的 GLB 或貼圖進入部署。

1. **人物**：切換 `baseline-2048`／`candidate-1024`，量測正常市民視角；另以既有 W 導航做 2／4／8 秒真實運動截圖。比較固定視角四光照與近景細節，檢查動畫、接地及載入失敗回退。相機一致不代表 idle 動作每個時間點完全一致，動畫畫面須記錄實際取樣語意。
2. **建築**：逐家庭框出具名來源 frontage；比較原 box／LOD0／LOD1。只有模板載入成功不夠，需 shared atlas ready、來源 cell 完成、可見 replacement >0；驗證沒有擴大 footprint、遮住 opening、穿牆或增加部件人口。
3. **葉片**：完整目標是同一既有 broadleaf／conifer 的 10／30／65 m 與四光照矩陣；本輪完成 broadleaf 10 m 四光照、broadleaf／conifer 30 m 晴天。其餘距離／光照保留未測狀態。查亮背景暈邊、細針葉、內冠色、陰影遮罩、LOD 邊界與既有 pool 數量；不得以 sprig 擴大人口。
4. **角色材質**：同一實際 renderer 中比較晴／陰／黃昏／夜的原試片布局；只驗收 PBR 閱讀性和載入／釋放，不驗收尚未存在的城市 consumer。

資產 checkpoint 使用 1920 ×1080 drawing buffer、至少可見 5 秒 warmup、8 秒未插入 CPU instrumentation 的 RAF sample，記錄 FPS、p50／p95 frame gap、calls、triangles、geometry／texture 計數、renderer、camera／target、來源候選狀態和 source fingerprint。四光照為 clear 14h、overcast 14h、clear 19.8h、clear 23h。單純角色材質試片是 2.5 秒 settling 後截圖，不提供 FPS 對照。

隱藏頁面、漂移相機、未完成載入或未顯示候選的捕捉不能算通過。draw counters 包含多 pass 工作，不是唯一 mesh tris；RAF frame gap 包含 CPU／GPU／瀏覽器排程，不是獨立 GPU timer。效能比較期間不併跑 Blender、build 或測試。

| 驗收項 | Baseline 證據 | Candidate 證據 | 視覺判斷／成本差 | 最終決策 |
|---|---|---|---|---|
| Citizen LOD0 正常視角與四光照 | `citizen-baseline-{clear,overcast,dusk,night}`，4/4 valid | `citizen-candidate-{clear,overcast,dusk,night}`，4/4 valid | baseline／candidate 約 24.9–25.2 FPS；下載 −47.5%、貼圖估算 −75%，沒有 FPS 提升證據 | 採用 LOD0 |
| Citizen 實際走動／接地 | `offline-baseline-2048-high-citizen-motion-{2,4,8}s`，3/3 valid | `offline-candidate-1024-high-citizen-motion-{2,4,8}s`，3/3 valid | 8 秒 32.976／32.888 m；導航速度維持 | 採用 LOD0 |
| Modern sill LOD0／1 | `modern-baseline-clear` valid | `modern-lod0-{clear,overcast,dusk,night}`＋`modern-lod1-clear`，5/5 valid | 24 個可見替換；晴天 30.78／30.67／30.34 FPS；局部風格細節 | QA 保留 |
| Cedar sill LOD0／1 | `cedar-baseline-clear` valid | `cedar-lod0-{clear,overcast,dusk,night}`＋`cedar-lod1-clear`，5/5 valid | 8 個可見替換；晴天 32.24／32.29／32.87 FPS；局部風格細節 | QA 保留 |
| 公園 broadleaf 10 m RGBA | `park-broadleaf-baseline-10m-{clear,overcast,dusk,night}`，4/4 valid | `park-broadleaf-candidate-10m-{clear,overcast,dusk,night}`，4/4 valid | 約 35–36 FPS，color／depth map 一致；候選形態較簡化；兩版 card 尺度仍需重整 | 正式採用延後 |
| Broadleaf／conifer 30 m 晴天 | `park-{broadleaf,conifer}-baseline-30m-clear`，2/2 valid | `park-{broadleaf,conifer}-candidate-30m-clear`，2/2 valid | broadleaf 37.73／37.82 FPS；conifer 36.75／36.86 FPS；輪廓沒有明確改善 | QA 完成；保留 baseline |
| 八角色實際 renderer 試片 | 不適用完整城市替換比較 | `offline-role-materials-{clear,overcast,dusk,night}`，4/4 valid | 8 材質、16 meshes、4,560 tris、24 textures；未接入城市 consumer | 材質研究完成；consumer 延後 |

人物、建築與角色試片的原始 PNG／JSON 保存於 `work/visual-qa/offline-assets-candidate/`（source fingerprint `ce82fd515ecd4c0228e266832763f5015e2bc9e3698d8ca82c0f373002c0fcdb`）；公園樹比較保存於 `work/visual-qa/offline-assets-final/`（fingerprint `1d4d32351062b2fc80a26aa1e7964ef9fb7007079f2f7671f3bc922d5412ebb0`）。不同樣區與工作版本的 FPS 不作交叉排名；每個 baseline／candidate 對照以相同 fingerprint 為準。已整理 [43 份有效紀錄、測量表與代表圖片](visual-quality/offline-assets/README.md)。紀錄的 `revision` 是擷取時的 base HEAD，當時修改尚未提交；`sourceFingerprint` 識別實際工作來源，不能把 base HEAD 誤當成完整實作版本。角色試片採用最後近景版本。最後 production-only fetch gate 修正不改變 QA=true 的載入行為；該修正後已重跑完整回歸與正式 build。

## 建構、回歸與發布紀錄

從 repository 根目錄執行。本次先做只讀完整性檢查，不以重新生成覆寫手動來源：

```sh
python3 tools/assets/offline-handoff/validate.py --report work/offline-assets-validation/source-integrity.json
npm run check
npm test
VANCOUVER_VISUAL_QA=1 VANCOUVER_STATIC_EXPORT=1 npm run build
node tools/serve-visual-qa.mjs offline-assets-candidate
# GPU 場景比較完成後，以正式建置再次排除 QA
npm run build:firebase
```

完整性結果為上述 273 個檔案通過；原 handoff inventory 保持不變。最後 `npm run check` 通過，`npm test` **651/651 通過、0 fail／skip**，`npm run build:firebase` 通過。正式 verifier 同時確認英文 HTML、十語系、地理資產、emitted landmark worker 初始化／訊息協定，以及候選 GLB／葉片 PNG／QA controls 排除。原 2048 市民及未採用的候選只保留在 tools，沒有進入正式部署目錄。

新增人物 evidence 後，早期一次回歸因 endurance mock 缺少真實導航的 `walker.group` 契約而失敗；已修正 fixture 並增加證據斷言。上述 651/651 是修正後最後完整重跑結果。測試摘要與 log hashes 見 [verification.json](visual-quality/offline-assets/verification.json)。

回歸涵蓋人物切換保留根節點與 gait、過期／失敗 load、不完整動作回退及私有資源釋放；葉片 color／depth coverage、一張 texture 的五 mip、QA gate、載入失敗；建築來源邊匹配、既有人口／cell cap、LOD bounds、原 box 恢復與預覽資源釋放。八角色試片清除或 engine 銷毀時，texture dispose 會關閉私有 ImageBitmap。

| 發布檢查 | 本次結果 |
|---|---|
| TypeScript／repository tests | 通過；651/651 tests，0 fail／skip |
| 正式 Firebase build／worker／QA 隔離 | 通過；正式 fetch 只使用已採用 public 市民 URL |
| 瀏覽器可見畫面與對照紀錄 | 43 份有效 QA 紀錄；正式版另外驗證城市載入、步行／第三人稱、時間控制和 QA UI 缺席，console warning／error 為空 |
| 正式採用項目與保留離線項目 | 採用 citizen LOD0；窗台／葉片 QA 保留，其餘來源延後正式 consumer |
| commit／push／combine to main | 交付版本依 [main 文件歷史](https://github.com/YiTaChen/vancouver-living-atlas/commits/main/docs/OFFLINE_ASSET_INTEGRATION_2026_10.md)及本次交付回覆核對 |
| main 推送後 Firebase workflow | 另以 [Deploy Firebase Hosting](https://github.com/YiTaChen/vancouver-living-atlas/actions/workflows/firebase-hosting.yml)的相同 head SHA 成功結果核對；本地 build 不作 Hosting 成功證據 |

素材來源保留和正式採用是兩個不同決策：完整可編輯來源可以合併為庫存，正式 runtime 只啟用有場景證據支持的版本。原創／專案自有來源沿用 repository [LICENSE](../LICENSE)；不新增第三方模型或改稱 CC0／商用素材。後續工作以 source ID、profile、部件尺寸、公尺 UV 和有上限的 consumer 規則擴展，避免逐物件修改世界 XYZ。
