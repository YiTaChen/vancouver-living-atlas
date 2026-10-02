# 植被、樹皮與土壤／草地交界：離線 Blender 資產交付

**狀態：已製作的獨立候選素材，尚未接入城市 runtime。** 不是 Phase D 全城效能／視覺驗收通過，不宣稱更高 FPS。所有新檔留在本目錄，未替換 `public/`、沒有新增樹木或地面實例。

## 實際新增哪些資產

- `source/vegetation_ground.blend`：可編輯網格、各資產／LOD 獨立具名 collection、PBR 節點、內嵌貼圖及完整生成 Python 原始碼。使用公尺；地面 patch 為 2×2 m，植物為約 1.25 m 的**代表性幼樹／枝條研究件**，不是 GIS 成年行道樹的等比例替代。
- `maps/leaf_atlas_rgba.png`：1024² 原創四色塊 straight-RGBA 葉簇 atlas。影像左上 maple、右上 alder、左下 Douglas-fir、右下 western redcedar；具掌狀／橢圓葉、針葉／扁平鱗葉區別與葉脈。形態為代表性程序造型，並非植物學測量或掃描。
- `exports/{maple,alder,douglas_fir,western_redcedar}_sprig_lod{0,1,2}.glb`：12 個獨立 GLB；每個含不透明木質部分和雙面 alpha-cutout 折疊葉卡，最多 2 primitives。三 LOD 保留主要枝端，減少葉卡和樹枝徑向段數；不是 billboard。切換輪廓和薄針葉仍須實際相機檢查。
- `maps/bark_{basecolor,normal,orm}.png`：512² 縱向樹皮 PBR，實體重複範圍 0.8×1.6 m。原創週期凹槽及顆粒，沒有照片、外部材質或烘焙照明。
- `maps/{soil,grass,soil_grass_edge}_{basecolor,normal,orm}.png`：9 張 512² 地面 PBR 圖；土壤、低草表面及有起伏邊界的土草混合各一組，2×2 m。soil/grass 可雙軸 repeat；edge **僅 V repeat，U 左土右草，不可 U repeat**；交付地面 GLB 已明確設定 U=CLAMP_TO_EDGE、V=REPEAT。
- `maps/soil_grass_blend_weight.png`：512² 真正程序噪聲邊界權重，供自行實作双材質混合。GLB 已使用預混合貼圖，沒有增加雙材質繪製成本。GLB 的 `_GRASS_WEIGHT` 自訂 scalar attribute 只是低頻預覽權重，不等同逐像素遮罩。
- `exports/soil_grass_slope_lod{0,1,2}.glb`：三件 2×2 m 小斜坡的土草接界，512／128／32 triangles。UV 0..1，含低頻權重，僅代表受控樣區，不是新的全城 overlay。
- `maps/leaf_mip_*`、`alpha-coverage.json`：1024→64 五層每種葉片的 cutoff=0.4 覆蓋率與校正參考圖。每 cell 獨立調 alpha、保留邊緣 RGB，避免白色背景暈邊。**GLB 不會自動使用這套 mip 檔**；runtime 必須明確選用經驗證的 texture mip upload／壓縮流程。最低層的針葉形狀仍可能改變；覆蓋率相同不代表樹冠投影相同。
- `previews/vegetation_ground_board.png`：Blender Cycles CPU 實際總覽。前方為來源葉簇與三個土草斜坡；後方四欄由左至右為 maple、alder、Douglas-fir、western redcedar，各三個 LOD。植物由前排至後排依序 LOD0／1／2（188／136／80 triangles）；地面由左至右 LOD0／1／2（512／128／32 triangles）。每個植物最高約 1.25 m，每片地面 2×2 m；展示間距不屬於要整合的 mesh。
- `manifest.json`、`validation.json`、`source-roundtrip.json`、`export-edit-safety.json`：資產名稱、三角形、圖元、尺寸、byte、map SHA256 與來源重匯出證據。

既有 `tools/assets/residential-perennial/` 的 7-triangle perennial 是之前的獨立交付，本批不重製、不變更其 QA-only 狀態。現有成熟樹冠 procedural geometry、來源樹／補植分佈與人口不修改。

## 最重要的整合契約

