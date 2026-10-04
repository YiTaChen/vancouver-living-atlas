# E02／E03／E04／F05：材質 consumer 離線候選

Based on Vancouver Living Atlas by YiTaChen  
Source: https://github.com/YiTaChen/vancouver-living-atlas  
License: [Vancouver Living Atlas Noncommercial Research and Attribution 1.0](../../../LICENSE)

**本包完成離線 consumer adapters、回歸測試、兩種可編輯傢具模塊及 CPU 重匯入圖；沒有改 runtime、public、碰撞或正式材質預設。** 基準 HEAD 是 manifest 的 `baseRevision`，不是待開發文件較舊的盤點 revision。所有新檔限於本包，不覆寫舊 role-materials 或其他 package manifest。

## 實作內容與邊界

- **E02：offline_complete / runtime_pending_webgl。** `adapters/consumer-candidates.mjs` 真正執行目前 Roadster constructor，僅在記憶體套用經審閱、會拒絕來源漂移的 callsite patch。補公尺 UV；座墊／椅背／頭枕／側墊分為 seat-upholstery，driver-skin 與 driver-clothing 分開。原本 `leather` 唯一用途是頭部，並不是座椅。車身、輪胎可用 paint／rubber maps；trim、底盤、方向盤等 dark 保留原材質。沒有把全部 dark 換成皮革。
- **E04：offline_complete / runtime_pending_webgl。** 實際三處 PublicInteriors constructors 補 UV、拆 floor-terrazzo／wood／plaster；保持原頂點色 fallback、emissive hook、light lab 與 clipping。木角色只來自明確長椅及 Canada 木面板 callsite；灰泥只來自指定柱體／partition。地毯、警示線、結構底板、石材、玻璃、螢幕、燈及 heritage shell 不按顏色猜角色。另有 lecture-chair-module 和 admissions-counter-module 的獨立原始來源、LOD0/1、GLB；並提供 58 個已存在用途的非作用中替換 plan。
- **E03：offline_audit_complete_no_verified_asset_gap。** 真正執行 4 種 harbour factory＋45 個 yacht variants、兩種玩家航空 exterior/cockpit，量 bounds、triangles、控制節點與動力學接口。既有 rails、seats、controls、hulls、wings、rotors 已存在；沒有驗證到具名缺件，故新增 E03 幾何為零。程序模型不是無效模型。沒有做 runtime 近景畫面驗收。
- **F05：offline_complete / runtime_pending_webgl。** 共用既有 8 IDs／24 張 256² PNG，catalog 列原始路徑、hash、色彩空間、通道、公尺週期。材質 binding API 已實作並測試；沒有複製或新增任何 maps。六種車輛／室內 surface 有實際語意 consumer；brushed aluminum 用於本包傢具；pale panel 僅維持 catalog 契約，本包沒有額外改造地標 consumer。所有正式載入、四光照 WebGL、GPU 成本及全城 rollout 仍未整合。

## 如何重跑

從 repository 根目錄：

```sh
# 一次檢查 Node 單元測試、原 source 回歸、共通 manifest／GLB、傢具 fit。
python tools/assets/material-consumer-candidates/validate.py

# 原 source vs candidate 的 geometry／角色／門地板／碰撞查詢等完整比對。
node tools/assets/material-consumer-candidates/validate-consumers.mjs
node --test tools/assets/material-consumer-candidates/test-consumers.mjs
node --test tests/roadster.test.mjs tests/interiors.test.mjs
node tools/assets/material-consumer-candidates/validate-furniture.mjs

# 重開現有 source；保留每個 .blend，只重匯出、驗證 batching／編輯證據與傢具 CPU 預覽。
blender -b --factory-startup -t 2 --python-exit-code 1 --python tools/assets/material-consumer-candidates/build.py -- --refresh-existing
python tools/assets/material-consumer-candidates/audit_batch.py tools/assets/material-consumer-candidates/qa/.batch-baseline
python tools/assets/material-consumer-candidates/manifest.py
blender -b --factory-startup -t 2 --python-exit-code 1 --python tools/assets/material-consumer-candidates/render-coverage.py
python tools/assets/material-consumer-candidates/assemble-previews.py

# 真正保留手動 .blend 編輯的匯出入口，不呼叫任何幾何 generator。
blender -b --factory-startup -t 2 --python-exit-code 1 --python tools/assets/material-consumer-candidates/build.py -- \
  --from-source tools/assets/material-consumer-candidates/source/lecture-chair-module.lod0.blend \
  --output tools/assets/material-consumer-candidates/exports/lecture-chair-module.lod0.glb
# 更改每個來源後重算包裝資料，重新跑完整檢查與該來源重匯入視覺驗證。
python tools/assets/material-consumer-candidates/manifest.py
python tools/assets/material-consumer-candidates/validate.py
```

