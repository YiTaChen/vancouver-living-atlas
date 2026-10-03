# B01 屋頂機電首批離線資產

基準 commit：`5574d55719f10d1575127d8b92cbd23ff71e446f`。
本包依 `docs/AI_AGENT_DEVELOPMENT_BACKLOG.md` 共通契約製作，提供三種原創、代表性 HVAC，不是指定廠牌或逐棟實測設備。

交付狀態：`offline_complete`；場景整合：`runtime_pending_webgl`。正式 loader、`public/`、屋頂人口、GIS、地形、碰撞、初始 10:00／300 倍時鐘都沒有改動。本包離線完整不代表 B01 全城市整合或正式採用已完成。

## 資產與尺度

尺寸順序為 glTF X 寬 × Y 高 × Z 深，已含底座與管件。每個 LOD 都使用原點 `[0,0,0]`、屋頂接觸 Y=0，兩 LOD 外框一致。

| ID | 完整尺寸 m | LOD0 / LOD1 tris | GLB primitives |
| --- | --- | --- | --- |
| `hvac-compact-single` | 2.20 × 1.10 × 1.65 | 324 / 70 | 各 2 |
| `hvac-medium-twin` | 2.67 × 1.35 × 2.05 | 388 / 92 | 各 2 |
| `hvac-wide-twin` | 3.61 × 1.40 × 2.45 | 388 / 92 | 各 2 |

實際 bytes、vertices、source/GLB SHA-256、完整 min/max/size 與 CPU 環境見 [manifest](manifest.json) 和 [measurements](qa/measurements.json)。全部低於 B-ROOF 的 480/96 tris、96/24 KiB 幾何 GLB 目標；六份壓縮 `.blend` 各約 0.1 MiB，遠低於 20 MiB 整理目標。

LOD0 具真正環形風扇護罩、十字護網、三片風扇葉、五道斜百葉及凹入面板、連接到機殼的服務接管、可編輯倒角 modifier、獨立底座。護罩底部接到機殼頂面，沒有漂浮風扇環。LOD1 保留同一底座、主外框與風扇高度；風扇改為封閉簡化遠景形狀，百葉改為角色面板。本包沒有可供人物穿越的開口。

## 可編輯來源與材質

- 六份 `source/<asset-id>.lod{0,1}.blend` 是獨立、原生 Blender 作者場景，保留分件 mesh、`UVMap`、Principled 節點與 LOD0 bevel modifier，並非把已烘焙 GLB 匯回冒充來源。
- Blender Z up / −Y front；glTF Y up / +Z front。標準 exporter 只做一次 `(x,y,z) → (x,z,−y)`。GLB 靜態根節點為 `body-shell`，兩個 primitive 由材質名稱辨識。
- `shared-metal-housing` → `shared-metal`；`shared-metal-detail` → `shared-metal-grille`。兩者 surface ID 都是既有 `painted-metal`，0.8 m 共用表面週期。UV 由作者端公尺投影保存，來源重新匯出時不重算。
- 目前用無圖像 semantic-role 材質；新增 runtime maps、嵌入圖像、unique texel+mips 成本全部為 0。沒有複製現有 atlas，也沒有把天空、AO 或日照烘進 base color。灰白機殼與深色護網是明確角色色，不以顏色猜用途。
- `export.py` 保留修改後的 mesh、UV、base color、roughness、metallic，只在暫存 mesh 評估 modifier／三角化／合併，從不重新呼叫 generator、不儲存 source。不支援的材質節點／效果明確拒絕，不靜默換回預設材質。

## 可重現命令

以下都從 repository 根目錄執行。已測 Blender 4.3.2、Python 3、Pillow。一次只開一個 Blender，兩個 CPU threads、12 render samples；不與城市效能採樣同時執行。

```sh
# 讀取並完整驗證交付來源；不生成或覆寫來源
python3 tools/assets/rooftop-equipment/validate.py --root tools/assets/rooftop-equipment --blender-audit --report tools/assets/rooftop-equipment/qa/validation.json
python3 tools/assets/package-contract/validate.py tools/assets/rooftop-equipment --report tools/assets/rooftop-equipment/qa/common-validation.json

# 保存作者修改的重新匯出；output 必須不存在，原來源不變
blender --background --factory-startup --threads 2 --python-exit-code 1 --python tools/assets/rooftop-equipment/export.py -- --source tools/assets/rooftop-equipment/source --output /tmp/rooftop-equipment-reexport
python3 tools/assets/rooftop-equipment/validate.py --root /tmp/rooftop-equipment-reexport --blender-audit

# 真正開 Blender 的來源 roundtrip／修改保留／拒絕覆写測試
python3 tools/assets/rooftop-equipment/test_source_workflow.py
python3 -m unittest discover -s tools/assets/rooftop-equipment -p 'test_validate.py' -v

# 由實際 exports/*.glb 重新匯入，渲染完整48張離線證據
blender --background --factory-startup --threads 2 --python-exit-code 1 --python tools/assets/rooftop-equipment/render_previews.py -- --root tools/assets/rooftop-equipment
python3 tools/assets/rooftop-equipment/compose_previews.py

# 僅在需要全新預設作品時，產生到另一個新目錄；不要用來覆寫作者修改
blender --background --factory-startup --threads 2 --python-exit-code 1 --python tools/assets/rooftop-equipment/build.py -- --output /tmp/rooftop-equipment-new-defaults
```

