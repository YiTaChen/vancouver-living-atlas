# 地表、局部接界與小型植栽：離線交付

Based on Vancouver Living Atlas by YiTaChen  
Source: https://github.com/YiTaChen/vancouver-living-atlas  
License: Vancouver Living Atlas Noncommercial Research and Attribution 1.0（沿用 repository LICENSE）

狀態：離線製作與 CPU 驗證 `offline_complete`；城市整合 `runtime_pending_webgl`。本包補 A02 缺少的真正 10 m 表面試片及砂地研究，另交 C04／F03 局部模型。**沒有改動正式 consumer、public、舊素材包、全城地形／海岸／道路／walk／collision，也沒有新增花草人口或部署。** 舊 city-scale-audit 的 partial 報告保留為當時記錄；本包是補充證據，不能回寫成它當時已完成。

2026-10-03 consumer 整合後，來源參照中的 `lib/city/*.ts`／`*.js` SHA 依本包完整 `baseRevision`（`752cd68b2664d7d87d1c89e31de2308b145ced3a`）核對不可變 Git blob；所有歷史 SHA 保留。GIS（包括 `lib/city/` 下的來源 JSON）、source `.blend`、GLB、PNG、atlas 像素／色彩、植栽 cohort 與配置檔仍核對當前工作樹，沒有放寬 geometry／UV／模型契約。缺少歷史 revision 明確失敗並提示取得完整歷史，不以當前 consumer 代替。依賴最小化回歸 `tests/blender-historical-source-hashes.test.mjs` 驗證偽造歷史 SHA、當前 GIS 差異與缺失 commit 都拒絕；它不需要 Blender、Pillow 或 WebGL。

## 交付物與用途

- 六種表面：soil、grass、sand、concrete、asphalt、street-brick，各有真正 2×2 m 與 10×10 m 的平面研究件。每件只有兩個三角形；不是把 2 m 斜坡放大，不是可鋪全城的 terrain patch。試片没有世界配置、导航高度或碰撞。
- 1 m 混凝土路緣：0.18 m 寬、0.15 m 高，近景保留 20-triangle 倒角斷面，遠景 12 triangles。依實際來源 contour 分段，不能放大斷面來追坡。
- 1 m 土草邊界：0.4 m 寬；從既有 2 m 表面裁出 U=0.4–0.6，V 長度為 0.5 個週期。保留公尺尺度，沒有把整張 2 m 圖縮成 0.4 m。只替代已選定表面局部或供同 shader 混合研究，不增一層全城共面 overlay。
- 中空方形花台：0.8×0.5×0.6 m（W×H×D），與中空圓花台：0.65×0.4×0.65 m。外殼與土壤兩個 semantic roles；上方真正凹入，不用實心盒子冒充可栽植內部。
- rosette 低植株高 0.30 m、tuft 高 0.45 m；實體薄葉面、opaque 雙面材質，兩個 LOD。維持既有低多年生植物的局部尺寸研究身份；不修改既有七三角形 perennial，也不是把 1.25 m sprig 縮放當成新地被來源。
- 六件局部模型各有兩個可編輯來源／兩 LOD。12 件 coupon 各一個 LOD；再簡化兩三角形平面沒有實益。總計 24 個模型來源，另有一個可改 procedural nodes 的砂地 master。

每個 `.blend` 都是壓縮保存的真正原始網格／UV／材質節點。砂地 master 保留 4D 週期程序節點，以現有 city-materials 的 Cycles CPU bake 流程輸出 512² color／normal／ORM。沒有以 GLB 重匯入偽造製作來源，也沒有第三方照片／掃描／下載模型。

## 正式模型、檢視模型、來源參照分開