`--record-fixtures` 只供明確審閱 upstream source 變更後重新記錄，不能用來掩蓋回歸失敗。常規 validator 絕不更新 regression fixtures。Node v24.19.0、Three r185；Blender 4.3.2、Cycles CPU、固定 2 threads。此 Blender build 無 OIDN，預覽以 20 samples、不去噪；噪點不是材質。每次只有一個 Blender process。額外完整視角／四光照contact sheets使用12 samples、2 threads；每tile記錄原GLB hash、camera、light及像素hash。

## UV 與 shared-map 契約

`metre-uv.mjs` 不改 positions、normals 或 transform；原本刪除 UV 的 merge 位置改為產生／保留公尺 UV。每 UV 單位等於 1 m。水平 floor 使用共同 XZ 投影，使相鄰平面 phase 一致；坡面與曲面使用逐 triangle 的等距 chart，三條 UV 邊長均等於實體邊長。這是有測試的最小候選，**不宣稱曲面 UV 無接縫**：per-triangle charts 可能有法線方向或 grain seams，不應用於方向性長木紋、大標誌或 decals。家具來源另外使用一致的 box-axis metre charts。

八 surface 的 period：車漆／輪胎／座椅皮革為 **0.5 m**，其餘 **1 m**。texture repeat 為 period 的倒數；不要在幾何 UV 和 texture repeat 同時除以 period。非等比放大後不能沿用本公尺契約；本傢具固定 scale=[1,1,1]。

`configureSharedMaps(id, {basecolor,normal,orm})` 只接受呼叫端已載入的共享 THREE.Textures，不啟動網路。basecolor=sRGB；normal/ORM=NoColorSpace；normal 為 OpenGL +Y；ORM 的 R=1/G=roughness/B=metallic。同一 ORM 物件同時接 aoMap／roughnessMap／metalnessMap。Native Three geometry 使用 flipY=true；glTF imported UV 使用 `{gltf:true}`，需要 separate texture transform/view ownership，不能在已共用的同一 Texture 上反覆改 flipY。UV0 足夠，AO 為 constant one。

`bindCandidateMaps` 預設完全不執行，需顯式傳入 textures。綁定 authored maps 時清除重複 pigment multiplier（color=white、vertexColors=false、roughness/metalness factors=1）；保持原 onBeforeCompile、clipping、side 等。材質替換的最終明亮度和 emissive ambient 需由整合者四光照檢查，不能把本 CPU binding 測試稱為已接受的 PBR 視覺。玻璃／screen／head skin 永不綁入。

## Roadster 保留證據與成本

`qa/current-source-fixtures.json` 固定目前來源 hash 與原 constructor 輸出。`qa/consumer-validation.json` 保存即時 baseline/candidate 比對：

- **14,662 triangles** 的 positions／normals／winding multiset 相同，四組 distance/steering wheel transforms 相同，open-cabin downward ray 行為相同。
- 完整 bounds min = [-1.15999997, -0.05800001, -2.28999996]；max = [1.15999997, 1.38499999, 2.29250002]，size 約 **2.32×1.443×4.5825 m**。原 wheel-well liner 低於 Y=0，所以禁止按 bounds 重新接地。
- 原 meshes **19 → 21**，因真實座椅及 driver-clothing 分組增加 2，不宣稱節省 draws。位置／原 triangle 數不變，UV attributes 及 unindexed tyre vertices 仍有成本。完整 fingerprint 在套用 world matrices 後以 1e-8 m 小數精度比對，並非 GPU buffer allocation測量。
- Driver head [0.44,1.27,-0.34]、radius .115；seat cushion [0.44,.53,-.21]、top .615；steering [.44,.88,.4]。Driver eye height=1.2、left offset=.45；別將獨立 camera-local cockpit 的座標誤當 vehicle root。沒有捏造既有 pedal／foot anchors。
- 驗證直接執行目前 `StreetNavigation.clearGround` 在 land/water/collision polygon fixtures 的結果；沒有改其碰撞程式。這不等於完整遊戲碰撞驗收。

## 內部與傢具

三個真實 constructor 的 polygons、door rectangles、obstacles、entry／approach anchors、floor heights 全部相同；16,422 個 fixture site-local 取樣檢查 height／walk／drive clearance，含 SkyWalk／SeaBus 範圍。light lab mix 和 cutaway planes 也比對。沒有 document 的 CPU 環境會讓原本 sign() 與候選同樣跳過 canvas wayfinding，**因此文字螢幕的 browser rendering 是 not_run**。

