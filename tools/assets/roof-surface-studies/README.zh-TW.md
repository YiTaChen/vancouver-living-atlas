# B02 平屋頂礦物顆粒／膜面接縫研究

Based on Vancouver Living Atlas by YiTaChen  
Source: https://github.com/YiTaChen/vancouver-living-atlas  
License: [Vancouver Living Atlas Noncommercial Research and Attribution 1.0](../../../LICENSE)

本包是原專案的新增離線研究修改。所有數學材質與 coupon 在本包製作，沒有使用外部照片、掃描、模型或貼圖。基準 commit：`5574d55719f10d1575127d8b92cbd23ff71e446f`。

**交付：B02 `offline_complete`；整合 `runtime_pending_webgl`。** 這是兩種可編輯材質、四個檢視用 GLB 和實際 CPU 渲染證據，不是城市材質已啟用、逐棟屋頂調查或效能改善。沒有修改 `public/`、現有材質包、runtime consumer、來源 footprint／holes、屋高、碰撞、seed 配色、10:00／300 倍時鐘。

## 新增內容

- `roof-mineral-grain`：礦物顆粒，保留原 `mineral-gravel` 的 `#93988e` 明度／色向。4D torus 上的 Voronoi 與 Noise 建立真正雙軸週期節點，pigment 與凹凸分開；並非把暗影畫進 base color。
- `roof-membrane-seams`：灰白塗膜，保留 `coated-membrane` 的 `#b9c0bb`。縱向焊接／搭接紋以 1 m 為間隔，端部接縫 2 m；整個表面重複單位為 **2 × 2 m**。接縫主要由法線表現，並非黑線或 AO。
- 每材質各有真正 **2 × 2 m、10 × 10 m** coupon；大 coupon 包含 5 × 5 個材質週期，不把同一張貼圖拉成 10 m。每 coupon 2 triangles、4 exported vertices、1 primitive。兩個尺寸是不同試片，**不是 LOD0／LOD1**；各自只有 LOD0。
- 各獨立 `.blend` 約 90 KiB，壓縮保存，含兩張原點置中的 mesh、公尺 UV、原始可修改節點。10 m mesh 預設隱藏，避免與 2 m 重疊；編輯時只顯示一張。不是從 GLB 匯回假造原始來源。

## 貼圖成本與 512 → 256 的取捨

實際使用 Cycles CPU 從節點先烘焙 **六張 512²** PNG，保存於 `source/textures/`。兩種材料若各帶三張 512² runtime maps，RGBA8＋完整 mip 的保守估算為 **8 MiB**，超出 B02 的 4 MiB 上限。因此以線性 color／data 的 2 × 2 area filter 降到六張 **256²**，normal 再歸一化，放在 `exports/textures/`。總新增唯一 runtime texel 估算為 **2 MiB**。

512² 的來源 bakes 是離線編輯／比對證據，不能隨 runtime 載入。此取捨使極近距礦物細粒與約 25 mm 膜面接縫較柔和；`qa/previews/*-grazing-detail.png` 誠實呈現 0.68 m 視野下的濾波。沒有用 PNG 檔案 bytes 代替解碼後成本，也沒有宣稱實際 GPU residency 已量測。

整合者可另比較「只啟用一種 512px 三 maps（4 MiB），另一種仍沿用既有 fallback」與本包「兩種皆 256px（2 MiB）」的近景收益。不能同時載入一組 512px 加另一組 256px，因為共 5 MiB 會超標；本包尚未做這項 WebGL 比較。

三 maps 契約：

- `color`：sRGB、不含預烘日照／陰影；由 Principled Base Color 接到 EMIT 真正烘焙。
- `normal`：Non-Color、tangent OpenGL **+Y**；Blender NORMAL bake，RGB 軸正向。使用 glTF tangent，不作第二次綠色反轉。
- `orm`：Non-Color、R 固定 1／G roughness／B metallic=0；EMIT 烘焙，沒有 AO。

每個 `.inspection.glb` 為方便查看而內嵌三张 256² maps。不同尺寸 GLB 會重複嵌圖；外部共享 maps 與 GLB 圖片的 SHA-256 完全相同。**正式整合只能按 surface ID 共用六 maps；不應在屋頂鋪上 coupon GLB，更不能把每個檢視 GLB 的貼圖當作已在執行時去重。** `manifest.json`／`qa/measurements.json` 分開列 GLB total、geometry（完整 GLB 減 image payload）、embedded images 與 unique texel bytes。

## 原點、軸向與材質接口

- 1 unit = 1 m。作者端 Blender Z-up，標準 glTF 匯出一次轉成 Y-up：`(x,y,z) → (x,z,-y)`。
- coupon 中心為原點，屋頂 attachment plane 為 glTF local Y=0，法線 +Y。2 m bounds 為 `[-1,0,-1]..[1,0,1]`；10 m 為 `[-5,0,-5]..[5,0,5]`。零厚度是有意的材質板，不是屋頂結構。
- 原始 `UVMap` 的 1 unit = 1 m；匯出暫存 mesh 將 UV 除以 2 一次，使 glTF 0..1 對應 2 m。來源的 geometry／UV 不被改寫。
- material name 與 `surfaceId` 明列在 manifest，不能依灰度推斷用途。GLB inspection plane 為 opaque／double-sided，便利正反面檢視；未來 GIS consumer 保持本身屋頂面設定。
- 沒有 collision、placement anchors、LOD 轉換或世界座標。所有圖中的尺、人形、文字、台座、相機、燈光都在 QA 場景，沒有進 GLB。

