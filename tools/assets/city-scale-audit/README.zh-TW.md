# A01–A04 城市尺度來源與 CPU 契約

本包只新增來源規則、可重現 CPU 對照及交接證據。沒有修改 `public/`、城市來源、runtime、來源 Blender、正式材質或地標；沒有匯出替代整城 GLB。基準 HEAD：`5574d55719f10d1575127d8b92cbd23ff71e446f`。實際輸入以 `qa/source-hashes.json` 的逐檔 SHA-256 為準，不能只靠 HEAD 判斷工作樹。

2026-10-03 整合時，runtime 可合法新增已驗證的資產 consumer。因此 `lib/city/*.ts`／`*.js` 的交接 SHA 改為核對完整 `baseRevision` 的不可變 Git blob，歷史 SHA 不會被當前整合覆寫；數值稽核仍執行當前 TypeScript consumer 和當前 GIS。其餘 GIS（包括 `lib/city/` 的來源 JSON）、GLB、PNG、Blender、規則、工具、來源文件仍核對工作樹。缺少歷史 commit 時明確失敗並提示取得完整歷史，不回退到當前檔案。工具自身 SHA／總 fingerprint 隨這次明確驗證器修改更新，建築 ledger、來源幾何、A01–A04 數值及 WebGL `not_run` 狀態不變；遷移逐檔差異記錄於 `qa/hash-contract-migration.json`。

**整包狀態是 `partial`。** A01 的來源規則／數值對照、A03 的 CPU 研究、A04 的來源核對已完成各自離線範圍；A02 尚缺 10×10 m 實際 coupon 與新四條件 CPU 渲染。所有 WebGL、城市畫面改善、效能與發布均 `not_run`。本包不引用歷史截圖為本輪通過證據。

## 實際結果

- 7,630 個 source solids、7,806 個 polygon parts、261 個 holes；7,630 個 feature ID 都唯一且有有限高度／基底／minHeight。CoV 2009 6,505 筆，協調後 OSM 1,125 筆；OSM 結構、原 sourceIds、baseSource 與 reconciliation 欄位完整。
- 沿用現有地標／SeaBus 去重後，7,794 個 polygon parts、3,370 個 structure 進入 generic building 契約。完整對照是 `qa/buildings.jsonl`，每列有 feature/polygon index、來源 polygon hash、source IDs、來源與顯示高度、datum、profile、seed 及屋頂結果。
- 676 個 parts 通過現有 source-tagged gable 條件；其餘 7,118 個維持平頂回退。沒有新增實測屋頂材料欄位，三種平頂 finish 仍屬代表性 seeded 外觀。原始 roof tag 分布與 profile/finish 分布均在報告中，不把 `Pitched` tag 全部宣稱為精確雙坡屋頂。
- **32 筆 source height 小於 2 m，現有 consumer 會夾到 2 m。** 本包逐列記錄來源值與有效值，不改寫資料，也不謊稱目前每個顯示高度完全等於原始值。`sourceVolumeY` 用原始 `base+minHeight` 至 `base+height`，不使用顯示夾限後的數字。
- **1,121 個 structure 若反轉 part 順序，first-part datum 會改變。** Profile／finish 實際函式在反序下穩定；共同地基仍按原第一 part 外環頂點平均中心取 `elevation - 0.4`。這是既有相容性限制，不能為了排序或材質工作偷偷換成最大 podium 的中心。每個對照的 ID、原／反序 datum 及差值都保留。
- 24 個 CoV bridge features 的每個頂點都核對到 `roads.geojson` 指定 source feature/line 的**連續正序或反序子列**（依既有準備工具取 7 位小數）。其餘 21 個 OSM bridge/causeway features 保留 ID／URL，但原始 Overpass 幾何未重取，標 `not_run`，不假裝完整 provenance 已再次驗證。
- 執行現有橋梁 consumer 的 junction-height solver，以及實際 rail path 函式。三條軌道所有 segment spans 有 sourceId 歸屬；generated 最大坡度依序為 0.025、0.03154604、0.02483172，均在既有 0.025／0.055 門檻內。橋寬、橋面高及軌道高仍是來源明記的展示估計。

## 檔案與方法

- `source-rules.json`：A01–A04 的機器可讀規則、datum、roof gates、finish 分布、coupon／時鐘／結構限制。
- `audit.mjs`：讀取真實來源，呼叫現行 TypeScript 匯出函式，重新產生所有 CPU 證據。
- `cpu-modules.mjs`：只讀 TypeScript loader；直接抽取 engine 的 `elevation/rawElevation` 方法，搭配真實 `BeachGround`。不把自寫近似 bilinear 函式當成 consumer。
- `audit.test.mjs`：13 個回歸案例，包括反序穩定性、source clamp／datum 陷阱、無效輸入拒絕、實際 GLB、來源子列、clock 獨立與 deterministic report；新增歷史 SHA 偽造、當前 GIS 差異與缺失歷史的拒絕。
- `qa/report.json`：四項結果、精確數字、confidence、來源限制、缺口與未測項目。
- `qa/buildings.jsonl`：7,794 個 accepted polygon parts 的完整數值 ledger。這是 CPU 對照資料，不是另一份城市 geometry 或 runtime 配置檔。
- `qa/source-hashes.json`：實際消費的 TS、JSON、GLB、PNG、來源 Blender 與規格文件 SHA-256。包含 audit／loader 自身，來源檔沒有重烘焙或覆寫。
- `qa/handoff.json`：逐任務範圍與狀態，無任何 replacement 或正式採用。
- `manifest.json`：本包特用 `vancouver-city-scale-source-audit/1`；`assets`／`textures` 為空，因為這是 A 類 source audit，不冒充 `.blend`／GLB 製作包。未覆寫其他 package schema。