傢具兩型是實際 existing-use 的視覺缺口：原 Canada lecture seat 是實心 box 和背板，Science admissions 是單一實心 counter。新 module 提供腿、可編輯背板、下緣／檯面／內部工作層。材質為代表性 oak，非現實館內家具複製。座面 **.45 m**、檯面 **1.1 m**；兩LOD都維持地面原點與既有 collision 範圍。

| 模塊 | LOD0 / LOD1 tris | primitives | GLB bytes | 尺度 W×H×D |
|---|---:|---:|---:|---|
| lecture-chair-module | 440 / 96 | 2 / 2 | 54,868 / 18,520 | .62×1.0075×.6075 m；LOD1高度1.0 m |
| admissions-counter-module | 308 / 60 | 2 / 2 | 39,300 / 12,764 | 1.5×1.1×1.5 m |

### 靜態傢具 export-only batching

`build.py` 先正常匯出目前 `.blend` 的 evaluated mesh，再由 `batch_static.py` 按 material role／attribute signature 合批。椅子 **10／8 → 2／2** primitives，counter **7／5 → 2／2**；triangles、頂點、兩組 UV、normals、材質及尺寸不變。四個原來源的 SHA-256 完全不變，fresh normal exports 與本次優化前四個 GLB **byte-identical**。來源每個約92–96 KiB，所有 mesh 零件、UV、PBR節點、LOD0 bevel／weighted-normal modifiers、外部共享貼圖相對路徑仍可編輯；來源不合併，也不是從 GLB 匯回。

每件只有一個 `furniture-module-root` actor，可按 plan 整件搬移。原 `seat`／`leg-*`／`counter-top` 等具名節點保留 transform 和 extras，但成為 **zero-draw anchors**；真正幾何在兩個 `furniture-batch-*` meshes。其 `extras.componentRanges`（manifest 每個 LOD 同樣記錄）提供 sourceNodeId／sourcePrimitive、sourceLocalToModuleMatrix、vertexStart/count、indexStart/count、triangleCount 和 bounds。每批恰有一個 primitive，range 明確指向實際 BIN，不是以 bbox 假裝幾何。若要 query／量測某零件，讀對應 range；不能把 anchor 當 Mesh，也不能只移動單件 anchor 期待 batch geometry 隨動。這是靜態模塊，不支援零件獨立動畫。

`qa/static-batching.json` 逐 component 比對實際 indices（扣 vertex base）、POSITION／NORMAL／TEXCOORD_0／TEXCOORD_1、material、原節點 transform 與完整覆蓋；最大 float32 rebasing 誤差 **5.22e−8**，無幾何簡化。七種反例涵蓋 range 缺口、重疊、遺失零件、anchor 誤帶 mesh、假 bounds、越界 binary index 和重複 batching。保存／重開編輯副本後，座面 +10 mm 可從 **batched range 的真正 vertices** 及 imported surface ray 同時量出；正式 source hashes 不變。

成本須同時看：四個 GLB 合計 **110,664 → 125,452 bytes（+14,788）**；真正 geometry attribute/index bufferViews 合計 **78,432 → 88,608 bytes（+10,176）**，主要是 uint32 indices，另有完整 anchor／range provenance 的 JSON 成本。embedded images、new maps 都是 **0**。以原 plan 的54把椅子＋4個counter、未 instancing 計算，primitive submissions 提案為 LOD0 **568 → 116**、LOD1 **452 → 116**；僅54把椅子為 **540 → 108／432 → 108**。這不是實測 GPU draws／FPS／VRAM 改善，也沒有聲稱每 material 永遠只有一個 pass。

`--from-source ... --output ...` 預設套用 batching；加 `--unbatched` 只供正常來源 GLB 比對。`--refresh-existing` 完整重跑 source-preserving exporter／edit proof，保留 unbatched 比對檔於忽略的 `qa/.batch-baseline/`。只有省略所有參數才會呼叫原 generator 並重建 source，手改後不要這樣跑。

`adapters/furniture-plan.mjs` 從現有 callsite loops 和 actual site obstacles 建立 54 把講堂椅＋4個 counter modules，兩LOD逐件確認 bounds 在既有 blocked footprint 裡。來源 drift 或越界會拒絕。這是 **plan，未替換 runtime 幾何**；未來替換時必須移除對應舊 visual boxes，保留 original obstacle 記錄／screens／signs，不能疊上新 module 增加重影。

未製作 0.72–0.76 m table：目前找到的是 Canada lounge coffee table，原 top 約 .475 m，沒有具名高桌用途。為湊件數而抬高或插入桌子會改變既有場景。本包也不把整廳導出成 GLB。

