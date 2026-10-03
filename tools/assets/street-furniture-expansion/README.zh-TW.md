# 街道傢具與小型街景：F01／F02 離線候選

Based on Vancouver Living Atlas by YiTaChen  
Source: https://github.com/YiTaChen/vancouver-living-atlas  
License: [Vancouver Living Atlas Noncommercial Research and Attribution 1.0](../../../LICENSE)

本包沿用基準 `8b95f013297597845d542463d6ce635105a95c4f`，提供 8 件資產、16 個真正獨立可修改的壓縮 `.blend`、16 個普通 GLB，無 Draco／Meshopt／KTX2。F01 延伸原 `streetscape/generate_streetscape.py` 的雪松長椅、歷史雙燈與候車亭，另做獨立 8 m 幹道路燈。F02 新增垃圾桶、消防栓、自行車架、防撞柱。新增五件均為代表性原創設計，沒有宣稱實測型號，也沒有下載照片、模型或官方品牌。

離線完成以 `qa/validation.json` 與 `qa/handoff.json` 為準；整合狀態始終是 `runtime_pending_webgl`。本包沒有修改舊包、`public/`、城市 consumer、路燈人口或正式載入預設。

## 尺度與成本

尺寸順序為 glTF W=X、H=Y、D=Z，單位公尺；精確 bounds／bytes／hash 以 manifest 和 measurements 為準。

| 資產 | 目標 W × H × D | LOD0／LOD1 tris | 注意事項 |
|---|---|---:|---|
| cedar-bench | 2.02 × 約 0.985 × 約 0.700 | 756／200 | 既有座面中心 0.48，頂面 0.509 不變 |
| heritage-lamp | 2.13 × 4.49 × 0.47 | 1292／228 | 歷史燈沒有拉伸 |
| transit-shelter | 4.56 × 2.82 × 1.86 | 2164／584 | 最低屋頂淨高 2.59；前柱內淨寬 4.095 |
| arterial-lamp-8m | 1.91 × 8.00 × 0.34 | 252／108 | 另建桿、伸臂與燈殼，原點在桿底 |
| garbage-bin | 0.58 × 0.97 × 0.58 | 528／96 | 具有真正投入口，不是實心封閉 box |
| fire-hydrant | 0.55 × 0.854 × 0.41 | 320／192 | 側出水口、前蓋及操作螺帽 |
| bicycle-rack | 0.97 × 0.84 × 0.17 | 228／84 | 開放倒 U；腳管與底板交接 |
| bollard | 0.19 × 0.90 × 0.19 | 160／104 | 獨立視覺光學帶，不含燈光物件 |

各 LOD 都通過 B-FURN／B-PROP 幾何、bytes、2 cm 外框容差；來源均遠低於每檔 20 MiB。新增 maps = 0，GLB image bytes = 0。geometry bytes 是 GLB 總 bytes 減 image payload，包含 JSON／padding，不是 GPU allocation。LOD 與材質 role 不代表瀏覽器已測 draw calls 或 FPS。

## 來源保留與簡化

`build.py` 只透過 AST 載入既有 `bench`、`lamp`、`shelter` 三個設計函數，不執行舊 generator 的頂層生成、bake 或輸出。套用較低細分與可修改倒角，保留每個零件、UV、節點和曲線。原長椅腿末端略離作者地面約 3 cm；LOD0 加小型接地鞋，LOD1 做接地斜腿，沒有平移／拉高座面。候車亭招牌為空白通用面板，沒有官方品牌；LOD1 減少玻璃標記、木板和燈柱細部。

`.blend` 不是從 GLB 匯回的重建品。來源內的 mesh／Bezier／bevel 可直接編輯；匯出器先重開，轉換目前評估結果、按 role 合併到 1–4 primitives，再輸出 GLB，不儲存或覆寫來源。`qa/source-roundtrip.json` 驗證 16 個 GLB 重新匯出完全相同，來源 hash 不變。

`qa/artist-edit.json` 在一次性來源副本實測頂點 +7 mm、UV U +0.125、roughness 0.731、新增 bevel，重匯入後仍保留。未支援的程序材質節點會明確拒絕，不能默默遺失美術修改。要加材質 maps／其他 shader，先擴充受控 exporter 和測試，或明確 bake；不能用重建 defaults 取代編輯。

## 材質、UV 與軸

- 作者端 Z up、front −Y；GLB 自動一次轉換 `(x,y,z) → (x,z,−y)`，Y up、front +Z。consumer 不要再旋轉。
- 預設 scale `[1,1,1]`，地面 Y=0。候車亭刻意保留既有前柱框架原點，而不是把外框重新置中。
- `wood`、`metal`、`glass`、`diffuser` 為明確具名 semantic role；不以顏色辨識。glass 為雙面 alpha BLEND，其他角色 opaque。
- 本輪交付無貼圖 Principled 占位材質，wood 指向既有 cedar、metal 指向 painted-metal 共享表面身份。這不是聲稱目前已載入既有貼圖或實現 runtime 去重。
- UV 為作者公尺座標、1 repeat/m。日後綁定 catalog 的 cedar 1.52 m／painted-metal 0.8 m 週期，需另做明確 UV 比例換算與四光照確認。
- diffuser 僅是材質視覺發光／光學角色，不帶任何 point light，不能按材質自動生成城市燈光。