重新匯出的目錄含新 manifest、複製且 hash 不變的原始 source 與新 exports；不把旧 QA 圖假裝成新輸出的證據，初始狀態為 `offline_partial`。如需升版採用新輸出，完整重跑來源驗證、CPU／負向測試、GLB 預覽及目視檢查後，才更新新版本交接證據。`finalize.py` 只在檔案 hash、48 張新圖、來源修改保留和明確目視審查都匹配時完成封存。

## 已執行的離線驗證

- 共通 manifest 必填欄位、每個 source/GLB hash、實際 indexed geometry／node transform bounds／bytes。
- CPU finite position/index、非退化三角形、單位 normals/tangents、UV、無重複三角面、負 scale、材質角色、opaque/culling、primitive/budget 和零圖像成本。
- 六份來源逐一用 Blender 開檔，檢查獨立分件／modifier／UV／材質；六份實際 GLB 在空白場景重匯入，重新量 bounds／ground datum。
- LOD0 每個風扇孔的向下 ray 與百葉間隙向內 ray，證明護罩內部／百葉凹槽有真實幾何深度。兩 LOD 外框與 attachment datum 相同。
- 全量 source-preserving 重新匯出到暫存目錄；GLB byte-identical，原來源 hash 不变。
- 在暫存 LOD0/1 來源施加 11 mm mesh 位移、UV-U +0.0625 及 Principled 色／roughness 修改，證明輸出保留；不支援的 shader 節點和原路徑覆寫均被拒絕。
- 22 項 CPU 正／負向測試：錯 hash、尺寸、datum、排除範圍、runtime 假聲明、缺 manifest 欄位、轉換、負 scale、QA node、缺 UV/tangent、錯 role、double-side、NaN、越界 index、退化／截斷 GLB、來源被改。

證據：[validation](qa/validation.json)、[Blender audit](qa/blender-audit.json)、[source roundtrip](qa/source-roundtrip.json)、[tests](qa/test-results.json)、[visual review](qa/visual-review.json)。一般 CPU 驗證不含 `--blender-audit` 時，必定標記 Blender 檢查 `not_run`。

## 實際 GLB 預覽

48 張皆為 GLB 匯回後以 Cycles CPU 渲染：三型 × 兩 LOD × 正／側／後／俯視及晴／陰／黃昏／夜四種同相機比例照明。比例場景含 1 m 尺、1.75 m 及 1.81 m 人形，這些參考物、地面、camera/light 完全不在 runtime GLB。640×480 / 12 samples 可見少量 Monte Carlo 雜訊；沒有後製增亮夜景。

- [LOD 正／側／後／俯視對照](qa/previews/lod-views.png)
- [四光照及人形尺度對照](qa/previews/four-light-scale.png)
- [完整每圖 input GLB hash、camera、照明與時間](qa/preview-index.json)

這是離線 studio 研究，並非城市 clear14h/overcast14h/dusk19.8h/night23h 相同光照，更不是瀏覽器畫面驗收。

## 屋頂配置及既有壓頂適配

維持既有 `roofBoxFits`、polygon holes、更高 building parts 排除、seed 和 source ID。只適合非住宅、無 `roofEaveHeight` 的露出平屋頂，不能放在住宅斜屋頂。使用固定實際尺寸並在 `ground + part.height` 放置原點，不套舊 box-centre offset、不重複加底座高度、不非等比拉伸。完整 W/D 各加 2 m 做 `roofBoxFits`；每組半徑保留 `hypot(W,D)/2 + 0.8` 排除。名義 2.5 m 高樓首組繼續舊 fallback，不把新 1.10–1.40 m 型硬拉高。

`parapet-adapter.json` 引用且驗證既有 `architecture-expansion/modern-parapet-cap` manifest／source／GLB hashes，完全不覆寫舊包。原 cap 2.4×0.19×0.46 m、插入淨寬 0.388 m；相容既有 0.24 m 牆厚，保留雙側餘隙。設定 cap 原 +Z 向屋頂內側，頂面由外側 0.19 m 向內側 0.16 m 排水；提供平面置中 −0.25 m Z shift 和 Y 插入基準。沿來源邊重複 2.4 m 段，轉角、末端及剩餘短段仍需個別作者幾何和場景測試，不拉伸斷面。此 adapter 不是已接入壓頂的宣稱。

## 接手順序與限制

詳見 [handoff.json](qa/handoff.json)。先核 hash／metre datum → 來源 ID 和受控平屋頂樣區 → 角色共用與去重 → 替換完整舊設備群組並 suppress 對應 boxes → 最多 2 cells／High24、Ultra48 → 量測 LOD、四光照、快取／釋放／失敗 fallback → 擴充 production isolation 才可考慮 `public/`／正式 consumer。35/110 m LOD 距離只作提案，未量測。

CPU 幾何成本不是 GPU residency 或 draw-pass/FPS。沒有 WebGL、場景 gameplay、正式 build、main push、CI 或 Hosting 驗收聲明。

## 原創與授權

Based on Vancouver Living Atlas by YiTaChen  
Source: https://github.com/YiTaChen/vancouver-living-atlas  
License: Vancouver Living Atlas Noncommercial Research and Attribution 1.0

本包幾何、腳本及預覽是本專案原創代表性製作；沿用 repository LICENSE，不新增第三方模型、照片或貼圖，不改稱 CC0。既有材質／壓頂來源與它們的歷史證據保持不變。