## E03 精確 interfaces

完整 min/max/size、49個 harbour variants 和 cockpit／propeller／stick／instruments 位於 `qa/harbour-aircraft-gap-audit.json`。主要完整 bounds size（W×H×L）為：harbour helicopter **13.8965×4.54×16.0033**；harbour seaplane **19.0710×6.36×14.6550**；cruise ship **32×56.96×250**；motorboat **2.4000×2.9350×7.11 m**。player seaplane **15.1900×4.625×9.64**；player helicopter **11.38×4.73×13.9053 m**。名義長度不包含所有 rotor/propeller extents，所以不能互換。

harbour forward **+Z**；player aircraft forward **−Z**；兩者 up +Y，但 root datum／waterline／landing contact 各自保留。Boat `canOccupy` halfLength=3.5、radius=1.35 m；player aircraft AIRFRAME_RADIUS=.85 並保留完整 probe list。Boat 0..0.1 s clamp/120 Hz substeps、wave bob、propeller；flight fixed elapsed-time update、spinAxis/spinRate、rotorBlur、camera cockpit／instrument disposal都留給原 controller。沒有讓物理跟日夜300×倍速。

## 整合交接順序

1. 先跑 `validate.py`，核對 source hashes。`qa/*integration-candidate.ts.txt` 是目前 constructor 加 narrow patch 的完整可審閱結果；`source-patches.mjs` 列每個精確修改 anchor。不要複製 `.txt` 後忽略 upstream drift。
2. 將 `metreUV` 與 semantic callsite changes 正式移入受選的 Roadster／PublicInteriors consumer；保持 `update()`、site frames、collision、door／floor／entry、controls和camera原邏輯。或者先用本包 `makeRoadsterCandidate()` / `makeInteriorsCandidate(engine)` 做離線或受控 QA；其 in-memory source loader不是建議的 production bundling 方案。
3. 整合者另外建立距離控制／lazy texture cache，用 catalog 的 source maps 只載一次；`bindCandidateMaps(root, sharedById)` 顯式啟用。未選定 surface 保持 original factor fallback，不整個 material registry 重綁。
4. GLB furniture 的原零件名稱是 zero-draw anchors，請用 componentRanges 查實際幾何，整件移動 `furniture-module-root`。家具是獨立可選替換，與幾何不變的材質 adapter 分開驗收。按照 `furnitureReplacementPlan()` 只更換 named original visual callsites，保留 routes/obstacles。禁止把 plan稱為已生成 runtime instancing。
5. 至少 Roadster＋一處 interior做晴／陰／晚／夜同相機 compare，核 seam、normal direction、brightness、cutaway、screens、door／floor foot placement；量draw calls/frame time/memory/cache disposal。若 per-triangle seams 可見，先改連續曲面 charts，再考慮採用。
6. E03沒有新 replacement；F04新角色若接入Roadster，需沿既有 frame/seat/view獨立做pose/clearance驗收。正式啟用和部署均留待整合 agent。

## QA 圖及限制

- `qa/previews/furniture-views-lods.png`：16張真實 GLB 重匯入圖，兩模塊×兩LOD×front/side/back/top；無縮放合成，可用 `qa/render-coverage.json` 中的pixel rectangle和RGB hash逐tile驗證。
- `qa/previews/furniture-four-light.png`：8張真實LOD0 GLB圖，兩模塊×clear/overcast/dusk/night；同camera／reference，沒有調曝光冒充不同shader。
- `qa/previews/furniture-reimport.png`：四個實際 GLB，1 m尺、1.75 m及1.81 m參考；參考物不在exports。
- `qa/previews/edited-chair-reimport.png`：真正修改 `.blend` 座面上頂點 +10 mm、保存、重開、從來源export、再import。量到 +.009999987 m；原來源hash不變。
- `qa/previews/roadster-reimport.png`：由現有 constructor候選輸出GLB，再import後重綁共享maps。driver皮膚保留原色，座椅才是皮革。GLTFExporter可能規範化既有非unit normals；幾何不變證據以CPU原constructor比較為準，這個inspection GLB不能拿來替換原車。

本次 batching 前後沿用相同 render settings 的四張傢具圖共3,209,472 pixels，僅12個pixel有差，最大RGB8通道差6；完整舊／新pixel hashes及統計見 `qa/visual-review.json`。這是離線影像比對，不替代binary geometry／range驗證。

這些是原創模塊／實際候選的離線 Cycles 圖，沒有 browser、GPU、FPS、playthrough或正式PBR rollout的驗收宣稱。