## 淨空、碰撞與來源選擇

候車亭入口 anchor `[0,0,0.34]`，站立空間 min `[-1.15,0,-0.18]`、max `[1.15,2.45,0.22]`；屋頂 headroom 的 CPU 多點向上 ray 與入口多高度穿越 ray 均通過。座位 anchor `[0.25,0.509,-0.69]`。主行人通道須在亭前另保留至少 1.8 m 連續淨寬，不能把長椅／看板區當穿越通道。`qa/collision-proxies.json` 為來源零件個別 AABB，避免把整亭或自行車架中心做成實心障礙；曲管的 AABB 僅供 broadphase，仍需整合時的 narrowphase／導航檢查。

`placement-proposal.json` 只選 public roads 中 WATER ST 與 W GEORGIA ST 的具名來源邊。原資料缺少逐 feature 外部 ID，因此身份為 source／name／geometry 的 SHA-256，array index 僅供除錯。沒有世界 XYZ 特例，activePlacements 為空，populationDelta=0。數量上限是研究提案，並非批准生成更多實例；候車亭還需要另外證實站點來源，目前道路線並不證明有公車站或足夠人行道。現有 `environment.ts` 路燈使用 ground+1；此包原點已為地面，整合時必須用實際地面取樣，不能盲搬 +1。

`placement.py` 是未接入 runtime 的獨立拒絕條件：來源、existing slot、單位 scale、凸 footprint、walkable containment、至少三個地面樣本且坡差≤0.14 m、行人淨寬≥1.8 m、入口 approach／車門完整 sweep／道路軌道排除。13 個正反例包含旋轉碰撞、缺漏 layer、越界、無來源及人口增加。門口 1.5 m、車門 0.9 m 是代表性研究下限，不是無障礙或交通法規認證。

## 重現命令

從 repository 根目錄執行；一次只啟動一個 Blender process，最多兩 threads：

```sh
# 僅初次生成或明確重置來源時使用。預設拒絕覆寫已有 .blend；蓄意重建須另加 -- --force-reset-sources。不能拿來匯出藝術家修改。
OPENBLAS_NUM_THREADS=1 OMP_NUM_THREADS=2 blender -b -t 2 --python-exit-code 1 --python tools/assets/street-furniture-expansion/build.py

# 正常編輯後，保留 .blend 來源，輸出到全新目錄；存在的目的目錄會被拒絕。
OPENBLAS_NUM_THREADS=1 OMP_NUM_THREADS=2 blender -b -t 2 --python-exit-code 1 --python tools/assets/street-furniture-expansion/export.py -- --source tools/assets/street-furniture-expansion/source --output /tmp/street-furniture-reexport

# source reopen／edit test／GLB ray audit／88 個 CPU render；不改來源。
OPENBLAS_NUM_THREADS=1 OMP_NUM_THREADS=2 blender -b -t 2 --python-exit-code 1 --python tools/assets/street-furniture-expansion/audit.py
python3 tools/assets/street-furniture-expansion/compose_previews.py
python3 tools/assets/street-furniture-expansion/test_placement.py
python3 tools/assets/street-furniture-expansion/validate.py
python3 tools/assets/street-furniture-expansion/test_validate.py
```

匯出到另一目錄只產生新 source 副本／GLB／manifest，不繼承舊 QA pass。新內容必須重新做該目錄的幾何、預覽與人工視覺檢查，再更新證據；本 audit 預設針對本包。

## CPU 預覽與限制

`qa/previews/` 有每資產雙 LOD 正／側／後／俯視，以及晴／陰／黃昏／夜四光照，合計 88 次實際 GLB 重匯入後的 Cycles CPU 渲染，組成 16 張 compact PNG。每張含 1 m 黑白尺、藍色 1.75 m 與橘色 1.81 m QA 人形；這些參考物、地面、相機和燈均沒有進 runtime GLB。固定 AgX／exposure 0，256²、16 samples、兩 CPU threads；此 Blender build 不含 OpenImageDenoise，所以最終使用無 denoiser，細玻璃仍有低樣本噪點。四條件是離線光照研究，並非城市實際天氣或瀏覽器 render 驗收。

LOD1 木板／燈柱／圓管為預算內明顯簡化；超近景使用 LOD0。來源零件有組裝交疊，檢查的是重複三角形及主要走入空間，並非製造用 watertight CAD。實際 glass 排序、場景地面／碰撞、LOD pop、來源對位、cache/dispose、draw calls、GPU frame-time／VRAM 全部未測。

## 交接順序

1. 讀 manifest、measurements、validation、handoff、placement-proposal。
2. 確認 source edge／existing slot，從空配置開始，不先增加實例。
3. 將 source ground datum、role materials、footprint 與排除區接進小樣區 adapter。
4. 候車亭可供 transit-station-spaces 的 D01 研究 layout 引用，仍須使用獨立站點來源／步行面證據。
5. 真正 WebGL 檢查四光照、透明、LOD、接地、行人／車門、生命週期與成本，之後才由整合 agent 決定 `public/`／正式 consumer。