1. **本 RGBA atlas 不能直接覆蓋現有 leaf-atlas.png。** `lib/city/detailed-trees.ts` 現在以 RGB 中最小通道去 neutral matte，且 `aSolid` 保護內部冠體；depth material 也有相同 patch。新候選 GLB 採標準 straight RGBA、alphaMode MASK、alphaCutoff 0.4、doubleSided；basecolor 是 sRGB，alpha 是線性 coverage。將新 RGBA 丟進舊 RGB decoder 會再次解碼並造成顏色／透明度錯誤。
2. 若採用新 atlas，須一起更新 color/depth/shadow 的 coverage 與 `aSolid` 路徑，重新選取 `TREE_SOLID_UV` 的實心色位置。保留既有兩行兩列物種順序和 0.008 cell 內縮只是 UV 起點，不代表舊實心採樣點可用。透明 RGB 保留色彩延拓，不應以 min(RGB)推回 alpha。
3. `.blend` 中 `DITHERED` 用於 Blender 預覽，Blender 4.3 glTF exporter 預設會寫 BLEND；生成器 `export_group` 對 GLB JSON 明確設定 MASK/.4/doubleSided。手動 Export 若跳過這步，不能視為等價交付。
4. Bark 和 ground 必須保持不透明；normal 與 ORM 使用 Non-Color／線性，normal 為 OpenGL +Y；ORM 的 R=1（無 baked AO）、G=roughness、B=0 metalness。不要將新 normal 當舊 bark albedo bump。可先只評估 albedo，再量測增加 normal/ORM 的收益。
5. 地面接界应替換已選定的既有表面或在同一 shader 混合，不能全城疊加共面 patch（z fighting／draw calls）。terrain drape、道路／入口／鄰地排除、坡地接地與走動碰撞仍由既有來源及邏輯決定。
6. 先選單一來源樣區、固定來源 ID／種子／位置／人口；不要用本 sprig GLB 取代所有成熟樹，也不要把三個 LOD 同時加到場景。三 LOD 在 glTF 中是各自檔案，未使用非標準 LOD extension。相同材質應共用和 instancing；不得把候選貼圖重複載入為每棵樹獨立 texture。

## 成本與限制

所有實際計數以 `manifest.json` 為準。每 sprig 上限 208 triangles、2 primitives；地面上限 512 triangles、1 primitive；沒有新增 population。12 個 sprig GLB **各自內嵌相同 atlas 和 bark maps**，是可攜檢查件，不能把檔案總和當成最佳 runtime bundle。整合時應共用貼圖／材質，只取必要 LOD。

RGBA8 +完整 mip 鏈估算：leaf 1024² 約 5.33 MiB；每組 3×512² PBR 約 4 MiB。leaf+bark+soil+grass+edge 共約 **21.33 MiB**；另選用 512² blend weight 約 1.33 MiB，全部約 **22.67 MiB**。這是未壓縮資源規劃，不是實際 GPU allocation。mip 參考 PNG 不應再各自載入成五張 runtime texture。KTX2、各手機 GPU、色彩/深度雙 pass、投影 overdraw 和 frame time 尚未測量。

## 重建與驗證

在 repository root 執行（Blender 4.3.2，本機 CPU 2 threads；不需下載素材）：

```sh
blender -b -t 2 --python-exit-code 1 --python tools/assets/vegetation_ground/build_vegetation_ground.py
python3 tools/assets/vegetation_ground/validate_vegetation_ground.py
blender -b -t 2 --python-exit-code 1 --python tools/assets/vegetation_ground/audit_source_roundtrip.py
blender -b -t 2 --python-exit-code 1 --python tools/assets/vegetation_ground/test_export_edit_safety.py
```

修改已存 .blend 後請用下面的安全匯出命令，**不要用 build 腳本保留手動修改**（build 會從參數完整重建來源）：

```sh
blender -b -t 2 --python-exit-code 1 --python tools/assets/vegetation_ground/export_from_source.py -- --source tools/assets/vegetation_ground/source/vegetation_ground.blend --output /tmp/vegetation-edited
```

安全 exporter 不重建貼圖／網格、不儲存或覆寫 .blend；會驗證 source SHA256 未變，輸出15個 GLB 與 export-report.json。可編輯 mesh/UV、物件 transform、既有 PBR 貼圖與支援節點數值，修改貼圖後必須在 Blender 重新 Pack Resources。超出直接 image→Principled、normal-map、ORM 分離的 shader graph、未套用 modifiers、animation/parent、未 pack 圖片或 >1024 圖片會拒絕匯出，而非默默丟棄。build 和 exporter 都有 main guard，import 不執行生成／export。

每個資產在 .blend 有同名 collection；為了總覽，location 含展示位移，`display_offset` metadata 記錄原始展示值。exporter 只扣除此值，保留後續 transform/mesh 編輯，並自動套用 MASK/.4/doubleSided、自訂 ground attribute 和 U-clamp/V-repeat。**不要修改 display_offset 作為造型調整。** roundtrip audit 直接呼叫此真實交付 exporter，比對 geometry attributes/indices、內嵌 PNG bytes、materials 與 samplers（含 alpha/wrap）。

驗證涵蓋 GLB header/buffer、索引、非退化面、finite UV/position、unit normals、材質 alpha 分離、貼圖 CRC/SHA256/尺寸、mip coverage 與來源 roundtrip；安全匯出回歸測試另外證實 mesh 與 object translation 修改未遺失、source SHA256 未變及未支援節點會拒絕；並檢視實際離線 render。**這些不等於 WebGL／手機驗證。** 尚須晴天／陰天／黃昏／夜晚、近中遠 LOD 與風格一致性、亮背景細針葉、陰影輪廓、坡地與 grazing angles、GPU／memory／frame time 才可決定是否整合。

## 來源與授權

本批葉形、樹枝、樹皮與地面均由附帶程式原創生成；沒有第三方圖片、生成圖片服务、下載模型、掃描或訓練來源素材。依本 repository LICENSE 使用；不能把本批標為 CC0/MIT 素材包。

Based on Vancouver Living Atlas by YiTaChen
Source: https://github.com/YiTaChen/vancouver-living-atlas
License: Vancouver Living Atlas Noncommercial Research and Attribution 1.0