- `exports/<prop>.lodN.glb` 是待整合的 role-only 幾何：沒有內嵌／外掛私有貼圖。供 consumer 根據 `role-concrete`、`role-soil`、`role-foliage`、`role-soil-grass-edge` 明確綁定。
- `*.inspection.glb` 是實際可重匯入的貼圖檢视版；所有 PNG 外掛到同一個 `exports/textures/`，按 SHA-256 去重，不在每個 GLB 內複製。表面 coupon 本來就是研究件，因此只交 inspection 版。
- `manifest.json` 的 assets 使用共通 package-contract schema。`placement-reference.json`、`source-references.json` 是 `referenceOnly` 配置／來源證據，不冒充模型或正式 geographic placement。
- 現有 production city atlas 以其原始 hash 和 catalog 引用。檢視版裁取同一 padded pixel-center slot，不再次套 sRGB gamma；CPU 檢查裁切 PNG 的像素與原 atlas 相同。現有 shader 的距離 fade／導數處理不在 Blender 中重現。
- 植被來源貼圖雖然重用，**並不代表它們已在 production 常駐**。完整 inspection 組使用的所有 unique PNG／完整 RGBA8 mip 估算全部列入 `qa/measurements.json`；不能宣稱增量為零。單獨採用既有三張 512² 地面 maps 約 4 MiB；砂地新三 maps 也約 4 MiB。部署時應按實際挑選的表面再做 budget，不同時自動載入整個研究板。
- B-PROP 正式模型的新增私有 map 成本為零，各 LOD 幾何均低於 1,000／200 triangles、192／48 KiB、最多兩個 primitives。檢視／研究資源另計，不將它們假裝為零成本 runtime 貼圖。

## 軸向、公尺 UV 與接界語意

作者端 Z-up；glTF 只做一次 `(x,y,z) → (x,z,-y)`，1 unit=1 m，local Y=0 是現有地面的接觸基準。固定模型不非等比拉伸。植株為代表性局部幾何，輪廓可因 LOD 減少葉片，但高度／原點保持一致。

UVMap 已是「公尺座標除以表面 tileMeters」後的 tile coordinates：soil／grass／sand／edge 為 2 m；concrete 1.5 m；asphalt 3 m；street-brick 1.92 m。若接現有要求公尺 UV 的 city shader，先乘回 catalog tileMeters 一次，不能再除第二次。

- soil、grass、sand 與 city 檢視表面：repeat U／V。
- edge 檢視 GLB 的實際 glTF sampler：U `CLAMP_TO_EDGE`（33071），V `REPEAT`（10497）。包驗證器讀取檔案本身檢查。
- `_GRASS_WEIGHT` 是 0–1 線性低頻 vertex 研究屬性，不是逐像素噪聲 mask。既有 `soil_grass_blend_weight.png` 仍是另一份高頻像素權重來源；不能拿前者當後者，也不能由底色猜混合權重。
- Base color=sRGB；normal／ORM=Non-Color；normal=OpenGL +Y；ORM 的 R=1（中性 AO）、G=roughness、B=metallic。底色沒有烘入照明或陰影。

## 實際來源、正反例與坡地契約

`source_selection.mjs` 執行既有 canonical CPU 地面 fixture、building profile 與 residential selector，依原有 stable source／seed 順序取樣，不自訂世界 XYZ。確認原 500 plots／977 beds／1,954 plants，並逐一保留來源、terrain／roads／navigation protected-state hash。

- 第一個實際 accepted bed，來源 building `137668`：whole-contour relief 約 0.05570 m。大於 rigid planter 0.02 m 容差，**平底花台配置拒絕**；不抬高／攤平地形掩蓋問題。
- 依相同順序找到的第二個 accepted bed，仍為 `137668`：whole-contour relief 約 0.00676 m，0.8×0.6 m 的花台 footprint 全部包含在既有 bed 內；四角地形差約 0.00290 m，含蓋面積 0.48 m²。這是 positive geometric-fit fixture，沒有真的放置花台或改動原 plant slots。後續仍須檢查完整 footprint 內的 rendered triangles、土台／植株接觸與新 collision 決策。

一般契約：保留 footprint holes、來源邊界及 actual rendered triangle 分割；bed 高差最多 0.5 m、相對 anchor 最多 0.45 m，沿用 surface offset 0.012 m。剛性件最大底高差 0.02 m；不合時跳過或另做明確 source-specific 階梯件，不能靠伸縮斷面處理。排除 roads／sidewalk walk-surface triangles、建築及鄰 bed；保留入口 ±1.45 m gap、門片掃掠及原通行走廊。既有 bed 可恰好接觸 2.9 m 保留區邊界，但不得有面積重疊；新剛性件另需 inset。所有判斷重新使用當前 rendered surface，不將較粗 elevation 函式當成真實腳下平面。

