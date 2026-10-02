# 地標、車輛與室內 PBR 材質離線交付

**狀態：8 種原創材質、可編輯 Blender 來源、24 張烘焙 maps、3 組材質研究 GLB 已製作；未接入 runtime。** 這些 GLB 是有實際尺度的材質試片與曲面樣件，不是整棟地標、完整汽車或房間替換模型。不改動 `public/`、GIS、碰撞或現有專用 shader。所有新檔僅位於本資料夾。

## 本次新增清單與用途

| 材質 ID | 每 UV 週期 | 後續候選消費位置 | 本次新增內容 |
|---|---:|---|---|
| `landmark-brushed-aluminum` | 1 m | `primary-landmarks.ts` 的 silver／panel-trim 不透明角色 | 原創週期拉絲底色、粗糙度、微法線；metallic=1 |
| `landmark-pale-panel` | 1 m | `primary-landmarks.ts` 的 cladding／white 不透明面板 | 輕微礦物顆粒與獨立 PBR；不替換玻璃 |
| `vehicle-red-paint` | 0.5 m | `assets/roadster.ts` 的 paint | 紅色底漆細紋與粗糙度微變化；標準 metallic-roughness 近似，無 clearcoat |
| `vehicle-tire-rubber` | 0.5 m | roadster rubber | 細微斜向溝槽／橡膠 maps，另有 0.64 m 外徑輪胎環樣件 |
| `vehicle-seat-leather` | 0.5 m | roadster leather | 棕色皮革細紋與較高粗糙度 |
| `interior-terrazzo` | 1 m | `interiors.ts` floor 類角色 | 原創固定種子碎石分布與表面 maps |
| `interior-oak-veneer` | 1 m | interiors 的木色長椅／櫃體 | 原創連續木紋貼皮；不能依 structure batch 一次全部替換 |
| `interior-matte-plaster` | 1 m | interiors 不透明牆／柱 | 原創灰泥微紋與高粗糙度 |

庫存依據：`docs/PROJECT_SPECIFICATION.md` 階段 D、`docs/MATERIAL_PIPELINE.md`，以及上述實際 source。現有 common city library 的 brick/sandstone/concrete/cedar/shingle/street-brick/painted-metal/asphalt 已有完整來源，這批保留為足夠的共同基礎，沒有重製或冒稱新增。新 pale-panel 是較細的面板角色，不是替換全部 concrete。Canada membrane、Science red-panel、玻璃、夜間窗光、LED、展示螢幕、水和人物專用 shader 均不在這批修改範圍。

## 檔案與預算

- `source/role-material-library.blend`：8 個原始材質節點、24 張打包原創 source maps、16 個可編輯 mesh。每個角色有 1.2 × 1.2 × 0.2 m 試片與曲面樣件。場景公尺、Z-up；匯出為 glTF 公尺、Y-up。
- `source/textures/`：24 張原創 256 × 256 PNG；`exports/textures/`：24 張從 `.blend` 實際重烘焙的 PNG。沒有下載／轉貼外部紋理。
- `exports/landmark-material-study.glb`：4 meshes，1,080 triangles，2 materials，約 228 KiB。
- `exports/vehicle-material-study.glb`：6 meshes，1,860 triangles，3 materials，約 444 KiB。
- `exports/interior-material-study.glb`：6 meshes，1,620 triangles，3 materials，約 479 KiB。
- GLB 已嵌入貼圖，不帶燈、相機或動畫。試片位置保留材質板排版，**不是放置到城市的世界座標**。
- 全 8 角色 24 張 maps 的 RGBA8+mips 保守估算共 **8 MiB**。單角色約 1 MiB。PNG 與 GLB 的同一貼圖不能重複載入再當作零成本；不強行併入既有八格 atlas。無 GPU texture compression，本次未測 runtime GPU/FPS。

Base color 為 sRGB、無烘焙日照；normal／ORM 為 Non-Color。normal 是 tangent-space OpenGL +Y；ORM：R=1、G=roughness、B=metallic，沒有把光照／陰影塞入 AO。貼圖週期由角色指定；平面與 box 使用實際公尺 UV。球面／輪胎是曲率評估樣件，依周長設定 UV；球面極點仍有正常的緯度參數化壓縮，不適合當任意模型自動 unwrap 範例。拉絲表現是小尺度幾何法線與 roughness，不宣稱具有 anisotropic BRDF。

