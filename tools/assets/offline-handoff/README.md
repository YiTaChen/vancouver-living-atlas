# 離線 Blender 資產總稽核

整合入口：[中文交接清單](../../../docs/BLENDER_ASSET_HANDOFF_2026_10.md)。四個新資產資料夾各自保存作者來源、輸出、預覽及專屬驗證。此處串聯檔案身份與獨立 GLB 檢查，不代替角色變形、材質重烘焙、LOD／alpha／淨空或 Blender 開檔稽核。

- `manifest.json`：四批新增檔案，以及重用的建築／矮植栽來源與共享 maps 的逐檔 SHA-256、大小、用途分類。不是整個 repository 的檔案清單。
- `validation.json`：從實際檔案重新計算的完整性結果、GLB 成本與 PNG 尺寸。
- `validate.py`：只讀的 Python 標準庫檢查；驗證 GLB 結構、嵌入資源、索引界限、所有 JSON／accessor 數值有限、三角形／材質數及沒有預覽燈／相機混入輸出。
- `test_validate.py`：真實 GLB 正例，以及長度、NaN position、無限 node transform、越界 index、錯誤 digest、重複路徑、路徑越界的回歸檢查。
- `build_manifest.py`：在各批來源／輸出重新驗證後，明確更新檔案 inventory。改 hash 不能代替重做資產驗證。

```sh
python3 tools/assets/offline-handoff/validate.py
python3 -m unittest discover -s tools/assets/offline-handoff -p 'test_validate.py'
node --test tests/offline-asset-handoff.test.mjs
```

一般 `npm test` 會跑最後一項，所以未一起更新的候選來源／GLB／貼圖會被偵測。CI 沒有 Blender 時只能執行這個標準庫完整性檢查；不能將它標為「已重新在 Blender 烘焙」。實際 Blender 檢查記錄位於各批 QA 報告。

`.blend` 可為標準或 Blender 自己支援的 gzip／zstd 壓縮格式；檔頭與雜湊只確認容器身份，是否能打開及正確匯出由各批實際 Blender 稽核證明。沒有用預覽圖取代可編輯來源。

所有資產候選維持離線，正式 `public/`／runtime 不變。真實城市的光照、地形、UV 接法、LOD 閾值、FPS／GPU／裝置記憶體及重複釋放由後續整合者驗收。