沒有完整地面 consumer 接線時，以上均保留為離線研究。局部表面不能自動成為新的可走地板。低植株只可考慮替換原有每 bed 的兩個位置，不增加人口；新花台 collision 不自動啟用。

## 重建、保留手工修改與驗證

從 repository root：

```sh
# 原始 defaults 重建會覆寫本包作者源；只在刻意重建時執行。
blender -b -t 2 --python-exit-code 1 --python tools/assets/ground-planting-details/build.py -- --defaults
# 正常 artist 工作使用保留来源 exporter，輸出到新資料夾。
blender -b -t 2 --python-exit-code 1 --python tools/assets/ground-planting-details/export.py -- --source tools/assets/ground-planting-details/source --output /tmp/ground-edited
node tools/assets/ground-planting-details/source_selection.mjs
blender -b -t 2 --python-exit-code 1 --python tools/assets/ground-planting-details/artist_edit_test.py
blender -b -t 2 --python-exit-code 1 --python tools/assets/ground-planting-details/sand_edit_test.py
blender -b -t 2 --python-exit-code 1 --python tools/assets/ground-planting-details/render.py
python tools/assets/ground-planting-details/validate.py
python tools/assets/ground-planting-details/test_validate.py
python tools/assets/package-contract/validate.py tools/assets/ground-planting-details
```

模型 exporter 直接讀取現存 source 的 mesh／UV／transform／opaque Principled 值，不重建 defaults、不回存來源。n-gon 只在記憶體私有 mesh copy 做三角化，以輸出有效 tangent；原始可編輯面保留。未支援的 shader nodes、modifier、rig／animation、負 determinant 會明確拒絕，不默默丟失編輯。inspection 貼圖是明記的 catalog binding；它不宣稱能保留任意自訂 shader graph。砂地 master 改節點後，對同一 export 命令加上 `--rebake-sand` 並指定新的 `--output` 資料夾；它讀取編輯後 master，512² CPU rebake，再讓 surface-sand GLB 綁定新 maps，且拒絕寫回來源資料夾。此專用流程不能當作任意 procedural model shader 的通用 baker。

`qa/artist-edit-proof.json` 證明全部 GLB 可由原 source 重匯出為相同 bytes，且路緣／方花台／植株的 mesh、UV、roughness 修改經實際 exporter 保留；原檔 hash 未變。`qa/sand-edit-proof.json` 證明真正修改 master tint 節點會改變 512² CPU bake，未覆寫原始 source。

## 實際驗證與下一步

- 共通 validator：來源／GLB hash、套用 node transform 一次的 bounds、finite positions／normals／UV／tangents、indices／退化面、counts／bytes、沒有 QA camera/light。
- 本包 validator：真正 2／10 m 平面與 UV 週期、edge sampler／權重、尺寸、地面 datum、兩 LOD／成本、來源人口及 protected hash、PNG channels 和 atlas 裁切色彩。
- 實際空場景重匯入全部 36 個 GLB，量測 bounds。32 張 Cycles CPU 圖：2 m／10 m coupon、兩個 prop LOD，各 oblique／grazing、clear／overcast／dusk／night。1 m 尺及 1.75／1.81 m 人形只在 QA scene，不進 GLB。
- 現有 dist/client 的 payload／檔名隔離掃描通過：110 個本包內容 hash、72 個輸出檔，沒有候選資產滲入。這不是本包重跑整體 build 或 browser network 驗收。
- 22 個正／負測試涵蓋錯 sampler、缺 weight、錯 UV、NaN、退化三角形、負 scale、QA camera、道路跨越／包含、門／holes 排除、缺來源／地面樣本、坡度正反例。

未測項目：城市 WebGL 實際來源配置、色彩與 atlas-distance fade、坡地 grazing 接縫、完整連續 LOD／陰影、可走高度／碰撞、cache／instancing／重複 dispose／context-loss、GPU memory／frame time／手機。10 m 檢視圖可能顯示原 street-brick atlas 的重複節奏或遠距 alias；現有 renderer 有自己的 footprint fade，不能憑 Blender 圖宣稱已改善城市畫面。下一個整合 agent 先選上述單一 source fixture，按材質 role 綁定、精確 drape／排除並做 WebGL 對照，再決定採用；不要把整個 coupon 板載入城市。