## 可重現命令

需求：Blender 4.3.2（本次實測）、Python 3＋numpy＋Pillow。單次只啟動一個 Blender，固定 CPU 2 threads；bake 8 samples、overview 12、detail 32。從 repository 根目錄執行。

```sh
# 只讀驗證：共通 contract、來源 hash、bounds、maps、真重匯入、渲染與來源修改證據
python3 tools/assets/roof-surface-studies/validate.py
python3 tools/assets/package-contract/validate.py tools/assets/roof-surface-studies
python3 tools/assets/roof-surface-studies/test_validate.py

# 從 .blend 重烘焙到獨立工作目錄；保留手動節點／geometry／UV 和來源 bytes
blender -b -t 2 --factory-startup --python-exit-code 1 \
  --python tools/assets/roof-surface-studies/build.py -- \
  --from-source tools/assets/roof-surface-studies/source \
  --output /tmp/roof-surface-reexport --render

# 原來源 roundtrip、真 2m 位移週期、藝術家 tint 修改、unsupported coat 拒絕測試
blender -b -t 2 --factory-startup --python-exit-code 1 \
  --python tools/assets/roof-surface-studies/test_source_edits.py

# 只重拍實際 GLB 的 grazing-angle close-up，不做圖像後製裁切
blender -b -t 2 --factory-startup --python-exit-code 1 \
  --python tools/assets/roof-surface-studies/render_details.py

# 在新目錄生成預設來源；有手改來源時不要執行 defaults 覆寫
blender -b -t 2 --factory-startup --python-exit-code 1 \
  --python tools/assets/roof-surface-studies/build.py -- \
  --defaults --output /tmp/roof-new-defaults --render
```

`build.py` 重用既有 city-materials exporter 的不透明 Principled 驗證、真正 Cycles bake、線性濾波、normal 歸一化與 PNG 寫出；沒有修改既有流程。來源的 `EDIT_BASE_TINT`、`EDIT_ROUGHNESS_BASE`、`EDIT_RELIEF_METRES`、grain scale 與 seam width 都可直接調整。保留材質 `surface_id`、mesh 名稱及 2 m tile contract。

匯出拒絕 unsupported coat、transmission、非 opaque alpha、displacement、shader mixes、view-dependent nodes 等，避免默默丟失效果。此流程支援指定不透明表面，並非任意 Blender shader 的一般轉換器。重新匯出後須重跑適用驗證／視覺審查；新的工作輸出不自動繼承本次 offline_complete。

## 真正完成的離線 QA

- 重開兩份壓縮來源，確認原始 procedural nodes；export 前後 source SHA-256 相同。
- 從原來源再 bake，六個 runtime maps 的 hash 全數相同。
- 在另存來源圖中於 UV 上游加入 `(2,2,0)` 公尺位移，再完整 bake，與原圖比較；驗證完整物理週期，容許 float／8-bit 量化誤差。
- 另存來源的礦物 tint 乘 0.8 再 bake，只有 mineral-color 改變，normal、ORM 與另一材質的 maps 不變。unsupported coat 明確拒絕。
- 四個實際 GLB 在空白 Blender 場景重新匯入，核尺寸、UV 範圍；共通 validator 對檔內 node transform 套用一次後量 bounds／tris／vertices／primitive／bytes，檢查 finite indices／normal／tangent、無 QA camera／light、PNG hashes、channel、roughness、neutral AO、無 metallic。
- **2 尺寸 × 晴／陰／黃昏／夜 = 8 張**實際重新匯入後的 Cycles CPU overview。加上每材質一張真正 camera close-up，共 **10 張**。固定 exposure=0；這是離線照明研究，不能冒稱城市天氣／WebGL 驗收。
- 1 m 尺、1.75 m 與 1.81 m QA 人形提供比例；night 刻意低光，overview 細節很淡，grazing 相機是檢查 normal 的補充，不是「材質全面改善」的宣稱。

證據在 `qa/export-report.json`、`source-edit-test.json`、`render-evidence.json`、`detail-render-evidence.json`、`visual-review.json`、`measurements.json`、`validation.json`、`handoff.json`。`qa/previews/` 全部為 inspection-only。

## 整合順序與仍未驗證項目

1. 先讀 `qa/handoff.json` 與 manifest，不啟用任何 coupon world placement。
2. 保留 `building-surface-palette.ts` 的 asphalt／mineral／membrane seed mix。此包只提供 mineral 與 membrane 的新表面候選，不能把所有屋頂刷成白色；來源沒有真實材料分類欄位。
3. 在 source-selected 平屋頂樣區提供 roof-local 公尺 UV、共享 map loader、same-source stable phase、平均色 fallback 與正確一次 sRGB→linear。保留 pitched shingle、專用 landmark membrane／glass／night windows。
4. 在相同城市相機及晴／陰／晚／夜做現有材質與候選對照，核 2 m 週期、遠近景 aliasing／fade、seam／normal 方向、平均明度、載入失敗 fallback、deduplication、dispose。
5. 另量測 CPU／GPU frame time、draw calls、unique texture residency 和快取行為後，才決定是否移入 `public/`。目前全部 `not_run`，沒有發布或正式啟用。

已知限制：沒有真正幾何 displacement／碎石輪廓／防水構造／屋頂排水；256px 近拍較軟；規則週期可能在大平面可見；normal 材質不增加可行走面或屋頂厚度。代表性設計尺寸不宣稱為任何建築或防水產品的實測／工程認證。