建築前處理與列管規則依實際 consumer 對照；profile／roof／palette、clock、sky、water、bus、rail 使用實際匯出函式。地基使用實際 engine 方法與 beach override。橋梁只執行原 consumer 在建立 mesh 前的高度 solver，報告明確限定為 source graph 的共享節點連續性，並非完整橋面視覺／碰撞驗收。

所有來源 polygons 檢查 closed ring 與 finite coordinates；**沒有重跑 polygon 自交、三維 building overlap 或完整 GIS 拓撲驗證**。原始資料 acquisition／reconciliation 未重新執行；來源連結是既有 attribution，不宣稱本輪上網重核。

## A02 既有表面與 coupon 交接

沿用 `city-materials/catalog.json` 與正式 material manifest 的八種物理週期，程式核對兩邊 tileMeters 相同，計算各自 2 m／10 m 面積的 UV repeat 數。這些數字是研究配置，**不是新渲染**。

對 `vegetation_ground` 的三個實際 `soil_grass_slope_lod*.glb` 解析 GLB binary、POSITION／UV、scene/node transforms，只套用 transform 一次，得到 glTF Y-up size **2×0.1×2 m**、512／128／32 tris、UV 0..1。逐一核對實際 bytes、bounds、opaque role 與 **U clamp／V repeat**。GLB 總 bytes、嵌圖 bytes、其餘 geometry/container bytes 分開，不能把嵌圖檢查件當成最佳 runtime bundle。

現有 soil／grass／edge／weight 共 10 個 map 檔，依 SHA-256 去重成 9 個（soil ORM 與 edge ORM 相同）；全部實測 512²。RGBA8＋完整 mip 保守估算約 12 MiB，是去重後這組 maps 的估算，**不是 GPU allocation**。PNG 的簽章、尺寸、bytes、hash 本輪核對；像素通道語意／CRC／Blender 節點仍依原 package 契約，未重新烘焙。

後續研究保持：

1. Soil／grass 可雙軸 repeat，2 m 週期在 10 m coupon 上為 5×5。
2. Edge U 只是一條土到草過渡，不能把 U 重複五次；10 m coupon 要保留 2 m 過渡帶，或設計明確的雙材質 blend mapping，V 才可 repeat。
3. 補實際 2×2／10×10 m 來源、匯出／重匯入及晴／陰／黃昏／夜四條件 CPU render，記錄 camera/light/hash，之後才評估改善。
4. 八材質 catalog 無新 sand 表面，ground 候選無完整 path/sand consumer。本包沒有憑空新增材料，也沒有把 2 m slope 複製鋪滿城市。
5. Terrain drape、道路／入口排除、真實三角形接地與 navigation 屬後續整合；coupon 不能新增可走地板。

## A03 時鐘、水與天空證據

實際 `CityClock` 驗證 10:00／300×／running、60 s→15:00、126 s→20:30、156 s→23:00，含不同 frame 分割、hidden-page 暫停及首次夜晚 auto aurora。Aurora 是展示循環，沒有天文預報聲明。

使用相同 60 個真實秒，clock rate=1、rate=300 及 paused 的實際 bus updater 都得到同一 480 m 位移；rail-head／sea-wave 函式亦相同。Engine 的真實 seconds/delta call site 與 railway delta clamp 同時受來源 guard 檢查。另有兩種天氣／八時刻 finite atmosphere 數值及 sea/lake 各 1,764 個 wave 樣本；界限分別為 ±0.415 m／±0.021 m。

此處不是完整 engine 畫面 replay，不驗 shader compilation、實際反射、霧、陰影、角色輸入、GPU 或 frame time。保留專用 water/sky shaders，不作 Blender 材質替換。

## A04 不新增無依據模型

Existing Lions 外側欄桿 consumer 已依 OSM `70954668`／`70954672` 路徑與 tower openings 配置，程式也已有密集欄條與主柱。單憑 primitive 類型不能推論缺少可見接頭或需要重建。本輪沒有 source-backed close-view deficit，所以 `namedCloseStructureProposals=[]`。

後續只有取得具名支座／護欄／接頭的來源外觀與尺度，並證實現有近景確有缺口，才提 B-PART 新件。不能為使車輛模型好看而改橋寬／跨度／rail corridor，也不能把三段展示軌道當成完整營運或搭乘路線。

## 精確重現命令

從 repository root 執行。需要已安裝本專案 dependencies（Node.js 22.13+、Three.js／TypeScript）；本輪實際 Node.js 24.19.0。沒有 network、Blender 或 WebGL 要求，也不啟動完整 build。

```sh
# 預設只讀核對。任何 input/report 差異均失敗；不自動更新基準。
node tools/assets/city-scale-audit/audit.mjs --check

# 13 個 CPU 回歸，包含存檔 evidence 與重新計算完全相同。
node --test tools/assets/city-scale-audit/audit.test.mjs

# 只有在檢視來源差異、確認規則仍相容後，才主動更新本包 qa/。
node tools/assets/city-scale-audit/audit.mjs --write
```

audit.mjs 的 JSON／JSONL 不含機器絕對路徑、時間戳或不穩定耗時；相同來源重新產生可逐 bytes 比較。`--write` 只寫本包 `qa/`，不修改來源或 consumer。測試故意錯誤資料用記憶體 fixture，不改 public data。完整 repository TypeScript／build／deployment 由整合者另記，本包沒有替它們宣稱通過。

## 授權

Based on Vancouver Living Atlas by YiTaChen  
Source: https://github.com/YiTaChen/vancouver-living-atlas  
License: Vancouver Living Atlas Noncommercial Research and Attribution 1.0

City of Vancouver 與 OpenStreetMap 等地理來源維持原 attribution／license。沒有下載、複製或新增外部模型、照片、掃描材質或商用資產。
