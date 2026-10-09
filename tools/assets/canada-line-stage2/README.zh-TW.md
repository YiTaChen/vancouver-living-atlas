# Canada Line Stage 2 離線資產

基於 Vancouver Living Atlas by YiTaChen。來源：https://github.com/YiTaChen/vancouver-living-atlas 。授權：Vancouver Living Atlas Noncommercial Research and Attribution 1.0。第三方參考媒體權利另計。

## 交付與狀態

此包為**原創代表性 Canada Line 兩節車**，並非 Expo 模型換名、縮放，也不宣稱完整 Hyundai Rotem 復刻。實作來源基準 `9efce79601deac6a0648cf8e158f3935cbb46f51`；復原工作以 `9d0349d79362466c5bfc66a1618dfebcf46db82f` 文件 checkpoint 為起點。

- 5 個真正可編輯 `.blend`：車外 LOD0/1/2，獨立車內 LOD0/1
- 5 個實際 GLB，外觀及內裝分開 lazy-load；無影像貼圖
- D04/D05 既有 manifest 欄位、單節 frame、門／輪／座席／站立／碰撞／貫通道資料
- 同一 endcar 在前節 +10.5 m、後節 −10.5 m 並旋轉 180° 組成兩節。後節的 car-left 會對應 consist-right，整合時須轉換法向，不能只依字串左右開門
- 11 張真正 GLB 重匯入的 Cycles CPU 圖片，以及來源重開、重匯出、重匯入及暫存編輯證明
- 正向與負向測試；WebGL、搭乘、地形、觸控、資源生命週期均 `not_run`

## 尺度與清楚限制

單節 body 20.5 × 3 m、兩節名義 41.5 m；實際模型編組長度約 41.512 m（fascia 小幅外伸，以 `qa/validation.json` 實測為準）。停車兩端各留 1 m，所需月台長度約 43.512 m；站包採代表性 44 m 平台。

所有高度用軌面 Y=0 的 metre glTF frame。地板／門檻 Y=1.10、天花板底 Y=3.45。每車左右各 3 個 1.50 × 2.13 m 淨開口，中心 Z=−6.4/0/6.4；12 個門片有獨立节点與 plug→slide 位移端點、完整 swept bounds。方向為 +Z 車頭、−X 右側。

這些是**代表性工程尺寸**，不是從照片量測的真車施工尺寸。官方照片支持寬車身、兩節連接、藍色前端、銀色側板、觀景窗與門組形態；2008 年官方刊物支持懸臂座席。來源照片及 PDF 頁面已看實際像素。官方來源連結、雜湊、觀察與近似項見 `references/source-review.json`；出版者的完整文章及照片只作本地檢視輸入，不包進模型或再授權。

- 詳細單節車外：2,220 triangles／43 primitives；中階 1,964／43；展示級 364／15。必要門、輪與 bogie 保留動態节点，未以錯誤合併掩蓋 draw cost
- 車內 LOD0：1,320 triangles／6 primitives；LOD1：984／6。以既有 static batching utility 合批，原座椅等组件節點及精確 vertex/index range 仍保留
- 20 個代表性座位／單節，非官方載客或座位容量；優先座、輪椅／行李空間及相機 pelvis/eye 錨點分開
- 碰撞以 JSON primitives 和動態 door leaf local bounds 表示，`assetRefs.collision=null`，没有假裝另有 collision GLB
- LOD2 只有關門、無乘客展示能力。載客或開門必須鎖定外觀 LOD0/1 + 已載入內裝
- 地板接縫、旋轉編組以及曲線行進中的貫通道通行**尚未接受**；`intercarTraversalEnabled=false`
- CPU 預覽使用 QA 臨時日光／室內 softbox；沒有把燈具、相機、夜景曝光或新夜間 runtime 寫入 GLB

## 重現

在 repo 根目錄執行，Python 需 numpy，Blender 4.3.2：

```sh
# 只有需要重新生成原始程序模型時才用此命令；會覆寫 source。
blender -b -t 2 --python tools/assets/canada-line-stage2/build.py

# 一般美術編輯後應重匯出來源；不執行生成器、不覆寫來源。
blender -b -t 2 --python tools/assets/canada-line-stage2/export.py -- --output /tmp/canada-line-reexport

python tools/assets/canada-line-stage2/validate.py
python tools/assets/canada-line-stage2/test_validate.py
blender -b -t 2 --python tools/assets/canada-line-stage2/audit_source.py
blender -b -t 2 --python tools/assets/canada-line-stage2/render_previews.py
python tools/assets/canada-line-stage2/finalize.py
```

採用美術重匯出的檔案前，需先審查輸出，再更新測量／manifest；生成器不能作為「重新匯出」來抹除美術修改。

## 離線驗證範圍

`qa/validation.json`：真實二進位 GLB 的樓板射線、開門淨空、走道頭部、空置區、門片運動與靜態幾何碰撞、1.95 m 參考人體 capsule、錨點、輪軌 datum、材質、完整編組尺寸。`qa/source-roundtrip.json`：所有來源重匯出 byte-identical，以及暫存來源修改後輸出確實改變、原始檔未變的證明。`qa/render-report.json` 每張圖綁定輸入 GLB SHA-256。

不等同正式場景／手機 GPU 的 draw calls、效能、自由車內走動或完整旅程驗收。離線測試通過後，整合狀態仍為 `runtime_pending_webgl`，D06 尚未實施。未修改 app、既有資產、workflow、package、部署設定。