## 重建、手動編輯與驗證

需要 Blender 4.3.2（本次實測）、Python 與 Blender 附帶 numpy。以下從 repository 根目錄執行：

```sh
# 從原創數學來源重建預設庫：會覆寫 library；手改後不要執行這條
blender -b --factory-startup --python-exit-code 1 --python tools/assets/role-materials/build.py -- --render

# 從手動編輯的 .blend 重烘焙，不會重建模型／重設節點／覆寫來源
blender -b --factory-startup --python-exit-code 1 --python tools/assets/role-materials/build.py -- --from-source tools/assets/role-materials/source/role-material-library.blend --output /tmp/role-materials-roundtrip --render

# reopen source、import GLB、UV/finite/PBR/normal/ORM/source→export hash roundtrip
blender -b --factory-startup --python-exit-code 1 --python tools/assets/role-materials/audit.py -- --roundtrip /tmp/role-materials-roundtrip

# 實際改 tint 後重烘焙：僅目標 base map 改變；其餘 23 張維持一致
blender -b --factory-startup --python-exit-code 1 --python tools/assets/role-materials/test_source_edits.py
```

編輯 `EDIT_BASE_TINT`、`EDIT_ROUGHNESS_SCALE`、`EDIT_NORMAL_STRENGTH` 或上游圖像／節點後保存另一本 `.blend`，再用 `--from-source`。匯出器沿 `ROLE_PBR` 的 Base Color、Roughness、Metallic、Normal 實際 bake，不會拿原始 PNG 複製充數。不要改材質 ID 與 mesh 的 role_id；這是穩定的匯出合約。匯出器明確拒絕 transmission、coat、sheen、subsurface、anisotropy、emission、非 1 alpha、displacement 或額外 surface blend，避免靜默損失專用效果。這是指定不透明標準 PBR 流程，不支援任意 Blender shader。

`qa/validation.json` 記錄實際來源 reopen 與 24 張重烘焙 hash 一致性、GLB 匯入及 triangle 計數。`qa/source-edit-test.json` 記錄來源編輯確實進入輸出，並測試不支援的 coat 會拒絕。`qa/visual-review.json` 記錄四種光照圖片檢視與限制。

## 四光照檢視

`exports/sunny.png`、`overcast.png`、`dusk.png`、`night.png` 是同相機、同幾何、96-sample Cycles CPU 渲染；日／陰／晚霞／夜間採不同 key 色溫、亮度和 world 強度。近排由左至右為鋁、淺色板、車漆、輪胎；遠排由左至右為皮革、磨石子、木皮、灰泥。它們是離線材質閱讀性檢查，不是 Vancouver runtime 天氣或物理量測；沒有宣稱 GPU 畫面一致。

## 整合前必做

1. `roadster.ts` 的合批程式目前刪除 UV，不能直接掛貼圖。先建立穩定 UV／明確表面角色、保留玻璃與燈光 batch，再試車漆／輪胎／座椅。不要以這組試片替换整輛車。
2. `interiors.ts` 的 Parts.add 刪除 UV、使用 vertexColors，且有 emissive ambient 的 shader hook。先補 UV 並按用途拆分 role；依顏色判定木頭會誤改其他物件。保留玻璃、導引螢幕、展示互動及現有照明語意。
3. 地標既有 UV 不全為公尺比例；先檢查每個 silver/cladding 部件的 chart。`nightMaterials`、Science/Canada 專用 shader 必須保留，不能整個 material registry 一次覆寫。
4. 先選具名地標／一輛車／一處室內做 source-selected 整合；依可見距離載入並保持原 factor fallback。以現有渲染引擎測試同相機晴／陰／晚／夜、UV seams、顏色、shading、frame time、draw calls、記憶體後再擴展。

原創來源為本資料夾 `build.py` 的確定性週期函數與幾何程式；無外部照片／模型／紋理、無新第三方授權。沿用 repository 的 LICENSE，本交付不改變其授權條款。
